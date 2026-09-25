import test from 'node:test'
import assert from 'node:assert/strict'
import { preencherFiliaisCotacao, identificarFilial, unidadesFaturamento } from '../src/lib/filiaisFaturamento.ts'

const filiais = [
  { id:'sp', codigo:'0101', nome:'SP - MATRIZ', uf:'SP' },
  { id:'sc', codigo:'0102', nome:'SC - ITAJAÍ', uf:'SC' },
  { id:'maua', codigo:'0103', nome:'MAUÁ - FILIAL', uf:'SP' },
]
test('Faturamento associa cada ID à unidade correta, sem confundir Mauá com Matriz', () => {
  const d = preencherFiliaisCotacao({ itens:filiais.map(f => ({ filial_origem_id:f.id })) }, filiais)
  assert.deepEqual(d.itens.map((i:any)=>i.filial_faturamento.cnpj), ['01.382.160/0001-05','01.382.160/0002-96','01.382.160/0003-77'])
  assert.deepEqual(d.itens.map((i:any)=>i.filial_faturamento.nome), ['Matriz-SP','Filial-Itajaí','Filial-Mauá'])
})
test('Documentos antigos resolvem o nome e a origem fiscal sem inventar a filial ausente', () => {
  const a = preencherFiliaisCotacao({ filial:{nome:'MAUÁ - FILIAL',uf:'SP'},itens:[{}] }, [])
  assert.equal((a.itens[0] as any).filial_faturamento.cnpj, '01.382.160/0003-77')
  const b = preencherFiliaisCotacao({ itens:[{fiscal:{filial_origem_id:'sc'}},{filial_origem_id:'desconhecida'},{}] }, filiais)
  assert.equal((b.itens[0] as any).filial_faturamento.nome,'Filial-Itajaí')
  assert.equal((b.itens[1] as any).filial_faturamento,undefined);assert.equal((b.itens[2] as any).filial_faturamento,undefined)
  assert.equal(identificarFilial({nome:'Unidade desconhecida',uf:'SP'}).cnpj,undefined)
})
test('Identificação do PDF não modifica dados, valores ou a cotação original', () => {
  const original={itens:[{filial_origem_id:'sp',preco_net:8.05,preco_final:9.24,quantidade:2500},{filial_origem_id:'sp',preco_net:25.1234,preco_final:29.12,quantidade:null}],total:null}
  const before=JSON.stringify(original), d=preencherFiliaisCotacao(original,filiais)
  assert.equal(JSON.stringify(original),before)
  assert.equal((d as any).filiais_faturamento.length,1)
  assert.equal(d.itens[0].preco_final,9.24);assert.equal(d.itens[1].preco_net,25.1234);assert.equal(d.itens[1].quantidade,null);assert.equal(d.total,null)
})
test('Documento enriquecido continua identificando a unidade ao renderizar sem nova consulta', () => {
  const d=preencherFiliaisCotacao({itens:[{filial_origem_id:'sc'}]},filiais)
  assert.deepEqual(preencherFiliaisCotacao(d,[]),d)
})
test('Dados de faturamento fornecidos têm CNPJ válido e endereço completo', () => {
  for(const f of Object.values(unidadesFaturamento)) {
    const n=f.cnpj!.replace(/\D/g,'')
    const digit=(length:number)=>{let weight=length-7;const sum=[...n.slice(0,length)].reduce((total,x)=>{const value=total+Number(x)*weight;weight=weight===2?9:weight-1;return value},0);return sum%11<2?0:11-sum%11}
    assert.equal(n.length,14);assert.equal(digit(12),Number(n[12]));assert.equal(digit(13),Number(n[13]))
    assert.match(f.cep!,/^\d{5}-\d{3}$/);assert.ok(f.endereco?.includes('/'+f.uf));assert.ok(f.inscricao_estadual)
  }
})
