import test from 'node:test'
import assert from 'node:assert/strict'
import { temVisaoComercial } from '../src/lib/permissoes.ts'

test('ADMIN, GERENTE e DIRETOR ativos possuem visão comercial global', () => {
  for (const perfil of ['ADMIN', 'GERENTE', 'DIRETOR'] as const) {
    assert.equal(temVisaoComercial({ perfil, ativo: true }), true)
    assert.equal(temVisaoComercial({ perfil, ativo: false }), false)
  }
})
test('VENDEDOR permanece restrito à carteira', () => {
  assert.equal(temVisaoComercial({ perfil: 'VENDEDOR', ativo: true }), false)
})
