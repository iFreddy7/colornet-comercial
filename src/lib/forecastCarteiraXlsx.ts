import type ExcelJS from 'exceljs'

export const normalNome=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,' ')
export function textoSimples(cell:ExcelJS.Cell):string {
  const v=cell.value
  if(v==null)return ''
  if(typeof v!=='string'&&typeof v!=='number')throw Error(`Célula ${cell.address}: use texto ou número, sem links ou fórmulas.`)
  return String(v).trim()
}
export function separarCodigo(value:string) {
  const m=value.match(/^([^-]+?)\s*-\s*(.+)$/)
  if(!m)throw Error('Informe código e nome separados por hífen na coluna A.')
  return {codigo:m[1].trim(),nome:m[2].trim()}
}
export type GrupoCarteira={linha:number;origem:string;codigo:string;nome:string}
export type LinhaCarteira={linha:number;grupo:GrupoCarteira;codigo:string;quantidades:Record<string,number>}
export type LeituraCarteira={vendedor:string;linhas:LinhaCarteira[];erros:string[];ignoradas:number;arredondadas:number}

function numero(cell:ExcelJS.Cell,blankZero=false):number {
  const t=textoSimples(cell)
  if(t===''&&blankZero)return 0
  if(!/^-?\d+(?:[.,]\d+)?$/.test(t))throw Error(`Célula ${cell.address}: número inválido. Use vírgula decimal, sem separador de milhar.`)
  const n=Number(t.replace(',','.'))
  if(!Number.isFinite(n))throw Error(`Célula ${cell.address}: número fora do limite.`)
  return n
}
function formula(cell:ExcelJS.Cell) {return cell.formula?.replace(/\s/g,'').replace(/'Histórico'!/g,'Histórico!')||''}

// Somente as duas fórmulas do modelo são calculadas; resultados em cache não são confiáveis.
function mediaBase(sheet:ExcelJS.Worksheet,hist:ExcelJS.Worksheet|undefined,row:number,grupo:GrupoCarteira,codigo:string) {
  const d=sheet.getCell(row,4)
  if(!d.formula)return numero(d)
  const f=formula(d),match=f.match(/^MAX\(0,SUM\(INDEX\(Histórico!\$C(\d+):\$AN\1,1,COLUMNS\(Histórico!\$C\1:\$AN\1\)-\$B\$3\+1\):INDEX\(Histórico!\$C\1:\$AN\1,1,COLUMNS\(Histórico!\$C\1:\$AN\1\)\)\)\/\$B\$3\)$/i)
  if(!match||!hist)throw Error(`Célula D${row}: fórmula de média não reconhecida. Mantenha a fórmula original ou informe uma quantidade nas colunas dos meses.`)
  const hr=Number(match[1]),n=numero(sheet.getCell('B3'))
  if(!Number.isInteger(n)||n<1||n>38)throw Error('B3: informe de 1 a 38 meses para calcular a média.')
  if(hr<7||hr>hist.rowCount||normalNome(textoSimples(hist.getCell(hr,2)))!=='PRODUTO'||normalNome(separarCodigo(textoSimples(hist.getCell(hr,1))).codigo)!==normalNome(codigo))throw Error(`D${row}: a fórmula aponta para outro produto no Histórico.`)
  let pai=hr-1
  while(pai>=7&&normalNome(textoSimples(hist.getCell(pai,2)))!=='CLIENTE')pai--
  if(pai<7||normalNome(textoSimples(hist.getCell(pai,1)))!==normalNome(grupo.origem))throw Error(`D${row}: a fórmula aponta para outro cliente no Histórico.`)
  let soma=0
  for(let col=41-n;col<=40;col++)soma+=numero(hist.getCell(hr,col),true)
  return Math.max(0,soma/n)
}

export function lerCarteiraXlsx(wb:ExcelJS.Workbook):LeituraCarteira {
  const sheet=wb.getWorksheet('Forecast')!
  const titulo=textoSimples(sheet.getCell('A1')).match(/^Forecast de faturamento\s*[—–-]\s*(.+)$/i)
  if(!titulo||normalNome(textoSimples(sheet.getCell('A5')))!=='CLIENTE / PRODUTO'||normalNome(textoSimples(sheet.getCell('B5')))!=='NIVEL')throw Error('Use a planilha base do portal ou o modelo Forecast de faturamento, mantendo os cabeçalhos.')
  if(sheet.rowCount>2507)throw Error('Importe até 2.000 produtos e 500 grupos de clientes por arquivo.')
  const meses:Array<{col:number;mes:string}>=[],seen=new Set<string>()
  let fimMeses=false
  for(let col=6;col<=sheet.columnCount;col++) {
    const ano=textoSimples(sheet.getCell(5,col)),mes=textoSimples(sheet.getCell(6,col))
    if(!ano&&!mes){fimMeses=true;continue}
    if(normalNome(ano)==='TOTAIS (KG)'){fimMeses=true;continue}
    if(fimMeses)throw Error('Há uma lacuna nos cabeçalhos dos meses. Preserve todos os anos e meses consecutivos antes dos totais.')
    if(!/^20[2-9]\d$/.test(ano)||!/^([1-9]|1[0-2])$/.test(mes))throw Error('Cabeçalhos de meses inválidos. Preserve os anos na linha 5 e os meses na linha 6.')
    const key=`${ano}-${mes.padStart(2,'0')}`
    if(seen.has(key))throw Error('Mês repetido no cabeçalho.')
    seen.add(key);meses.push({col,mes:key})
  }
  if(!meses.length||meses.length>36)throw Error('Informe de 1 a 36 meses nas colunas a partir de F.')
  const out:LeituraCarteira={vendedor:titulo[1].trim(),linhas:[],erros:[],ignoradas:0,arredondadas:0}
  let grupo:GrupoCarteira|null=null,produtos=0
  for(let row=8;row<=sheet.rowCount;row++) {
    try {
      const nivel=normalNome(textoSimples(sheet.getCell(row,2)))
      if(nivel==='CLIENTE') {
        grupo=null
        const origem=textoSimples(sheet.getCell(row,1))
        grupo={linha:row,origem,...separarCodigo(origem)};continue
      }
      if(!nivel&&!textoSimples(sheet.getCell(row,1)))continue
      if(nivel!=='PRODUTO')throw Error('Nível desconhecido: use Cliente ou Produto, sem alterar a estrutura do modelo.')
      if(++produtos>2000)throw Error('Limite de 2.000 produtos por arquivo.')
      if(!grupo)throw Error('Produto sem cliente acima dele.')
      const codigo=separarCodigo(textoSimples(sheet.getCell(row,1))).codigo
      const quantidades:Record<string,number>={};let media:number|undefined
      for(const {col,mes} of meses) {
        const cell=sheet.getCell(row,col)
        if(cell.value==null||cell.value==='')continue
        let value:number
        if(cell.formula) {
          if(formula(cell)!==`$D${row}*(1+$E${row})`)throw Error(`Célula ${cell.address}: fórmula não reconhecida. Mantenha a fórmula original ou cole somente a quantidade calculada.`)
          media??=mediaBase(sheet,wb.getWorksheet('Histórico'),row,grupo,codigo)
          value=media*(1+numero(sheet.getCell(row,5),true))
        }else value=numero(cell)
        if(!Number.isFinite(value)||value<0||value>999999999)throw Error(`Célula ${cell.address}: quantidade deve estar entre zero e 999.999.999 kg.`)
        const rounded=Math.round((value+Number.EPSILON)*1000)/1000
        if(Math.abs(rounded-value)>1e-9)out.arredondadas++
        quantidades[mes]=rounded
      }
      if(!Object.keys(quantidades).length){out.ignoradas++;continue}
      out.linhas.push({linha:row,grupo,codigo,quantidades})
    }catch(e){out.erros.push(`Linha ${row}: ${e instanceof Error?e.message:'Dados inválidos.'}`)}
  }
  return out
}
