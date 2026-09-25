import { temVisaoComercial } from '../lib/permissoes'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { DashboardStats, UsuarioApp } from '../types'
import { Loading } from '../components/Loading'

export function Home({ usuario }: { usuario: UsuarioApp }) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [erro, setErro] = useState('')

  const visaoComercial = temVisaoComercial(usuario)

  useEffect(() => {
    carregar()
  }, [])

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
      const [clientes, produtos, precos, filiais, pedidos] = await Promise.all([
        contar('clientes'),
        contar('produtos'),
        contar('precos'),
        contar('filiais'),
        contar('pedidos'),
      ])

      setStats({ clientes, produtos, precos, filiais, pedidos })
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Erro ao carregar dados.')
    }
  }

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">COLORNET COMERCIAL • FASE 5</span>
          <h1>Olá, {usuario.nome || 'bem-vindo'}.</h1>
          <p>
            {visaoComercial
              ? 'Você possui visão geral dos clientes e pedidos da operação.'
              : 'Clientes e pedidos abaixo já respeitam a sua carteira e seu usuário.'}
          </p>
        </div>

        <div className="status-pill">
          <span className="status-dot" />
          Supabase conectado
        </div>
      </div>

      {erro && <div className="alert error">{erro}</div>}

      {!stats ? (
        <Loading texto="Consultando o banco..." />
      ) : (
        <>
          <div className="stats-grid five">
            <div className="stat-card">
              <span>{visaoComercial ? 'Clientes' : 'Minha carteira'}</span>
              <strong>{stats.clientes.toLocaleString('pt-BR')}</strong>
              <small>{visaoComercial ? 'todos os clientes' : 'clientes liberados pelo RLS'}</small>
            </div>

            <div className="stat-card">
              <span>{visaoComercial ? 'Pedidos' : 'Meus pedidos'}</span>
              <strong>{stats.pedidos.toLocaleString('pt-BR')}</strong>
              <small>{visaoComercial ? 'todos os vendedores' : 'lançados por você'}</small>
            </div>

            <div className="stat-card">
              <span>Produtos</span>
              <strong>{stats.produtos.toLocaleString('pt-BR')}</strong>
              <small>base comercial</small>
            </div>

            <div className="stat-card">
              <span>Preços</span>
              <strong>{stats.precos.toLocaleString('pt-BR')}</strong>
              <small>listas vinculadas</small>
            </div>

            <div className="stat-card">
              <span>Filiais</span>
              <strong>{stats.filiais.toLocaleString('pt-BR')}</strong>
              <small>configuradas</small>
            </div>
          </div>

          <div className="welcome-panel">
            <div>
              <span className="eyebrow">SEGURANÇA</span>
              <h2>Permissão aplicada no próprio banco</h2>
              <p>
                O React não decide quais clientes e pedidos você pode visualizar.
                O PostgreSQL aplica Row Level Security em cada consulta, inclusive
                se alguém tentar chamar a API manualmente fora da interface.
              </p>
            </div>

            <div className="check-list">
              <span>✓ Supabase Auth</span>
              <span>✓ Carteira por vendedor</span>
              <span>✓ Pedidos pelo criador</span>
              <span>✓ Gestão com visão geral</span>
              <span>✓ Gravação por RPC</span>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
