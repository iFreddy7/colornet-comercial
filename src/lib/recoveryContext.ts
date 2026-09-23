import { readRecoveryLink } from './passwordRecovery'

// Capture before createClient can consume the URL. Recovery is handled once by our page.
export const recoveryLink = readRecoveryLink(window.location.href)
const KEY = 'colornet-recovery'
type Marker = { userId: string; expiresAt: number }

export function recoveryMarker(): Marker | null {
  try {
    const marker = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    return marker && typeof marker.userId === 'string' && marker.expiresAt > Date.now() ? marker : null
  } catch { return null }
}

export function rememberRecovery(userId: string) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ userId, expiresAt: Date.now() + 15 * 60_000 })) } catch { /* recovery still works without persistence */ }
}

export function clearRecovery() {
  try { sessionStorage.removeItem(KEY) } catch { /* storage may be blocked */ }
}

export function cleanRecoveryUrl() {
  window.history.replaceState({}, document.title, window.location.pathname)
}

export const startsRecovery = recoveryLink.requested || Boolean(recoveryMarker())
