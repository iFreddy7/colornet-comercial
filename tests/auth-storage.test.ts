import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { createAuthStorage } from '../src/lib/authStorage.ts'

function memory() {
  const data = new Map<string, string>()
  return { data, getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
}
const key = 'sb-test-auth-token'

test('Existing sessions survive rollout and remembered sessions survive a new browser session', () => {
  const local = memory(), tab = memory()
  local.setItem(key, 'legacy-session')
  const a = createAuthStorage(key, () => local, () => tab)
  assert.equal(a.storage.getItem(key), 'legacy-session')
  a.setRememberMe(true); a.storage.setItem(key, 'remembered-session')
  assert.equal(createAuthStorage(key, () => local, memory).storage.getItem(key), 'remembered-session')
  assert.equal(tab.getItem(key), null)
})

test('Unchecked sessions survive reload in their tab but cannot reopen from persistent storage', () => {
  const local = memory(), tab = memory()
  const a = createAuthStorage(key, () => local, () => tab)
  a.storage.setItem(key, 'old-session')
  a.setRememberMe(false); a.storage.setItem(key, 'temporary-session')
  assert.equal(local.getItem(key), null)
  assert.equal(createAuthStorage(key, () => local, () => tab).storage.getItem(key), 'temporary-session')
  assert.equal(createAuthStorage(key, () => local, memory).storage.getItem(key), null)
  // Another tab cannot turn this explicitly temporary session into a remembered one.
  local.setItem(`${key}:remember-me`, 'true')
  local.setItem(key, 'new-remembered-login-in-another-tab')
  a.storage.setItem(key, 'refreshed-temporary-session')
  assert.equal(local.getItem(key), 'new-remembered-login-in-another-tab')
  assert.equal(a.storage.getItem(key), 'refreshed-temporary-session')
})

test('Logout removes both session stores; project data and preferences remain isolated', () => {
  const local = memory(), tab = memory(), a = createAuthStorage(key, () => local, () => tab)
  local.setItem('sb-other-project-auth-token', 'other-project')
  for (const k of [key, `${key}-code-verifier`, `${key}-user`]) {
    local.setItem(k, 'stale'); tab.setItem(k, 'stale'); a.storage.removeItem(k)
    assert.equal(local.getItem(k), null); assert.equal(tab.getItem(k), null)
  }
  assert.equal(local.getItem('sb-other-project-auth-token'), 'other-project')
})

test('Blocked persistence reports an error and unchecked login still uses session storage', () => {
  const local = memory(), tab = memory()
  local.setItem(`${key}:remember-me`, 'true')
  const blocked = { ...local, setItem: () => { throw new Error('QuotaExceeded') } }
  const a = createAuthStorage(key, () => blocked, () => tab)
  assert.throws(() => a.setRememberMe(true), /Desmarque/)
  a.setRememberMe(false); a.storage.setItem(key, 'temporary')
  assert.equal(a.getRememberMe(), false); assert.equal(tab.getItem(key), 'temporary')
  assert.equal(local.getItem(key), null)
})

function fixture(local: ReturnType<typeof memory>, tab: ReturnType<typeof memory>) {
  const persistence = createAuthStorage(key, () => local, () => tab)
  const calls: string[] = []
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
  const expires = Math.floor(Date.now() / 1000) + 3600
  const token = [ { alg: 'HS256', typ: 'JWT' }, { sub: user.id, exp: expires } ].map(p => Buffer.from(JSON.stringify(p)).toString('base64url')).join('.') + '.fixture-signature'
  const client = createClient('https://test.supabase.co', 'test-public-key', {
    auth: { storage: persistence.storage, storageKey: key, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); calls.push(url.pathname + url.search)
      if (url.pathname.endsWith('/logout')) return new Response('{}', { status: 200 })
      assert.equal(url.pathname, '/auth/v1/token')
      const body = JSON.parse(String(init?.body))
      if (url.searchParams.get('grant_type') === 'password') assert.equal(body.password, 'fixture-password')
      else assert.equal(body.refresh_token, 'fixture-refresh')
      return Response.json({ access_token: token, refresh_token: 'fixture-refresh', expires_in: 3600, expires_at: expires, token_type: 'bearer', user })
    } },
  })
  return { client, persistence, calls }
}

test('Supabase restores and refreshes remembered sessions, then local logout prevents restoration', async () => {
  const local = memory(), a = fixture(local, memory())
  a.persistence.setRememberMe(true)
  assert.equal((await a.client.auth.signInWithPassword({ email: 'test@example.com', password: 'fixture-password' })).error, null)
  assert.ok(local.getItem(key)); assert.ok(!JSON.stringify([...local.data]).includes('fixture-password'))
  const saved = JSON.parse(local.getItem(key)!)
  saved.expires_at = Math.floor(Date.now() / 1000) - 60
  local.setItem(key, JSON.stringify(saved))
  const reopened = fixture(local, memory())
  assert.equal((await reopened.client.auth.getSession()).data.session?.user.email, 'test@example.com')
  assert.ok(reopened.calls.includes('/auth/v1/token?grant_type=refresh_token'))
  assert.equal((await reopened.client.auth.signOut({ scope: 'local' })).error, null)
  assert.ok(reopened.calls.includes('/auth/v1/logout?scope=local'))
  assert.equal((await fixture(local, memory()).client.auth.getSession()).data.session, null)
})

test('Supabase temporary login restores after reload and disappears with a fresh tab store', async () => {
  const local = memory(), tab = memory(), a = fixture(local, tab)
  a.persistence.setRememberMe(false)
  assert.equal((await a.client.auth.signInWithPassword({ email: 'test@example.com', password: 'fixture-password' })).error, null)
  assert.ok((await fixture(local, tab).client.auth.getSession()).data.session)
  assert.equal((await fixture(local, memory()).client.auth.getSession()).data.session, null)
  assert.equal(local.getItem(key), null)
})
