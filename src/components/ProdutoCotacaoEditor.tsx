import { ChegadasProduto } from './ChegadasProduto'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Produto, CalculoFiscal, ItemPedidoLocal, Moeda } from '../types'

export type ProdutoCotacaoRascunho = { quantidade: string; entrega: string; net: string; final: string; entrada: 'NET' | 'FINAL'; faixa: string | null; obs: string }
export function ProdutoCotacaoEditor({ produto, clienteId, filialId, moeda, ptax, quantidadeObrigatoria, inicial, onRascunho, onAdicionar, onRemover, onErro }: {
  produto: Produto; clienteId: string; filialId: string; moeda: Moeda; ptax: number; quantidadeObrigatoria: boolean
  onAdicionar: (item: ItemPedidoLocal) => void; onRemover: () => void; onErro: (erro: string) => void
  inicial?: ProdutoCotacaoRascunho; onRascunho: (dados: ProdutoCotacaoRascunho) => void
}) {
  const [quantidade, setQuantidade] = useState(inicial?.quantidade || '')
  const [entrega, setEntrega] = useState(inicial?.entrega || '')
  const [net, setNet] = useState(inicial?.net || '')
  const [final, setFinal] = useState(inicial?.final || '')
  const [entrada, setEntrada] = useState<'NET' | 'FINAL'>(inicial?.entrada || 'NET')
  const [faixa, setFaixa] = useState<string | null>(inicial?.faixa || null)
  const [obs, setObs] = useState(inicial?.obs || '')
  const [calculo, setCalculo] = useState<CalculoFiscal | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const preco = Array.isArray(produto.precos) ? produto.precos[0] : produto.precos
  const valor = entrada === 'NET' ? net : final
  useEffect(() => { onRascunho({ quantidade, entrega, net, final, entrada, faixa, obs }) }, [quantidade, entrega, net, final, entrada, faixa, obs])
  useEffect(() => {
    const atual = ++seq.current
    setCalculo(null)
    if (!clienteId || !filialId || !(Number(valor) > 0)) { setBusy(false); return }
    setBusy(true)
    const timer = window.setTimeout(() => {
      void supabase.rpc('calcular_preco_comercial', { p_cliente_id: clienteId, p_produto_id: produto.id, p_filial_id: filialId,
        p_preco_net: entrada === 'NET' ? Number(net) : null, p_preco_final: entrada === 'FINAL' ? Number(final) : null, p_cotacao: true,
      }).then(({ data, error }) => {
        if (atual !== seq.current) return
        setBusy(false)
        if (error) { onErro(error.message); return }
        const result = data as CalculoFiscal
        setCalculo(result)
        if (result.automatico) {
          if (entrada === 'NET') setFinal(Number(result.preco_final).toFixed(2))
          else setNet(Number(result.preco_net).toFixed(4))
        }
      }, () => { if (atual === seq.current) { setBusy(false); onErro('Não foi possível calcular o produto. Altere o preço para tentar novamente.') } })
    }, 350)
    return () => { window.clearTimeout(timer); seq.current += 1 }
  }, [clienteId, filialId, produto.id, entrada, valor])
  function adicionar() {
    onErro('')
    if (!calculo || busy) { onErro('Informe NET ou preço final e aguarde o cálculo deste produto.'); return }
    const qtd = quantidade.trim() ? Number(quantidade) : null
    if ((quantidadeObrigatoria && qtd == null) || (qtd != null && (!Number.isFinite(qtd) || qtd <= 0))) { onErro(`Informe uma quantidade válida para ${produto.nome}.`); return }
    const precoNet = calculo.automatico ? Number(calculo.preco_net) : Number(net)
    const precoFinal = calculo.automatico ? Number(calculo.preco_final) : Number(final)
    if (!(precoNet > 0 && precoFinal > 0) || (!calculo.automatico && !obs.trim())) { onErro('Informe preços válidos e a aprovação do preço manual quando necessária.'); return }
    const ipi = Number(calculo.ipi || 0), subtotal = qtd == null ? 0 : Number((precoFinal * qtd).toFixed(2)), valorIpi = Number((subtotal * ipi).toFixed(2))
    onAdicionar({ idLocal: crypto.randomUUID(), produto_id: produto.id, produto: produto.nome, codigo: produto.codigo_protheus,
      quantidade: qtd, prazo_entrega: entrega, preco_net: precoNet, preco_final: precoFinal, entrada_preco: entrada,
      ncm: calculo.ncm ?? produto.ncm, colour_index: calculo.colour_index ?? produto.colour_index,
      filial_origem_id: calculo.filial_origem_id ?? null, aliquota_icms: calculo.aliquota == null ? null : Number(calculo.aliquota),
      divisor_icms: calculo.divisor == null ? null : Number(calculo.divisor), ipi, valor_ipi: valorIpi, subtotal, total_item: Number((subtotal + valorIpi).toFixed(2)),
      modo_fiscal: calculo.automatico ? 'AUTOMATICO' : 'MANUAL', regra_icms: calculo.regra || null, motivo_fiscal: calculo.motivo || null,
      faixa_interna: faixa, observacao_preco: calculo.automatico ? null : obs.trim(),
    })
  }
  return <div className="selected-product">
    <h3>{produto.nome}</h3><p>{produto.codigo_protheus} · Colour Index: {produto.colour_index || 'Não informado'}</p>
    {preco && <div className="price-options">{([['1', preco.faixa_1], ['2', preco.faixa_2], ['3', preco.faixa_3]] as const).map(([key, value]) => {
      const valorFaixa = Number(value) * (moeda === 'USD' ? 1 : ptax)
      return <button type="button" key={key} className={faixa === key ? 'price-option selected' : 'price-option'} onClick={() => { setEntrada('NET'); setNet(valorFaixa.toFixed(4)); setFaixa(key) }}>
        Preço sugerido {key}: {valorFaixa.toLocaleString('pt-BR', { style: 'currency', currency: moeda })}</button>
    })}</div>}
    <ChegadasProduto produtoId={produto.id} onErro={onErro} />
    <div className="form-grid compact">
      <label className="field">Quantidade {quantidadeObrigatoria ? '*' : '(opcional)'}<input type="number" min="0.001" step="0.001" value={quantidade} onChange={e => setQuantidade(e.target.value)} /></label>
      <label className="field">Preço NET *<input type="number" min="0" step="0.0001" value={net} onChange={e => { setEntrada('NET'); setNet(e.target.value); setFaixa(null) }} /></label>
      <label className="field">Preço final (sem IPI) *<input type="number" min="0" step="0.01" value={final} onChange={e => { setEntrada('FINAL'); setFinal(e.target.value); setFaixa(null) }} /></label>
      <label className="field">Entrega prevista (opcional)<input type="date" value={entrega} onChange={e => setEntrega(e.target.value)} /></label>
    </div>
    <p>{busy ? 'Calculando...' : calculo ? calculo.automatico ? `ICMS: ${(Number(calculo.aliquota || 0) * 100).toFixed(0)}% · IPI: ${(Number(calculo.ipi || 0) * 100).toFixed(2)}%` : calculo.motivo || 'Validação manual necessária' : 'Preencha NET ou final para calcular.'}</p>
    {calculo && !calculo.automatico && <label className="field">Observação / aprovação do preço manual *<input value={obs} onChange={e => setObs(e.target.value)} /></label>}
    <button type="button" className="primary-button" disabled={busy} onClick={adicionar}>Incluir este produto</button>{' '}
    <button type="button" className="secondary-button" onClick={onRemover}>Remover do preenchimento</button>
  </div>
}

