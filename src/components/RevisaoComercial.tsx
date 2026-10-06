import { useEffect, useRef } from 'react'
import type { ItemPedidoLocal, Moeda } from '../types'
import { APP_ENV_LABEL } from '../lib/env'

export function RevisaoComercial({ tipo, campos, itens, moeda, observacoes, erro, salvando, onEditar, onConfirmar }: {
  tipo: 'cotação' | 'pedido'
  campos: Array<[string, string | null | undefined]>
  itens: ItemPedidoLocal[]
  moeda: Moeda
  observacoes: string
  erro: string
  salvando: boolean
  onEditar: () => void
  onConfirmar: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'start' }) }, [])
  const money = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: moeda, minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const completos = itens.every(item => item.quantidade != null)
  const totais = itens.reduce((acc, item) => ({ subtotal: acc.subtotal + item.subtotal, ipi: acc.ipi + item.valor_ipi, total: acc.total + item.total_item }), { subtotal: 0, ipi: 0, total: 0 })

  return <section className="page" aria-busy={salvando}>
    <div className="page-header"><div>
      <span className="eyebrow">REVISÃO ANTES DO ENVIO • {APP_ENV_LABEL}</span>
      <h1 ref={heading} tabIndex={-1}>Revisar {tipo}</h1>
      <p>Confira os dados abaixo. Para corrigir, volte ao preenchimento. O envio acontece somente após a confirmação.</p>
    </div></div>
    {erro && <div className="alert error" role="alert">{erro}</div>}
    <div className="form-card">
      <h2>Dados comerciais</h2>
      <dl className="form-grid">
        {campos.map(([nome, valor]) => <div className="field" key={nome}>
          <dt>{nome}</dt><dd style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><strong>{valor || 'Não informado'}</strong></dd>
        </div>)}
      </dl>
    </div>
    <div className="form-card">
      <h2>Produtos ({itens.length})</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Produto</th><th>Qtd.</th><th>NET</th><th>Final</th><th>ICMS</th><th>IPI</th><th>Total com IPI</th></tr></thead>
        <tbody>{itens.map(item => <tr key={item.idLocal}>
          <td><strong>{item.produto}</strong><small>{item.codigo || 'SEM CÓDIGO'} • NCM {item.ncm || 'Não informado'}</small>
            <small>Colour Index: {item.colour_index || 'Não informado'}</small>
            {item.observacao_preco && <small>Preço manual: {item.observacao_preco}</small>}
          </td>
          <td>{item.quantidade == null ? 'Não informada' : item.quantidade.toLocaleString('pt-BR')}</td>
          <td>{money(item.preco_net)}</td><td>{money(item.preco_final)}</td>
          <td>{item.aliquota_icms == null ? 'MANUAL' : `${(item.aliquota_icms * 100).toLocaleString('pt-BR')}%`}</td>
          <td>{(item.ipi * 100).toLocaleString('pt-BR')}%</td>
          <td>{item.quantidade == null ? '—' : money(item.total_item)}</td>
        </tr>)}</tbody>
      </table></div>
      {completos ? <div className="order-totals">
        <div><span>Subtotal</span><strong>{money(totais.subtotal)}</strong></div>
        <div><span>IPI</span><strong>{money(totais.ipi)}</strong></div>
        <div className="grand-total"><span>Total</span><strong>{money(totais.total)}</strong></div>
      </div> : <p>Há produtos sem quantidade. O total da cotação será definido quando todas as quantidades forem informadas.</p>}
      <h3>Observações gerais</h3><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{observacoes.trim() || 'Sem observações.'}</p>
    </div>
    <div className="form-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <button type="button" className="secondary-button" onClick={onEditar} disabled={salvando}>Voltar e editar</button>
      <button type="button" className="primary-button" onClick={onConfirmar} disabled={salvando}>
        {salvando ? 'Enviando...' : `Confirmar e enviar ${tipo}`}
      </button>
    </div>
  </section>
}
