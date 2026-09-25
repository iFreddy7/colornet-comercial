import test from 'node:test'
import assert from 'node:assert/strict'
import { atualizarPtax } from '../supabase/functions/ptax-atualizar/index.ts'
function fixture(options: {secret?: boolean; rpcError?: boolean; user?: boolean; active?: boolean; bcbStatus?: number; rows?: unknown[]} = {}) {
 const writes: any[] = [], calls: string[] = []
 const admin: any = {
  rpc: async () => ({data: options.secret ?? false,error: options.rpcError ? {} : null}),
  auth:{getUser:async()=>({data:{user:options.user===false?null:{id:'user'}},error:null})},
  from:(table:string)=>({select:()=>({eq:()=>({single:async()=>({data:{ativo:options.active??true},error:null})})}),update:(v:any)=>({eq:async(k:string,key:string)=>{writes.push({table,key,...v});return {error:null}}})})
 }
 const fetcher:any=async(url:string)=>{calls.push(url);return Response.json({value:options.rows??[{cotacaoVenda:5.23,dataHoraCotacao:'2026-09-24 13:00:00'}]},{status:options.bcbStatus??200})}
 const run=(headers:Record<string,string>={})=>atualizarPtax(new Request('https://example.invalid',{method:'POST',headers}),admin,fetcher)
 return {run,writes,calls}
}
test('PTAX sem credencial, com segredo errado ou falha de validação não consulta BCB',async()=>{
 for(const options of [{},{secret:false},{rpcError:true}]) {
  const f=fixture(options);assert.equal((await f.run({'x-ptax-secret':'invalid'})).status,401);assert.equal(f.calls.length,0)
 }
 const f=fixture();assert.equal((await f.run()).status,401);assert.equal(f.writes.length,0)
})
test('Cron autenticado atualiza PTAX venda D-1 diretamente no Banco Central',async()=>{
 const f=fixture({secret:true});const r=await f.run({'x-ptax-secret':'valid'})
 assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'*')
 const url=new URL(f.calls[0]);assert.equal(url.hostname,'olinda.bcb.gov.br')
 assert.equal(url.searchParams.get('$top'),'1');assert.equal(url.searchParams.get('$orderby'),'dataHoraCotacao desc')
 assert.ok(!f.calls[0].includes('+'));assert.ok(f.calls[0].includes('%20desc'))
 assert.equal(f.writes[0].valor,5.23);assert.equal(f.writes[1].valor,'2026-09-24')
})
test('Portal permite usuário ativo, bloqueia sessão inválida e usuário desativado',async()=>{
 for(const [options,status] of [[{user:false},401],[{active:false},403],[{active:true},200]] as const){
  const f=fixture(options);assert.equal((await f.run({authorization:'Bearer token'})).status,status)
  if(status!==200) assert.equal(f.calls.length,0)
 }
})
test('Indisponibilidade ou resposta inválida do BCB preserva PTAX anterior',async()=>{
 for(const options of [{bcbStatus:503},{rows:[]},{rows:[{cotacaoVenda:0}]}]){
  const f=fixture({...options,secret:true});assert.equal((await f.run({'x-ptax-secret':'valid'})).status,503);assert.equal(f.writes.length,0)
 }
})
