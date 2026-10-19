import ExcelJS from 'exceljs'
import type { ForecastDados } from './forecastSupabase'
import {lerCarteiraXlsx,normalNome} from './forecastCarteiraXlsx.ts'
export const MESES_IMPORTACAO=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
export const COLUNAS_IMPORTACAO=['Código vendedor','Vendedor','Código cliente / loja','Cliente','Código produto','Produto','Ano',...MESES_IMPORTACAO]
export type PlanoImportacao={cliente_id:string;vendedor_id:string;revisao:number;itens:Array<{produto_id:string;quantidades:Record<string,number>}>}
export type MudancaForecast={linha:number;vendedor:string;cliente:string;produto:string;codigo:string;mes:string;atual:number|null;novo:number;origem?:string;codigoCliente?:string}
export type EscolhasImportacao={vendedorId?:string;clientes?:Record<string,string>}
export type PendenciaCliente={linha:number;origem:string;candidatos:Array<{id:string;codigo:string;nome:string}>;selecionado:string;motivo:'codigo'|'loja'}
export type RevisaoImportacao={planos:PlanoImportacao[];mudancas:MudancaForecast[];erros:string[];linhas:number;ignoradas:number;iguais:number;avisos:string[];formato:'base'|'carteira';vendedorOrigem?:string;vendedorId?:string;clientesConferir:PendenciaCliente[]}
const novaRevisao=():RevisaoImportacao=>({planos:[],mudancas:[],erros:[],linhas:0,ignoradas:0,iguais:0,avisos:[],formato:'base',clientesConferir:[]})
const normal=(value:string)=>value.trim().toUpperCase().replace(/\s*\/\s*/g,' / ')
function texto(cell:ExcelJS.Cell) {
  const v=cell.value
  if(v==null)return ''
  if(typeof v!=='string'&&typeof v!=='number')throw new Error('Use texto ou número; fórmulas, links e datas automáticas não são aceitos.')
  return String(v).trim()
}
function quantidade(cell:ExcelJS.Cell):number|null {
  const v=texto(cell);if(v==='')return null
  if(!/^\d+(?:[.,]\d{1,3})?$/.test(v))throw new Error('Quantidade inválida: use kg, até 3 casas decimais, sem separador de milhar.')
  const n=Number(v.replace(',','.'));if(!Number.isFinite(n)||n>999999999)throw new Error('Quantidade fora do limite.')
  return n
}
function unico<T extends {codigo:string;id:string;ativo:boolean}>(rows:T[],code:string,label:string):T {
  const encontrados=rows.filter(r=>normal(r.codigo||r.id)===normal(code))
  if(encontrados.length!==1||!encontrados[0].ativo)throw new Error(`${label}: código inexistente, ambíguo ou inativo (${code||'vazio'}).`)
  return encontrados[0]
}
// Inspeciona o diretório ZIP antes de descompactar, limitando tamanho e conteúdo.
export function validarArquivoXlsx(bytes:Uint8Array) {
  if(bytes.byteLength>5_000_000)throw new Error('Arquivo maior que 5 MB.')
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break}
  if(end<0)throw new Error('Arquivo XLSX inválido.')
  const count=view.getUint16(end+10,true);let pos=view.getUint32(end+16,true),total=0
  if(count>1000)throw new Error('Arquivo possui conteúdo demais.')
  for(let i=0;i<count;i++) {
    if(pos+46>bytes.length||view.getUint32(pos,true)!==0x02014b50)throw new Error('Estrutura XLSX inválida.')
    total+=view.getUint32(pos+24,true);const nameLength=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true)
    const name=new TextDecoder().decode(bytes.subarray(pos+46,pos+46+nameLength))
    if(total>40_000_000||/vbaProject|externalLinks|embeddings/i.test(name))throw new Error('Arquivo muito grande ou com conteúdo não permitido. Utilize a planilha base.')
    pos+=46+nameLength+extra+comment
  }
}
export async function lerImportacaoForecast(bytes:Uint8Array,dados:ForecastDados,escolhas:EscolhasImportacao={}):Promise<RevisaoImportacao> {
  validarArquivoXlsx(bytes)
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes as any)
  const sheet=wb.getWorksheet('Forecast')
  if(sheet&&texto(sheet.getCell('A1')).startsWith('Forecast de faturamento'))return revisarCarteira(wb,dados,escolhas)
  if(!sheet||texto(sheet.getCell('A1'))!=='COLORNET | FORECAST V1'||COLUNAS_IMPORTACAO.some((h,i)=>texto(sheet.getCell(6,i+1))!==h))throw new Error('Use a planilha base do portal, mantendo a aba Forecast e os cabeçalhos.')
  if(sheet.rowCount>2006)throw new Error('Importe até 2.000 linhas por arquivo.')
  const result=novaRevisao()
  const planos=new Map<string,PlanoImportacao>(),seen=new Set<string>()
  for(let row=7;row<=sheet.rowCount;row++) {
    try {
      const q=MESES_IMPORTACAO.map((_,m)=>quantidade(sheet.getCell(row,m+8)))
      if(q.every(v=>v==null)){result.ignoradas++;continue}
      result.linhas++
      const vendedor=unico(dados.vendedores,texto(sheet.getCell(row,1)),'Vendedor')
      const cliente=unico(dados.clientes,texto(sheet.getCell(row,3)),'Cliente / loja')
      const produto=unico(dados.produtos,texto(sheet.getCell(row,5)),'Produto')
      if(cliente.vendedorId!==vendedor.id)throw new Error('O cliente não pertence à carteira atual desse vendedor.')
      const ano=texto(sheet.getCell(row,7));if(!/^20[2-9]\d$/.test(ano))throw new Error('Informe um ano de 2020 a 2099.')
      const key=`${vendedor.id}:${cliente.id}`,duplicado=`${key}:${produto.id}:${ano}`
      if(seen.has(duplicado))throw new Error('Cliente, produto e ano repetidos. Consolide as quantidades em uma única linha.')
      seen.add(duplicado)
      const atual=dados.planos.find(p=>p.cliente_id===cliente.id&&p.vendedor_id===vendedor.id)
      let plano=planos.get(key);if(!plano){plano={cliente_id:cliente.id,vendedor_id:vendedor.id,revisao:atual?.revisao||0,itens:[]};planos.set(key,plano)}
      let item=plano.itens.find(i=>i.produto_id===produto.id);if(!item){item={produto_id:produto.id,quantidades:{}};plano.itens.push(item)}
      q.forEach((value,m)=>{if(value==null)return;const mes=`${ano}-${String(m+1).padStart(2,'0')}`,anterior=atual?.documento?.[produto.id]?.[mes]??null
        item!.quantidades[mes]=value
        if(anterior===value)result.iguais++
        else result.mudancas.push({linha:row,vendedor:vendedor.nome,cliente:cliente.nome,produto:produto.nome,codigo:produto.codigo,mes,atual:anterior,novo:value})
      })
    }catch(e){result.erros.push(`Linha ${row}: ${e instanceof Error?e.message:'Dados inválidos.'}`)}
  }
  result.planos=[...planos.values()]
  if(result.planos.length>500)result.erros.push('Limite de 500 combinações de cliente e vendedor por arquivo. Divida a planilha.')
  if(result.planos.some(p=>p.itens.length>200))result.erros.push('Limite de 200 produtos por cliente e vendedor.')
  if(!result.linhas)result.erros.push('Nenhuma quantidade preenchida. Informe ao menos um mês; zero também é aceito.')
  return result
}
function revisarCarteira(wb:ExcelJS.Workbook,dados:ForecastDados,escolhas:EscolhasImportacao):RevisaoImportacao {
  const leitura=lerCarteiraXlsx(wb),result=novaRevisao()
  Object.assign(result,{formato:'carteira',vendedorOrigem:leitura.vendedor,erros:leitura.erros,linhas:leitura.linhas.length,ignoradas:leitura.ignoradas})
  result.avisos.push('Somente as quantidades mensais dos produtos serão importadas. Totais de clientes e totais gerais não entram. O Histórico é usado apenas para calcular a média do modelo.')
  if(leitura.arredondadas)result.avisos.push(`${leitura.arredondadas} quantidade(s) arredondada(s) para 3 casas decimais de kg. Confira os valores abaixo.`)
  const vendedores=dados.vendedores.filter(v=>v.ativo&&(escolhas.vendedorId?v.id===escolhas.vendedorId:normalNome(v.nome)===normalNome(leitura.vendedor)))
  if(vendedores.length!==1){result.erros.push(`Selecione o vendedor do portal correspondente a “${leitura.vendedor}”.`);return result}
  const vendedor=vendedores[0];result.vendedorId=vendedor.id
  const grupos=[...new Map(leitura.linhas.map(l=>[l.grupo.linha,l.grupo])).values()]
  const clientes=new Map<number,ForecastDados['clientes'][number]>(),usados=new Map<string,number>()
  for(const grupo of grupos) {
    const carteira=dados.clientes.filter(c=>c.ativo&&c.vendedorId===vendedor.id)
    const porCodigo=carteira.filter(c=>normal(c.codigo)===normal(grupo.codigo)||(!grupo.codigo.includes('/')&&normal(c.codigo.split('/')[0])===normal(grupo.codigo)))
    const candidatos=porCodigo.length?porCodigo:carteira
    const escolha=escolhas.clientes?.[grupo.linha]
    const porNome=candidatos.filter(c=>[c.nome,c.nomeFantasia||''].some(n=>normalNome(n)===normalNome(grupo.nome)))
    const encontrados=escolha?candidatos.filter(c=>c.id===escolha):!porCodigo.length?[]:candidatos.length===1?candidatos:porNome
    if(porCodigo.length!==1)result.clientesConferir.push({linha:grupo.linha,origem:grupo.origem,candidatos,selecionado:encontrados.length===1?encontrados[0].id:'',motivo:porCodigo.length?'loja':'codigo'})
    if(encontrados.length!==1) {
      result.erros.push(`Linha ${grupo.linha}: ${grupo.origem} — ${porCodigo.length?'selecione a loja correta na conferência.':'código não encontrado na carteira atual. Selecione explicitamente o cadastro correspondente ou confira o código / loja.'}`);continue
    }
    const cliente=encontrados[0],anterior=usados.get(cliente.id)
    if(anterior!=null){result.erros.push(`Linhas ${anterior} e ${grupo.linha}: dois grupos apontam para o mesmo cliente / loja (${cliente.codigo}). Identifique as lojas distintas ou consolide os grupos na planilha.`);continue}
    usados.set(cliente.id,grupo.linha);clientes.set(grupo.linha,cliente)
  }
  const planos=new Map<string,PlanoImportacao>(),seen=new Set<string>()
  for(const linha of leitura.linhas) {
    const cliente=clientes.get(linha.grupo.linha);if(!cliente)continue
    try {
      const produto=unico(dados.produtos,linha.codigo,'Produto'),key=cliente.id+':'+produto.id
      if(seen.has(key))throw Error('Produto repetido para o mesmo cliente / loja. Consolide em uma única linha.')
      seen.add(key)
      const atual=dados.planos.find(p=>p.cliente_id===cliente.id&&p.vendedor_id===vendedor.id)
      let plano=planos.get(cliente.id)
      if(!plano){plano={cliente_id:cliente.id,vendedor_id:vendedor.id,revisao:atual?.revisao||0,itens:[]};planos.set(cliente.id,plano)}
      plano.itens.push({produto_id:produto.id,quantidades:linha.quantidades})
      for(const [mes,novo] of Object.entries(linha.quantidades)) {
        const anterior=atual?.documento?.[produto.id]?.[mes]??null
        if(anterior===novo)result.iguais++
        else result.mudancas.push({linha:linha.linha,vendedor:vendedor.nome,cliente:cliente.nome,codigoCliente:cliente.codigo,origem:linha.grupo.origem,produto:produto.nome,codigo:produto.codigo,mes,atual:anterior,novo})
      }
    }catch(e){result.erros.push(`Linha ${linha.linha}: ${e instanceof Error?e.message:'Dados inválidos.'}`)}
  }
  result.planos=[...planos.values()]
  if(result.planos.length>500)result.erros.push('Limite de 500 clientes / vendedores por arquivo.')
  if(result.planos.some(p=>p.itens.length>200))result.erros.push('Limite de 200 produtos por cliente / vendedor.')
  if(!result.linhas)result.erros.push('Nenhuma quantidade preenchida. Informe ao menos um mês; zero também é aceito.')
  return result
}
export async function preencherModeloForecast(base:Uint8Array,dados:ForecastDados,vendedorId:string,ano:number):Promise<Uint8Array> {
  const vendedor=dados.vendedores.find(v=>v.id===vendedorId&&v.ativo);if(!vendedor)throw new Error('Selecione um vendedor ativo.')
  if(!Number.isInteger(ano)||ano<2020||ano>2099)throw new Error('Ano inválido.')
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(base as any)
  const sheet=wb.getWorksheet('Forecast');if(!sheet)throw new Error('Modelo indisponível.')
  sheet.getCell('A3').value=`Vendedor: ${vendedor.nome} | Ano: ${ano} | Quantidades em KG. Vazio mantém; zero zera.`
  const clientes=dados.clientes.filter(c=>c.ativo&&c.vendedorId===vendedorId)
  clientes.forEach((c,i)=>{sheet.getRow(i+7).values=[vendedor.codigo||vendedor.id,vendedor.nome,c.codigo,c.nome,'','',ano];sheet.getRow(i+7).height=24})
  sheet.views=[{state:'frozen',ySplit:6,xSplit:7}]
  sheet.autoFilter={from:'A6',to:`S${Math.max(7,clientes.length+6)}`}
  for(let i=7;i<=Math.max(206,clientes.length+6);i++){
    for(const col of [1,3,5])sheet.getCell(i,col).numFmt='@'
    for(let c=8;c<=19;c++){sheet.getCell(i,c).numFmt='#,##0.###';sheet.getCell(i,c).dataValidation={type:'decimal',operator:'between',formulae:[0,999999999],allowBlank:true,showErrorMessage:true,error:'Informe quantidade em kg entre 0 e 999.999.999.'}}
  }
  const catalogo=wb.getWorksheet('Produtos')||wb.addWorksheet('Produtos')
  catalogo.addRows([['Código produto','Produto'],...dados.produtos.filter(p=>p.ativo).map(p=>[p.codigo||p.id,p.nome])])
  catalogo.getColumn(1).width=24;catalogo.getColumn(2).width=55;catalogo.getColumn(1).numFmt='@';catalogo.views=[{state:'frozen',ySplit:1}]
  catalogo.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};catalogo.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF19337F'}}
  return new Uint8Array(await wb.xlsx.writeBuffer())
}
