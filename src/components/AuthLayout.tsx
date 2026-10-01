import type { ReactNode } from 'react'
import { APP_ENV_LABEL, IS_PRODUCTION } from '../lib/env'
import { BrandLogo } from './BrandLogo'
import { InstallPwaButton } from './Pwa'
import { Icon } from './Icon'

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <header className="auth-topbar">
        <BrandLogo />
        <span className={IS_PRODUCTION ? 'env-chip prod' : 'env-chip'}>{APP_ENV_LABEL}</span>
      </header>
      <main className="auth-content">
        <section className="auth-intro" aria-label="Portal Comercial ColorNet">
          <span className="auth-eyebrow">PORTAL COMERCIAL</span>
          <h1>Mais conexão.<br />Novas possibilidades.</h1>
          <p>Clientes, cotações e pedidos.<br />Tudo conectado ao seu dia a dia.</p>
          <div className="auth-features">
            <span><Icon name="clients" /> Sua carteira de clientes</span>
            <span><Icon name="quote" /> Cotações e oportunidades</span>
            <span><Icon name="orders" /> Acompanhamento de pedidos</span>
          </div>
          <div className="auth-signature">ColorNet <span>•</span> a vinmar company</div>
        </section>
        <div className="auth-form-area">{children}<InstallPwaButton /></div>
      </main>
      <footer className="auth-footer">ColorNet Comercial <span>Um espaço para conectar negócios.</span></footer>
    </div>
  )
}
