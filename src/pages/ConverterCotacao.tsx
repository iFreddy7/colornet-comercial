import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { APP_ENV_LABEL, IS_PRODUCTION } from '../lib/env'
import { draftKey, type CommercialDraft } from '../lib/commercialDraft'
import { useCommercialDraft } from '../lib/useCommercialDraft'
import { dadosIniciaisConversao, valoresAprovados, type CotacaoParaPedido } from '../lib/conversaoCotacao'
import { DraftNotice } from '../components/DraftNotice'
import { Loading } from '../components/Loading'
import type { Filial, OpcaoCadastro, UsuarioApp } from '../types'

type Fields = ReturnType<typeof dadosIniciaisConversao>
const empty: Fields = { filialId: '', prazoId: '', freteId: '', observacoes: '', dataEntrega: '', transportadora: '', observacoesTransporte: '', quantidades: [] }
const money = (value: number, currency: string, digits = 2) => value.toLocaleString('pt-BR', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits })
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export function ConverterCotacao({ id, usuario, onVoltar, onCriado }: { id: string; usuario: UsuarioApp; onVoltar: () => void; onCriado: () => void }) {
  const [quote, setQuote] = useState<CotacaoParaPedido | null>(null)
  const [filiais, setFiliais] = useState<Filial[]>([])
  const [prazos, setPrazos] = useState<OpcaoCadastro[]>([])
  const [fretes, setFretes] = useState<OpcaoCadastro[]>([])
  const [fields, setFields] = useState<Fields>(empty)
  const [initial, setInitial] = useState<Fields>(empty)
  const [saldos, setSaldos] = useState<Record<string, number> | null>(null)
  const [stockError, setStockError] = useState(false)
  const [confirmedSignature, setConfirmedSignature] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [aviso, setAviso] = useState('')
  const sending = useRef(false)
  const signature = JSON.stringify(fields)
  const confirmado = confirmedSignature === signature
  const { filialId, prazoId, freteId, quantidades, observacoes, dataEntrega, transportadora, observacoesTransporte } = fields
  const setField = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields(current => ({ ...current, [key]: value }))

  useEffect(() => {
    let active = true
    void Promise.all([
      supabase.from('cotacoes').select('id,numero,cliente_id,cliente_nome,vendedor_nome,filial_id,moeda,validade,prazo_pagamento_id,frete_id,observacoes,pedido_convertido_id,aprovacao_status,documento').eq('id', id).single(),
      supabase.from('filiais').select('id,codigo,nome,uf').eq('ativo', true).order('nome'),
      supabase.from('prazos_pagamento').select('id,codigo,descricao').eq('ativo', true).order('descricao'),
      supabase.from('fretes').select('id,codigo,descricao').eq('ativo', true).order('descricao'),
    ]).then(([q, f, p, t]) => {
      if (!active) return
      if (q.error || f.error || p.error || t.error) throw new Error('Não foi possível carregar a cotação e os cadastros. Tente novamente.')
      const value = q.data as CotacaoParaPedido
      if (!value?.documento?.itens?.length || value.documento.itens.some(i => !i.produto_id)) throw new Error('Esta cotação não contém os dados necessários para conversão. Emita uma nova proposta.')
      value.documento.itens.forEach(item => valoresAprovados(item, String(item.quantidade ?? '')))
      const defaults = dadosIniciaisConversao(value, f.data as Filial[])
      setQuote(value); setFiliais(f.data as Filial[]); setPrazos(p.data as OpcaoCadastro[]); setFretes(t.data as OpcaoCadastro[])
      setInitial(defaults); setFields(defaults)
    }).catch(e => { if (active) setErro(e instanceof Error ? e.message : 'Não foi possível carregar a cotação.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  useEffect(() => {
    let active = true
    setSaldos(null); setStockError(false)
    if (!quote || !filialId || sucesso || quote.pedido_convertido_id || quote.aprovacao_status !== 'APROVADA') return
    const products = [...new Set(quote.documento.itens.map(i => i.produto_id))]
    void Promise.all(products.map(async product => {
      const { data, error } = await supabase.rpc('consultar_disponibilidade_produto', { p_produto_id: product })
      if (error) throw error
      const saldo = (data as Array<{ filial_id: string; disponivel: number }> || []).filter(s => s.filial_id === filialId).reduce((n, s) => n + Number(s.disponivel), 0)
      return [product, saldo] as const
    })).then(result => { if (active) setSaldos(Object.fromEntries(result)) })
      .catch(() => { if (active) setStockError(true) })
    return () => { active = false }
  }, [quote, filialId, sucesso])

  async function restore(data: CommercialDraft) {
    const values: unknown = JSON.parse(data.fields.quantidades || '[]')
    if (!Array.isArray(values) || values.length !== quote?.documento.itens.length || values.some(v => typeof v !== 'string')) throw new Error('Rascunho incompatível com esta cotação. Descarte-o para começar novamente.')
    setFields({
      filialId: data.fields.filialId || initial.filialId, prazoId: data.fields.prazoId || initial.prazoId, freteId: data.fields.freteId || initial.freteId,
      observacoes: data.fields.observacoes ?? initial.observacoes, transportadora: data.fields.transportadora ?? initial.transportadora,
      dataEntrega: data.fields.dataEntrega ?? initial.dataEntrega, observacoesTransporte: data.fields.observacoesTransporte ?? initial.observacoesTransporte,
      quantidades: values as string[],
    })
    setConfirmedSignature('')
  }
  // Keep existing drafts; their old manual-price fields never override approved prices.
  const draft = useCommercialDraft(draftKey(APP_ENV_LABEL, usuario.id, `converter-${id}`), {
    fields: { ...fields, quantidades: JSON.stringify(quantidades) }, items: [], productId: null, idempotencyKey: id,
  }, Boolean(quote && signature !== JSON.stringify(initial)), !loading && Boolean(quote) && !quote?.pedido_convertido_id && quote?.aprovacao_status === 'APROVADA' && !sucesso, restore)
  const prices = quote?.documento.itens.map((item, index) => valoresAprovados(item, quantidades[index] || '')) || []
  const valid = filiais.some(f => f.id === filialId) && prazos.some(p => p.id === prazoId) && fretes.some(f => f.id === freteId) && prices.length > 0 && prices.every(p => p.quantidadeValida)

  async function confirmar() {
    if (!quote || !valid || !confirmado || sending.current) return
    sending.current = true; setBusy(true); setErro('')
    try {
      const { data, error } = await supabase.rpc('converter_cotacao_pedido', {
        p_cotacao_id: id,
        p_cabecalho: { cliente_id: quote.cliente_id, moeda: quote.moeda, filial_id: filialId, prazo_pagamento_id: prazoId, frete_id: freteId, observacoes, data_entrega: dataEntrega || null, transportadora: transportadora || null, observacoes_transporte: observacoesTransporte || null },
        p_itens: quote.documento.itens.map((item, index) => ({ produto_id: item.produto_id, quantidade: Number(quantidades[index]) })),
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

  if (loading) return <Loading texto="Carregando cotação aprovada..." />
  if (!quote) return <section className="page"><div className="alert error">{erro}</div><button className="secondary-button" onClick={onVoltar}>Voltar às cotações</button></section>
  if (quote.pedido_convertido_id || sucesso) return <section className="page"><h1>Conversão da cotação</h1><div className="alert success">{sucesso || 'Esta cotação já foi convertida. Consulte o pedido vinculado no histórico de Pedidos.'}</div>{aviso && <div className="alert warning-box">{aviso}</div>}<button className="primary-button" onClick={onVoltar}>Voltar às cotações</button></section>
  if (quote.aprovacao_status !== 'APROVADA') return <section className="page"><div className="alert warning-box">Esta cotação precisa ser aprovada por Gerente ou Diretor antes de virar pedido. Consulte a avaliação nas cotações.</div><button className="secondary-button" onClick={onVoltar}>Voltar às cotações</button></section>
  if (!quote.validade || quote.validade < today()) return <section className="page"><div className="alert warning-box">Esta cotação venceu ou não possui validade. Emita uma nova proposta com as condições atualizadas.</div><button className="secondary-button" onClick={onVoltar}>Voltar às cotações</button></section>
  if (draft.pending) return <section className="page"><h1>Converter {quote.numero}</h1><DraftNotice draft={draft} /><button className="secondary-button" onClick={onVoltar}>Voltar às cotações</button></section>
  return <section className="page">
    <div className="page-header"><div><span className="eyebrow">COTAÇÃO APROVADA</span><h1>Converter {quote.numero}</h1><p>{quote.cliente_nome} • {quote.moeda} • Validade: {quote.validade.split('-').reverse().join('/')}</p></div><button className="secondary-button" disabled={busy} onClick={onVoltar}>Voltar às cotações</button></div>
    <DraftNotice draft={draft} />
    <div className="alert success">Os dados da cotação já foram preenchidos. NET, preço final e IPI aprovados serão mantidos no pedido, sem recálculo de preços.</div>
    {erro && <div className="alert error" role="alert">{erro}</div>}
    <fieldset disabled={busy} className="form-card">
      <div className="form-grid">
        <label className="field">Cliente<input value={quote.cliente_nome} readOnly /></label>
        <label className="field">Vendedor<input value={quote.vendedor_nome} readOnly /></label>
        <label className="field">Moeda<input value={quote.moeda} readOnly /></label>
        <label className="field">Filial de faturamento<select value={filialId} onChange={e => setField('filialId', e.target.value)}><option value="">Selecione</option>{filiais.map(f => <option key={f.id} value={f.id}>{f.nome} — {f.uf}</option>)}</select></label>
        <label className="field">Prazo de pagamento<select value={prazoId} onChange={e => setField('prazoId', e.target.value)}><option value="">Selecione</option>{prazos.map(p => <option key={p.id} value={p.id}>{p.descricao}</option>)}</select></label>
        <label className="field">Frete<select value={freteId} onChange={e => setField('freteId', e.target.value)}><option value="">Selecione</option>{fretes.map(f => <option key={f.id} value={f.id}>{f.descricao}</option>)}</select></label>
        <label className="field">Entrega solicitada (opcional)<input type="date" value={dataEntrega} onChange={e => setField('dataEntrega', e.target.value)} /></label>
        <label className="field">Transportadora (opcional)<input value={transportadora} onChange={e => setField('transportadora', e.target.value)} /></label>
      </div>
      {!initial.filialId && <p>A proposta não identifica uma única filial ativa. Selecione a filial que irá faturar o pedido.</p>}
      <div className="table-scroll"><table><thead><tr><th>Produto</th><th>Quantidade (KG)</th><th>NET aprovado</th><th>Final aprovado</th><th>IPI</th><th>Total com IPI</th><th>Saldo imediato</th></tr></thead><tbody>
        {quote.documento.itens.map((item, index) => <tr key={`${item.produto_id}-${index}`}><td><strong>{item.produto}</strong><small>{item.codigo}</small></td><td><div className="field"><input aria-label={`Quantidade de ${item.produto}`} type="number" min="0.001" step="0.001" value={quantidades[index] || ''} onChange={e => setField('quantidades', quantidades.map((v, i) => i === index ? e.target.value : v))} /></div></td><td>{money(prices[index].net, quote.moeda)}</td><td>{money(prices[index].final, quote.moeda)}</td><td>{(prices[index].ipi * 100).toLocaleString('pt-BR')}%</td><td>{prices[index].quantidadeValida ? money(prices[index].total, quote.moeda) : 'Informe a quantidade'}</td><td>{saldos ? saldos[item.produto_id].toLocaleString('pt-BR') : !filialId ? 'Selecione a filial' : stockError ? 'Na confirmação' : 'Consultando...'}</td></tr>)}
      </tbody></table></div>
      <div className="form-grid"><label className="field">Observações<textarea value={observacoes} onChange={e => setField('observacoes', e.target.value)} /></label>
      <label className="field">Observações de transporte (opcional)<textarea value={observacoesTransporte} onChange={e => setField('observacoesTransporte', e.target.value)} /></label></div>
      {stockError && <p role="status">Não foi possível consultar o saldo agora. O estoque será conferido e reservado ao confirmar o pedido.</p>}
      <p><strong>{prices.every(p => p.quantidadeValida) ? `Total com IPI: ${money(prices.reduce((sum, p) => sum + p.total, 0), quote.moeda)}` : 'Preencha as quantidades que não foram informadas na cotação.'}</strong></p>
      <p>O estoque será reservado na confirmação. Quantidades sem saldo imediato seguem as regras de reserva futura do portal.</p>
      <label className="switch-line"><input type="checkbox" checked={confirmado} onChange={e => setConfirmedSignature(e.target.checked ? signature : '')} />Revisei os dados do pedido e os valores da cotação aprovada.</label>
      <button className="primary-button submit-order" disabled={!valid || !confirmado || busy} onClick={confirmar}>{busy ? 'Processando...' : 'Confirmar e criar pedido'}</button>
    </fieldset>
  </section>
}
