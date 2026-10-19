import { supabase } from './supabase'
import { quantidadeForecast, type ForecastCadastro, type ForecastLinha } from './forecastDraft'

export interface ForecastRegistro extends ForecastCadastro { ativo: boolean; vendedorId?: string | null; nomeFantasia?: string | null }
export interface ForecastPlano { cliente_id: string; vendedor_id: string; documento: Record<string, Record<string, number>>; revisao: number; atualizado_em: string }
export interface ForecastDados { clientes: ForecastRegistro[]; produtos: ForecastRegistro[]; vendedores: ForecastRegistro[]; planos: ForecastPlano[] }
async function paginar<T>(tabela: string, colunas: string): Promise<T[]> {
  const itens: T[] = []; let total: number | null = null
  do {
    const { data, error, count } = await supabase.from(tabela).select(colunas, { count: 'exact' }).order(tabela === 'forecast_planos' ? 'cliente_id' : 'id').order(tabela === 'forecast_planos' ? 'vendedor_id' : 'id').range(itens.length, itens.length + 499)
    if (error) throw error
    if (count == null || (total != null && total !== count) || (!data?.length && itens.length < count)) throw new Error('Os dados mudaram durante a consulta. Atualize para tentar novamente.')
    total = count; itens.push(...(data || []) as T[])
  } while (itens.length < total)
  return itens
}
export async function carregarForecastDados(): Promise<ForecastDados> {
  const [clientes, produtos, vendedores, planos] = await Promise.all([
    paginar<{id:string;codigo:string;loja:string|null;razao_social:string;nome_fantasia:string|null;ativo:boolean;vendedor_id:string|null}>('clientes','id,codigo,loja,razao_social,nome_fantasia,ativo,vendedor_id'),
    paginar<{id:string;codigo_protheus:string|null;nome:string;ativo:boolean}>('produtos','id,codigo_protheus,nome,ativo'),
    paginar<{id:string;codigo_protheus:string|null;nome:string;ativo:boolean}>('vendedores','id,codigo_protheus,nome,ativo'),
    paginar<ForecastPlano>('forecast_planos','cliente_id,vendedor_id,documento,revisao,atualizado_em'),
  ])
  return {
    clientes: clientes.map(c=>({id:c.id,codigo:c.codigo+(c.loja?' / '+c.loja:''),nome:c.razao_social,nomeFantasia:c.nome_fantasia,ativo:c.ativo,vendedorId:c.vendedor_id})).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR')),
    produtos: produtos.map(p=>({id:p.id,codigo:p.codigo_protheus||'',nome:p.nome,ativo:p.ativo})).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR')||a.codigo.localeCompare(b.codigo)),
    vendedores: vendedores.map(v=>({id:v.id,codigo:v.codigo_protheus||'',nome:v.nome,ativo:v.ativo})).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR')),
    planos,
  }
}
export function linhasDosPlanos(planos: ForecastPlano[]): ForecastLinha[] {
  return planos.flatMap(p=>Object.entries(p.documento).map(([produtoId, quantidades])=>({id:p.vendedor_id+':'+p.cliente_id+':'+produtoId,vendedorId:p.vendedor_id,clienteId:p.cliente_id,produtoId,quantidades:Object.fromEntries(Object.entries(quantidades).map(([mes,q])=>[mes,String(q)]))})))
}
export async function carregarPlano(clienteId: string, vendedorId: string) {
  const {data,error}=await supabase.from('forecast_planos').select('cliente_id,vendedor_id,documento,revisao,atualizado_em').eq('cliente_id',clienteId).eq('vendedor_id',vendedorId).maybeSingle()
  if(error) throw error
  return data as ForecastPlano|null
}
export async function salvarForecast(clienteId:string,vendedorId:string,inicio:string,itens:ForecastLinha[],revisao:number) {
  const { data,error }=await supabase.rpc('forecast_salvar_v1',{p_cliente_id:clienteId,p_vendedor_id:vendedorId,p_inicio:inicio+'-01',p_revisao:revisao,p_itens:itens.map(l=>({produto_id:l.produtoId,quantidades:Object.fromEntries(Object.entries(l.quantidades).filter(([,q])=>q.trim()).map(([m,q])=>[m,quantidadeForecast(q)]))}))})
  if(error) throw error
  if(typeof data!=='number') throw new Error('O servidor não confirmou o salvamento. Consulte a previsão antes de repetir.')
  return data
}

