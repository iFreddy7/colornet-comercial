import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { APP_ENV_LABEL, IS_PRODUCTION } from '../lib/env'
import { draftKey, type CommercialDraft } from '../lib/commercialDraft'
import { useCommercialDraft } from '../lib/useCommercialDraft'
import { DraftNotice } from '../components/DraftNotice'
import { Loading } from '../components/Loading'
import type { CalculoFiscal, Filial, OpcaoCadastro, UsuarioApp } from '../types'

type QuoteItem = { produto_id: string; produto: string; codigo: string; quantidade: number | null; preco_net: number; preco_final: number; observacao_preco?: string }
type Quote = { aprovacao_status: string; id: string; numero: string; cliente_id: string; cliente_nome: string; moeda: 'USD' | 'BRL'; validade: string | null; prazo_pagamento_id: string | null; frete_id: string | null; observacoes: string | null; pedido_convertido_id: string | null; documento: { itens: QuoteItem[] } }
type Review = { automatico: boolean; preco_net: number; preco_final: number; ipi: number; divisor: number | null; disponivel: number; total: number }
const money = (value: number, currency: string, digits = 2) => value.toLocaleString('pt-BR', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits })
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export function ConverterCotacao({ id, usuario, onVoltar, onCriado }: { id: string; usuario: UsuarioApp; onVoltar: () => void; onCriado: () => void }) {
  const [quote, setQuote] = useState<Quote | null>(null)
  const [filiais, setFiliais] = useState<Filial[]>([])
  const [prazos, setPrazos] = useState<OpcaoCadastro[]>([])
  const [fretes, setFretes] = useState<OpcaoCadastro[]>([])
  const [filialId, setFilialId] = useState('')
  const [prazoId, setPrazoId] = useState('')
  const [freteId, setFreteId] = useState('')
  const [quantidades, setQuantidades] = useState<string[]>([])
  const [finais, setFinais] = useState<string[]>([])
  const [aprovacoes, setAprovacoes] = useState<string[]>([])
  const [observacoes, setObservacoes] = useState('')
  const [dataEntrega, setDataEntrega] = useState('')
  const [transportadora, setTransportadora] = useState('')
  const [review, setReview] = useState<Review[] | null>(null)
  const [reviewSignature, setReviewSignature] = useState('')
  const [confirmado, setConfirmado] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [aviso, setAviso] = useState('')
  const sending = useRef(false)
  const request = useRef(0)
  const signature = JSON.stringify({ filialId, prazoId, freteId, quantidades, finais, aprovacoes, observacoes, dataEntrega, transportadora })
  const latest = useRef(signature)
  latest.current = signature
  const validReview = review && reviewSignature === signature

  useEffect(() => {
    let active = true
    void Promise.all([
      supabase.from('cotacoes').select('id,numero,cliente_id,cliente_nome,moeda,validade,prazo_pagamento_id,frete_id,observacoes,pedido_convertido_id,aprovacao_status,documento').eq('id', id).single(),
      supabase.from('filiais').select('id,codigo,nome,uf').eq('ativo', true).order('nome'),
      supabase.from('prazos_pagamento').select('id,codigo,descricao').eq('ativo', true).order('descricao'),
      supabase.from('fretes').select('id,codigo,descricao').eq('ativo', true).order('descricao'),
    ]).then(([q, f, p, t]) => {
      if (!active) return
      if (q.error || f.error || p.error || t.error) throw new Error('Não foi possível carregar a cotação e os cadastros. Tente novamente.')
      const value = q.data as Quote
      if (!value?.documento?.itens?.length || value.documento.itens.some(i => !i.produto_id || !Number.isFinite(Number(i.preco_net)))) throw new Error('Esta cotação não contém os dados necessários para conversão. Emita uma nova proposta.')
      setQuote(value); setFiliais(f.data as Filial[]); setPrazos(p.data as OpcaoCadastro[]); setFretes(t.data as OpcaoCadastro[])
      setPrazoId(value.prazo_pagamento_id || ''); setFreteId(value.frete_id || ''); setObservacoes(value.observacoes || '')
      setQuantidades(value.documento.itens.map(i => i.quantidade == null ? '' : String(i.quantidade)))
      setFinais(value.documento.itens.map(i => String(i.preco_final)))
      setAprovacoes(value.documento.itens.map(i => i.observacao_preco || ''))
    }).catch(e => { if (active) setErro(e instanceof Error ? e.message : 'Não foi possível carregar a cotação.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; request.current++ }
  }, [id])

  async function restore(data: CommercialDraft) {
    const arrays = ['quantidades', 'finais', 'aprovacoes'].map(field => JSON.parse(data.fields[field] || '[]'))
    if (arrays.some(a => !Array.isArray(a) || a.length !== quote?.documento.itens.length || a.some(v => typeof v !== 'string'))) throw new Error('Rascunho incompatível com esta cotação. Descarte-o para começar novamente.')
    setQuantidades(arrays[0]); setFinais(arrays[1]); setAprovacoes(arrays[2])
    setFilialId(data.fields.filialId || ''); setPrazoId(data.fields.prazoId || ''); setFreteId(data.fields.freteId || '')
    setObservacoes(data.fields.observacoes || ''); setTransportadora(data.fields.transportadora || ''); setDataEntrega(data.fields.dataEntrega || '')
    setConfirmado(false); setReview(null)
  }
  const draft = useCommercialDraft(draftKey(APP_ENV_LABEL, usuario.id, `converter-${id}`), {
    fields: { filialId, prazoId, freteId, observacoes, transportadora, dataEntrega, quantidades: JSON.stringify(quantidades), finais: JSON.stringify(finais), aprovacoes: JSON.stringify(aprovacoes) },
    items: [], productId: null, idempotencyKey: id,
  }, Boolean(quote && (filialId || transportadora || dataEntrega || observacoes !== (quote.observacoes || '') || prazoId !== (quote.prazo_pagamento_id || '') || freteId !== (quote.frete_id || '') || quantidades.some((v,i) => v !== (quote.documento.itens[i]?.quantidade == null ? '' : String(quote.documento.itens[i]?.quantidade))) || finais.some((v,i) => v !== String(quote.documento.itens[i]?.preco_final)) || aprovacoes.some((v,i) => v !== (quote.documento.itens[i]?.observacao_preco || '')))), !loading && Boolean(quote) && !quote?.pedido_convertido_id && quote?.aprovacao_status === 'APROVADA' && !sucesso, restore)

  async function recalcular() {
    if (!quote || busy) return
    setErro(''); setConfirmado(false); setReview(null)
    if (!filiais.some(f => f.id === filialId)) return setErro('Selecione a filial de faturamento.')
    if (!prazos.some(p => p.id === prazoId) || !fretes.some(f => f.id === freteId)) return setErro('Selecione prazo e frete ativos.')
    if (quantidades.some(q => !Number.isFinite(Number(q)) || Number(q) <= 0)) return setErro('Informe uma quantidade maior que zero em todos os produtos.')
    const seq = ++request.current, captured = signature
    setBusy(true)
    try {
      const result: Review[] = []
      for (const [index, item] of quote.documento.itens.entries()) {
        const [fiscal, stock] = await Promise.all([
          supabase.rpc('calcular_preco_comercial', { p_cliente_id: quote.cliente_id, p_produto_id: item.produto_id, p_filial_id: filialId, p_preco_net: Number(item.preco_net), p_preco_final: null, p_cotacao: false }),
          supabase.rpc('consultar_disponibilidade_produto', { p_produto_id: item.produto_id }),
        ])
        if (fiscal.error || stock.error) throw new Error(fiscal.error?.message || stock.error?.message || `Não foi possível conferir ${item.produto}.`)
        const calc = fiscal.data as CalculoFiscal
        const final = Math.round((calc.automatico ? Number(calc.preco_final) : Number(finais[index])) * 100) / 100
        if (!Number.isFinite(final) || final <= 0) throw new Error(`Informe o preço final de ${item.produto}.`)
        const ipi = Number(calc.ipi || 0), subtotal = Math.round(final * Number(quantidades[index]) * 100) / 100
        const saldo = (stock.data as Array<{ filial_id: string; disponivel: number }> || []).filter(s => s.filial_id === filialId).reduce((n, s) => n + Number(s.disponivel), 0)
        result.push({ automatico: Boolean(calc.automatico), preco_net: Number(item.preco_net), preco_final: final, ipi, divisor: calc.divisor == null ? null : Number(calc.divisor), disponivel: saldo, total: subtotal + Math.round(subtotal * ipi * 100) / 100 })
      }
      if (seq !== request.current || latest.current !== captured) return
      setReview(result); setReviewSignature(captured)
    } catch (e) { if (seq === request.current) setErro(e instanceof Error ? e.message : 'Falha ao recalcular. Tente novamente.') }
    finally { if (seq === request.current) setBusy(false) }
  }

  async function confirmar() {
    if (!quote || !validReview || !review || !confirmado || sending.current) return
    if (review.some((r, i) => !r.automatico && !aprovacoes[i]?.trim())) return setErro('Informe a observação/aprovação de todos os preços manuais e recalcule.')
    sending.current = true; setBusy(true); setErro('')
    try {
      const { data, error } = await supabase.rpc('converter_cotacao_pedido', {
        p_cotacao_id: id,
        p_cabecalho: { cliente_id: quote.cliente_id, moeda: quote.moeda, filial_id: filialId, prazo_pagamento_id: prazoId, frete_id: freteId, observacoes, data_entrega: dataEntrega || null, transportadora: transportadora || null },
        p_itens: quote.documento.itens.map((i, index) => ({ produto_id: i.produto_id, quantidade: Number(quantidades[index]), preco_final_manual: review[index].preco_final, observacao_preco: aprovacoes[index], calculo_confirmado: review[index] })),
      })
      if (error) throw new Error(error.message)
      if (!data?.pedido_id) throw new Error('O servidor não confirmou o pedido. Tente novamente; a cotação só pode gerar um pedido.')
      draft.clear()
      setSucesso(data.duplicado_bloqueado ? `Esta cotação já gerou o pedido ${data.numero}. Nenhum pedido adicional foi criado.` : `Pedido ${data.numero} criado e vinculado à cotação ${quote.numero}. Consulte Pedidos para acompanhar as reservas.`)
      if (data.previsao?.sem_cobertura > 0) setAviso(`Há ${Number(data.previsao.sem_cobertura).toLocaleString('pt-BR')} KG sem cobertura de estoque ou previsão. Confira o pedido.`)
      if (IS_PRODUCTION && !data.duplicado_bloqueado) {
        try { const sent = await supabase.functions.invoke('pedido-confirmacao', { body: { pedido_id: data.pedido_id } }); if (sent.error) throw sent.error }
        catch { setAviso('Pedido criado. O envio do e-mail falhou; confira o pedido e os registros de envio.') }
      }
      onCriado()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha de conexão. Tente novamente; a cotação só pode gerar um pedido.') }
    finally { sending.current = false; setBusy(false) }
  }

  if (loading) return <Loading texto="Carregando cotação para revisão..." />
  if (!quote) return <section className="page"><div className="alert error">{erro}</div><button className="secondary-button" onClick={onVoltar}>Voltar às cotações</button></section>
  if (quote.pedido_convertido_id || sucesso) return <section className="page"><h1>Conversão da cotação</h1><div className="alert success">{sucesso || 'Esta cotação já foi convertida. Consulte o pedido vinculado no histórico de Pedidos.'}</div>{aviso && <div className="alert warning-box">{aviso}</div>}<button className="primary-button" onClick={onVoltar}>Voltar às cotações</button></section>
  if (quote.aprovacao_status !== 'APROVADA') return <section className="page"><div className="alert warning-box">Esta cotação precisa ser aprovada por Gerente ou Diretor antes de virar pedido. Consulte a avaliação nas cotações.</div><button className="secondary-button" onClick={onVoltar}>Voltar às cotações</button></section>
  if (!quote.validade || quote.validade < today()) return <section className="page"><div className="alert warning-box">Esta cotação venceu ou não possui validade. Emita uma nova proposta com as condições atualizadas.</div><button className="secondary-button" onClick={onVoltar}>Voltar às cotações</button></section>
  if (draft.pending) return <section className="page"><h1>Converter {quote.numero}</h1><DraftNotice draft={draft} /><button className="secondary-button" onClick={onVoltar}>Voltar às cotações</button></section>
  const update = (setter: typeof setQuantidades, index: number, value: string) => { setter(a => a.map((v, i) => i === index ? value : v)); setConfirmado(false) }
  return <section className="page">
    <div className="page-header"><div><span className="eyebrow">REVISÃO DO PEDIDO</span><h1>Converter {quote.numero}</h1><p>{quote.cliente_nome} • {quote.moeda} • Validade: {quote.validade.split('-').reverse().join('/')}</p></div><button className="secondary-button" disabled={busy} onClick={onVoltar}>Voltar às cotações</button></div>
    <DraftNotice draft={draft} />
    <p>O NET da proposta será preservado. O preço final será recalculado para a filial escolhida. O estoque só será reservado após confirmar o pedido.</p>
    {erro && <div className="alert error" role="alert">{erro}</div>}
    <fieldset disabled={busy} className="form-card">
      <div className="form-grid">
        <label>Filial de faturamento<select value={filialId} onChange={e => setFilialId(e.target.value)}><option value="">Selecione</option>{filiais.map(f => <option key={f.id} value={f.id}>{f.nome} — {f.uf}</option>)}</select></label>
        <label>Prazo de pagamento<select value={prazoId} onChange={e => setPrazoId(e.target.value)}><option value="">Selecione</option>{prazos.map(p => <option key={p.id} value={p.id}>{p.descricao}</option>)}</select></label>
        <label>Frete<select value={freteId} onChange={e => setFreteId(e.target.value)}><option value="">Selecione</option>{fretes.map(f => <option key={f.id} value={f.id}>{f.descricao}</option>)}</select></label>
        <label>Entrega solicitada<input type="date" value={dataEntrega} onChange={e => setDataEntrega(e.target.value)} /></label>
        <label>Transportadora<input value={transportadora} onChange={e => setTransportadora(e.target.value)} /></label>
      </div>
      <div className="table-scroll"><table><thead><tr><th>Produto</th><th>Quantidade (KG)</th><th>NET da proposta</th><th>Final da proposta</th><th>Final revisado</th><th>Saldo imediato</th></tr></thead><tbody>
        {quote.documento.itens.map((item, index) => <tr key={`${item.produto_id}-${index}`}><td><strong>{item.produto}</strong><small>{item.codigo}</small></td><td><input aria-label={`Quantidade de ${item.produto}`} type="number" min="0.001" step="0.001" value={quantidades[index] || ''} onChange={e => update(setQuantidades,index,e.target.value)} /></td><td>{money(Number(item.preco_net),quote.moeda,4)}</td><td>{money(Number(item.preco_final),quote.moeda)}</td><td>{validReview ? money(review[index].preco_final,quote.moeda) : 'Recalcular'}</td><td>{validReview ? review[index].disponivel.toLocaleString('pt-BR') : 'Consultar'}</td></tr>)}
      </tbody></table></div>
      {review?.map((r, i) => !r.automatico && <div className="form-grid" key={i}><label>Preço final manual — {quote.documento.itens[i].produto}<input type="number" min="0.01" step="0.01" value={finais[i]} onChange={e => update(setFinais,i,e.target.value)} /></label><label>Observação / aprovação do preço manual<input value={aprovacoes[i]} onChange={e => update(setAprovacoes,i,e.target.value)} /></label></div>)}
      <label>Observações<textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} /></label>
      <button className="secondary-button" type="button" onClick={recalcular}>Recalcular preços e consultar estoque</button>
      {validReview && <><p><strong>Total com IPI: {money(review.reduce((sum,r) => sum+r.total,0),quote.moeda)}</strong></p><p>A disponibilidade pode mudar até a confirmação. Quantidades sem saldo imediato seguem as regras de reserva futura do portal.</p><label className="switch-line"><input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} />Revisei as quantidades, os preços e a filial de faturamento.</label></>}
      <button className="primary-button submit-order" disabled={!validReview || !confirmado || busy} onClick={confirmar}>{busy ? 'Processando...' : 'Confirmar e criar pedido'}</button>
    </fieldset>
  </section>
}
