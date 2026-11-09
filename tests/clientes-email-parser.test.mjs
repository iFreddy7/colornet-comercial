import test from 'node:test';
import assert from 'node:assert/strict';
import {parseClientes} from '../supabase/functions/ingest-email-xlsx/parser.mjs';
import {readClientSheets} from '../supabase/functions/ingest-email-xlsx/xlsx-clientes.mjs';
function sheet(seller='000014 - FRANCISCO') {
 const h=[];h[1]='Código';h[2]='Loja';h[29]='Vendedor';
 const r=[];r[1]='123';r[2]='1';r[4]='CLIENTE TESTE';r[29]=seller;r[117]='Ativo';
 return {name:'Clientes',rows:[h,r]};
}
test('AD fornece código do vendedor; código e loja preservam zeros',()=>{
 const c=parseClientes([sheet()]).linhas[0];
 assert.equal(c.codigo,'000123');assert.equal(c.loja,'0001');assert.equal(c.vendedor_codigo,'000014');
 assert.equal(parseClientes([sheet('')]).linhas[0].vendedor_codigo,null);
});
test('abas repetidas não duplicam clientes; diferenças bloqueiam o arquivo',()=>{
 const a=sheet(),b=sheet();assert.equal(parseClientes([a,b]).duplicados_identicos,1);
 b.rows[1][4]='OUTRO';assert.throws(()=>parseClientes([a,b]),/conflitantes/);
});
test('lojas distintas permanecem separadas',()=>{
 const a=sheet(),b=sheet();b.rows[1][2]='2';assert.equal(parseClientes([a,b]).linhas.length,2);
});
test('cabeçalho, vendedor e status inválidos são rejeitados',()=>{
 const a=sheet();a.rows[0][29]='Outro';assert.throws(()=>parseClientes([a]),/coluna AD/);
 assert.throws(()=>parseClientes([sheet('Francisco')]),/Código inválido/);
 const b=sheet();b.rows[1][117]='Talvez';assert.throws(()=>parseClientes([b]),/Status inválido/);
 assert.throws(()=>parseClientes([]),/Quantidade/);
});
test('leitor XLSX ignora formatação e preserva texto compartilhado, inline e entidades',()=>{
 const encode=s=>new TextEncoder().encode(s);
 const data={'xl/sharedStrings.xml':encode('<sst><si><t>A &amp; B</t></si></sst>'),
 'xl/worksheets/sheet1.xml':encode('<worksheet><sheetData><row r="1"><c r="B1" t="s"><v>0</v></c><c r="AD1" t="inlineStr"><is><t>000014</t></is></c><c r="C1"><v>2</v></c><c r="DN1"/><c r="ZZ1"><v>999</v></c></row></sheetData></worksheet>')};
 const s=readClientSheets(new Uint8Array(),()=>data);
 assert.equal(s[0].rows[0][1],'A & B');assert.equal(s[0].rows[0][29],'000014');assert.equal(s[0].rows[0][2],'2');assert.equal(s[0].rows[0].length,118);
 assert.throws(()=>readClientSheets(new Uint8Array(),(b,o)=>{o.filter({name:'xl/worksheets/sheet1.xml',originalSize:65*1024*1024});return {};}),/64 MB/);
});
