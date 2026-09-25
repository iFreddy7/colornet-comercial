import test from 'node:test'
import assert from 'node:assert/strict'
import { dadosIniciaisConversao, valoresAprovados, type CotacaoParaPedido } from '../src/lib/conversaoCotacao.ts'

const item = { produto_id: 'produto', produto: 'Produto', codigo: '001', quantidade: 2500, preco_net: 8.05, preco_final: 9.24, ipi: 0, filial_origem_id: 'sc' }
const quote: CotacaoParaPedido = { id: 'cotacao', numero: 'COT', aprovacao_status: 'APROVADA', cliente_id: 'cliente', cliente_nome: 'Cliente', vendedor_nome: 'Vendedor', filial_id: null, moeda: 'USD', validade: '2099-12-31', prazo_pagamento_id: '28dias', frete_id: 'cif', observacoes: 'Entrega combinada', pedido_convertido_id: null, documento: { itens: [item] } }
test('Conversão herda filial dos itens e todas as condições existentes da cotação', () => {
  assert.deepEqual(dadosIniciaisConversao(quote, [{ id: 'sc' }]), { filialId: 'sc', prazoId: '28dias', freteId: 'cif', observacoes: 'Entrega combinada', quantidades: ['2500'], transportadora: '', dataEntrega: '', observacoesTransporte: '' })
  const loaded = dadosIniciaisConversao({ ...quote, documento: { itens: [item], data_entrega: '2099-10-01', transportadora: 'Transportadora', observacoes_transporte: 'Agendar' } }, [{ id: 'sc' }])
  assert.equal(loaded.dataEntrega, '2099-10-01'); assert.equal(loaded.transportadora, 'Transportadora'); assert.equal(loaded.observacoesTransporte, 'Agendar')
})
test('Filial ambígua, desconhecida ou inativa não é escolhida por suposição', () => {
  for (const itens of [[item, { ...item, filial_origem_id: 'sp' }], [{ ...item, filial_origem_id: undefined }]]) {
    assert.equal(dadosIniciaisConversao({ ...quote, documento: { itens } }, [{ id: 'sc' }]).filialId, '')
  }
  assert.equal(dadosIniciaisConversao(quote, [{ id: 'sp' }]).filialId, '')
  assert.equal(dadosIniciaisConversao({ ...quote, filial_id: 'sp' }, [{ id: 'sp' }, { id: 'sc' }]).filialId, 'sp')
  assert.equal(dadosIniciaisConversao({ ...quote, documento: { itens: [{ ...item, filial_origem_id: undefined, fiscal: { filial_origem_id: 'sc' } }] } }, [{ id: 'sc' }]).filialId, 'sc')
})
test('NET, final e IPI exibidos usam a proposta aprovada; quantidade só altera o total', () => {
  assert.deepEqual(valoresAprovados(item, '2500'), { net: 8.05, final: 9.24, ipi: 0, quantidadeValida: true, total: 23100 })
  assert.equal(valoresAprovados({ ...item, ipi: 0.065 }, '100').total, 984.06)
  assert.equal(valoresAprovados(item, '').quantidadeValida, false)
  assert.equal(valoresAprovados(item, 'Infinity').quantidadeValida, false)
  assert.equal(dadosIniciaisConversao({ ...quote, documento: { itens: [{ ...item, quantidade: null }] } }, [{ id: 'sc' }]).quantidades[0], '')
})
test('Proposta legada sem imposto conhecido não inventa IPI zero', () => {
  assert.throws(() => valoresAprovados({ ...item, ipi: undefined }, '10'), /preços e impostos/)
  assert.equal(valoresAprovados({ ...item, ipi: undefined, fiscal: { ipi: 0.05 } }, '10').ipi, 0.05)
  assert.throws(() => valoresAprovados({ ...item, preco_final: NaN }, '10'), /preços e impostos/)
})
