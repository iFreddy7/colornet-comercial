import { parseClientes } from './parser.mjs'
import { readClientSheets } from './xlsx-clientes.mjs'
import { unzipSync } from 'npm:fflate@0.8.2'
import { createClient } from 'npm:@supabase/supabase-js@2'
import * as XLSX from 'npm:xlsx@0.18.5'

function secretKey(){const raw=Deno.env.get('SUPABASE_SECRET_KEYS');if(!raw)throw new Error('SUPABASE_SECRET_KEYS ausente');const keys=JSON.parse(raw);return keys.default||Object.values(keys)[0]}
function norm(v:unknown){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim()}
function key(v:unknown){return norm(v).replace(/\s+/g,'')}
function num(v:unknown){if(typeof v==='number')return v;const s=String(v??'').trim().replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'');const n=Number(s);return Number.isFinite(n)?n:0}
function dateISO(v:unknown){
  if(v===null || v===undefined || v===''){
    return null
  }

  // Caso a biblioteca já entregue um Date.
  if(v instanceof Date){
    if(Number.isNaN(v.getTime()))return null

    return [
      String(v.getUTCFullYear()).padStart(4,'0'),
      String(v.getUTCMonth()+1).padStart(2,'0'),
      String(v.getUTCDate()).padStart(2,'0')
    ].join('-')
  }

  // Excel armazena datas como número serial.
  // Fazemos a conversão manualmente para não depender de XLSX.SSF,
  // que não está disponível nessa forma no runtime da Edge Function.
  const converterSerialExcel=(serial:number)=>{
    if(!Number.isFinite(serial) || serial<=0)return null

    const dias=Math.floor(serial)

    // 1899-12-30 compensa o bug histórico do ano bissexto de 1900
    // usado pelo sistema de datas do Excel.
    const epoch=Date.UTC(1899,11,30)
    const ms=epoch+(dias*86400000)
    const d=new Date(ms)

    if(Number.isNaN(d.getTime()))return null

    return [
      String(d.getUTCFullYear()).padStart(4,'0'),
      String(d.getUTCMonth()+1).padStart(2,'0'),
      String(d.getUTCDate()).padStart(2,'0')
    ].join('-')
  }

  if(typeof v==='number'){
    return converterSerialExcel(v)
  }

  const s=String(v??'').trim()

  if(!s)return null

  // Alguns arquivos podem trazer o serial do Excel como texto.
  if(/^\d+(?:[.,]\d+)?$/.test(s)){
    const serial=Number(s.replace(',','.'))
    const porSerial=converterSerialExcel(serial)

    if(porSerial)return porSerial
  }

  // dd/mm/aaaa, dd-mm-aaaa ou dd.mm.aaaa
  let m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/)

  if(m){
    return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
  }

  // dd/mm/aa
  m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2})$/)

  if(m){
    const yy=Number(m[3])
    const ano=yy>=70 ? 1900+yy : 2000+yy

    return `${ano}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
  }

  // aaaa-mm-dd / aaaa/mm/dd
  m=s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)

  if(m){
    return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`
  }

  return null
}

function erroEstruturado(e:any){
  if(!e) return { message:'Erro desconhecido' }

  if(e instanceof Error){
    return {
      name:e.name,
      message:e.message,
      stack:e.stack ? e.stack.split('\n').slice(0,8).join('\n') : null
    }
  }

  if(typeof e === 'object'){
    return {
      code:e.code ?? null,
      message:e.message ?? null,
      details:e.details ?? null,
      hint:e.hint ?? null,
      status:e.status ?? null,
      statusText:e.statusText ?? null
    }
  }

  return { message:String(e) }
}

function findHeader(rows:any[][], need:string[]){
  const procurados=need.map(key)

  for(let r=0;r<Math.min(rows.length,20);r++){
    const h=rows[r].map(key)

    if(
      procurados.every(
        n=>h.some(x=>x.includes(n))
      )
    ){
      return r
    }
  }

  return -1
}

function col(headers:any[], names:string[]){
  const h=headers.map(key)

  for(const nome of names){
    const n=key(nome)

    const i=h.findIndex(
      x=>x===n || x.includes(n)
    )

    if(i>=0)return i
  }

  return -1
}
function matchFilial(raw:any, filiais:any[]){
  const n=key(raw)

  if(!n)return null

  // Primeiro tenta código/nome exatamente como cadastrado no Supabase.
  const direta=filiais.find(
    f=>
      n===key(f.codigo) ||
      n===key(f.nome) ||
      n.includes(key(f.codigo)) ||
      n.includes(key(f.nome))
  )

  if(direta)return direta

  // Aliases usados no FUP / operação Colornet.
  if(
    n.includes('ITAJAI') ||
    n==='SC' ||
    n==='0102'
  ){
    return filiais.find(f=>String(f.codigo)==='0102')||null
  }

  if(
    n.includes('MAUA') ||
    n==='0103'
  ){
    return filiais.find(f=>String(f.codigo)==='0103')||null
  }

  // O FUP usa "São Paulo" para a filial SP Matriz.
  if(
    n==='SAOPAULO' ||
    n==='SP' ||
    n.includes('SAOPAULO')
  ){
    return filiais.find(f=>String(f.codigo)==='0101')||null
  }

  return null
}

function quaseIgual(a:number,b:number,eps=0.000001){
  return Math.abs(a-b)<=eps
}

function mesmoPreco(a:any,b:any){
  return (
    String(a.moeda||'USD')===String(b.moeda||'USD') &&
    quaseIgual(Number(a.faixa_1||0),Number(b.faixa_1||0)) &&
    quaseIgual(Number(a.faixa_2||0),Number(b.faixa_2||0)) &&
    quaseIgual(Number(a.faixa_3||0),Number(b.faixa_3||0))
  )
}

async function fingerprint(valor:string){
  const bytes=new TextEncoder().encode(valor)
  const digest=await crypto.subtle.digest('SHA-256',bytes)
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,12)
}

Deno.serve(async(req)=>{
  try{
    if(req.method!=='POST')return Response.json({erro:'POST obrigatório'},{status:405})

    const recebido=req.headers.get('x-ingest-secret')??''
    const esperado=Deno.env.get('INGEST_SECRET')??''

    const diagnosticoSegredo={
      recebidoExiste:recebido.length>0,
      recebidoTamanho:recebido.length,
      recebidoFingerprint:await fingerprint(recebido),
      esperadoExiste:esperado.length>0,
      esperadoTamanho:esperado.length,
      recebidoTrimTamanho:recebido.trim().length,
      esperadoTrimTamanho:esperado.trim().length,
      iguais:recebido===esperado,
      iguaisAposTrim:recebido.trim()===esperado.trim()
    }

    console.log('DIAGNOSTICO_INGEST',diagnosticoSegredo)

    if(!esperado || recebido!==esperado){
      return Response.json(
        {
          erro:'Não autorizado',
          diagnostico:diagnosticoSegredo
        },
        {status:401}
      )
    }

    const form=await req.formData();const file=form.get('file');if(!(file instanceof File))throw new Error('Anexo file obrigatório')
    if (String(form.get('tipo')||'').toUpperCase()==='CLIENTES') {
      const sender=String(form.get('sender')||'').trim().toLowerCase();
      if(!['jrodrigues@colornet.com.br','marcia@colornet.com.br'].includes(sender)) return Response.json({sucesso:false,erro:'Remetente não autorizado'},{status:403});
      const emailId=String(form.get('email_id')||'');const received=String(form.get('received_at')||'');
      if(!emailId||!received||!Number.isFinite(Date.parse(received)))return Response.json({sucesso:false,erro:'Identificação e data do e-mail obrigatórias'},{status:422});
      if(file.size>15*1024*1024)return Response.json({sucesso:false,erro:'Arquivo excede 15 MB'},{status:413});
      const apply=String(form.get('apply')||'false')==='true';
      const admin=createClient(Deno.env.get('SUPABASE_URL')!,secretKey() as string,{auth:{persistSession:false,autoRefreshToken:false}});
      let parsed;
      try {
        parsed=parseClientes(readClientSheets(new Uint8Array(await file.arrayBuffer()),unzipSync));
      }catch(e){return Response.json({sucesso:false,erro:String(e instanceof Error?e.message:e),pendencias:1},{status:422});}
      const {data,error}=await admin.rpc('aplicar_clientes_email',{p_linhas:parsed.linhas,p_chave:emailId,p_arquivo:file.name,p_recebido:received,p_apply:apply});
      const log={tipo:'CLIENTES',ambiente:'PRODUCAO',external_id:emailId,assunto:String(form.get('subject')||''),remetente:sender,arquivo:file.name,recebido_em:received,modo:apply?'APLICAR':'DRY_RUN',status:error?'ERRO':apply?'APLICADO':'DRY_RUN_OK',linhas_total:parsed.linhas.length,linhas_aplicadas:!error&&apply?parsed.linhas.length:0,pendencias:error?1:0,detalhes:{...(data||{}),duplicados_identicos:parsed.duplicados_identicos,...(error?{erro:error.message}:{})}};
      await admin.from('integracao_execucoes').insert(log);
      if(error)return Response.json({sucesso:false,erro:error.message,pendencias:1},{status:422});
      return Response.json({sucesso:true,...log,resumo:data});
    }

    const tipo=String(form.get('tipo')||'').toUpperCase();const apply=String(form.get('apply')||'false').toLowerCase()==='true';const ambiente=Deno.env.get('APP_ENV')||'HOMOLOGACAO'
    if(!['ESTOQUE','PRECOS','PREVISAO'].includes(tipo))throw new Error('tipo inválido')
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''}) as any[][]
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,secretKey() as string,{auth:{persistSession:false,autoRefreshToken:false}})
    const [{data:produtos},{data:filiais}]=await Promise.all([admin.from('produtos').select('id,codigo_protheus,nome').eq('ativo',true),admin.from('filiais').select('id,codigo,nome,uf').eq('ativo',true)])
    const byCode=new Map(
      (produtos||[])
        .filter((p:any)=>p.codigo_protheus)
        .map((p:any)=>[key(p.codigo_protheus),p])
    )

    const byName=new Map<string,any[]>()

    for(const p of produtos||[]){
      const k=key((p as any).nome)
      byName.set(k,[...(byName.get(k)||[]),p])
    }

    const matchProd=(c:any,n:any)=>{
      const porCodigo=c ? byCode.get(key(c)) : null
      const arrNome=n ? (byName.get(key(n))||[]) : []
      const porNome=arrNome.length===1 ? arrNome[0] : null

      if(porCodigo && porNome && porCodigo.id===porNome.id){
        return porCodigo
      }

      if(porCodigo && porNome && porCodigo.id!==porNome.id){
        console.log('CODIGO_CORRIGIDO_POR_NOME',{
          codigo_recebido:String(c||''),
          nome_recebido:String(n||''),
          produto_codigo:porCodigo.nome,
          codigo_utilizado:porNome.codigo_protheus,
          produto_utilizado:porNome.nome
        })
        return porNome
      }

      if(porCodigo)return porCodigo
      if(porNome)return porNome

      return null
    }
    let parsed:any[]=[]
    let pend:any[]=[]
    let duplicadosIdenticos:any[]=[]
    let duplicadosConflitantes:any[]=[]
    if(tipo==='ESTOQUE'){
      const hr=findHeader(rows,['DISPONIVEL','PRODUTO']);if(hr<0)throw new Error('Cabeçalho de estoque não reconhecido')
      const h=rows[hr], iFil=col(h,['FILIAL']),iCod=col(h,['CODIGO PRODUTO','PRODUTO']),iNome=col(h,['DESCRICAO']),iQtd=col(h,['DISPONIVEL']);if(iFil<0||iCod<0||iQtd<0)throw new Error('Colunas obrigatórias do estoque não encontradas')
      const agg=new Map<string,any>();for(const r of rows.slice(hr+1)){const cod=r[iCod],nome=iNome>=0?r[iNome]:'',q=num(r[iQtd]);if(!cod&&!nome)continue;const p=matchProd(cod,nome),f=matchFilial(r[iFil],filiais||[]);if(!p||!f){pend.push({codigo:cod,nome,filial:r[iFil],motivo:!p?'produto não encontrado':'filial não encontrada'});continue}const k=`${p.id}|${f.id}`;const a=agg.get(k)||{produto_id:p.id,filial_id:f.id,quantidade:0};a.quantidade+=q;agg.set(k,a)}parsed=[...agg.values()]
    }
    if(tipo==='PRECOS'){
      const hr=findHeader(rows,['FAIXA1','FAIXA2','FAIXA3'])
      if(hr<0)throw new Error('Cabeçalho da lista de preços não reconhecido')

      const h=rows[hr]
      const iCod=col(h,['CODE','CODIGO'])
      const iNome=col(h,['DESCRIPTION','DESCRICAO','PRODUCT','PRODUTO'])
      const i1=col(h,['FAIXA1'])
      const i2=col(h,['FAIXA2'])
      const i3=col(h,['FAIXA3'])

      if(iNome<0||i1<0||i2<0||i3<0){
        throw new Error('Colunas de preço não encontradas')
      }

      const porProduto=new Map<string,any>()
      const produtosEmConflito=new Set<string>()

      const linhas=rows.slice(hr+1)

      for(let idx=0;idx<linhas.length;idx++){
        const r=linhas[idx]
        const linhaExcel=hr+2+idx

        const cod=iCod>=0?r[iCod]:''
        const nome=r[iNome]

        if(!cod&&!nome)continue

        const p=matchProd(cod,nome)
        const a=num(r[i1])
        const b=num(r[i2])
        const c=num(r[i3])

        if(!p){
          pend.push({
            linha:linhaExcel,
            codigo:cod,
            nome,
            motivo:'produto não encontrado/ambíguo'
          })
          continue
        }

        if(!(a>0&&b>0&&c>0&&a<=b&&b<=c)){
          pend.push({
            linha:linhaExcel,
            codigo:cod,
            nome,
            motivo:'faixas inválidas',
            faixas:[a,b,c]
          })
          continue
        }

        const candidato={
          produto_id:p.id,
          moeda:'USD',
          faixa_1:a,
          faixa_2:b,
          faixa_3:c,
          _linha:linhaExcel,
          _codigo:String(cod||''),
          _nome:String(nome||'')
        }

        // Se já detectamos conflito para o produto, não tentamos
        // escolher arbitrariamente uma das linhas.
        if(produtosEmConflito.has(p.id)){
          duplicadosConflitantes.push({
            produto_id:p.id,
            linha:linhaExcel,
            codigo:cod,
            nome,
            motivo:'produto já possui duplicidade conflitante na mesma planilha'
          })
          continue
        }

        const anterior=porProduto.get(p.id)

        if(!anterior){
          porProduto.set(p.id,candidato)
          continue
        }

        if(mesmoPreco(anterior,candidato)){
          // Duplicidade idêntica: segura para consolidar em uma única linha.
          duplicadosIdenticos.push({
            produto_id:p.id,
            codigo:cod || anterior._codigo,
            nome:nome || anterior._nome,
            linha_primeira:anterior._linha,
            linha_duplicada:linhaExcel,
            faixas:[a,b,c]
          })
          continue
        }

        // Duplicidade com valores diferentes: bloqueia APPLY.
        produtosEmConflito.add(p.id)
        porProduto.delete(p.id)

        const conflito={
          produto_id:p.id,
          codigo:cod || anterior._codigo,
          nome:nome || anterior._nome,
          motivo:'produto duplicado com preços diferentes',
          linha_primeira:anterior._linha,
          linha_conflitante:linhaExcel,
          faixas_primeira:[
            anterior.faixa_1,
            anterior.faixa_2,
            anterior.faixa_3
          ],
          faixas_conflitante:[a,b,c]
        }

        duplicadosConflitantes.push(conflito)
        pend.push(conflito)
      }

      parsed=[...porProduto.values()].map(x=>({
        produto_id:x.produto_id,
        moeda:x.moeda,
        faixa_1:x.faixa_1,
        faixa_2:x.faixa_2,
        faixa_3:x.faixa_3
      }))
    }
    if(tipo==='PREVISAO'){
      // Layout real do FUP usado anteriormente pelo Apps Script:
      // FILIAL | NO. DA S.I. | NO. P.O. | PED. COMPRA | PROCESSO |
      // STATUS | FORNECEDOR | CODIGO | NOME COLORNET | QUANTIDADE |
      // NRO DO LOTE | PREV. ESTOQUE | OBS OPERACIONAL
      //
      // O erro anterior acontecia porque "PREV. ESTOQUE" normaliza para
      // PREVESTOQUE, e não para PREVISAO.

      const hr=findHeader(rows,['QUANTIDADE','PREVESTOQUE'])

      if(hr<0){
        const amostra=rows
          .slice(0,15)
          .map((r:any[],i:number)=>({
            linha:i+1,
            valores:r
              .map(v=>String(v??'').trim())
              .filter(v=>v!=='')
              .slice(0,25)
          }))
          .filter(x=>x.valores.length>0)

        return Response.json({
          sucesso:false,
          etapa:'CABECALHO_PREVISAO',
          tipo,
          arquivo:file.name,
          erro:'Cabeçalho de previsão não reconhecido.',
          cabecalhos_esperados:[
            'FILIAL',
            'CODIGO',
            'QUANTIDADE',
            'PREV. ESTOQUE'
          ],
          amostra_primeiras_linhas:amostra
        },{status:422})
      }

      const h=rows[hr]

      const iFil=col(h,['FILIAL'])

      const iSI=col(h,[
        'NO DA SI',
        'N DA SI',
        'SI'
      ])

      const iPO=col(h,[
        'NO PO',
        'N PO',
        'PO'
      ])

      const iPC=col(h,[
        'PED COMPRA',
        'PEDIDO COMPRA'
      ])

      const iProc=col(h,['PROCESSO'])
      const iStatus=col(h,['STATUS'])
      const iFor=col(h,['FORNECEDOR'])

      const iCod=col(h,[
        'CODIGO PRODUTO',
        'CODIGO'
      ])

      const iNome=col(h,[
        'NOME COLORNET',
        'NOME PRODUTO',
        'DESCRICAO',
        'PRODUTO'
      ])

      const iQtd=col(h,[
        'QUANTIDADE PREVISTA',
        'QUANTIDADE'
      ])

      const iLote=col(h,[
        'NRO DO LOTE',
        'N DO LOTE',
        'LOTE'
      ])

      const iData=col(h,[
        'PREV ESTOQUE',
        'PREVISAO DE ESTOQUE',
        'PREVISAO'
      ])

      const iObs=col(h,[
        'OBS OPERACIONAL',
        'OBSERVACAO OPERACIONAL'
      ])

      if(iFil<0||iCod<0||iQtd<0||iData<0){
        return Response.json({
          sucesso:false,
          etapa:'COLUNAS_PREVISAO',
          tipo,
          arquivo:file.name,
          erro:'Colunas obrigatórias da previsão não encontradas.',
          cabecalho_encontrado:h.map(v=>String(v??'')),
          indices:{
            filial:iFil,
            codigo:iCod,
            quantidade:iQtd,
            previsao:iData,
            nome:iNome,
            processo:iProc,
            pedido_compra:iPC,
            fornecedor:iFor,
            lote:iLote,
            status:iStatus,
            si:iSI,
            po:iPO,
            obs:iObs
          }
        },{status:422})
      }

      const mapa=new Map<string,any>()
      const linhas=rows.slice(hr+1)

      for(let idx=0;idx<linhas.length;idx++){
        const r=linhas[idx]
        const linhaExcel=hr+2+idx

        const cod=String(r[iCod]??'').trim()
        const nome=iNome>=0 ? String(r[iNome]??'').trim() : ''

        if(!cod&&!nome)continue

        const q=num(r[iQtd])
        const previsao=dateISO(r[iData])
        const f=matchFilial(r[iFil],filiais||[])
        const p=matchProd(cod,nome)

        const status=iStatus>=0
          ? String(r[iStatus]??'').trim()
          : 'ATIVO'

        const statusNorm=key(status)

        // Mesma regra usada no sistema legado:
        // itens cancelados/finalizados/encerrados não entram como previsão ativa.
        if(
          statusNorm.includes('CANCEL') ||
          statusNorm.includes('FINALIZ') ||
          statusNorm.includes('ENCERR')
        ){
          continue
        }

        if(!p){
          pend.push({
            linha:linhaExcel,
            codigo:cod,
            nome,
            filial:r[iFil],
            motivo:'produto não encontrado/ambíguo'
          })
          continue
        }

        if(!f){
          pend.push({
            linha:linhaExcel,
            codigo:cod,
            nome,
            filial:r[iFil],
            motivo:'filial não encontrada'
          })
          continue
        }

        if(!(q>0)){
          pend.push({
            linha:linhaExcel,
            codigo:cod,
            nome,
            filial:r[iFil],
            quantidade:r[iQtd],
            motivo:'quantidade inválida'
          })
          continue
        }

        if(!previsao){
          const dataOriginal=String(r[iData]??'').trim()

          // No FUP, "/  /" significa que ainda não existe previsão de estoque.
          // O sistema legado simplesmente ignorava essas linhas até receberem data.
          // Mantemos o mesmo comportamento para não bloquear todo o snapshot.
          const conteudoData=dataOriginal.replace(/[\\/\.\-_:;\s]+/g,'')

          if(!conteudoData){
            continue
          }

          pend.push({
            linha:linhaExcel,
            codigo:cod,
            nome,
            filial:r[iFil],
            previsao_original:r[iData],
            motivo:'data de previsão inválida'
          })
          continue
        }

        const si=iSI>=0 ? String(r[iSI]??'').trim() : ''
        const po=iPO>=0 ? String(r[iPO]??'').trim() : ''
        const pc=iPC>=0 ? String(r[iPC]??'').trim() : ''
        const processo=iProc>=0 ? String(r[iProc]??'').trim() : ''
        const fornecedor=iFor>=0 ? String(r[iFor]??'').trim() : ''
        const lote=iLote>=0 ? String(r[iLote]??'').trim() : ''

        // Replica a chave de consolidação do sistema legado.
        const chave=[
          key(si),
          key(po),
          key(pc),
          key(processo),
          p.id,
          f.id,
          key(lote)
        ].join('|')

        const anterior=mapa.get(chave)

        if(!anterior){
          mapa.set(chave,{
            produto_id:p.id,
            filial_id:f.id,
            quantidade:q,
            previsao,
            processo:processo||null,
            pedido_compra:pc||null,
            fornecedor:fornecedor||null,
            lote:lote||null,
            status:status||'ATIVO'
          })
        }else{
          anterior.quantidade+=q

          // Mantém a data mais próxima caso o mesmo agrupamento
          // apareça com datas diferentes.
          if(
            previsao &&
            (!anterior.previsao || previsao<anterior.previsao)
          ){
            anterior.previsao=previsao
          }
        }
      }

      parsed=[...mapa.values()]
    }
    let aplicadas=0
    let status='DRY_RUN_OK'

    if(apply){
      if(parsed.length===0){
        return Response.json({
          sucesso:false,
          etapa:'VALIDACAO_APPLY',
          erro:'Nenhuma linha válida para aplicar.',
          tipo,
          arquivo:file.name
        },{status:422})
      }

      if(pend.length>0){
        return Response.json({
          sucesso:false,
          etapa:'VALIDACAO_APPLY',
          erro:`Aplicação bloqueada: existem ${pend.length} pendência(s).`,
          tipo,
          arquivo:file.name,
          linhas_validas:parsed.length,
          pendencias:pend.length,
          amostra_pendencias:pend.slice(0,20),
          duplicados_identicos:duplicadosIdenticos.slice(0,20),
          duplicados_conflitantes:duplicadosConflitantes.slice(0,20)
        },{status:422})
      }

      if(
        tipo==='PRECOS' &&
        parsed.length<Math.max(1,Math.floor((produtos||[]).length*.8))
      ){
        return Response.json({
          sucesso:false,
          etapa:'VALIDACAO_APPLY',
          erro:'Bloqueio de segurança: menos de 80% dos produtos tiveram preço válido.',
          tipo,
          arquivo:file.name,
          linhas_validas:parsed.length,
          produtos_ativos:(produtos||[]).length
        },{status:422})
      }

      let rpc=''
      let args:any={}
      let res:any=null

      if(tipo==='ESTOQUE'){
        rpc='aplicar_snapshot_estoque_email'
        args={p_linhas:parsed}
      }else if(tipo==='PRECOS'){
        rpc='aplicar_lista_precos_email'
        args={p_linhas:parsed,p_arquivo:file.name}
      }else if(tipo==='PREVISAO'){
        rpc='aplicar_previsao_estoque_email'
        args={p_linhas:parsed}
      }

      console.log('APPLY_RPC_INICIO',{
        tipo,
        rpc,
        arquivo:file.name,
        linhas:parsed.length
      })

      res=await admin.rpc(rpc,args)

      console.log('APPLY_RPC_RETORNO',{
        tipo,
        rpc,
        data:res?.data ?? null,
        error:res?.error ? erroEstruturado(res.error) : null
      })

      if(res?.error){
        const erroRpc=erroEstruturado(res.error)

        return Response.json({
          sucesso:false,
          etapa:'RPC_APPLY',
          tipo,
          rpc,
          arquivo:file.name,
          linhas_enviadas:parsed.length,
          erro:erroRpc
        },{status:500})
      }

      aplicadas=Number(res?.data||0)
      status='APLICADO'
    }

    const log={
      tipo,
      ambiente,
      external_id:String(form.get('email_id')||''),
      assunto:String(form.get('subject')||''),
      remetente:String(form.get('sender')||''),
      arquivo:file.name,
      recebido_em:String(form.get('received_at')||'')||null,
      modo:apply?'APLICAR':'DRY_RUN',
      status,
      linhas_total:parsed.length+pend.length,
      linhas_aplicadas:apply?aplicadas:parsed.length,
      pendencias:pend.length,
      detalhes:{
        planilha:wb.SheetNames[0],
        amostra_pendencias:pend.slice(0,20),
        duplicados_identicos:duplicadosIdenticos.slice(0,20),
        duplicados_conflitantes:duplicadosConflitantes.slice(0,20),
        total_duplicados_identicos:duplicadosIdenticos.length,
        total_duplicados_conflitantes:duplicadosConflitantes.length
      }
    }

    const logRes=await admin
      .from('integracao_execucoes')
      .insert(log)

    if(logRes.error){
      console.error(
        'ERRO_LOG_INTEGRACAO',
        erroEstruturado(logRes.error)
      )
    }

    return Response.json({
      sucesso:true,
      ...log,
      pendencias_amostra:pend.slice(0,20),
      duplicados_identicos:duplicadosIdenticos.slice(0,20),
      duplicados_conflitantes:duplicadosConflitantes.slice(0,20)
    })

  }catch(e){
    const info=erroEstruturado(e)

    console.error(
      'ERRO_INGEST_GERAL',
      info
    )

    return Response.json({
      sucesso:false,
      etapa:'EXCECAO_GERAL',
      erro:info
    },{status:500})
  }
})
