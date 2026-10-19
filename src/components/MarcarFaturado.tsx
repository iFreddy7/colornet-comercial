import { useRef, useState } from 'react'

export function MarcarFaturado({ numero, disabled, onConfirmar }: {
  numero: string; disabled: boolean; onConfirmar: () => Promise<boolean>
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const emAndamento = useRef(false)
  async function confirmar() {
    if (emAndamento.current || disabled) return
    emAndamento.current = true; setSalvando(true)
    try { if (await onConfirmar()) setConfirmando(false) }
    finally { emAndamento.current = false; setSalvando(false) }
  }
  return <div className="mark-invoiced">
    {confirmando ? <div className="mark-invoiced-confirm" role="group" aria-label={'Confirmar faturamento de ' + numero}>
      <strong>Marcar {numero} como faturado?</strong>
      <p>Confirme que o pedido foi faturado por completo. Após a marcação, ele não poderá ser cancelado pelo portal.</p>
      <p>O vendedor responsável, João e Márcia receberão um aviso por e-mail.</p>
      <div><button type="button" className="secondary-button" disabled={salvando} onClick={() => setConfirmando(false)}>Voltar</button>
        <button type="button" className="primary-button" disabled={disabled || salvando} onClick={() => void confirmar()}>{salvando ? 'Registrando…' : 'Confirmar faturado'}</button></div>
    </div> : <button type="button" className="primary-button" disabled={disabled} onClick={() => setConfirmando(true)}>Faturado</button>}
  </div>
}
