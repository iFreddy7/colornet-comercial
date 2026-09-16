import test from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { handleCreateUser } from '../supabase/functions/admin-criar-usuario/index.ts'

const adminId = '00000000-0000-0000-0000-000000000001'
const novoId = '00000000-0000-0000-0000-000000000003'
const vendedorId = '00000000-0000-0000-0000-000000000002'
const cadastro = { nome: 'Pessoa de Teste', email: ' TESTE@example.invalid ', senha: 'Senha-ficticia-123', perfil: 'VENDEDOR', vendedor_id: vendedorId }
function fake(options: Record<string, unknown> = {}) {
  const calls: Array<{ op: string; data: any }> = []
  const admin = {
    auth: {
      getUser: async (token: string) => ({ data: { user: options.authError ? null : { id: adminId } }, error: options.authError || (token !== 'valid' ? { message: 'bad' } : null) }),
      admin: {
        createUser: async (data: unknown) => { calls.push({ op: 'create', data }); return { data: { user: { id: novoId } }, error: options.createError || null } },
        updateUserById: async (id: string, data: unknown) => { calls.push({ op: 'authUpdate', data: { id, ...data as object } }); return { error: options.activateError || null } },
        deleteUser: async (id: string) => { calls.push({ op: 'delete', data: id }); return { error: options.deleteError || null } },
      },
    },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({
        data: table === 'usuarios' ? { perfil: options.perfil || 'ADMIN', ativo: options.ativo !== false } : { id: vendedorId, ativo: options.vendedorAtivo !== false },
        error: options.profileError || null,
      }) }) }),
      update: (data: unknown) => ({ eq: async (_: string, id: string) => { calls.push({ op: 'disableProfile', data: { id, ...data as object } }); return { error: null } } }),
    }),
    rpc: async (_: string, data: unknown) => { calls.push({ op: 'profile', data }); return { error: options.finalizeError || null } },
  }
  return { admin: admin as unknown as SupabaseClient, calls }
}
const request = (body: unknown = cadastro, token: string | null = 'valid', method = 'POST') => new Request('https://local.invalid/admin-criar-usuario', {
  method, headers: token ? { authorization: 'Bearer ' + token, 'content-type': 'application/json' } : {},
  body: method === 'POST' ? JSON.stringify(body) : undefined,
})

test('Sem JWT e JWT inválido não iniciam cadastro', async () => {
  for (const token of [null, 'invalid']) {
    const f = fake(); const response = await handleCreateUser(request(cadastro, token), f.admin)
    assert.equal(response.status, 401); assert.equal(f.calls.length, 0)
  }
})
test('Vendedor, gerente e ADMIN inativo não criam contas', async () => {
  for (const opt of [{ perfil: 'VENDEDOR' }, { perfil: 'GERENTE' }, { ativo: false }]) {
    const f = fake(opt); const response = await handleCreateUser(request(), f.admin)
    assert.equal(response.status, 403); assert.equal(f.calls.length, 0)
  }
})
test('Falha ao consultar permissões impede qualquer criação', async () => {
  const f = fake({ profileError: {} })
  assert.equal((await handleCreateUser(request(), f.admin)).status, 503)
  assert.equal(f.calls.length, 0)
})
test('Cadastro e vínculo inválidos são rejeitados antes do Auth', async () => {
  for (const patch of [{ nome: '' }, { email: 'x' }, { senha: 'curta' }, { perfil: 'ROOT' }, { vendedor_id: null }, { vendedor_id: 'errado' }]) {
    const f = fake(); assert.equal((await handleCreateUser(request({ ...cadastro, ...patch }), f.admin)).status, 400)
    assert.equal(f.calls.length, 0)
  }
  const f = fake({ vendedorAtivo: false }); assert.equal((await handleCreateUser(request(), f.admin)).status, 400)
  assert.equal(f.calls.length, 0)
})
test('Conta só é liberada depois de perfil e auditoria; senha não retorna', async () => {
  const f = fake(); const response = await handleCreateUser(request({ ...cadastro, administrador_id: 'forjado' }), f.admin)
  assert.equal(response.status, 201)
  assert.deepEqual(f.calls.map(c => c.op), ['create','profile','authUpdate'])
  assert.equal(f.calls[0].data.email, 'teste@example.invalid')
  assert.equal(f.calls[0].data.ban_duration, '876000h')
  assert.equal(f.calls[1].data.p_administrador_id, adminId)
  assert.equal(f.calls[2].data.ban_duration, 'none')
  const resposta = await response.text()
  assert.ok(!resposta.includes(cadastro.senha)); assert.ok(!resposta.includes('colornet_criacao_id'))
})
test('ADMIN sem vendedor pode ser criado; GERENTE mantém perfil solicitado', async () => {
  for (const perfil of ['ADMIN','GERENTE']) {
    const f = fake(); assert.equal((await handleCreateUser(request({ ...cadastro, perfil, vendedor_id: null }), f.admin)).status, 201)
    assert.equal(f.calls[1].data.p_perfil, perfil)
  }
})
test('E-mail duplicado não altera ou remove a conta existente', async () => {
  const f = fake({ createError: { code: 'email_exists' } })
  assert.equal((await handleCreateUser(request(), f.admin)).status, 409)
  assert.deepEqual(f.calls.map(c => c.op), ['create'])
})
test('Erro no perfil ou ativação remove somente a conta recém-criada', async () => {
  for (const opt of [{ finalizeError: {} }, { activateError: {} }]) {
    const f = fake(opt); assert.equal((await handleCreateUser(request(), f.admin)).status, 500)
    assert.equal(f.calls.at(-1)?.op, 'delete'); assert.equal(f.calls.at(-1)?.data, novoId)
  }
})
test('Se limpeza falhar, tenta bloquear identidade e desativar perfil', async () => {
  const f = fake({ finalizeError: {}, deleteError: {} })
  const original = console.error; console.error = () => {}
  try { assert.equal((await handleCreateUser(request(), f.admin)).status, 500) } finally { console.error = original }
  assert.deepEqual(f.calls.slice(-2), [
    { op: 'authUpdate', data: { id: novoId, ban_duration: '876000h' } },
    { op: 'disableProfile', data: { id: novoId, ativo: false } },
  ])
})
test('Preflight funciona e GET não cria usuário', async () => {
  const f = fake()
  assert.equal((await handleCreateUser(request(null,null,'OPTIONS'), f.admin)).status, 200)
  assert.equal((await handleCreateUser(request(null,null,'GET'), f.admin)).status, 405)
  assert.equal(f.calls.length, 0)
})
