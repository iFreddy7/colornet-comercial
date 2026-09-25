import test from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { handlePasswordLink } from '../supabase/functions/admin-gerar-link-senha/index.ts'
import { passwordLinkFailure } from '../src/lib/adminPasswordLink.ts'

const actor = '00000000-0000-0000-0000-000000000001'
const target = '00000000-0000-0000-0000-000000000002'
const email = 'pessoa@example.invalid'
const env = { supabaseUrl: 'https://nqyddagfawklfqwumlie.supabase.co' }
const body = { usuario_id: target }
const creation = { ...body, criar_acesso: true, email_confirmacao: email }
function request(value: unknown = body, token: string | null = 'valid', method = 'POST') {
  return new Request('https://example.invalid/link', { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: method === 'POST' ? JSON.stringify(value) : undefined })
}
function fake(options: Record<string, any> = {}) {
  const calls: Array<{ op: string; data?: any }> = []
  const user = { id: target, email }
  const admin = {
    auth: {
      getUser: async (token: string) => ({ data: { user: token === 'valid' ? { id: actor } : null }, error: null }),
      admin: {
        getUserById: async (id: string) => { calls.push({ op: 'lookup', data: id }); return {
          data: { user: options.missing ? null : { ...user, ...options.authUser } },
          error: options.lookupError || (options.missing ? { code: 'user_not_found', status: 404 } : null),
        } },
        createUser: async (value: unknown) => { calls.push({ op: 'create', data: value }); return { data: { user: { ...user, ...options.createdUser } }, error: options.createError || null } },
        generateLink: async (value: unknown) => { calls.push({ op: 'link', data: value }); return {
          data: { user: { ...user, ...options.linkUser }, properties: { hashed_token: options.noToken ? null : 'fixture-token' } }, error: options.linkError || null,
        } },
      },
    },
    from: () => ({ select: () => ({ eq: (_: string, id: string) => ({ single: async () => ({
      data: id === actor ? { perfil: options.role || 'ADMIN', ativo: options.actorActive !== false }
        : { id: target, email, nome: 'Teste', ativo: options.targetActive !== false },
      error: options.profileError || null,
    }) }) }) }),
  }
  return { admin: admin as unknown as SupabaseClient, calls }
}
async function run(f: ReturnType<typeof fake>, value: unknown = body, environment = env) {
  const response = await handlePasswordLink(request(value), f.admin, environment)
  return { response, data: await response.json() }
}

test('Link de senha exige sessão e administrador ativo', async () => {
  for (const token of [null, 'invalid']) {
    const f = fake(); assert.equal((await handlePasswordLink(request(body, token), f.admin, env)).status, 401); assert.equal(f.calls.length, 0)
  }
  for (const opt of [{ role: 'GERENTE' }, { role: 'DIRETOR' }, { role: 'VENDEDOR' }, { actorActive: false }]) {
    const f = fake(opt); assert.equal((await run(f, creation)).response.status, 403); assert.equal(f.calls.length, 0)
  }
})
test('Perfil sem Auth informa ausência sem criar conta implicitamente', async () => {
  const f = fake({ missing: true }); const r = await run(f)
  assert.equal(r.response.status, 404); assert.equal(r.data.codigo, 'AUTH_USER_MISSING'); assert.equal(r.data.pode_criar_acesso, true)
  assert.deepEqual(f.calls.map(c => c.op), ['lookup'])
})
test('Criação explícita mantém ID, não define senha, não confirma email nem muda permissões', async () => {
  const f = fake({ missing: true }); const r = await run(f, creation)
  assert.equal(r.response.status, 200); assert.equal(r.data.acesso_criado, true)
  assert.deepEqual(f.calls.map(c => c.op), ['lookup', 'create', 'link'])
  assert.deepEqual(f.calls[1].data, { id: target, email, email_confirm: false, user_metadata: { nome: 'Teste' } })
  const link = new URL(r.data.link)
  assert.equal(link.origin, 'https://homologacao.colornet-comercial.pages.dev')
  assert.equal(link.searchParams.get('recovery'), '1'); assert.ok(link.hash.includes('type=recovery&token_hash='))
  assert.equal(r.response.headers.get('cache-control'), 'no-store')
})
test('Repetir criação com conta existente só gera link, sem recriar ou alterar a conta', async () => {
  const f = fake(); const r = await run(f, creation)
  assert.equal(r.response.status, 200); assert.equal(r.data.acesso_criado, false)
  assert.deepEqual(f.calls.map(c => c.op), ['lookup', 'link'])
})
test('Conta em produção pode recuperar senha mas não recebe criação implícita ou explícita', async () => {
  const prod = { supabaseUrl: 'https://duojavyrugezvlvuuwag.supabase.co' }
  const f = fake(); assert.equal((await run(f, creation, prod)).response.status, 403); assert.equal(f.calls.length, 0)
  const missing = await run(fake({ missing: true }), body, prod)
  assert.equal(missing.data.pode_criar_acesso, false)
  const r = await run(fake(), body, prod)
  assert.equal(new URL(r.data.link).origin, 'https://colornet-comercial.vercel.app')
})
test('Email alterado ou conflito de email não cria vínculo incorreto', async () => {
  const f = fake({ missing: true }); assert.equal((await run(f, { ...creation, email_confirmacao: 'outro@example.invalid' })).response.status, 409)
  assert.deepEqual(f.calls.map(c => c.op), ['lookup'])
  const duplicate = fake({ missing: true, createError: { code: 'email_exists' } })
  assert.equal((await run(duplicate, creation)).response.status, 409)
  assert.deepEqual(duplicate.calls.map(c => c.op), ['lookup', 'create'])
})
test('Falha temporária no Auth não é tratada como conta ausente', async () => {
  const f = fake({ missing: true, lookupError: { status: 503, code: 'unexpected_failure' } })
  const r = await run(f, creation); assert.equal(r.response.status, 503); assert.equal(r.data.codigo, undefined)
  assert.deepEqual(f.calls.map(c => c.op), ['lookup'])
})
test('ID ou email divergente bloqueia geração ou devolução de link de outra conta', async () => {
  for (const authUser of [{ email: 'outro@example.invalid' }, { id: actor }]) {
    const f = fake({ authUser }); assert.equal((await run(f)).response.status, 409)
    assert.deepEqual(f.calls.map(c => c.op), ['lookup'])
  }
  const r = await run(fake({ linkUser: { id: actor } }))
  assert.equal(r.response.status, 409); assert.equal(r.data.link, undefined)
})
test('Usuário inativo, ID inválido e falha de permissões não acessam Auth administrativo', async () => {
  for (const value of [null, [], { usuario_id: 'invalido' }]) {
    const f = fake(); assert.equal((await run(f, value)).response.status, 400); assert.equal(f.calls.length, 0)
  }
  const f = fake({ targetActive: false }); assert.equal((await run(f)).response.status, 400); assert.equal(f.calls.length, 0)
  assert.equal((await run(fake({ profileError: {} }))).response.status, 503)
})
test('Redirect inseguro ou cruzando ambientes é bloqueado antes de criar conta', async () => {
  for (const appUrl of ['http://localhost:3000', 'https://localhost', 'https://127.0.0.2', 'https://colornet-comercial.vercel.app', 'invalido']) {
    const f = fake({ missing: true }); const r = await run(f, creation, { ...env, appUrl } as typeof env)
    assert.equal(r.response.status, 503); assert.equal(f.calls.length, 0)
  }
})
test('Falha de geração não retorna token e criação pode ser retomada sem remover perfil', async () => {
  for (const opt of [{ linkError: { status: 500 } }, { noToken: true }]) {
    const f = fake({ missing: true, ...opt }); const r = await run(f, creation)
    assert.equal(r.response.status, 502); assert.equal(r.data.link, undefined)
    assert.deepEqual(f.calls.map(c => c.op), ['lookup', 'create', 'link'])
  }
  assert.equal((await run(fake({ linkError: { status: 429 } }))).response.status, 429)
})
test('Preflight funciona e GET não gera link', async () => {
  const f = fake()
  assert.equal((await handlePasswordLink(request(null, null, 'OPTIONS'), f.admin, env)).status, 200)
  assert.equal((await handlePasswordLink(request(null, null, 'GET'), f.admin, env)).status, 405)
  assert.equal(f.calls.length, 0)
})
test('Interface distingue conta ausente, sessão expirada e erro de rede', async () => {
  const f = fake({ missing: true }); const missing = await handlePasswordLink(request(), f.admin, env)
  assert.equal((await passwordLinkFailure({ context: missing })).canCreateAccess, true)
  assert.equal((await passwordLinkFailure({ context: Response.json({ message: 'Invalid JWT' }, { status: 401 }) })).message, 'Sua sessão expirou. Entre novamente no portal.')
  for (const error of [null, new Error('network'), { context: new Response('bad gateway', { status: 502 }) }]) {
    const r = await passwordLinkFailure(error); assert.equal(r.canCreateAccess, false); assert.ok(r.message.includes('conexão'))
  }
  assert.equal((await passwordLinkFailure({ context: Response.json({ codigo: 'AUTH_USER_MISSING', pode_criar_acesso: true }, { status: 503 }) })).canCreateAccess, false)
})
