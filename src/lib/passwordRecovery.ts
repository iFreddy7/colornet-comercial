export const INVALID_RECOVERY = 'Este link é inválido, expirou ou já foi utilizado. Solicite um novo link e use o e-mail mais recente.'

export type RecoveryLink = {
  requested: boolean
  error: boolean
  type: 'recovery' | 'invite' | null
  tokenHash: string | null
  accessToken: string | null
  refreshToken: string | null
  code: string | null
}

export function readRecoveryLink(href: string): RecoveryLink {
  const url = new URL(href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const get = (key: string) => hash.get(key) || url.searchParams.get(key)
  const rawType = get('type')
  const type = rawType === 'recovery' || rawType === 'invite' ? rawType : null
  const error = Boolean(get('error') || get('error_code') || get('error_description'))
  return {
    requested: Boolean(type || error || get('token_hash') || get('code') || url.searchParams.get('recovery') === '1'),
    error,
    type,
    tokenHash: get('token_hash'),
    accessToken: hash.get('access_token'),
    refreshToken: hash.get('refresh_token'),
    code: url.searchParams.get('code'),
  }
}

// Use the same origin and a stable path: never an old localhost or another environment.
// The exact result must also be authorized in this environment's Supabase Redirect URLs.
export function recoveryRedirect(href: string): string {
  const url = new URL(href)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Abra o portal pelo endereço HTTPS para recuperar sua senha.')
  }
  return `${url.origin}/?recovery=1`
}

export function authErrorMessage(error: { code?: string; message?: string; status?: number } | null | undefined): string {
  if (error?.code === 'otp_expired' || error?.code === 'session_not_found' || error?.status === 401 || error?.status === 403) return INVALID_RECOVERY
  if (error?.code === 'same_password') return 'Escolha uma senha diferente da senha atual.'
  if (error?.code === 'weak_password') return 'A senha não atende aos requisitos de segurança. Use uma senha mais forte.'
  if (error?.status === 429 || error?.code === 'over_email_send_rate_limit') return 'Aguarde alguns minutos antes de solicitar outro link.'
  return 'Não foi possível concluir a solicitação. Verifique sua conexão e tente novamente.'
}
