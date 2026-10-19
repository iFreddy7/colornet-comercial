import { temVisaoComercial } from '../lib/permissoes'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { PedidoItemBanco, PedidoResumo as PedidoResumoBase, UsuarioApp } from '../types'
import { MarcarFaturado } from '../components/MarcarFaturado'
import { Loading } from '../components/Loading'
import { dataHoraBrasilia } from '../lib/dataHora'
import './Pedidos.css'

// Permite atualizar esta tela mesmo se types.ts ainda for de um pacote anterior.
type PedidoResumo = PedidoResumoBase & {
  created_by: string
  faturamento_aviso_status: string
  pedido_eventos?: Array<{ tipo: string; criado_em: string; detalhes: { registrado_por_nome?: string } }>
  cancelado_em?: string | null
  motivo_cancelamento?: string | null
}

function rel<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function money(value: number, moeda: string) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: moeda === 'BRL' ? 'BRL' : 'USD',
  }).format(Number(value || 0))
}

function dateTime(value: string) {
  return dataHoraBrasilia(value)
}

type CancelamentoResposta = {
  sucesso?: boolean
  ja_cancelado?: boolean
  numero?: string
  motivo?: string
  estoque?: {
    quantidade_estornada?: number
    quantidade_ja_absorvida_por_snapshot?: number
  }
  previsao?: {
    quantidade_estornada?: number
  }
}

export function Pedidos({
  usuario,
  onDuplicar,
}: {
  usuario: UsuarioApp
  onDuplicar: (pedidoId: string) => void
}) {
  const [pedidos, setPedidos] = useState<PedidoResumo[]>([])
  const [itens, setItens] = useState<Record<string, PedidoItemBanco[]>>({})
  const [aberto, setAberto] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [avisoEmail, setAvisoEmail] = useState('')
  const [enviandoAvisoId, setEnviandoAvisoId] = useState<string | null>(null)

  const [faturandoId, setFaturandoId] = useState<string | null>(null)
  const [cancelandoId, setCancelandoId] = useState<string | null>(null)
  const [motivoCancelamento, setMotivoCancelamento] = useState('')
  const [salvandoCancelamento, setSalvandoCancelamento] = useState(false)

  const admin = usuario.perfil === 'ADMIN'
  const visaoComercial = temVisaoComercial(usuario)

  useEffect(() => {
    carregar()
  }, [])

  async function carregar() {
    setCarregando(true)
    setErro('')

    const { data, error } = await supabase
      .from('pedidos')
      .select(`
        id,
        numero,
        created_at,
        created_by,
        status,
        faturamento_aviso_status,
        pedido_eventos(tipo,criado_em,detalhes),
        cancelado_em,
        motivo_cancelamento,
        moeda,
        subtotal,
        valor_ipi,
        total,
        clientes(codigo,razao_social),
        vendedores(nome),
        filiais(nome,uf)
      `)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      setErro(error.message)
      setPedidos([])
    } else {
      setPedidos((data ?? []) as PedidoResumo[])
    }

    setCarregando(false)
  }

  async function alternar(pedidoId: string) {
    if (aberto === pedidoId) {
      setAberto(null)
      return
    }

    setAberto(pedidoId)

    if (itens[pedidoId]) return

    const { data, error } = await supabase
      .from('pedido_itens')
      .select(`
        id,
        quantidade,
        preco_net,
        preco_final,
        aliquota_icms,
        ipi,
        total_item,
        modo_fiscal,
        produtos(codigo_protheus,nome)
      `)
      .eq('pedido_id', pedidoId)
      .order('id')

    if (error) {
      setErro(error.message)
      return
    }

    setItens((atual) => ({
      ...atual,
      [pedidoId]: (data ?? []) as PedidoItemBanco[],
    }))
  }

  async function enviarAvisoFaturado(pedido: PedidoResumo) {
    setEnviandoAvisoId(pedido.id); setAvisoEmail('')
    try {
      const { data, error } = await supabase.functions.invoke('pedido-faturado-email', { body: { pedido_id: pedido.id } })
      if (error) {
        setAvisoEmail('O faturamento está salvo. Não foi possível confirmar o envio do e-mail; confira o status abaixo.')
      } else if (data?.status === 'ENVIADO') {
        setAvisoEmail('Aviso de pedido faturado enviado ao vendedor, João e Márcia.')
      } else {
        setAvisoEmail(data?.erro || (data?.aguarde ? 'Aguarde alguns segundos antes de tentar novamente.' : 'O faturamento está salvo. Confira abaixo a situação do aviso por e-mail.'))
      }
    } catch {
      setAvisoEmail('O faturamento está salvo. Não foi possível confirmar o envio do e-mail; confira o status abaixo.')
    } finally { setEnviandoAvisoId(null) }
  }

  async function repetirAvisoFaturado(pedido: PedidoResumo) {
    if (enviandoAvisoId) return
    await enviarAvisoFaturado(pedido)
    await carregar()
  }

  async function marcarFaturado(pedido: PedidoResumo): Promise<boolean> {
    if (faturandoId || salvandoCancelamento) return false
    setFaturandoId(pedido.id); setErro(''); setSucesso(''); setAvisoEmail('')
    try {
      const { data, error } = await supabase.rpc('marcar_pedido_faturado', { p_pedido_id: pedido.id })
      if (error) { setErro(error.message); return false }
      if (data?.sucesso !== true || data?.status !== 'FATURADO' || data?.pedido_id !== pedido.id) {
        setErro('O portal não confirmou a marcação. Atualize a lista antes de tentar novamente.'); return false
      }
      setCancelandoId(null); setMotivoCancelamento('')
      setSucesso(data.ja_faturado ? `${pedido.numero} já estava marcado como faturado.` : `${pedido.numero} marcado como faturado.`)
      await enviarAvisoFaturado(pedido)
      await carregar()
      return true
    } catch {
      setErro('Não foi possível confirmar a marcação. Atualize a lista para conferir o status antes de tentar novamente.')
      return false
    } finally { setFaturandoId(null) }
  }

  function abrirCancelamento(pedidoId: string) {
    setErro('')
    setSucesso('')
    setCancelandoId(pedidoId)
    setMotivoCancelamento('')
  }

  function fecharCancelamento() {
    if (salvandoCancelamento) return
    setCancelandoId(null)
    setMotivoCancelamento('')
  }

  async function confirmarCancelamento(pedido: PedidoResumo) {
    const motivo = motivoCancelamento.trim()

    if (motivo.length < 3) {
      setErro('Informe o motivo do cancelamento.')
      return
    }

    const confirmado = window.confirm(
      `Cancelar ${pedido.numero}?\n\n` +
        `O pedido NÃO será apagado. As reservas ainda ativas serão estornadas.`
    )

    if (!confirmado) return

    setSalvandoCancelamento(true)
    setErro('')
    setSucesso('')

    const { data, error } = await supabase.rpc('cancelar_pedido', {
      p_pedido_id: pedido.id,
      p_motivo: motivo,
    })

    setSalvandoCancelamento(false)

    if (error) {
      setErro(error.message)
      return
    }

    const resposta = data as CancelamentoResposta

    const estoqueEstornado = Number(
      resposta?.estoque?.quantidade_estornada || 0
    )

    const estoqueAbsorvido = Number(
      resposta?.estoque?.quantidade_ja_absorvida_por_snapshot || 0
    )

    const previsaoEstornada = Number(
      resposta?.previsao?.quantidade_estornada || 0
    )

    let mensagem = `${pedido.numero} cancelado com sucesso.`

    if (estoqueEstornado > 0) {
      mensagem += ` Estoque liberado: ${estoqueEstornado.toLocaleString(
        'pt-BR'
      )} KG.`
    }

    if (previsaoEstornada > 0) {
      mensagem += ` Previsão liberada: ${previsaoEstornada.toLocaleString(
        'pt-BR'
      )} KG.`
    }

    if (estoqueAbsorvido > 0) {
      mensagem +=
        ` ${estoqueAbsorvido.toLocaleString('pt-BR')} KG de reserva imediata ` +
        `já estavam absorvidos pelo snapshot do ERP e não foram somados novamente ao saldo.`
    }

    setSucesso(mensagem)
    setCancelandoId(null)
    setMotivoCancelamento('')

    await carregar()
  }

  return (
    <section className="page orders-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">
            {admin ? 'ADMINISTRAÇÃO' : 'COMERCIAL'}
          </span>
          <h1>{visaoComercial ? 'Todos os pedidos' : 'Meus pedidos'}</h1>
          <p>
            {visaoComercial
              ? 'Pedidos de todos os vendedores.'
              : 'Somente pedidos criados pela sua conta.'}
            {' '}Horários de Brasília.
          </p>
        </div>

        <button className="secondary-button" onClick={carregar}>
          Atualizar
        </button>
      </div>

      {erro && <div className="alert error">{erro}</div>}
      {sucesso && <div className="alert success">{sucesso}</div>}
      {avisoEmail && <div className="alert" role="status">{avisoEmail}</div>}

      {carregando ? (
        <Loading texto="Buscando pedidos..." />
      ) : (
        <div className="orders-list">
          {pedidos.map((pedido) => {
            const cliente = rel(pedido.clientes)
            const vendedor = rel(pedido.vendedores)
            const filial = rel(pedido.filiais)
            const expandido = aberto === pedido.id
            const cancelado = Boolean(pedido.cancelado_em) || pedido.status === 'CANCELADO'
            const podeOperar = visaoComercial || pedido.created_by === usuario.id
            const podeCancelar = podeOperar && ['ABERTO', 'ENVIADO'].includes(pedido.status)
            const mostrandoCancelamento = cancelandoId === pedido.id
            const faturamento = pedido.pedido_eventos?.find(e => e.tipo === 'FATURAMENTO_MANUAL')
            const podeFaturar = usuario.ativo && visaoComercial && !cancelado && ['ABERTO', 'ENVIADO'].includes(pedido.status)

            return (
              <article
                className={
                  cancelado ? 'order-card order-card-cancelled' : 'order-card'
                }
                key={pedido.id}
              >
                <div className="order-summary order-summary-actions">
                  <button
                    type="button"
                    className="order-open-button"
                    onClick={() => alternar(pedido.id)}
                  >
                    <div>
                      <strong>{pedido.numero}</strong>
                      <span>{dateTime(pedido.created_at)}</span>
                    </div>

                    <div className="order-client">
                      <strong>{cliente?.razao_social || 'Cliente'}</strong>
                      <span>
                        {cliente?.codigo || '—'} • {filial?.nome || 'Filial'}
                      </span>
                    </div>

                    {visaoComercial && (
                      <div>
                        <span className="order-label">Vendedor</span>
                        <strong>{vendedor?.nome || '—'}</strong>
                      </div>
                    )}

                    <div>
                      <span className="order-label">Total</span>
                      <strong>
                        {money(Number(pedido.total), pedido.moeda)}
                      </strong>
                    </div>

                    <span
                      className={
                        cancelado ? 'badge danger' : pedido.status === 'FATURADO' ? 'badge success' : 'badge neutral'
                      }
                    >
                      {cancelado ? 'CANCELADO' : pedido.status}
                    </span>

                    <span className="chevron">
                      {expandido ? '▲' : '▼'}
                    </span>
                  </button>

                  <div className="order-action-buttons">
                    {podeFaturar && <MarcarFaturado numero={pedido.numero} disabled={faturandoId !== null || salvandoCancelamento} onConfirmar={() => marcarFaturado(pedido)} />}
                    <button
                      type="button"
                      className="secondary-button duplicate-button"
                      disabled={!podeOperar}
                      onClick={() => onDuplicar(pedido.id)}
                    >
                      Duplicar
                    </button>

                    {!cancelado && podeOperar && (
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => abrirCancelamento(pedido.id)}
                        disabled={!podeCancelar || salvandoCancelamento || faturandoId !== null}
                        title={podeCancelar ? undefined : 'Cancelamento disponível para pedidos ABERTO ou ENVIADO.'}
                      >
                        Cancelar pedido
                      </button>
                    )}
                  </div>
                </div>

                {pedido.status === 'FATURADO' && faturamento && <div className="invoiced-order-note">Marcado como faturado em {dateTime(faturamento.criado_em)} por <strong>{faturamento.detalhes?.registrado_por_nome || 'Usuário'}</strong>.</div>}
                {pedido.status === 'FATURADO' && pedido.faturamento_aviso_status !== 'NAO_SOLICITADO' && <div className="invoiced-email-note" role="status">
                  <span>{({ PENDENTE: 'E-mail de faturamento pendente.', ENVIANDO: 'Envio de e-mail em andamento.', ENVIADO: 'E-mail de faturamento enviado ao vendedor, João e Márcia.', ERRO: 'Não foi possível enviar o e-mail a todos os destinatários.', INCERTO: 'Envio sem confirmação. Confira o recebimento com os destinatários antes de solicitar suporte.' } as Record<string, string>)[pedido.faturamento_aviso_status]}</span>
                  {usuario.ativo && visaoComercial && ['PENDENTE','ERRO','ENVIANDO'].includes(pedido.faturamento_aviso_status) && <button type="button" className="secondary-button" disabled={enviandoAvisoId !== null || faturandoId !== null} onClick={() => void repetirAvisoFaturado(pedido)}>{enviandoAvisoId === pedido.id ? 'Verificando…' : pedido.faturamento_aviso_status === 'ENVIANDO' ? 'Verificar envio' : 'Tentar enviar e-mail'}</button>}
                </div>}

                {cancelado && (
                  <div className="cancelled-order-note">
                    <strong>Pedido cancelado</strong>
                    <span>
                      {pedido.cancelado_em
                        ? dateTime(pedido.cancelado_em)
                        : ''}
                    </span>
                    {pedido.motivo_cancelamento && (
                      <p>Motivo: {pedido.motivo_cancelamento}</p>
                    )}
                  </div>
                )}

                {mostrandoCancelamento && !cancelado && podeCancelar && (
                  <div className="cancel-order-panel">
                    <div>
                      <strong>Cancelar {pedido.numero}</strong>
                      <p>
                        O pedido continuará no histórico. Reservas imediatas
                        ainda ativas e reservas futuras serão estornadas.
                      </p>
                    </div>

                    <label>
                      Motivo do cancelamento *
                      <textarea
                        rows={3}
                        value={motivoCancelamento}
                        onChange={(e) =>
                          setMotivoCancelamento(e.target.value)
                        }
                        placeholder="Ex.: cliente desistiu / pedido lançado incorretamente..."
                        disabled={salvandoCancelamento}
                      />
                    </label>

                    <div className="cancel-order-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={fecharCancelamento}
                        disabled={salvandoCancelamento}
                      >
                        Voltar
                      </button>

                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => confirmarCancelamento(pedido)}
                        disabled={salvandoCancelamento || faturandoId !== null}
                      >
                        {salvandoCancelamento
                          ? 'Cancelando...'
                          : 'Confirmar cancelamento'}
                      </button>
                    </div>
                  </div>
                )}

                {expandido && (
                  <div className="order-detail">
                    {!itens[pedido.id] ? (
                      <Loading texto="Carregando itens..." />
                    ) : (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Produto</th>
                              <th>Qtd.</th>
                              <th>NET</th>
                              <th>Final</th>
                              <th>ICMS</th>
                              <th>Fiscal</th>
                              <th>Total</th>
                            </tr>
                          </thead>

                          <tbody>
                            {itens[pedido.id].map((item) => {
                              const produto = rel(item.produtos)

                              return (
                                <tr key={item.id}>
                                  <td>
                                    <strong>
                                      {produto?.nome || 'Produto'}
                                    </strong>
                                    <small>
                                      {produto?.codigo_protheus ||
                                        'SEM CÓDIGO'}
                                    </small>
                                  </td>

                                  <td>
                                    {Number(item.quantidade).toLocaleString(
                                      'pt-BR'
                                    )}
                                  </td>

                                  <td>
                                    {money(
                                      Number(item.preco_net),
                                      pedido.moeda
                                    )}
                                  </td>

                                  <td>
                                    {money(
                                      Number(item.preco_final),
                                      pedido.moeda
                                    )}
                                  </td>

                                  <td>
                                    {item.aliquota_icms == null
                                      ? 'MANUAL'
                                      : `${(
                                          Number(item.aliquota_icms) * 100
                                        ).toFixed(0)}%`}
                                  </td>

                                  <td>
                                    <span
                                      className={
                                        item.modo_fiscal === 'AUTOMATICO'
                                          ? 'badge success'
                                          : 'badge warning'
                                      }
                                    >
                                      {item.modo_fiscal}
                                    </span>
                                  </td>

                                  <td>
                                    {money(
                                      Number(item.total_item),
                                      pedido.moeda
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </article>
            )
          })}

          {!pedidos.length && (
            <div className="empty-panel">
              {visaoComercial
                ? 'Ainda não existem pedidos.'
                : 'Você ainda não lançou pedidos.'}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
