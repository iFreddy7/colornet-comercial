import { FiltrosRecolhiveis } from '../components/FiltrosRecolhiveis'
import {useEffect,useMemo,useState} from 'react'
import type {UsuarioApp} from '../types'
import {temVisaoComercial} from '../lib/permissoes'
import {carregarFaturamento,periodosFaturamento,type FaturamentoMensal} from '../lib/faturamentoHistorico'
import {resumirFaturamento} from '../lib/faturamentoResumo'
import './forecast.css'

const meses=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
const numero=(v:number)=>v.toLocaleString('pt-BR',{maximumFractionDigits:4})
export function HistoricoFaturamento({usuario}:{usuario:UsuarioApp}){
  const gestao=temVisaoComercial(usuario)
  const [periodos,setPeriodos]=useState<string[]>([])
  const [ano,setAno]=useState('');const [comparar,setComparar]=useState('');const [mes,setMes]=useState('')
  const [linhas,setLinhas]=useState<FaturamentoMensal[]>([])
  const [vendedor,setVendedor]=useState('');const [cliente,setCliente]=useState('');const [produto,setProduto]=useState('');const [filial,setFilial]=useState('')
  const [erro,setErro]=useState('');const [carregando,setCarregando]=useState(true);const [exportando,setExportando]=useState(false)
  const [tentativa,setTentativa]=useState(0);const [pagina,setPagina]=useState(0)
  const atual=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(new Date())
  useEffect(()=>{let ativo=true;setErro('');setCarregando(true)
    periodosFaturamento().then(p=>{if(ativo)setPeriodos(p)}).catch(e=>{if(ativo)setErro(e.message||'Não foi possível carregar os períodos.')}).finally(()=>{if(ativo)setCarregando(false)})
    return()=>{ativo=false}
  },[usuario.id,tentativa])
  useEffect(()=>{let ativo=true;setLinhas([]);setErro('');setPagina(0)
    if(!ano){setCarregando(false);return()=>{ativo=false}}
    setCarregando(true)
    carregarFaturamento([ano,...(comparar&&comparar!==ano?[comparar]:[])])
      .then(d=>{if(ativo)setLinhas(d.filter(r=>r.periodo.slice(0,7)<atual))})
      .catch(e=>{if(ativo)setErro(e.message||'Não foi possível consultar o histórico.')}).finally(()=>{if(ativo)setCarregando(false)})
    return()=>{ativo=false}
  },[ano,comparar,usuario.id,tentativa,atual])
  const anos=[...new Set(periodos.filter(p=>p.slice(0,7)<atual).map(p=>p.slice(0,4)))].sort().reverse()
  const filtradas=useMemo(()=>linhas.filter(r=>(!vendedor||r.vendedor_nome===vendedor)&&(!cliente||r.cliente_chave===cliente)&&(!produto||r.produto_codigo===produto)&&(!filial||r.filial_codigo===filial)&&(!mes||r.periodo.slice(5,7)===mes)),[linhas,vendedor,cliente,produto,filial,mes])
  const resumo=useMemo(()=>resumirFaturamento(filtradas),[filtradas])
  const opcoesClientes=[...new Map(linhas.filter(r=>!vendedor||r.vendedor_nome===vendedor).map(r=>[r.cliente_chave,`${r.cliente_nome} · ${r.cliente_codigo}`])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'pt-BR'))
  const opcoesProdutos=[...new Map(linhas.map(r=>[r.produto_codigo,`${r.produto_nome} · ${r.produto_codigo}`])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'pt-BR'))
  const soma=(a:string)=>filtradas.filter(r=>r.periodo.startsWith(a+'-')).reduce((n,r)=>n+Number(r.quantidade),0)
  const cabecalho=['Ano','Vendedor','Cliente','Código cliente','Produto','Código produto','Filial',...meses.map(m=>m+' (quantidade)'),'Total']
  const registros=resumo.map(r=>[r.ano,r.vendedor,r.cliente,r.codigoCliente,r.produto,r.codigoProduto,r.filial,...r.meses,r.meses.reduce<number>((s,v)=>s+(v??0),0)])
  const paginaAtual=Math.min(pagina,Math.max(0,Math.ceil(registros.length/50)-1))
  async function exportar(){
    setExportando(true);setErro('')
    try{
      const {default:ExcelJS}=await import('exceljs');const wb=new ExcelJS.Workbook();const s=wb.addWorksheet('Histórico faturado')
      s.addRows([cabecalho,...registros]);s.views=[{state:'frozen',ySplit:1,xSplit:3}];s.autoFilter={from:{row:1,column:1},to:{row:s.rowCount,column:20}}
      s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF19337F'}}
      s.columns.forEach((c,i)=>{c.width=i<7?26:17;if(i>=7)c.numFmt='#,##0.####'})
      const n=wb.addWorksheet('Informações');n.addRows([['Fonte','FATURAMENTO.xlsx'],['Ambiente','Homologação'],['Métrica','Quantidade da coluna I. Não representa valor monetário.'],['Carteira','Vendedor atribuído no relatório importado.'],['Exclusões','Complementos de impostos/preços e venda de ativo imobilizado.'],['Períodos disponíveis',periodos.join(', ')],['Observação','Meses sem registro aparecem vazios. Ausência de histórico não equivale a zero.'],['Ano',ano],['Comparação',comparar||'Sem comparação'],['Mês',mes?meses[Number(mes)-1]:'Todos disponíveis'],['Vendedor',vendedor||'Todos autorizados'],['Cliente',opcoesClientes.find(([id])=>id===cliente)?.[1]||'Todos autorizados'],['Produto',produto||'Todos'],['Filial',filial||'Todas']])
      n.getColumn(1).width=28;n.getColumn(2).width=100
      const b=await wb.xlsx.writeBuffer();const url=URL.createObjectURL(new Blob([b as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const link=document.createElement('a');link.href=url;link.download=`ColorNet_Historico_HOMOLOGACAO_${ano}.xlsx`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch{setErro('Não foi possível gerar o relatório. Tente novamente.')}finally{setExportando(false)}
  }
  return <section className="page forecast-page"><div className="page-header"><div><span className="eyebrow">COMPRAS REALIZADAS</span><h1>Histórico faturado</h1><p>Selecione anos e meses anteriores para consultar as compras por cliente e produto.</p></div><button className="secondary-button" type="button" disabled={!registros.length||carregando||exportando||!!erro} onClick={()=>void exportar()}>{exportando?'Gerando...':'Exportar histórico Excel'}</button></div>
    <p className="forecast-help">Compras realizadas, sem complementos de impostos ou preços. O histórico não altera as previsões.</p>
    <div className="form-card forecast-filter-card"><div className="forecast-filters">
      <label>Ano do faturamento<select value={ano} onChange={e=>{setAno(e.target.value);setComparar('');setCliente('');setProduto('');setVendedor('')}}><option value="">Selecione um ano</option>{anos.map(a=><option key={a}>{a}</option>)}</select></label>
      <label>Mês<select value={mes} onChange={e=>{setMes(e.target.value);setPagina(0)}}><option value="">Todos os meses disponíveis</option>{meses.map((m,i)=><option value={String(i+1).padStart(2,'0')} key={m}>{m}</option>)}</select></label>
      <label>Comparar com o ano<select disabled={!ano} value={comparar} onChange={e=>setComparar(e.target.value)}><option value="">Sem comparação</option>{anos.filter(a=>a!==ano).map(a=><option key={a}>{a}</option>)}</select></label>
    </div><p className="forecast-save-note">{ano?`Meses com registros em ${ano}: ${periodos.filter(p=>p.startsWith(ano)&&p.slice(0,7)<atual).map(p=>meses[Number(p.slice(5,7))-1]).join(', ')||'nenhum'}.`:'O histórico só será consultado depois de escolher o ano.'} {comparar&&`Em ${comparar}: ${periodos.filter(p=>p.startsWith(comparar)&&p.slice(0,7)<atual).map(p=>meses[Number(p.slice(5,7))-1]).join(', ')}.`}</p></div>
    {erro&&<div className="alert error" role="alert">{erro}<button type="button" className="secondary-button" onClick={()=>setTentativa(v=>v+1)}>Tentar novamente</button></div>}
    {carregando&&<p role="status">Carregando histórico autorizado...</p>}
    {ano&&!carregando&&!erro&&<><FiltrosRecolhiveis ativos={[vendedor, cliente, produto, filial].filter(Boolean).length}><div className="forecast-filters">
      {gestao&&<label>Vendedor<select value={vendedor} onChange={e=>{setVendedor(e.target.value);setCliente('');setPagina(0)}}><option value="">Todos os vendedores</option>{[...new Set(linhas.map(r=>r.vendedor_nome))].sort().map(v=><option key={v}>{v}</option>)}</select></label>}
      <label>Cliente<select value={cliente} onChange={e=>{setCliente(e.target.value);setPagina(0)}}><option value="">Todos os clientes autorizados</option>{opcoesClientes.map(([id,n])=><option value={id} key={id}>{n}</option>)}</select></label>
      <label>Produto<select value={produto} onChange={e=>{setProduto(e.target.value);setPagina(0)}}><option value="">Todos os produtos</option>{opcoesProdutos.map(([id,n])=><option value={id} key={id}>{n}</option>)}</select></label>
      <label>Filial de faturamento<select value={filial} onChange={e=>{setFilial(e.target.value);setPagina(0)}}><option value="">Todas as filiais</option>{[...new Set(linhas.map(r=>r.filial_codigo))].sort().map(f=><option key={f}>{f}</option>)}</select></label>
    </div></FiltrosRecolhiveis><div className="forecast-metrics"><div><span>Quantidade faturada · {ano}</span><strong>{numero(soma(ano))}</strong><p>Conforme mês e filtros selecionados</p></div>{comparar&&<div><span>Quantidade faturada · {comparar}</span><strong>{numero(soma(comparar))}</strong><p>Confira a cobertura de meses antes de comparar</p></div>}<div><span>Linhas no relatório</span><strong>{registros.length}</strong><p>Cliente, vendedor, produto, filial e ano</p></div></div>
    <div className="forecast-grid-card"><div className="forecast-grid-heading"><div><h2>Compras por mês</h2><p>Quantidade informada no faturamento. “—” indica ausência de registro no recorte.</p></div></div><div className="forecast-table-wrap" tabIndex={0} role="region" aria-label="Histórico de compras em colunas"><table className="forecast-flat-report"><thead><tr>{cabecalho.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{registros.slice(paginaAtual*50,paginaAtual*50+50).map((r,i)=><tr key={paginaAtual*50+i}>{r.map((v,j)=><td key={j}>{v==null?'—':typeof v==='number'?numero(v):v}</td>)}</tr>)}{!registros.length&&<tr><td colSpan={20}>Não há compras neste período com os filtros selecionados.</td></tr>}</tbody></table></div><div className="forecast-form-actions"><span>Página {paginaAtual+1} de {Math.max(1,Math.ceil(registros.length/50))}. A exportação inclui todas as linhas filtradas.</span><button type="button" className="secondary-button" disabled={!paginaAtual} onClick={()=>setPagina(paginaAtual-1)}>Anterior</button><button type="button" className="secondary-button" disabled={(paginaAtual+1)*50>=registros.length} onClick={()=>setPagina(paginaAtual+1)}>Próxima</button></div></div></>}
  </section>
}
