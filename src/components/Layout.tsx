import { useState, type ReactNode } from 'react'
import type { UsuarioApp } from '../types'

export type Tela =
  | 'inicio'
  | 'novo-pedido'
  | 'pedidos'
  | 'produtos'
  | 'clientes'
  | 'admin'
  | 'nova-cotacao'
  | 'cotacoes'

interface LayoutProps {
  usuario: UsuarioApp
  tela: Tela
  setTela: (tela: Tela) => void
  onSair: () => void
  children: ReactNode
}

export function Layout({ usuario, tela, setTela, onSair, children }: LayoutProps) {
  const [menuAberto, setMenuAberto] = useState(false)
  const admin = usuario.perfil === 'ADMIN'

  function navegar(destino: Tela) {
    setTela(destino)
    setMenuAberto(false)
  }

  return (
    <div className="app-shell">
      <header className="mobile-topbar">
        <button
          type="button"
          className="mobile-menu-button"
          onClick={() => setMenuAberto((v) => !v)}
          aria-label="Abrir menu"
        >
          ☰
        </button>
        <div className="mobile-brand">ColorNet</div>
      </header>

      {menuAberto && (
        <button
          type="button"
          className="mobile-menu-backdrop"
          onClick={() => setMenuAberto(false)}
          aria-label="Fechar menu"
        />
      )}

      <aside className={menuAberto ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <div className="brand-mark">C</div>
          <div>
            <strong>ColorNet</strong>
            <span>Comercial</span>
          </div>
        </div>

        <nav className="nav">
          <button className={tela === 'inicio' ? 'nav-item active' : 'nav-item'} onClick={() => navegar('inicio')}>
            <span>⌂</span>Início
          </button>
          <button className={tela === 'novo-pedido' ? 'nav-item active' : 'nav-item'} onClick={() => navegar('novo-pedido')}>
            <span>＋</span>Novo Pedido
          </button>
          <button className={tela === 'pedidos' ? 'nav-item active' : 'nav-item'} onClick={() => navegar('pedidos')}>
            <span>≡</span>{admin ? 'Todos os Pedidos' : 'Meus Pedidos'}
          </button>
          <button className={tela === 'nova-cotacao' ? 'nav-item active' : 'nav-item'} onClick={() => navegar('nova-cotacao')}><span>＋</span>Nova Cotação / Lista</button>
          <button className={tela === 'cotacoes' ? 'nav-item active' : 'nav-item'} onClick={() => navegar('cotacoes')}><span>≡</span>{admin ? 'Todas as Cotações' : 'Minhas Cotações'}</button>
          <button className={tela === 'produtos' ? 'nav-item active' : 'nav-item'} onClick={() => navegar('produtos')}>
            <span>□</span>Produtos
          </button>
          <button className={tela === 'clientes' ? 'nav-item active' : 'nav-item'} onClick={() => navegar('clientes')}>
            <span>◎</span>{admin ? 'Todos os Clientes' : 'Minha Carteira'}
          </button>
          {admin && (
            <button className={tela === 'admin' ? 'nav-item active' : 'nav-item'} onClick={() => navegar('admin')}>
              <span>⚙</span>Painel ADMIN
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-mini">
            <div className="avatar">{(usuario.nome || usuario.email || 'U').charAt(0).toUpperCase()}</div>
            <div>
              <strong>{usuario.nome || usuario.email}</strong>
              <span>{usuario.perfil}</span>
            </div>
          </div>
          <button className="logout-button" onClick={onSair}>Sair</button>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  )
}
