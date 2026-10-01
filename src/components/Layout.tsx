import { temVisaoComercial } from '../lib/permissoes'
import { APP_ENV_LABEL, IS_PRODUCTION } from '../lib/env'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { UsuarioApp } from '../types'
import { BrandLogo } from './BrandLogo'
import { InstallPwaButton } from './Pwa'
import { Icon, type IconName } from './Icon'

export type Tela = 'inicio' | 'novo-pedido' | 'pedidos' | 'produtos' | 'clientes' | 'admin' | 'relatorios' | 'nova-cotacao' | 'cotacoes'

interface LayoutProps {
  usuario: UsuarioApp
  tela: Tela
  setTela: (tela: Tela) => void
  onSair: () => void
  children: ReactNode
}

export function Layout({ usuario, tela, setTela, onSair, children }: LayoutProps) {
  const [menuAberto, setMenuAberto] = useState(false)
  const menuRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const admin = usuario.perfil === 'ADMIN'
  const visaoComercial = temVisaoComercial(usuario)

  useEffect(() => {
    if (!menuAberto) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('button')
    const focusFrame = requestAnimationFrame(() => buttons?.[0]?.focus())
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuAberto(false)
      if (event.key !== 'Tab' || !buttons?.length) return
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (!menuRef.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    const desktop = window.matchMedia('(min-width: 901px)')
    const closeOnDesktop = () => { if (desktop.matches) setMenuAberto(false) }
    desktop.addEventListener('change', closeOnDesktop)
    document.addEventListener('keydown', handleKey)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.body.style.overflow = previousOverflow
      desktop.removeEventListener('change', closeOnDesktop)
      document.removeEventListener('keydown', handleKey)
      toggleRef.current?.focus()
    }
  }, [menuAberto])

  function navegar(destino: Tela) {
    setTela(destino)
    setMenuAberto(false)
  }

  function item(destino: Tela, label: string, icon: IconName) {
    return <button type="button" className={tela === destino ? 'nav-item active' : 'nav-item'} aria-current={tela === destino ? 'page' : undefined} onClick={() => navegar(destino)}><Icon name={icon} /><span>{label}</span></button>
  }

  return (
    <div className="app-shell portal-shell">
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <header className="portal-topbar" inert={menuAberto}>
        <div className="portal-identity">
          <button ref={toggleRef} type="button" className="portal-menu-button" onClick={() => setMenuAberto(true)} aria-label="Abrir menu" aria-expanded={menuAberto} aria-controls="menu-principal"><Icon name="menu" /></button>
          <button type="button" className="brand-home" onClick={() => navegar('inicio')} aria-label="ColorNet — página inicial"><BrandLogo /></button>
          <div className="portal-title"><strong>Portal Comercial</strong><span>Conectando negócios</span></div>
        </div>
        <div className="portal-top-actions">
          <span className={IS_PRODUCTION ? 'env-chip prod' : 'env-chip'}>{APP_ENV_LABEL}</span>
          <button type="button" className="primary-button topbar-create" onClick={() => navegar('novo-pedido')}><Icon name="plus" />Novo pedido</button>
        </div>
      </header>
      {menuAberto && <button type="button" className="mobile-menu-backdrop" onClick={() => setMenuAberto(false)} aria-label="Fechar menu" tabIndex={-1} />}
      <aside id="menu-principal" ref={menuRef} className={menuAberto ? 'sidebar open' : 'sidebar'} role={menuAberto ? 'dialog' : undefined} aria-modal={menuAberto || undefined} aria-label="Menu principal">
        <div className="sidebar-mobile-heading"><strong>Seu espaço comercial</strong><button type="button" onClick={() => setMenuAberto(false)} aria-label="Fechar menu"><Icon name="close" /></button></div>
        <nav className="nav" aria-label="Navegação principal">
          <p className="nav-group-title">VISÃO GERAL</p>
          {item('inicio', 'Início', 'home')}
          <p className="nav-group-title">COMERCIAL</p>
          {item('novo-pedido', 'Novo Pedido', 'plus')}
          {item('pedidos', visaoComercial ? 'Todos os Pedidos' : 'Meus Pedidos', 'orders')}
          {item('nova-cotacao', 'Nova Cotação / Lista', 'plus')}
          {item('cotacoes', visaoComercial ? 'Todas as Cotações' : 'Minhas Cotações', 'quote')}
          <p className="nav-group-title">CONSULTAS</p>
          {item('produtos', 'Produtos', 'products')}
          {item('clientes', visaoComercial ? 'Todos os Clientes' : 'Minha Carteira', 'clients')}
          {visaoComercial && item('relatorios', 'Relatórios', 'reports')}
          {admin && <><p className="nav-group-title">ADMINISTRAÇÃO</p>{item('admin', 'Painel ADMIN', 'shield')}</>}
        </nav>
        <div className="sidebar-footer">
          <InstallPwaButton onBeforeInstall={() => setMenuAberto(false)} />
          <div className="user-mini">
            <div className="avatar">{(usuario.nome || usuario.email || 'U').charAt(0).toUpperCase()}</div>
            <div><strong title={usuario.nome || usuario.email || undefined}>{usuario.nome || usuario.email}</strong><span>{usuario.perfil.toLowerCase()}</span></div>
          </div>
          <button type="button" className="logout-button" onClick={onSair}><Icon name="logout" />Sair da conta</button>
        </div>
      </aside>
      <main id="conteudo" className="main-content" tabIndex={-1} inert={menuAberto}>{children}</main>
    </div>
  )
}
