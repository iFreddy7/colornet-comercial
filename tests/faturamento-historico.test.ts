import test from 'node:test'
import assert from 'node:assert/strict'
import {resumirFaturamento} from '../src/lib/faturamentoResumo.ts'

test('Histórico soma linhas da fonte sem misturar anos, carteiras, filiais e variantes',()=>{
 const base={periodo:'2025-09-01',filial_codigo:'0101',vendedor_nome:'Ana',cliente_chave:'c1',cliente_codigo:'0001',cliente_nome:'Cliente',produto_codigo:'AD010.2BD25',produto_nome:'Mesmo produto',quantidade:10}
 const rows=[base,{...base,quantidade:5},{...base,periodo:'2025-10-01',quantidade:0},{...base,produto_codigo:'AD010.7BD25'},{...base,periodo:'2026-09-01'},{...base,vendedor_nome:'Bia'},{...base,filial_codigo:'0102'}]
 const r=resumirFaturamento(rows)
 assert.equal(r.length,5)
 const a=r.find(x=>x.ano==='2025'&&x.vendedor==='Ana'&&x.filial==='0101'&&x.codigoProduto==='AD010.2BD25')!
 assert.equal(a.meses[8],15);assert.equal(a.meses[9],0);assert.equal(a.meses[7],null)
 assert.equal(r.reduce((n,g)=>n+g.meses.reduce<number>((s,v)=>s+(v??0),0),0),55)
})
