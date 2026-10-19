import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import {lerImportacaoForecast} from '../src/lib/forecastImportacao.ts'
import {lerCarteiraXlsx} from '../src/lib/forecastCarteiraXlsx.ts'
const dados={vendedores:[{id:'v',codigo:'01',nome:'ERIC GAMA',ativo:true}],clientes:[{id:'c',codigo:'00000123 / 01',nome:'Cliente A',ativo:true,vendedorId:'v'}],produtos:[{id:'p',codigo:'AD010.2BD25',nome:'Produto A',ativo:true},{id:'p2',codigo:'AD010.7BD25',nome:'Produto A',ativo:true}],planos:[{cliente_id:'c',vendedor_id:'v',documento:{p:{'2026-10':90,'2026-11':30}},revisao:3,atualizado_em:''}]}
async function fixture(edit?:(s:ExcelJS.Worksheet,h:ExcelJS.Worksheet)=>void) {
 const wb=new ExcelJS.Workbook(),h=wb.addWorksheet('Histórico'),s=wb.addWorksheet('Forecast')
 s.getCell('A1').value='Forecast de faturamento — Eric Gama';s.getCell('B3').value=12
 s.getCell('A5').value='Cliente / Produto';s.getCell('B5').value='Nível';s.mergeCells('F5:H5');s.getCell('F5').value=2026;s.mergeCells('I5:T5');s.getCell('I5').value=2027
 for(let c=6;c<=20;c++)s.getCell(6,c).value=((c+3)%12)+1
 s.getCell('A7').value='Total Geral';s.getCell('B7').value='Total';s.getCell('F7').value={formula:'SUM(F8:F9)',result:2000}
 s.getCell('A8').value='00000123-Cliente A';s.getCell('B8').value='Cliente';s.getCell('F8').value={formula:'SUM(F9:F9)',result:1000}
 s.getCell('A9').value='AD010.2BD25-Produto A';s.getCell('B9').value='Produto';s.getCell('E9').value=0
 h.getCell('A7').value='00000123-Cliente A';h.getCell('B7').value='Cliente';h.getCell('A8').value='AD010.2BD25-Produto A';h.getCell('B8').value='Produto'
 for(let c=3;c<=40;c++)h.getCell(8,c).value=c>=29?10:9999
 s.getCell('D9').value={formula:'MAX(0,SUM(INDEX(Histórico!$C8:$AN8,1,COLUMNS(Histórico!$C8:$AN8)-$B$3+1):INDEX(Histórico!$C8:$AN8,1,COLUMNS(Histórico!$C8:$AN8)))/$B$3)',result:999999}
 for(let c=6;c<=20;c++)s.getCell(9,c).value={formula:'$D9*(1+$E9)',result:999999}
 edit?.(s,h);return new Uint8Array(await wb.xlsx.writeBuffer())
}

test('Última linha formatada não conta como produto; quantidades sem identificação são sinalizadas',async()=>{
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(await fixture())
 const s=wb.getWorksheet('Forecast')!
 s.getCell('F1048576').numFmt='0.000'
 assert.deepEqual(lerCarteiraXlsx(wb).erros,[])
 s.getCell('F1048576').value=25
 const r=lerCarteiraXlsx(wb)
 assert.equal(r.linhas.length,1)
 assert.match(r.erros.join(' '),/Linha 1048576: Há quantidades preenchidas sem cliente e produto/)
})

test('Limite de grupos considera clientes preenchidos, inclusive sem produtos',async()=>{
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(await fixture())
 const s=wb.getWorksheet('Forecast')!
 for(let i=0;i<500;i++)s.getRow(10+i).values=[`${i}-Cliente`,'Cliente']
 assert.throws(()=>lerCarteiraXlsx(wb),/500 grupos/)
})
test('Carteira lê 15 meses, recalcula fórmulas e ignora cache, totais e histórico',async()=>{
 const r=await lerImportacaoForecast(await fixture((s,h)=>{s.getCell('B3').value=2;h.getCell('AM8').value=20;h.getCell('AN8').value=40;s.getCell('E9').value=.1}),dados)
 assert.deepEqual(r.erros,[]);assert.equal(r.formato,'carteira');assert.equal(r.planos.length,1);assert.equal(r.planos[0].revisao,3)
 assert.equal(r.mudancas.length,15);assert.equal(r.mudancas[0].novo,33);assert.equal(r.mudancas[0].mes,'2026-10');assert.equal(r.mudancas[14].mes,'2027-12')
 assert.ok(r.mudancas.every(m=>m.novo===33&&m.linha===9))
})
test('Carteira preserva vazio, grava zero e arredonda quantidade calculada ou manual para kg',async()=>{
 const r=await lerImportacaoForecast(await fixture(s=>{s.getCell('F9').value=null;s.getCell('G9').value=0;s.getCell('H9').value=1.234567;s.getCell('D9').value=10/3}),dados)
 assert.deepEqual(r.erros,[]);const q=r.planos[0].itens[0].quantidades
 assert.equal(q['2026-10'],undefined);assert.equal(q['2026-11'],0);assert.equal(q['2026-12'],1.235);assert.equal(q['2027-01'],3.333);assert.ok(r.avisos.some(a=>a.includes('arredondada')))
})
test('Recusa fórmula arbitrária, histórico errado, mês duplicado e quantidade negativa',async()=>{
 for(const edit of [(s:ExcelJS.Worksheet)=>{s.getCell('F9').value={formula:'1+1',result:2}},(s:ExcelJS.Worksheet,h:ExcelJS.Worksheet)=>{h.getCell('A7').value='Outro cliente'},(s:ExcelJS.Worksheet)=>{s.getCell('B3').value=39},(s:ExcelJS.Worksheet)=>{s.getCell('G9').value=-1}])assert.ok((await lerImportacaoForecast(await fixture(edit),dados)).erros.length)
 await assert.rejects(()=>fixture(s=>{s.getCell('G6').value=10}).then(b=>lerImportacaoForecast(b,dados)),/Mês repetido/)
})
test('Cliente com várias lojas exige correspondência exata ou escolha explícita da carteira',async()=>{
 const d={...dados,clientes:[{...dados.clientes[0],nome:'Loja SP'},{...dados.clientes[0],id:'c2',codigo:'00000123 / 02',nome:'Loja SC'}]}
 const bytes=await fixture(),r=await lerImportacaoForecast(bytes,d)
 assert.equal(r.clientesConferir.length,1);assert.equal(r.planos.length,0);assert.ok(r.erros.length)
 const ok=await lerImportacaoForecast(bytes,d,{clientes:{8:'c2'}});assert.deepEqual(ok.erros,[]);assert.equal(ok.planos[0].cliente_id,'c2')
 assert.ok((await lerImportacaoForecast(bytes,d,{clientes:{8:'fora-da-carteira'}})).erros.length)
})
test('Vendedor não identificado exige escolha e valida carteira; grupos não podem colapsar na mesma loja',async()=>{
 const bytes=await fixture(s=>{s.getCell('A1').value='Forecast de faturamento — Outro nome'})
 assert.ok((await lerImportacaoForecast(bytes,dados)).erros.length)
 assert.deepEqual((await lerImportacaoForecast(bytes,dados,{vendedorId:'v'})).erros,[])
 const duplicate=await fixture(s=>{s.getRow(10).values=['00000123-Outro nome','Cliente'];s.getRow(11).values=['AD010.7BD25-Produto A','Produto',null,null,0,5]})
 assert.match((await lerImportacaoForecast(duplicate,dados)).erros.join(' '),/dois grupos/)
})
test('Variantes do produto ficam separadas; linha repetida bloqueia o arquivo',async()=>{
 const bytes=await fixture(s=>{s.getRow(10).values=['AD010.7BD25-Produto A','Produto',null,null,0,5]})
 const r=await lerImportacaoForecast(bytes,dados);assert.deepEqual(r.erros,[]);assert.equal(r.planos[0].itens.length,2)
 assert.match((await lerImportacaoForecast(await fixture(s=>{s.getRow(10).values=['AD010.2BD25-Produto A','Produto',null,null,0,5]}),dados)).erros.join(' '),/repetido/)
})
test('Código legado exige escolha explícita e nunca aceita cliente de outro vendedor',async()=>{
 const bytes=await fixture(s=>{s.getCell('A8').value='LEGADO-Cliente A';s.getCell('D9').value=10})
 const d={...dados,clientes:[...dados.clientes,{...dados.clientes[0],id:'fora',vendedorId:'outro'}]}
 const r=await lerImportacaoForecast(bytes,d);assert.ok(r.erros.length);assert.equal(r.clientesConferir[0].motivo,'codigo');assert.equal(r.clientesConferir[0].selecionado,'');assert.equal(r.clientesConferir[0].candidatos.length,1)
 assert.deepEqual((await lerImportacaoForecast(bytes,d,{clientes:{8:'c'}})).erros,[])
 assert.ok((await lerImportacaoForecast(bytes,d,{clientes:{8:'fora'}})).erros.length)
})
test('Cabeçalho apagado no meio ou fim dos meses bloqueia leitura parcial',async()=>{
 for(const cell of ['G6','T6'])await assert.rejects(()=>fixture(s=>{s.getCell(cell).value=null}).then(b=>lerImportacaoForecast(b,dados)),/Cabeçalhos/)
 await assert.rejects(()=>fixture(s=>{s.unMergeCells('F5:H5');s.getCell('F5').value=2026;s.getCell('G6').value=null;s.getCell('H5').value=2026}).then(b=>lerImportacaoForecast(b,dados)),/lacuna/)
})
