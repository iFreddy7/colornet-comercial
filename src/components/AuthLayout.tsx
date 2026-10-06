import type { ReactNode } from 'react'
import { APP_ENV_LABEL, IS_PRODUCTION } from '../lib/env'
import { BrandLogo } from './BrandLogo'
import { InstallPwaButton } from './Pwa'
import './authGlass.css'

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell auth-glass">
      <div className="auth-glass-decoration" aria-hidden="true">
        <span className="auth-glass-orbit" />
        <span className="auth-glass-orb" />
        <span className="auth-glass-ribbon" />
      </div>
      <header className="auth-glass-topbar">
        <span>COLORNET COMERCIAL</span>
        <span className={IS_PRODUCTION ? 'env-chip prod' : 'env-chip'}>{APP_ENV_LABEL}</span>
      </header>
      <main className="auth-glass-main">
        <section className="auth-glass-panel" aria-label="Acesso ao portal ColorNet">
          <div className="auth-glass-brand">
            <BrandLogo />
            <h1>Portal Comercial</h1>
          </div>
          {children}
        </section>
      </main>
      <footer className="auth-glass-footer"><span>ColorNet • a vinmar company</span><InstallPwaButton /></footer>
    </div>
  )
}
