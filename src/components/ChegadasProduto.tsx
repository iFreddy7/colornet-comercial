import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Chegada = { chave_previsao:string; previsao:string|null; filial_nome:string; processo:string|null; quantidade_prevista:number; disponivel:number; status:string|null }
const cache=new Map<string,{ate:number; dados:Chegada[]}>()
export function ChegadasProduto({ produtoId, onErro }: { produtoId:string; onErro:(mensagem:string)=>void }) {
 const [dados,setDados]=useState<Chegada[]>([]),[busy,setBusy]=useState(true),[tentativa,setTentativa]=useState(0),[falhou,setFalhou]=useState(false)
 useEffect(()=>{
  let ativo=true
  setBusy(true);setFalhou(false);setDados([])
  const existente=cache.get(produtoId)
  if(existente && existente.ate>Date.now() && tentativa===0){setDados(existente.dados);setBusy(false);return}
  void supabase.rpc('consultar_previsoes_disponiveis_produto',{p_produto_id:produtoId}).then(({data,error})=>{
   if(!ativo)return
   setBusy(false)
   if(error){setFalhou(true);onErro('Não foi possível consultar as previsões de chegada. Use “Atualizar previsões” para tentar novamente.');return}
   const linhas=(data||[]) as Chegada[]
   cache.set(produtoId,{ate:Date.now()+60000,dados:linhas});setDados(linhas)
  },()=>{if(ativo){setBusy(false);setFalhou(true);onErro('Não foi possível consultar as previsões de chegada.')}})
  return()=>{ativo=false}
 },[produtoId,tentativa])
 const hoje=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
 return <div className="product-arrivals" aria-live="polite">
  <strong>Previsões de chegada</strong>
  {busy ? <p>Consultando importações...</p> : falhou ? <p>Previsões indisponíveis no momento.</p> : dados.length ? <ul>{dados.map(l=><li key={l.chave_previsao}>
   <b>{l.previsao ? l.previsao.slice(0,10).split('-').reverse().join('/') : 'Data a confirmar'}</b>{l.previsao && l.previsao<hoje ? ' (previsão vencida)' : ''} — {l.filial_nome}
   {' · '}{Number(l.quantidade_prevista).toLocaleString('pt-BR')} kg previstos / {Number(l.disponivel).toLocaleString('pt-BR')} kg disponíveis
   {l.processo && ` · Processo ${l.processo}`}{l.status && ` · ${l.status}`}
  </li>)}</ul> : <p>Sem importação em aberto para este produto.</p>}
  {!busy && <button type="button" className="secondary-button" onClick={()=>setTentativa(n=>n+1)}>Atualizar previsões</button>}
 </div>
}

