import type { SupabaseClient } from '@supabase/supabase-js'
import { INVALID_RECOVERY, authErrorMessage, type RecoveryLink } from './passwordRecovery.ts'

export type RecoveryResult = { userId: string; error?: never } | { userId?: never; error: string }

export function createRecoveryResolver(auth: SupabaseClient['auth'], link: RecoveryLink, savedUserId?: string) {
  let pending: Promise<RecoveryResult> | undefined
  // StrictMode/remounts must never exchange a single-use token twice.
  return () => pending ??= resolve()

  async function resolve(): Promise<RecoveryResult> {
    try {
      if (link.error) return { error: INVALID_RECOVERY }
      let expectedUserId: string | undefined
      if (link.requested) {
        let response
        if (link.tokenHash && link.type) {
          response = await auth.verifyOtp({ token_hash: link.tokenHash, type: link.type })
        } else if (link.code) {
          const exchanged = await auth.exchangeCodeForSession(link.code)
          // Do not treat a regular OAuth code as permission to open recovery.
          if (!exchanged.error && !link.type && (!('redirectType' in exchanged.data) || exchanged.data.redirectType !== 'recovery')) return { error: INVALID_RECOVERY }
          response = exchanged
        } else if (link.type && link.accessToken && link.refreshToken) {
          response = await auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
        } else {
          return { error: INVALID_RECOVERY }
        }
        if (response.error) return { error: authErrorMessage(response.error) }
        expectedUserId = response.data.session?.user.id
      } else {
        expectedUserId = savedUserId
      }
      // Never fall back to an unrelated existing login when a link fails.
      if (!expectedUserId) return { error: INVALID_RECOVERY }
      const { data, error } = await auth.getUser()
      if (error || data.user?.id !== expectedUserId) return { error: INVALID_RECOVERY }
      return { userId: expectedUserId }
    } catch {
      return { error: 'Não foi possível validar o link. Verifique sua conexão e abra novamente o link do e-mail.' }
    }
  }
}
