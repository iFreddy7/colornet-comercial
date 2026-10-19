import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ExcelJS from 'exceljs'
import {lerImportacaoForecast,preencherModeloForecast,validarArquivoXlsx} from '../src/lib/forecastImportacao.ts'
const dados={vendedores:[{id:'v',codigo:'001',nome:'Teste',ativo:true}],clientes:[{id:'c',codigo:'00012 / 01',nome:'Cliente',ativo:true,vendedorId:'v'}],produtos:[{id:'p',codigo:'AD010.2BD25',nome:'Produto',ativo:true},{id:'p2',codigo:'AD010.7BD25',nome:'Produto',ativo:true}],planos:[{cliente_id:'c',vendedor_id:'v',documento:{p:{'2026-01':80,'2026-02':50,'2026-03':25}},revisao:3,atualizado_em:''}]}
const base=new Uint8Array(await readFile(new URL('../public/templates/forecast-base.xlsx',import.meta.url)))
async function fixture(edit:(s:ExcelJS.Worksheet)=>void){const wb=new ExcelJS.Workbook();await wb.xlsx.load(await preencherModeloForecast(base,dados,'v',2026) as any);const s=wb.getWorksheet('Forecast')!;s.getCell('E7').value='AD010.2BD25';edit(s);return new Uint8Array(await wb.xlsx.writeBuffer())}
test('Modelo mantém códigos textuais e inclui catálogo com variantes',async()=>{
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(await preencherModeloForecast(base,dados,'v',2026) as any)
 assert.equal(wb.getWorksheet('Forecast')!.getCell('A7').value,'001');assert.equal(wb.getWorksheet('Forecast')!.getCell('C7').value,'00012 / 01')
 assert.equal(wb.getWorksheet('Produtos')!.rowCount,3)
})
test('Vazio preserva, zero zera e preenchido substitui só seu mês',async()=>{
 const r=await lerImportacaoForecast(await fixture(s=>{s.getCell('I7').value=0;s.getCell('J7').value='12,5'}),dados)
 assert.deepEqual(r.erros,[]);assert.deepEqual(r.planos[0].itens[0].quantidades,{'2026-02':0,'2026-03':12.5});assert.equal(r.planos[0].revisao,3)
 assert.deepEqual(r.mudancas.map(m=>[m.atual,m.novo]),[[50,0],[25,12.5]])
})
test('Variantes iguais por nome permanecem separadas por código',async()=>{
 const r=await lerImportacaoForecast(await fixture(s=>{s.getCell('H7').value=10;s.getRow(7).eachCell((cell,col)=>{s.getCell(8,col).value=cell.value});s.getCell('E8').value='AD010.7BD25';s.getCell('H8').value=20}),dados)
 assert.deepEqual(r.erros,[]);assert.equal(r.planos[0].itens.length,2)
})
test('Recusa código errado, carteira divergente, duplicação, fórmulas e precisão inválida',async()=>{
 for(const edit of [(s:ExcelJS.Worksheet)=>{s.getCell('E7').value='ERRADO'},(s:ExcelJS.Worksheet)=>{s.getRow(7).eachCell((cell,col)=>{s.getCell(8,col).value=cell.value})},(s:ExcelJS.Worksheet)=>{s.getCell('H7').value={formula:'1+1',result:2}},(s:ExcelJS.Worksheet)=>{s.getCell('H7').value=1.1234}]){
  const bytes=await fixture(s=>{s.getCell('H7').value=1;edit(s)});assert.ok((await lerImportacaoForecast(bytes,dados)).erros.length)
 }
 const bytes=await fixture(s=>{s.getCell('H7').value=1});assert.match((await lerImportacaoForecast(bytes,{...dados,clientes:[{...dados.clientes[0],vendedorId:'outro'}]})).erros[0],/carteira/)
})
test('Recusa planilha estranha e ZIP inválido antes de carregar',async()=>{
 assert.throws(()=>validarArquivoXlsx(new Uint8Array(10)),/inválido/)
 assert.throws(()=>validarArquivoXlsx(new Uint8Array(5_000_001)),/5 MB/)
 await assert.rejects(async()=>lerImportacaoForecast(await fixture(s=>{s.getCell('A1').value='Outro modelo'}),dados),/planilha base/)
})

