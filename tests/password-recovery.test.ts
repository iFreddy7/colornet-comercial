import test from 'node:test'
import assert from 'node:assert/strict'
import { readRecoveryLink, recoveryRedirect, INVALID_RECOVERY } from '../src/lib/passwordRecovery.ts'
import { createRecoveryResolver } from '../src/lib/recoverySession.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

function fakeAuth(overrides = {}) {
  const calls: string[] = []
  const session = { user: { id: 'recovery-user' } }
  const auth = {
    verifyOtp: async () => { calls.push('verify'); return { data: { session }, error: null } },
    setSession: async () => { calls.push('setSession'); return { data: { session }, error: null } },
    exchangeCodeForSession: async () => { calls.push('exchange'); return { data: { session, redirectType: 'recovery' }, error: null } },
    getUser: async () => { calls.push('getUser'); return { data: { user: session.user }, error: null } },
    ...overrides,
  } as unknown as SupabaseClient['auth']
  return { auth, calls }
}

test('redirect remains in the requesting environment and removes old path/hash/query', () => {
  for (const origin of ['https://colornet-comercial.pages.dev', 'https://homologacao.colornet-comercial.pages.dev', 'https://example.vercel.app', 'http://localhost:5173']) {
    assert.equal(recoveryRedirect(`${origin}/old?next=http://localhost:3000#token=old`), `${origin}/?recovery=1`)
  }
  assert.throws(() => recoveryRedirect('http://public.example/'))
})

test('expired link without type is still recognized and cannot reuse a logged-in session', async () => {
  const link = readRecoveryLink('https://portal.test/#error=access_denied&error_code=otp_expired')
  const { auth, calls } = fakeAuth()
  assert.equal(link.requested, true)
  assert.deepEqual(await createRecoveryResolver(auth, link, 'existing-user')(), { error: INVALID_RECOVERY })
  assert.deepEqual(calls, [])
})

test('implicit recovery is exchanged only once under concurrent initialization', async () => {
  const { auth, calls } = fakeAuth()
  const resolve = createRecoveryResolver(auth, readRecoveryLink('https://portal.test/#type=recovery&access_token=a&refresh_token=r'))
  const results = await Promise.all([resolve(), resolve()])
  assert.deepEqual(results, [{ userId: 'recovery-user' }, { userId: 'recovery-user' }])
  assert.deepEqual(calls, ['setSession', 'getUser'])
})

test('token hash is not consumed until resolver is explicitly called', async () => {
  const { auth, calls } = fakeAuth()
  const resolve = createRecoveryResolver(auth, readRecoveryLink('https://portal.test/#type=recovery&token_hash=hash'))
  assert.deepEqual(calls, [])
  assert.deepEqual(await resolve(), { userId: 'recovery-user' })
  assert.deepEqual(calls, ['verify', 'getUser'])
})

test('invitation waits for confirmation and verifies the invite token exactly once', async () => {
  const requests: unknown[] = []
  const { auth } = fakeAuth({ verifyOtp: async (request: unknown) => {
    requests.push(request)
    return { data: { session: { user: { id: 'recovery-user' } } }, error: null }
  } })
  const resolve = createRecoveryResolver(auth, readRecoveryLink('https://portal.test/#type=invite&token_hash=invite-hash'))
  assert.deepEqual(requests, [])
  assert.deepEqual(await Promise.all([resolve(), resolve()]), [{ userId: 'recovery-user' }, { userId: 'recovery-user' }])
  assert.deepEqual(requests, [{ token_hash: 'invite-hash', type: 'invite' }])
})

test('missing/incomplete/wrong-type tokens never fall back to an existing login', async () => {
  for (const fragment of ['?recovery=1', '#type=recovery', '#type=recovery&access_token=a', '#type=signup&token_hash=h']) {
    const { auth, calls } = fakeAuth()
    assert.deepEqual(await createRecoveryResolver(auth, readRecoveryLink(`https://portal.test/${fragment}`), 'recovery-user')(), { error: INVALID_RECOVERY })
    assert.deepEqual(calls, [])
  }
})

test('OTP rejection does not reuse the current session', async () => {
  const { auth, calls } = fakeAuth({ verifyOtp: async () => ({ data: { session: null }, error: { code: 'otp_expired' } }) })
  assert.deepEqual(await createRecoveryResolver(auth, readRecoveryLink('https://portal.test/#type=recovery&token_hash=used'))(), { error: INVALID_RECOVERY })
  assert.deepEqual(calls, [])
})

test('server identity must match the recovery session', async () => {
  const { auth } = fakeAuth({ getUser: async () => ({ data: { user: { id: 'other-user' } }, error: null }) })
  assert.deepEqual(await createRecoveryResolver(auth, readRecoveryLink('https://portal.test/#type=recovery&access_token=a&refresh_token=r'))(), { error: INVALID_RECOVERY })
})

test('refresh only resumes a saved recovery for the same verified user', async () => {
  const { auth } = fakeAuth()
  assert.deepEqual(await createRecoveryResolver(auth, readRecoveryLink('https://portal.test/'), 'recovery-user')(), { userId: 'recovery-user' })
  assert.deepEqual(await createRecoveryResolver(auth, readRecoveryLink('https://portal.test/'))(), { error: INVALID_RECOVERY })
})

test('PKCE recovery is supported and unrelated OAuth callbacks are rejected', async () => {
  const { auth } = fakeAuth()
  assert.deepEqual(await createRecoveryResolver(auth, readRecoveryLink('https://portal.test/?code=c'))(), { userId: 'recovery-user' })
  const other = fakeAuth({ exchangeCodeForSession: async () => ({ data: { session: { user: { id: 'recovery-user' } }, redirectType: null }, error: null }) })
  assert.deepEqual(await createRecoveryResolver(other.auth, readRecoveryLink('https://portal.test/?code=c'))(), { error: INVALID_RECOVERY })
})
