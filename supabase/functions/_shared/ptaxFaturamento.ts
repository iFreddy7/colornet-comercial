export type PtaxFaturamento = {status: 'DEFINIDA'|'PENDENTE'; valor: number|null; referencia: string|null; data_limite: string; criterio: 'D_1'|'APOS_14H'}
const shift = (iso: string, dias: number) => {const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+dias);return d.toISOString().slice(0,10)}
export function regraPtaxFaturamento(criadoEm: string) {
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(criadoEm)) throw new Error('Data do pedido sem fuso.')
  const date=new Date(criadoEm)
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date)
  const v=(type:string)=>parts.find(p=>p.type===type)!.value
  const dia=`${v('year')}-${v('month')}-${v('day')}`,hora=`${v('hour')}:${v('minute')}:${v('second')}`
  const apos=hora>'14:00:00'||(hora==='14:00:00'&&date.getUTCMilliseconds()>0)
  return {data_limite:apos?dia:shift(dia,-1),criterio:apos?'APOS_14H' as const:'D_1' as const}
}
export async function consultarPtaxFaturamento(criadoEm: string, consultar: typeof fetch=fetch, agora=new Date()):Promise<PtaxFaturamento> {
  const regra=regraPtaxFaturamento(criadoEm), pendente:PtaxFaturamento={...regra,status:'PENDENTE',valor:null,referencia:null}
  const bcbDate=(iso:string)=>`${iso.slice(5,7)}-${iso.slice(8,10)}-${iso.slice(0,4)}`
  const url=new URL('https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)')
  url.searchParams.set('@dataInicial',`'${bcbDate(shift(regra.data_limite,-14))}'`)
  url.searchParams.set('@dataFinalCotacao',`'${bcbDate(regra.data_limite)}'`)
  url.searchParams.set('$orderby','dataHoraCotacao desc');url.searchParams.set('$top','1');url.searchParams.set('$format','json')
  try {
    const res=await consultar(url.toString().replace(/\+/g,'%20'),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)})
    if(!res.ok)return pendente
    const data=await res.json(),row=data?.value?.[0],valor=Number(row?.cotacaoVenda)
    const referencia=String(row?.dataHoraCotacao||'').slice(0,10)
    if(!/^\d{4}-\d{2}-\d{2}$/.test(referencia)||!Number.isFinite(valor)||valor<=0||valor>1000||referencia>regra.data_limite||referencia<shift(regra.data_limite,-14))return pendente
    // No próprio dia, não usar o fechamento de ontem como se fosse o de hoje.
    // Em fins de semana, o último fechamento publicado é a referência disponível.
    const hoje=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(agora)
    const semana=new Date(regra.data_limite+'T12:00:00Z').getUTCDay()
    if(regra.criterio==='APOS_14H'&&regra.data_limite>=hoje&&semana!==0&&semana!==6&&referencia!==regra.data_limite)return pendente
    return {...regra,status:'DEFINIDA',valor,referencia}
  } catch {return pendente}
}
export function textoPtaxFaturamento(ptax:PtaxFaturamento) {
  const data=(iso:string)=>iso.split('-').reverse().join('/')
  const regra=ptax.criterio==='APOS_14H'?'Pedido após as 14h: fechamento do dia, referência D−1 do próximo dia útil.':'Pedido até as 14h: último fechamento disponível até o dia anterior (D−1).'
  const valor=ptax.status==='DEFINIDA'&&ptax.valor!=null&&ptax.referencia
    ?`PTAX venda para faturamento: R$ ${Number(ptax.valor).toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4})} por US$ 1. Data de referência: ${data(ptax.referencia)}.`
    :'PTAX para faturamento pendente de confirmação/publicação pelo Banco Central. O pedido foi registrado; não foi atribuída uma taxa provisória.'
  return `${valor} ${regra} Fonte: Banco Central do Brasil. Horário de Brasília.`
}
