import { temVisaoComercial } from '../lib/permissoes'
import { Icon } from '../components/Icon'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { UsuarioApp } from '../types'
import { Loading } from '../components/Loading'

function periodoMesAtual() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())

  const ano = Number(partes.find((p) => p.type === 'year')?.value)
  const mes = Number(partes.find((p) => p.type === 'month')?.value)

  const proximo = new Date(Date.UTC(ano, mes, 1, 12, 0, 0))
  const proximoAno = proximo.getUTCFullYear()
  const proximoMes = String(proximo.getUTCMonth() + 1).padStart(2, '0')
  const mesAtual = String(mes).padStart(2, '0')

  return {
    inicio: `${ano}-${mesAtual}-01T00:00:00-03:00`,
    fim: `${proximoAno}-${proximoMes}-01T00:00:00-03:00`,
    label: new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      month: 'long',
      year: 'numeric',
    }).format(new Date()),
  }
}

export function Home({ usuario }: { usuario: UsuarioApp }) {
  const [stats, setStats] = useState<{ clientes: number; produtos: number; pedidos: number } | null>(null)
  const [erro, setErro] = useState('')
  const [tentativa, setTentativa] = useState(0)
  const gestao = temVisaoComercial(usuario)
  const periodo = useMemo(() => periodoMesAtual(), [])
  useEffect(() => {
    let ativo = true
    setStats(null); setErro('')
    async function carregar() {
      try {
        const [clientes, produtos, pedidos] = await Promise.all([
          supabase.from('clientes').select('id', { count: 'exact', head: true }),
          supabase.from('produtos').select('id', { count: 'exact', head: true }),
          supabase.from('pedidos').select('id', { count: 'exact', head: true })
            .gte('created_at', periodo.inicio).lt('created_at', periodo.fim)
            .or('status.neq.CANCELADO,status.is.null'),
        ])
        const error = clientes.error || produtos.error || pedidos.error
        if (error) throw error
        if (ativo) setStats({ clientes: clientes.count ?? 0, produtos: produtos.count ?? 0, pedidos: pedidos.count ?? 0 })
      } catch {
        if (ativo) setErro('Não foi possível carregar o painel. Tente novamente.')
      }
    }
    void carregar()
    return () => { ativo = false }
  }, [usuario.id, periodo, tentativa])
  return <section className="page dashboard-page">
    <div className="page-header dashboard-header">
      <div><span className="eyebrow">SEU PAINEL COMERCIAL</span><h1>Olá, {usuario.nome || 'bem-vindo'}.</h1>
        <p>Acompanhe {gestao ? 'os' : 'seus'} pedidos de {periodo.label} e consulte os cadastros disponíveis.</p></div>
      {stats && <div className="status-pill"><span className="status-dot" />Dados atualizados</div>}
    </div>
    {erro ? <div className="alert error" role="alert">{erro} <button type="button" className="secondary-button" onClick={() => setTentativa(t => t + 1)}>Tentar novamente</button></div>
      : !stats ? <Loading texto="Carregando painel..." /> : <div className="stats-grid dashboard-main-stats dashboard-overview">
        <div className="stat-card dashboard-highlight"><div className="metric-icon"><Icon name="orders" /></div><span>{gestao ? 'Pedidos ativos no mês' : 'Meus pedidos no mês'}</span><strong>{stats.pedidos.toLocaleString('pt-BR')}</strong><small>Pedidos cancelados não entram</small></div>
        <div className="stat-card"><div className="metric-icon"><Icon name="clients" /></div><span>{gestao ? 'Clientes' : 'Minha carteira'}</span><strong>{stats.clientes.toLocaleString('pt-BR')}</strong><small>{gestao ? 'Todos os clientes' : 'Clientes liberados para você'}</small></div>
        <div className="stat-card"><div className="metric-icon"><Icon name="products" /></div><span>Produtos</span><strong>{stats.produtos.toLocaleString('pt-BR')}</strong><small>Base comercial</small></div>
      </div>}
  </section>
}
