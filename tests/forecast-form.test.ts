import test from 'node:test'
import assert from 'node:assert/strict'
import { atualizarForecastPeriodo, colunasRelatorioForecast, exemploForecast, mesesForecast } from '../src/lib/forecastDraft.ts'

test('Relatório utiliza os cadastros recebidos do banco e mantém variantes separadas',()=>{
  const produtos=[{id:'uuid-p1',nome:'Produto igual',codigo:'AD010.2BD25'},{id:'uuid-p2',nome:'Produto igual',codigo:'AD010.7BD25'}]
  const linhas=produtos.map(p=>({id:p.id,produtoId:p.id,clienteId:'uuid-c',vendedorId:'uuid-v',quantidades:{'2026-10':'12,5'}}))
  const relatorio=colunasRelatorioForecast(linhas,mesesForecast('2026-10'),[{id:'uuid-v',nome:'Responsável cadastrado'}],[{id:'uuid-c',nome:'Cliente cadastrado',codigo:'000123 / 01'}],produtos)
  assert.deepEqual(relatorio.linhas.map(l=>l.slice(0,6)),produtos.map(p=>['Responsável cadastrado','Cliente cadastrado','000123 / 01','Produto igual',p.codigo,12.5]))
})
test('Salvar substitui apenas o cliente, vendedor e meses selecionados, preservando os demais', () => {
  const base = exemploForecast('2026-10', ['a', 'b'])
  base[0].quantidades['2026-09'] = '75'
  const original = JSON.stringify(base)
  const resultado = atualizarForecastPeriodo(base, [{...base[0], quantidades:{'2026-10':'0','2026-11':'125,5'}}], 'cliente-a', 'a', mesesForecast('2026-10').map(m=>m.id))
  const mantida = resultado.find(l=>l.id===base[0].id)!
  assert.deepEqual(mantida.quantidades, {'2026-09':'75','2026-10':'0','2026-11':'125,5'})
  assert.equal(resultado.some(l=>l.id===base[1].id), false)
  assert.deepEqual(resultado.find(l=>l.id===base[3].id),base[3])
  assert.deepEqual(resultado.find(l=>l.id===base[2].id),base[2])
  assert.equal(JSON.stringify(base),original)
})
test('Relatório mantém vendedor, cliente, produto e cada mês em colunas com números e vazios',()=>{
  const linhas=exemploForecast('2026-10',['a','b'])
  linhas[0].quantidades['2026-10']='0'
  linhas[0].quantidades['2026-11']='125,5'
  const relatorio=colunasRelatorioForecast(linhas,mesesForecast('2026-10'),[{id:'a',nome:'Ana'},{id:'b',nome:'Bia'}])
  assert.equal(relatorio.cabecalho.length,18)
  assert.deepEqual(relatorio.cabecalho.slice(0,5),['Vendedor','Cliente','Código cliente','Produto','Código produto'])
  assert.equal(relatorio.linhas[0][0],'Ana')
  assert.equal(relatorio.linhas[3][0],'Bia')
  assert.equal(relatorio.linhas[0][5],0)
  assert.equal(relatorio.linhas[0][6],125.5)
  assert.equal(relatorio.linhas[0][16],null)
  assert.notEqual(relatorio.linhas[0][4],relatorio.linhas[2][4])
  assert.equal(relatorio.linhas.every(l=>l.length===18),true)
})
