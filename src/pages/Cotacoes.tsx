import { temVisaoComercial } from '../lib/permissoes'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { UsuarioApp } from '../types'
import type { DocumentoCotacao } from '../lib/cotacaoPdf'

type Linha={id:string;numero:string;titulo:string;created_at:string;cliente_nome:string;vendedor_nome:string;moeda:string;pedido_convertido_id:string|null}
function dataBr(value?:string|null){if(!value)return '—';const m=String(value).slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:String(value)}
export function Cotacoes({usuario,onConverter}:{usuario:UsuarioApp;onConverter:(id:string)=>void}) {
 const [linhas,setLinhas]=useState<Linha[]>([]),[busca,setBusca]=useState(''),[cliente,setCliente]=useState(''),[vendedor,setVendedor]=useState('')
 const [pagina,setPagina]=useState(0),[total,setTotal]=useState(0),[erro,setErro]=useState(''),[carregando,setCarregando]=useState(true),[pdf,setPdf]=useState('')
 const [detalhe,setDetalhe]=useState<DocumentoCotacao|null>(null)
 const seq=useRef(0);const visaoComercial=temVisaoComercial(usuario)
 useEffect(()=>{const token=++seq.current;setCarregando(true);const timer=setTimeout(async()=>{
  let q=supabase.from('cotacoes').select('id,numero,titulo,created_at,cliente_nome,vendedor_nome,moeda,pedido_convertido_id',{count:'exact'}).order('created_at',{ascending:false}).order('id').range(pagina*25,pagina*25+24)
  const clean=(v:string)=>v.trim().replace(/[%_]/g,'')
  if(!visaoComercial)q=q.eq('created_by',usuario.id)
  if(clean(busca))q=q.ilike('titulo',`%${clean(busca)}%`)
  if(clean(cliente))q=q.ilike('cliente_nome',`%${clean(cliente)}%`)
  if(visaoComercial&&clean(vendedor))q=q.ilike('vendedor_nome',`%${clean(vendedor)}%`)
  const {data,error,count}=await q
  if(token!==seq.current)return
  setErro(error?.message||'');setLinhas((data||[]) as Linha[]);setTotal(count||0);setCarregando(false)
 },250);return()=>{clearTimeout(timer);seq.current++}},[busca,cliente,vendedor,pagina,visaoComercial,usuario.id])
 async function abrir(id:string,baixar:boolean){if(pdf)return;setPdf(id);setErro('');try{
  const {data,error}=await supabase.from('cotacoes').select('documento').eq('id',id).single();if(error)throw error
  const d=data.documento as DocumentoCotacao
  if(baixar){const {baixarPdfCotacao}=await import('../lib/cotacaoPdf');baixarPdfCotacao(d)}else setDetalhe(d)
 }catch(e){setErro(e instanceof Error?e.message:'Não foi possível abrir a cotação.')}finally{setPdf('')}}
 const moeda=(n:number,m:string)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:m}).format(n)
 return <section className="page"><div className="page-header"><div><span className="eyebrow">COMERCIAL</span><h1>{visaoComercial?'Todas as Cotações / Listas':'Minhas Cotações / Listas'}</h1><p>{visaoComercial?'Consulte todos os vendedores e clientes.':'Consulte seus documentos e baixe o PDF para enviar ao cliente.'}</p></div></div>
 <div className="form-card form-grid"><div className="field"><label>Título</label><input value={busca} onChange={e=>{setBusca(e.target.value);setPagina(0)}} placeholder="Ex.: Setembro 2026" /></div><div className="field"><label>Cliente</label><input value={cliente} onChange={e=>{setCliente(e.target.value);setPagina(0)}} placeholder="Nome do cliente" /></div>{visaoComercial&&<div className="field"><label>Vendedor</label><input value={vendedor} onChange={e=>{setVendedor(e.target.value);setPagina(0)}} placeholder="Nome do vendedor" /></div>}</div>
 {erro&&<div className="alert error">{erro}</div>}
 <div className="form-card"><p>{carregando?'Carregando...':`${total} documento(s)`}</p><div className="table-scroll"><table><thead><tr><th>Título / Número</th><th>Cliente</th><th>Vendedor</th><th>Emissão</th><th>Ações</th></tr></thead><tbody>{linhas.map(l=><tr key={l.id}><td><strong>{l.titulo}</strong><small>{l.numero}</small></td><td>{l.cliente_nome}</td><td>{l.vendedor_nome}</td><td>{new Date(l.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</td><td><button className="secondary-button" disabled={!!pdf} onClick={()=>abrir(l.id,false)}>Ver itens</button>{' '}<button className="primary-button" disabled={!!pdf} onClick={()=>abrir(l.id,true)}>{pdf===l.id?'Abrindo...':'Baixar PDF'}</button>{' '}<button className="secondary-button" disabled={!!pdf || !!l.pedido_convertido_id} onClick={()=>onConverter(l.id)}>{l.pedido_convertido_id?'Convertida em pedido':'Converter em pedido'}</button></td></tr>)}{!carregando&&!linhas.length&&<tr><td colSpan={5}>Nenhuma cotação encontrada.</td></tr>}</tbody></table></div>
 <button className="secondary-button" disabled={carregando||pagina===0} onClick={()=>setPagina(p=>p-1)}>Anterior</button>{' '}Página {pagina+1}{' '}<button className="secondary-button" disabled={carregando||(pagina+1)*25>=total} onClick={()=>setPagina(p=>p+1)}>Próxima</button></div>
 {detalhe&&<div className="form-card">
  <button className="secondary-button" onClick={()=>setDetalhe(null)}>Fechar detalhes</button>
  <h2>{detalhe.titulo}</h2><p>{detalhe.cliente.nome} • {detalhe.numero}</p>
  <p><strong>Validade:</strong> {dataBr(detalhe.validade)} • <strong>Prazo de pagamento:</strong> {detalhe.prazo_pagamento?.descricao||'—'}</p>
  <div className="table-scroll"><table><thead><tr><th>Produto</th><th>NCM / Colour Index</th><th>Qtd.</th><th>NET</th><th>Final</th><th>IPI</th><th>Total</th></tr></thead>
  <tbody>{detalhe.itens.map((i,n)=><tr key={n}>
   <td>{i.produto}<small>{i.codigo}</small></td><td>{i.ncm||'—'}{i.colour_index&&<small>Colour Index: {i.colour_index}</small>}</td>
   <td>{i.quantidade??'—'}</td><td>{i.preco_net==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:detalhe.moeda,minimumFractionDigits:4,maximumFractionDigits:4}).format(i.preco_net)}</td>
   <td>{moeda(i.preco_final,detalhe.moeda)}</td><td>{(i.ipi*100).toFixed(2)}%</td><td>{i.total_item==null?'—':moeda(i.total_item,detalhe.moeda)}</td>
  </tr>)}</tbody></table></div>
  {detalhe.total==null?<p>Lista de preços unitários, sem total geral.</p>:<p>Total: <strong>{moeda(detalhe.total,detalhe.moeda)}</strong></p>}<p>{detalhe.observacoes}</p>
 </div>}
 </section>
}
