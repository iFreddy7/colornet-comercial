import { useState, type ReactNode } from 'react'

export function FiltrosRecolhiveis({ ativos, children }: { ativos: number; children: ReactNode }) {
  const [aberto, setAberto] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 701px)').matches)
  return <details className="form-card forecast-filter-card collapsible-filters" open={aberto} onToggle={e => setAberto(e.currentTarget.open)}>
    <summary>Filtros <span>{ativos ? `${ativos} ativo(s)` : 'Todos os registros autorizados'}</span></summary>
    {children}
  </details>
}
