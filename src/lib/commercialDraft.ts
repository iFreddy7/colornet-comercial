import type { ItemPedidoLocal } from '../types.ts'

export interface CommercialDraft {
  fields: Record<string, string>
  items: ItemPedidoLocal[]
  productId: string | null
  idempotencyKey: string
}
export interface StoredDraft { version: 1; savedAt: number; revision: string; data: CommercialDraft }
export const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000
export const draftKey = (environment: string, userId: string, kind: string) =>
  `colornet:draft:v1:${environment}:${userId}:${kind}`

export function parseDraft(raw: string | null, now = Date.now()): StoredDraft | null {
  if (!raw || raw.length > 1_000_000) return null
  try {
    const value = JSON.parse(raw)
    const data = value?.data
    if (value.version !== 1 || !Number.isFinite(value.savedAt) || value.savedAt > now + 60_000 || now - value.savedAt > DRAFT_TTL || typeof value.revision !== 'string') return null
    if (!data || typeof data.idempotencyKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.idempotencyKey)) return null
    if (data.productId !== null && typeof data.productId !== 'string') return null
    if (!data.fields || Array.isArray(data.fields) || typeof data.fields !== 'object' || Object.values(data.fields).some(v => typeof v !== 'string')) return null
    if (!Array.isArray(data.items) || data.items.length > 500) return null
    for (const item of data.items) {
      if (!item || typeof item.idLocal !== 'string' || typeof item.produto_id !== 'string' || typeof item.produto !== 'string') return null
      if (item.quantidade !== null && (!Number.isFinite(item.quantidade) || item.quantidade <= 0)) return null
      for (const field of ['preco_net', 'preco_final', 'ipi', 'valor_ipi', 'subtotal', 'total_item']) if (!Number.isFinite(item[field])) return null
      if (!['AUTOMATICO', 'MANUAL'].includes(item.modo_fiscal)) return null
    }
    return value as StoredDraft
  } catch { return null }
}

// A stale tab must not resurrect a submitted draft or overwrite a newer revision.
export function writeDraft(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, data: CommercialDraft, expected: string | null): StoredDraft {
  const current = storage.getItem(key)
  const previous = parseDraft(current)
  if ((previous?.revision ?? null) !== expected) throw new Error('Este rascunho mudou em outra aba. Atualize a página antes de continuar.')
  const next: StoredDraft = { version: 1, savedAt: Date.now(), revision: crypto.randomUUID(), data }
  storage.setItem(key, JSON.stringify(next))
  return next
}
