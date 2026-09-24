import { useEffect, useRef, useState } from 'react'
import { parseDraft, writeDraft, type CommercialDraft, type StoredDraft } from './commercialDraft'

export function useCommercialDraft(key: string, data: CommercialDraft, hasContent: boolean, ready: boolean, apply: (data: CommercialDraft) => Promise<void>) {
  const [pending, setPending] = useState<StoredDraft | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const revision = useRef<string | null>(null)
  const blocked = useRef(false)
  const ignored = useRef<string | null>(null)
  const submittedKey = useRef<string | null>(null)
  const serialized = JSON.stringify(data)
  const current = useRef({ data, serialized, hasContent, ready, pending, loaded })
  current.current = { data, serialized, hasContent, ready, pending, loaded }

  useEffect(() => {
    try {
      const saved = parseDraft(localStorage.getItem(key))
      revision.current = saved?.revision ?? null
      setPending(saved)
    } catch { blocked.current = true; setStatus('O navegador não permitiu salvar rascunhos. Mantenha esta página aberta até concluir.') }
    setLoaded(true)
  }, [key])

  function persist() {
    const value = current.current
    if (!value.ready || !value.loaded || value.pending || blocked.current || ignored.current === value.serialized || !value.hasContent) return
    try {
      const saved = writeDraft(localStorage, key, value.data, revision.current)
      revision.current = saved.revision
      ignored.current = value.serialized
      setStatus(`Rascunho salvo neste navegador às ${new Date(saved.savedAt).toLocaleTimeString('pt-BR')}.`)
    } catch (error) {
      blocked.current = true
      setStatus(error instanceof Error && error.message.includes('outra aba') ? error.message : 'Não foi possível salvar o rascunho neste navegador. Mantenha a página aberta até concluir.')
    }
  }

  useEffect(() => { persist() }, [key, serialized, hasContent, ready, loaded, pending])
  useEffect(() => {
    const save = () => persist()
    window.addEventListener('pagehide', save)
    return () => { save(); window.removeEventListener('pagehide', save) }
  }, [key])

  function clear() {
    blocked.current = true
    submittedKey.current = current.current.data.idempotencyKey
    try {
      // Do not delete work saved by a different tab.
      const saved = parseDraft(localStorage.getItem(key))
      if ((saved?.revision ?? null) === revision.current) localStorage.removeItem(key)
    } catch { /* The persisted idempotency key still prevents a duplicate after restore. */ }
    revision.current = null
    ignored.current = current.current.serialized
    setPending(null)
    setStatus('')
  }

  // A new submission identity starts another draft even when currency/branch stay selected.
  useEffect(() => {
    const nextDocument = submittedKey.current !== null && submittedKey.current !== data.idempotencyKey
    if ((!hasContent || nextDocument) && !pending && loaded) {
      blocked.current = false
      submittedKey.current = null
      ignored.current = serialized
    }
  }, [hasContent, pending, loaded, serialized, data.idempotencyKey])

  async function restore() {
    if (!pending || busy) return
    setBusy(true)
    try {
      await apply(pending.data)
      setPending(null)
      setStatus('Rascunho restaurado. Revise os dados e os preços antes de confirmar.')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Não foi possível restaurar. Tente novamente.') }
    finally { setBusy(false) }
  }
  function discard() {
    clear()
    blocked.current = false
  }
  return { pending, busy, status, loaded, restore, discard, clear }
}

