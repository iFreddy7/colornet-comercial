import type { useCommercialDraft } from '../lib/useCommercialDraft'

export function DraftNotice({ draft }: { draft: ReturnType<typeof useCommercialDraft> }) {
  if (draft.pending) return <div className="alert warning-box draft-notice" role="status">
    <p>Há um rascunho de {new Date(draft.pending.savedAt).toLocaleString('pt-BR')} salvo neste navegador. Ele não reserva estoque.</p>
    <button className="primary-button" disabled={draft.busy} onClick={draft.restore}>{draft.busy ? 'Restaurando...' : 'Restaurar rascunho'}</button>{' '}
    <button className="secondary-button" disabled={draft.busy} onClick={() => { if (window.confirm('Descartar o rascunho salvo neste navegador?')) draft.discard() }}>Descartar rascunho</button>
    {draft.status && <p>{draft.status}</p>}
  </div>
  return <p className="field-help" role="status">{draft.status || 'O rascunho é salvo automaticamente neste navegador por até 7 dias.'}</p>
}
