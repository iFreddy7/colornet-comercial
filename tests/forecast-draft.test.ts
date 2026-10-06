import test from 'node:test'
import assert from 'node:assert/strict'
import { exemploForecast, lerForecast, mesesForecast, mesAtualForecast, quantidadeForecast, totalForecast, totalInformadoForecast } from '../src/lib/forecastDraft.ts'

test('Forecast cobre doze meses sem perder a virada de ano e usa o mês de Brasília', () => {
  const meses = mesesForecast('2026-10')
  assert.equal(meses.length, 12)
  assert.equal(meses[0].id, '2026-10')
  assert.equal(meses[11].id, '2027-09')
  assert.equal(mesAtualForecast(new Date('2026-11-01T01:00:00Z')), '2026-10')
  assert.deepEqual(mesesForecast('2026-13'), [])
})
test('Vazio difere de zero, vírgula decimal é aceita e quantidades inválidas são rejeitadas', () => {
  assert.equal(quantidadeForecast(''), null)
  assert.equal(quantidadeForecast('0'), 0)
  assert.equal(quantidadeForecast('125,375'), 125.375)
  for (const valor of ['-1', 'Infinity', '1e5', '12.1234', '1000000000', '=2+3', 'abc']) assert.equal(quantidadeForecast(valor), null)
})
test('Consolidado soma clientes sem unir códigos diferentes e respeita o período filtrado', () => {
  const linhas = exemploForecast('2026-10', ['a', 'b'])
  const produtoA = linhas.filter(l => l.produtoId === 'produto-a')
  const produtoB = linhas.filter(l => l.produtoId === 'produto-b')
  assert.equal(totalForecast(produtoA, ['2026-10']), 800)
  assert.equal(totalForecast(produtoB, ['2026-10']), 125)
  assert.equal(totalForecast(linhas.filter(l => l.vendedorId === 'b'), ['2026-10']), 300)
  assert.equal(totalInformadoForecast(linhas, ['2027-09']), null)
  linhas[0].quantidades['2027-09'] = '0'
  assert.equal(totalInformadoForecast(linhas, ['2027-09']), 0)
})
test('Rascunho mantém valores editados, zero e campos ainda vazios ao reabrir', () => {
  const linhas = exemploForecast('2026-10', ['a'])
  linhas[0].quantidades['2026-10'] = '125,5'
  linhas[0].quantidades['2026-11'] = '0'
  linhas[0].quantidades['2026-12'] = ''
  const raw = JSON.stringify({ version: 1, salvoEm: new Date().toISOString(), linhas })
  assert.deepEqual(lerForecast(raw, ['a'])?.linhas, linhas)
  assert.equal(lerForecast(raw, ['outro-usuario']), null)
})
test('Dados inválidos e duplicações no armazenamento não viram previsão válida', () => {
  assert.equal(lerForecast('{', ['a']), null)
  const linhas = exemploForecast('2026-10', ['a'])
  const raw = (itens: unknown) => JSON.stringify({ version: 1, salvoEm: new Date().toISOString(), linhas: itens })
  assert.equal(lerForecast(raw([...linhas, {...linhas[0], id:'outra-id'}]), ['a']), null)
  assert.equal(lerForecast(raw([{...linhas[0],produtoId:'produto-real-nao-autorizado'}]), ['a']), null)
})
