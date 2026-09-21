import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { DashboardStats, UsuarioApp } from '../types'
import { Loading } from '../components/Loading'

type PedidoDashboard = {
  id: string
  status: string
  moeda: string
  vendedor_id: string | null
  vendedores: { nome: string } | Array<{ nome: string }> | null
  pedido_itens: Array<{
    quantidade: number | string | null
    preco_net: number | string | null
  }> | null
}

type VendedorResumo = {
  id: string
  nome: string
  pedidos: number
  netUsd: number
}

function relNome(value: PedidoDashboard['vendedores']) {
  if (!value) return 'Sem vendedor'
  return Array.isArray(value) ? value[0]?.nome || 'Sem vendedor' : value.nome || 'Sem vendedor'
}

function valorNetPedido(pedido: PedidoDashboard) {
  if (pedido.moeda !== 'USD') return 0

  return (pedido.pedido_itens ?? []).reduce((total, item) => {
    const quantidade = Number(item.quantidade ?? 0)
    const precoNet = Number(item.preco_net ?? 0)
    return total + quantidade * precoNet
  }, 0)
}

function usd(valor: number) {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function Home({ usuario }: { usuario: UsuarioApp }) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [pedidosDashboard, setPedidosDashboard] = useState<PedidoDashboard[]>([])
  const [erro, setErro] = useState('')

  const admin = usuario.perfil === 'ADMIN'

  useEffect(() => {
    carregar()
  }, [usuario.id])

  async function contar(tabela: string) {
    const { count, error } = await supabase
      .from(tabela)
      .select('*', { count: 'exact', head: true })

    if (error) throw error
    return count ?? 0
  }

  async function carregar() {
    setErro('')

    try {
      const [clientes, produtos, precos, filiais, pedidosResult] = await Promise.all([
        contar('clientes'),
        contar('produtos'),
        contar('precos'),
        contar('filiais'),
        supabase
          .from('pedidos')
          .select('id,status,moeda,vendedor_id,vendedores(nome),pedido_itens(quantidade,preco_net)')
          .order('created_at', { ascending: false }),
      ])

      if (pedidosResult.error) throw pedidosResult.error

      const pedidos = (pedidosResult.data ?? []) as PedidoDashboard[]
      const pedidosAtivos = pedidos.filter((pedido) => pedido.status !== 'CANCELADO')

      setPedidosDashboard(pedidosAtivos)
      setStats({
        clientes,
        produtos,
        precos,
        filiais,
        pedidos: pedidosAtivos.length,
      })
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Erro ao carregar dados.')
    }
  }

  const netUsdTotal = useMemo(
    () => pedidosDashboard.reduce((total, pedido) => total + valorNetPedido(pedido), 0),
    [pedidosDashboard]
  )

  const pedidosBrl = useMemo(
    () => pedidosDashboard.filter((pedido) => pedido.moeda !== 'USD').length,
    [pedidosDashboard]
  )

  const porVendedor = useMemo(() => {
    const mapa = new Map<string, VendedorResumo>()

    for (const pedido of pedidosDashboard) {
      const id = pedido.vendedor_id || 'sem-vendedor'
      const atual = mapa.get(id) ?? {
        id,
        nome: relNome(pedido.vendedores),
        pedidos: 0,
        netUsd: 0,
      }

      atual.pedidos += 1
      atual.netUsd += valorNetPedido(pedido)
      mapa.set(id, atual)
    }

    return [...mapa.values()].sort((a, b) => b.netUsd - a.netUsd || b.pedidos - a.pedidos)
  }, [pedidosDashboard])

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">COLORNET COMERCIAL</span>
          <h1>Olá, {usuario.nome || 'bem-vindo'}.</h1>
          <p>
            {admin
              ? 'Visão geral de pedidos e desempenho comercial.'
              : 'Acompanhe seus pedidos e o seu valor NET acumulado.'}
          </p>
        </div>

        <div className="status-pill">
          <span className="status-dot" />
          Dados atualizados
        </div>
      </div>

      {erro && <div className="alert error">{erro}</div>}

      {!stats ? (
        <Loading texto="Consultando o banco..." />
      ) : (
        <>
          <div className="stats-grid dashboard-main-stats">
            <div className="stat-card dashboard-highlight">
              <span>{admin ? 'Pedidos ativos' : 'Meus pedidos ativos'}</span>
              <strong>{stats.pedidos.toLocaleString('pt-BR')}</strong>
              <small>pedidos cancelados não entram</small>
            </div>

            <div className="stat-card dashboard-highlight">
              <span>{admin ? 'NET total em US$' : 'Meu NET total em US$'}</span>
              <strong className="dashboard-money">{usd(netUsdTotal)}</strong>
              <small>soma de quantidade × preço NET em pedidos USD</small>
            </div>

            <div className="stat-card">
              <span>{admin ? 'Clientes' : 'Minha carteira'}</span>
              <strong>{stats.clientes.toLocaleString('pt-BR')}</strong>
              <small>{admin ? 'todos os clientes' : 'clientes liberados para você'}</small>
            </div>

            <div className="stat-card">
              <span>Produtos</span>
              <strong>{stats.produtos.toLocaleString('pt-BR')}</strong>
              <small>base comercial</small>
            </div>
          </div>

          {pedidosBrl > 0 && (
            <div className="alert warning-box dashboard-note">
              {pedidosBrl} pedido(s) em R$ não entram no total em US$, para evitar conversão com PTAX diferente da data original do pedido.
            </div>
          )}

          {admin ? (
            <div className="form-card dashboard-sellers">
              <div className="section-title">
                <span>↗</span>
                <div>
                  <strong>Desempenho por vendedor</strong>
                  <small>Pedidos ativos e valor NET acumulado em dólar.</small>
                </div>
              </div>

              <div className="table-scroll">
                <table className="dashboard-sellers-table">
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th>Pedidos</th>
                      <th>NET em US$</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porVendedor.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.nome}</strong></td>
                        <td>{item.pedidos.toLocaleString('pt-BR')}</td>
                        <td><strong>{usd(item.netUsd)}</strong></td>
                      </tr>
                    ))}
                    {!porVendedor.length && (
                      <tr>
                        <td colSpan={3} className="empty-cell">Nenhum pedido ativo registrado.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="welcome-panel dashboard-personal">
              <div>
                <span className="eyebrow">MEU DESEMPENHO</span>
                <h2>{stats.pedidos.toLocaleString('pt-BR')} pedido(s) ativo(s)</h2>
                <p>
                  Seu valor NET acumulado nos pedidos em dólar é <strong>{usd(netUsdTotal)}</strong>.
                  Pedidos cancelados são desconsiderados automaticamente.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
