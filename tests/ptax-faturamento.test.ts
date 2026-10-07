import test from 'node:test'
import assert from 'node:assert/strict'
import {regraPtaxFaturamento,consultarPtaxFaturamento,textoPtaxFaturamento} from '../supabase/functions/_shared/ptaxFaturamento.ts'
import {erroValidadeCotacao,dataCotacaoMaisDias} from '../src/lib/validadeCotacao.ts'
const agora=new Date('2026-10-07T18:00:00Z')
const mock=(referencia:string,valor=5.1234):typeof fetch=>async()=>Response.json({value:[{dataHoraCotacao:referencia+' 13:00:00.000',cotacaoVenda:valor}]})
test('Corte usa horário de Brasília e momento de criação, inclusive meia-noite UTC',()=>{
  assert.deepEqual(regraPtaxFaturamento('2026-10-07T16:59:59Z'),{data_limite:'2026-10-06',criterio:'D_1'})
  assert.equal(regraPtaxFaturamento('2026-10-07T17:00:00Z').criterio,'D_1')
  assert.deepEqual(regraPtaxFaturamento('2026-10-07T17:00:00.001Z'),{data_limite:'2026-10-07',criterio:'APOS_14H'})
  assert.equal(regraPtaxFaturamento('2026-10-08T01:00:00Z').data_limite,'2026-10-07')
  assert.throws(()=>regraPtaxFaturamento('2026-10-07T14:01:00'),/fuso/)
})
test('Consulta oficial busca fechamento até o limite e e-mail explicita valor e referência',async()=>{
  let endpoint='';const consulta:typeof fetch=async(url)=>{endpoint=String(url);return mock('2026-10-06')()}
  const r=await consultarPtaxFaturamento('2026-10-07T16:00:00Z',consulta,agora)
  assert.equal(r.status,'DEFINIDA');assert.equal(r.referencia,'2026-10-06');assert.match(endpoint,/olinda.bcb.gov.br/);assert.doesNotMatch(endpoint,/\+/)
  assert.match(textoPtaxFaturamento(r),/5,1234.*06\/10\/2026/)
  const tarde=await consultarPtaxFaturamento('2026-10-07T18:00:00Z',mock('2026-10-07'),agora)
  assert.equal(tarde.referencia,'2026-10-07');assert.match(textoPtaxFaturamento(tarde),/após as 14h/)
})
test('Não inventa taxa futura nem substitui cotação ainda pendente pelo fechamento de ontem',async()=>{
  for(const fetcher of [mock('2026-10-06'),mock('2026-10-08'),mock('2026-10-07',0),async()=>{throw Error('offline')}]){
    const r=await consultarPtaxFaturamento('2026-10-07T18:00:00Z',fetcher,agora);assert.equal(r.status,'PENDENTE');assert.equal(r.valor,null)
  }
})
test('Fins de semana e feriados passados usam o último fechamento do período',async()=>{
  assert.equal((await consultarPtaxFaturamento('2026-10-10T18:00:00Z',mock('2026-10-09'),new Date('2026-10-10T19:00:00Z'))).referencia,'2026-10-09')
  assert.equal((await consultarPtaxFaturamento('2026-10-13T15:00:00Z',mock('2026-10-09'),new Date('2026-10-13T16:00:00Z'))).referencia,'2026-10-09')
})
test('Validade inclusiva de 30 dias usa dia de Brasília, valida calendário e virada de ano',()=>{
  const now=new Date('2026-10-08T01:00:00Z');assert.equal(dataCotacaoMaisDias(0,now),'2026-10-07')
  assert.equal(erroValidadeCotacao('2026-11-06',now),'');assert.match(erroValidadeCotacao('2026-11-07',now),/30 dias/)
  assert.match(erroValidadeCotacao('2026-10-06',now),/passado/);assert.match(erroValidadeCotacao('2026-02-30',now),/inválida/)
  assert.equal(dataCotacaoMaisDias(30,new Date('2026-12-20T15:00:00Z')),'2027-01-19')
})
