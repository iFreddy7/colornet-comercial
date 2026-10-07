import {useEffect,useRef,useState} from 'react'
import type {UsuarioApp} from '../types'
import {supabase} from '../lib/supabase'
import {carregarForecastDados,type ForecastDados} from '../lib/forecastSupabase'
import {lerImportacaoForecast,preencherModeloForecast,type RevisaoImportacao} from '../lib/forecastImportacao'
import {Loading} from '../components/Loading'
const kg=(v:number|null)=>v==null?'Não informado':v.toLocaleString('pt-BR',{maximumFractionDigits:3})
export function ImportarForecast({usuario,onConcluido}:{usuario:UsuarioApp;onConcluido:()=>void}) {
  const [dados,setDados]=useState<ForecastDados|null>(null),[vendedor,setVendedor]=useState(usuario.vendedor_id||''),[ano,setAno]=useState(new Date().getFullYear())
  const [erro,setErro]=useState(''),[aviso,setAviso]=useState(''),[ocupado,setOcupado]=useState(false),[revisao,setRevisao]=useState<RevisaoImportacao|null>(null),[nome,setNome]=useState('')
  const chave=useRef(''),lock=useRef(false),[pagina,setPagina]=useState(0)
  useEffect(()=>{let ativo=true;carregarForecastDados().then(d=>{if(ativo)setDados(d)}).catch(()=>{if(ativo)setErro('Não foi possível carregar os cadastros. Abra novamente esta aba.')});return()=>{ativo=false}},[])
  const admin=usuario.ativo&&usuario.perfil==='ADMIN'
  async function baixar(){if(!dados||lock.current)return;lock.current=true;setOcupado(true);setErro('')
    try{const res=await fetch('/templates/forecast-base.xlsx');if(!res.ok)throw Error('Modelo indisponível.');const bytes=await preencherModeloForecast(new Uint8Array(await res.arrayBuffer()),dados,vendedor,ano)
      const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=`ColorNet_Forecast_${dados.vendedores.find(v=>v.id===vendedor)?.nome.replace(/[^\p{L}\p{N}-]/gu,'_')}_${ano}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(e){setErro(e instanceof Error?e.message:'Não foi possível gerar a planilha.')}finally{lock.current=false;setOcupado(false)}}
  async function ler(file:File){if(!admin||lock.current)return;lock.current=true;setOcupado(true);setErro('');setAviso('');setRevisao(null);setPagina(0)
    try{if(!file.name.toLowerCase().endsWith('.xlsx')||file.size>5_000_000)throw Error('Selecione um arquivo .xlsx de até 5 MB.')
      const atual=await carregarForecastDados();setDados(atual);const r=await lerImportacaoForecast(new Uint8Array(await file.arrayBuffer()),atual);setNome(file.name.slice(0,200));chave.current=crypto.randomUUID();setRevisao(r)
    }catch(e){setErro(e instanceof Error?e.message:'Arquivo inválido.')}finally{lock.current=false;setOcupado(false)}}
  async function importar(){if(!admin||lock.current||!revisao||revisao.erros.length||!revisao.mudancas.length)return;lock.current=true;setOcupado(true);setErro('')
    try{const {data,error}=await supabase.rpc('forecast_importar_v1',{p_importacao_id:chave.current,p_arquivo:nome,p_planos:revisao.planos});if(error)throw error;if(data?.sucesso!==true)throw Error('O servidor não confirmou a importação. Tente novamente com esta mesma revisão.')
      setAviso(`Importação concluída: ${data.planos_alterados} carteira(s) atualizada(s).`);setRevisao(null);onConcluido()
    }catch(e){setErro(e instanceof Error?e.message:(e as {message?:string})?.message||'Não foi possível confirmar a importação. Tente novamente; o envio não será duplicado.')}finally{lock.current=false;setOcupado(false)}}
  if(!dados&&!erro)return <Loading texto="Preparando planilha base..."/>
  return <section className="page forecast-page"><div className="page-header"><div><span className="eyebrow">FORECAST • HOMOLOGAÇÃO</span><h1>Planilha base e importação</h1><p>Preencha as quantidades em kg por cliente, produto e mês. Não informe preços ou impostos.</p></div></div>
    {erro&&<div className="alert error" role="alert">{erro}</div>}{aviso&&<div className="alert success" role="status">{aviso}</div>}
    <div className="form-card"><h2>1. Baixar a planilha do vendedor</h2><p>Os clientes da carteira vêm preenchidos. Copie a linha para adicionar mais produtos e consulte os códigos na aba Produtos.</p><div className="form-grid"><label>Vendedor<select value={vendedor} disabled={ocupado} onChange={e=>setVendedor(e.target.value)}><option value="">Selecione</option>{dados?.vendedores.filter(v=>v.ativo&&(admin||['GERENTE','DIRETOR'].includes(usuario.perfil)||v.id===usuario.vendedor_id)).map(v=><option key={v.id} value={v.id}>{v.nome}</option>)}</select></label><label>Ano<input type="number" min={2020} max={2099} value={ano} disabled={ocupado} onChange={e=>setAno(Number(e.target.value))}/></label></div><button className="secondary-button" type="button" disabled={ocupado||!vendedor||!dados} onClick={()=>void baixar()}>Baixar planilha base</button></div>
    {admin&&<div className="form-card"><h2>2. Conferir a planilha preenchida</h2><p>Célula vazia mantém o valor existente. Zero zera a previsão. Outros valores substituem apenas o mês preenchido. Limite: 2.000 linhas, 100 carteiras e 5 MB por arquivo.</p><label>Arquivo Excel<input type="file" accept=".xlsx" disabled={ocupado} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void ler(f)}}/></label>
      {ocupado&&<p role="status">Processando…</p>}
      {revisao&&<><h3>Revisão: {nome}</h3><p>{revisao.linhas} linha(s) preenchida(s) • {revisao.mudancas.length} alteração(ões) • {revisao.iguais} valor(es) já iguais.</p>
        {revisao.erros.length>0?<div className="alert error" role="alert"><strong>Nada foi importado. Corrija os problemas e carregue novamente.</strong><ul>{revisao.erros.slice(0,100).map((e,i)=><li key={i}>{e}</li>)}</ul>{revisao.erros.length>100&&<p>Há outros erros no arquivo. Corrija estes primeiro.</p>}</div>:<><div className="table-scroll" role="region" aria-label="Alterações de forecast" tabIndex={0}><table><thead><tr><th>Linha</th><th>Vendedor</th><th>Cliente</th><th>Produto</th><th>Mês</th><th>Atual (kg)</th><th>Novo (kg)</th></tr></thead><tbody>{revisao.mudancas.slice(pagina*50,pagina*50+50).map((m,i)=><tr key={i}><td>{m.linha}</td><td>{m.vendedor}</td><td>{m.cliente}</td><td>{m.produto}<small>{m.codigo}</small></td><td>{m.mes}</td><td>{kg(m.atual)}</td><td><strong>{kg(m.novo)}</strong></td></tr>)}</tbody></table></div>
        {revisao.mudancas.length>50&&<div><button disabled={pagina===0||ocupado} onClick={()=>setPagina(p=>p-1)}>Anterior</button> Página {pagina+1} de {Math.ceil(revisao.mudancas.length/50)} <button disabled={(pagina+1)*50>=revisao.mudancas.length||ocupado} onClick={()=>setPagina(p=>p+1)}>Próxima</button></div>}
        {!revisao.mudancas.length&&<p>Os valores preenchidos já estão iguais aos do portal. Nenhuma alteração necessária.</p>}
        <button type="button" className="primary-button" disabled={ocupado||!revisao.mudancas.length} onClick={()=>void importar()}>Confirmar importação de {revisao.mudancas.length} alteração(ões)</button></>}
      </>}
    </div>}
  </section>
}
