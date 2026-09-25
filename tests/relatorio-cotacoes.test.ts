import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { gerarExcelCotacoes, validarRelatorioCotacoes } from '../src/lib/relatorioCotacoes.ts'
test('Excel de cotações preserva moedas, motivo, precisão, fuso e listas sem total',async()=>{
  const base={id:'1',numero:'COT-1',titulo:'=1+1',moeda:'BRL',aprovacao_status:'REPROVADA',aprovacao_motivo:'Rever preços',aprovacao_em:'2026-09-25T02:59:00Z',total:12.34}
  const r={versao:1,gerado_em:'2026-09-25T14:00:00Z',filtros:{},cotacoes:[base,{...base,id:'2',numero:'COT-2',moeda:'USD',total:null}],itens:[{numero_cotacao:'COT-1',item:{quantidade:null,preco_net:1.2345,total_item:null}}]}
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(await gerarExcelCotacoes(r) as any)
  assert.deepEqual(wb.worksheets.map(s=>s.name),['Resumo','Cotacoes','Itens','Informacoes'])
  const resumo=wb.getWorksheet('Resumo')!;assert.equal(resumo.getRow(2).getCell(5).value,12.34);assert.equal(resumo.getRow(3).getCell(5).value,null);assert.equal(resumo.getRow(3).getCell(4).value,1)
  const ws=wb.getWorksheet('Cotacoes')!;const headers=ws.getRow(1).values as string[];const cell=(name:string,row=2)=>ws.getRow(row).getCell(headers.indexOf(name)).value
  assert.equal(cell('Título'),'=1+1');assert.equal(cell('Motivo da reprovação'),'Rever preços')
  assert.equal((cell('Data da avaliação (Brasília)') as Date).toISOString(),'2026-09-24T23:59:00.000Z')
  const itens=wb.getWorksheet('Itens')!;assert.ok((itens.getRow(2).values as unknown[]).includes(1.2345))
  assert.throws(()=>validarRelatorioCotacoes({...r,cotacoes:[{...base,total:'x'}]}),/incompleto/)
})
