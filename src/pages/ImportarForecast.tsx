import {useEffect,useRef,useState} from 'react'
import type {UsuarioApp} from '../types'
import {supabase} from '../lib/supabase'
import {carregarForecastDados,type ForecastDados} from '../lib/forecastSupabase'
import {lerImportacaoForecast,preencherModeloForecast,type RevisaoImportacao,type EscolhasImportacao,type PendenciaCliente} from '../lib/forecastImportacao'
import {Loading} from '../components/Loading'
const kg=(v:number|null)=>v==null?'Não informado':v.toLocaleString('pt-BR',{maximumFractionDigits:3})
function ConferirCliente({cliente,ocupado,onSelecionar}:{cliente:PendenciaCliente;ocupado:boolean;onSelecionar:(id:string)=>void}) {
  const [busca,setBusca]=useState('')
  const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  const candidatos=cliente.candidatos.filter(c=>c.id===cliente.selecionado||norm(c.codigo+' '+c.nome).includes(norm(busca)))
  return <div className="form-card"><strong>Linha {cliente.linha} — {cliente.origem}</strong><p>{cliente.motivo==='codigo'?'Código diferente do portal: selecione o cliente correspondente da carteira.':'Mesmo código em mais de uma loja: confira a unidade.'}</p>
    <label>Buscar cadastro para a linha {cliente.linha}<input value={busca} disabled={ocupado} placeholder="Nome ou código do cliente no portal" onChange={e=>setBusca(e.target.value)}/></label>
    <label>Cliente / loja da linha {cliente.linha}<select value={cliente.selecionado} disabled={ocupado} onChange={e=>onSelecionar(e.target.value)}><option value="">Selecione o cadastro correto</option>{candidatos.map(o=><option key={o.id} value={o.id}>{o.codigo} — {o.nome}</option>)}</select></label>
    {!candidatos.length&&<p>Nenhum cliente encontrado nesta carteira. Confira o vendedor ou atualize o cadastro antes de importar.</p>}
  </div>
}
export function ImportarForecast({usuario,onConcluido}:{usuario:UsuarioApp;onConcluido:()=>void}) {
  const [dados,setDados]=useState<ForecastDados|null>(null),[vendedor,setVendedor]=useState(usuario.vendedor_id||''),[ano,setAno]=useState(new Date().getFullYear())
  const [erro,setErro]=useState(''),[aviso,setAviso]=useState(''),[ocupado,setOcupado]=useState(false),[revisao,setRevisao]=useState<RevisaoImportacao|null>(null),[nome,setNome]=useState('')
  const chave=useRef(''),lock=useRef(false),[pagina,setPagina]=useState(0)
  const arquivo=useRef<File|null>(null),[escolhas,setEscolhas]=useState<EscolhasImportacao>({})
  const [paginaClientes,setPaginaClientes]=useState(0)
  useEffect(()=>{let ativo=true;carregarForecastDados().then(d=>{if(ativo)setDados(d)}).catch(()=>{if(ativo)setErro('Não foi possível carregar os cadastros. Abra novamente esta aba.')});return()=>{ativo=false}},[])
  const admin=usuario.ativo&&usuario.perfil==='ADMIN'
  async function baixar(){if(!dados||lock.current)return;lock.current=true;setOcupado(true);setErro('')
    try{const res=await fetch('/templates/forecast-base.xlsx');if(!res.ok)throw Error('Modelo indisponível.');const bytes=await preencherModeloForecast(new Uint8Array(await res.arrayBuffer()),dados,vendedor,ano)
      const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=`ColorNet_Forecast_${dados.vendedores.find(v=>v.id===vendedor)?.nome.replace(/[^\p{L}\p{N}-]/gu,'_')}_${ano}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(e){setErro(e instanceof Error?e.message:'Não foi possível gerar a planilha.')}finally{lock.current=false;setOcupado(false)}}
  async function ler(file:File,opcoes:EscolhasImportacao={},conferencia=false){if(!admin||lock.current)return;lock.current=true;setOcupado(true);setErro('');setAviso('');if(!conferencia){setRevisao(null);setPaginaClientes(0)}setPagina(0);arquivo.current=file;setEscolhas(opcoes)
    try{if(!file.name.toLowerCase().endsWith('.xlsx')||file.size>5_000_000)throw Error('Selecione um arquivo .xlsx de até 5 MB.')
      const atual=conferencia&&dados?dados:await carregarForecastDados();setDados(atual);const r=await lerImportacaoForecast(new Uint8Array(await file.arrayBuffer()),atual,opcoes);setNome(file.name.slice(0,200));chave.current=crypto.randomUUID();setRevisao(r)
    }catch(e){setRevisao(null);setErro(e instanceof Error?e.message:'Arquivo inválido.')}finally{lock.current=false;setOcupado(false)}}
  async function importar(){if(!admin||lock.current||!revisao||revisao.erros.length||!revisao.mudancas.length)return;lock.current=true;setOcupado(true);setErro('')
    try{const {data,error}=await supabase.rpc('forecast_importar_v1',{p_importacao_id:chave.current,p_arquivo:nome,p_planos:revisao.planos});if(error)throw error;if(data?.sucesso!==true)throw Error('O servidor não confirmou a importação. Tente novamente com esta mesma revisão.')
      setAviso(`Importação concluída: ${data.planos_alterados} carteira(s) atualizada(s).`);setRevisao(null);onConcluido()
    }catch(e){setErro(e instanceof Error?e.message:(e as {message?:string})?.message||'Não foi possível confirmar a importação. Tente novamente; o envio não será duplicado.')}finally{lock.current=false;setOcupado(false)}}
  if(!dados&&!erro)return <Loading texto="Preparando planilha base..."/>
  return <section className="page forecast-page"><div className="page-header"><div><span className="eyebrow">FORECAST • HOMOLOGAÇÃO</span><h1>Planilha base e importação</h1><p>Preencha as quantidades em kg por cliente, produto e mês. Não informe preços ou impostos.</p></div></div>
    {erro&&<div className="alert error" role="alert">{erro}</div>}{aviso&&<div className="alert success" role="status">{aviso}</div>}
    <div className="form-card"><h2>1. Baixar a planilha do vendedor</h2><p>Os clientes da carteira vêm preenchidos. Copie a linha para adicionar mais produtos e consulte os códigos na aba Produtos.</p><div className="form-grid"><label>Vendedor<select value={vendedor} disabled={ocupado} onChange={e=>setVendedor(e.target.value)}><option value="">Selecione</option>{dados?.vendedores.filter(v=>v.ativo&&(admin||['GERENTE','DIRETOR'].includes(usuario.perfil)||v.id===usuario.vendedor_id)).map(v=><option key={v.id} value={v.id}>{v.nome}</option>)}</select></label><label>Ano<input type="number" min={2020} max={2099} value={ano} disabled={ocupado} onChange={e=>setAno(Number(e.target.value))}/></label></div><button className="secondary-button" type="button" disabled={ocupado||!vendedor||!dados} onClick={()=>void baixar()}>Baixar planilha base</button></div>
    {admin&&<div className="form-card"><h2>2. Conferir a planilha preenchida</h2><p>Aceita a planilha base e as planilhas por vendedor com abas Forecast e Histórico. Extraia o ZIP e carregue um arquivo Excel por vez.</p><p>Célula vazia mantém o valor existente. Zero zera a previsão. Outros valores substituem apenas o mês preenchido. Limite: 2.000 produtos, 500 clientes e 5 MB por arquivo.</p><label>Arquivo Excel<input type="file" accept=".xlsx" disabled={ocupado} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void ler(f)}}/></label>
      {ocupado&&<p role="status">Processando…</p>}
      {revisao&&<><h3>Revisão: {nome}</h3><p>{revisao.linhas} linha(s) preenchida(s) • {revisao.mudancas.length} alteração(ões) • {revisao.iguais} valor(es) já iguais.</p>
        {revisao.formato==='carteira'&&<><p>Vendedor informado na planilha: <strong>{revisao.vendedorOrigem}</strong></p><label>Vendedor correspondente no portal<select value={escolhas.vendedorId||revisao.vendedorId||''} disabled={ocupado} onChange={e=>{if(arquivo.current)void ler(arquivo.current,{vendedorId:e.target.value,clientes:{}})}}><option value="">Selecione o vendedor</option>{dados?.vendedores.filter(v=>v.ativo).map(v=><option key={v.id} value={v.id}>{v.nome}</option>)}</select></label>
          {revisao.clientesConferir.length>0&&<fieldset><legend>Conferir clientes e lojas</legend><p>Compare o nome da planilha com o cadastro do portal. A escolha vale somente para este arquivo e mantém a carteira atual.</p><p>{revisao.clientesConferir.filter(c=>!c.selecionado).length} correspondência(s) pendente(s).</p>
            {revisao.clientesConferir.slice(paginaClientes*8,paginaClientes*8+8).map(c=><ConferirCliente key={c.linha} cliente={c} ocupado={ocupado} onSelecionar={id=>{if(arquivo.current)void ler(arquivo.current,{...escolhas,vendedorId:revisao.vendedorId,clientes:{...escolhas.clientes,[c.linha]:id}},true)}}/>)}
            {revisao.clientesConferir.length>8&&<div><button type="button" disabled={!paginaClientes||ocupado} onClick={()=>setPaginaClientes(p=>p-1)}>Clientes anteriores</button> Página {paginaClientes+1} de {Math.ceil(revisao.clientesConferir.length/8)} <button type="button" disabled={(paginaClientes+1)*8>=revisao.clientesConferir.length||ocupado} onClick={()=>setPaginaClientes(p=>p+1)}>Próximos clientes</button></div>}
          </fieldset>}
        </>}
        {revisao.avisos.length>0&&<div className="alert" role="status">{revisao.avisos.map(a=><p key={a}>{a}</p>)}</div>}
        {revisao.erros.length>0?<div className="alert error" role="alert"><strong>Nada foi importado. Confira as seleções acima e corrija as divergências da planilha ou do cadastro.</strong><ul>{revisao.erros.slice(0,100).map((e,i)=><li key={i}>{e}</li>)}</ul>{revisao.erros.length>100&&<p>Há outros erros no arquivo. Corrija estes primeiro.</p>}</div>:<><div className="table-scroll" role="region" aria-label="Alterações de forecast" tabIndex={0}><table><thead><tr><th>Linha</th><th>Vendedor</th><th>Cliente / loja</th><th>Produto</th><th>Mês</th><th>Atual (kg)</th><th>Novo (kg)</th></tr></thead><tbody>{revisao.mudancas.slice(pagina*50,pagina*50+50).map((m,i)=><tr key={i}><td>{m.linha}</td><td>{m.vendedor}</td><td>{m.cliente}<small>{m.codigoCliente}</small>{m.origem&&<small>Planilha: {m.origem}</small>}</td><td>{m.produto}<small>{m.codigo}</small></td><td>{m.mes}</td><td>{kg(m.atual)}</td><td><strong>{kg(m.novo)}</strong></td></tr>)}</tbody></table></div>
        {revisao.mudancas.length>50&&<div><button disabled={pagina===0||ocupado} onClick={()=>setPagina(p=>p-1)}>Anterior</button> Página {pagina+1} de {Math.ceil(revisao.mudancas.length/50)} <button disabled={(pagina+1)*50>=revisao.mudancas.length||ocupado} onClick={()=>setPagina(p=>p+1)}>Próxima</button></div>}
        {!revisao.mudancas.length&&<p>Os valores preenchidos já estão iguais aos do portal. Nenhuma alteração necessária.</p>}
        <button type="button" className="primary-button" disabled={ocupado||!revisao.mudancas.length} onClick={()=>void importar()}>Confirmar importação de {revisao.mudancas.length} alteração(ões)</button></>}
      </>}
    </div>}
  </section>
}
