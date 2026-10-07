import { supabase } from './supabase'
import { IS_PRODUCTION } from './env'

export type FaturamentoMensal = {periodo:string;filial_codigo:string;vendedor_id:string|null;vendedor_nome:string;cliente_chave:string;cliente_codigo:string;cliente_nome:string;produto_codigo:string;produto_nome:string;quantidade:number;linhas:number}
function verificarAmbiente(){if(IS_PRODUCTION)throw new Error('Histórico disponível somente na homologação.')}
export async function periodosFaturamento(){
  verificarAmbiente()
  const {data,error}=await supabase.rpc('faturamento_periodos_v1')
  if(error)throw error
  return (data as {periodo:string}[]).map(r=>r.periodo)
}
export async function carregarFaturamento(anos:string[]){
  verificarAmbiente()
  if(!anos.length||anos.some(a=>!/^20\d{2}$/.test(a)))return []
  const paginas=await Promise.all([...new Set(anos)].map(async ano=>{
    const resultado:FaturamentoMensal[]=[];let total:number|null=null
    do{
      const {data,error,count}=await supabase.from('faturamento_historico_mensal').select('*',{count:'exact'})
        .gte('periodo',`${ano}-01-01`).lt('periodo',`${Number(ano)+1}-01-01`)
        .order('periodo').order('filial_codigo').order('vendedor_nome').order('cliente_chave').order('produto_codigo')
        .range(resultado.length,resultado.length+499)
      if(error)throw error
      if(count==null||(total!=null&&total!==count)||(!data?.length&&resultado.length<count))throw new Error('O histórico mudou durante a consulta. Tente novamente.')
      total=count;resultado.push(...data as FaturamentoMensal[])
    }while(resultado.length<total)
    return resultado
  }))
  return paginas.flat()
}
