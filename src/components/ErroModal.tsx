import { useEffect, useRef } from 'react'

export function ErroModal({ mensagem, onFechar }: { mensagem: string; onFechar?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (mensagem && !dialog.current?.open) dialog.current?.showModal()
    if (!mensagem) dialog.current?.close()
  }, [mensagem])
  return <dialog onClose={onFechar} ref={dialog} aria-label="Confira os dados" aria-describedby="erro-comercial-mensagem" style={{ border: '1px solid #dbe3f2', borderRadius: 16, padding: 24, maxWidth: 'min(480px, 90vw)', color: '#202e49' }}>
    <h2>Confira os dados</h2><p id="erro-comercial-mensagem" role="alert">{mensagem}</p>
    <button type="button" className="primary-button" autoFocus onClick={() => dialog.current?.close()}>Entendi, vou corrigir</button>
  </dialog>
}

