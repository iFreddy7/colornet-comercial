import { useEffect, useState } from 'react'
import type { UsuarioApp } from '../types'
import { Loading } from '../components/Loading'
import { Forecast } from './Forecast'
import { LancarForecast } from './LancarForecast'
import { carregarForecastDados, type ForecastDados } from '../lib/forecastSupabase'

function ForecastConectado({usuario,modo,onConsultar}:{usuario:UsuarioApp;modo:'consulta'|'lancamento';onConsultar?:()=>void}) {
  const [dados,setDados]=useState<ForecastDados|null>(null)
  const [erro,setErro]=useState('')
  const [tentativa,setTentativa]=useState(0)
  useEffect(()=>{
    let ativo=true; setDados(null); setErro('')
    carregarForecastDados().then(d=>{if(ativo)setDados(d)}).catch(e=>{if(ativo)setErro(e?.message||'Não foi possível carregar o forecast.')})
    return ()=>{ativo=false}
  },[usuario.id,tentativa])
  if(erro)return <section className="page"><div className="alert error" role="alert">{erro}</div><button type="button" className="secondary-button" onClick={()=>setTentativa(v=>v+1)}>Tentar novamente</button></section>
  if(!dados)return <Loading texto="Carregando cadastros e previsões da homologação..." />
  const gestao=['ADMIN','GERENTE','DIRETOR'].includes(usuario.perfil)
  if(modo==='lancamento'&&!dados.vendedores.some(v=>v.ativo&&(gestao||v.id===usuario.vendedor_id)))return <section className="page"><div className="alert error" role="alert">Seu usuário precisa estar vinculado a um vendedor ativo para lançar previsões. Solicite a conferência do cadastro ao administrador.</div></section>
  return modo==='consulta'?<Forecast usuario={usuario} dados={dados}/>:<LancarForecast usuario={usuario} dados={dados} onConsultar={onConsultar!}/>
}
export function ConsultarForecastSupabase({usuario}:{usuario:UsuarioApp}) {return <ForecastConectado usuario={usuario} modo="consulta"/>}
export function LancarForecastSupabase({usuario,onConsultar}:{usuario:UsuarioApp;onConsultar:()=>void}) {return <ForecastConectado usuario={usuario} modo="lancamento" onConsultar={onConsultar}/>}

