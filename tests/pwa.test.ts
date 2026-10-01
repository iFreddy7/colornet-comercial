import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function worker() {
  const events: Record<string, (event: any) => void> = {}
  const cached: string[][] = [], removed: string[] = []
  let skipped = 0
  const context = { URL, self: { location: { origin: 'https://portal.example' },
    addEventListener: (name: string, fn: (event: any) => void) => { events[name] = fn },
    skipWaiting: () => { skipped++ }, clients: { claim: async () => {} } },
    fetch: async () => { throw new Error('offline') },
    caches: { open: async () => ({ addAll: async (paths: string[]) => { cached.push(paths) } }),
      keys: async () => ['colornet-offline-old', 'another-app'],
      delete: async (key: string) => { removed.push(key) }, match: async (path: string) => ({ offline: path }) },
  }
  vm.runInNewContext(readFileSync(new URL('../pwa/sw.js', import.meta.url), 'utf8'), context)
  return { events, cached, removed, skipped: () => skipped }
}
test('Offline worker never intercepts API, third party requests, POSTs or recovery assets', () => {
  const w = worker()
  for (const [url, method, mode] of [
    ['https://project.supabase.co/rest/v1/clientes', 'GET', 'cors'],
    ['https://portal.example/api/pedidos', 'GET', 'cors'],
    ['https://portal.example/', 'POST', 'navigate'],
    ['https://portal.example/colornet-logo.jpg?code=sensitive', 'GET', 'cors'],
  ]) w.events.fetch({ request: { url, method, mode }, respondWith: () => assert.fail('Unexpected interception') })
})
test('Only public offline assets are cached; a recovery URL can fall back but is never saved', async () => {
  const w = worker()
  let pending: Promise<any> | undefined
  w.events.install({ waitUntil: (p: Promise<any>) => { pending = p } }); await pending
  assert.equal(JSON.stringify(w.cached), JSON.stringify([['/offline.html', '/colornet-logo.jpg']]))
  w.events.fetch({ request: { url: 'https://portal.example/?code=private-recovery-token', method: 'GET', mode: 'navigate' }, respondWith: (p: Promise<any>) => { pending = p } })
  assert.deepEqual(await pending, { offline: '/offline.html' })
  assert.equal(w.cached.length, 1)
  assert.equal(w.skipped(), 0)
  w.events.message({ data: { type: 'ACTIVATE_UPDATE' } })
  assert.equal(w.skipped(), 1)
})
test('Activation removes only old caches owned by ColorNet', async () => {
  const w = worker()
  let pending: Promise<any> | undefined
  w.events.activate({ waitUntil: (p: Promise<any>) => { pending = p } }); await pending
  assert.deepEqual(w.removed, ['colornet-offline-old'])
})
