import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import {textoPtaxFaturamento} from '../supabase/functions/_shared/ptaxFaturamento.ts'
test('Confirmação de pedido bloqueia usuário inativo, ausente ou consulta de perfil com erro antes de enviar',async()=>{
 for(const mode of ['inactive','missing','error']) {
  let handler:any,lookedUpOrder=false,mailSent=false
  const q:any={select:()=>q,eq:()=>q,single:async()=>({data:mode==='missing'?null:{perfil:'ADMIN',ativo:mode!=='inactive'},error:mode==='error'?{}:null})}
  const admin={auth:{getUser:async()=>({data:{user:{id:'id'}},error:null})},from:(table:string)=>{if(table!=='usuarios')lookedUpOrder=true;return q}}
  const source=readFileSync(new URL('../supabase/functions/pedido-confirmacao/index.ts',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'')
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
  vm.runInNewContext(code,{Deno:{env:{get:(name:string)=>name==='SUPABASE_SECRET_KEYS'?'{"default":"fixture"}':'fixture'},serve:(fn:any)=>handler=fn},createClient:()=>admin,Request,Response,Intl,fetch:async()=>{mailSent=true;return Response.json({ok:true})}})
  const r=await handler(new Request('https://example.invalid',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({pedido_id:'pedido'})}))
  assert.equal(r.status,403);assert.equal(lookedUpOrder,false);assert.equal(mailSent,false)
 }
})

test('E-mail usa PTAX registrada ou pendente, sem alterar preços do pedido',async()=>{
 for(const status of ['DEFINIDA','PENDENTE']){
  let handler:any,mail:any,rpcCalls=0
  const snapshot={status,valor:status==='DEFINIDA'?5.1991:null,referencia:status==='DEFINIDA'?'2026-10-07':null,data_limite:'2026-10-07',criterio:'APOS_14H'}
  const pedido={id:'pedido',numero:'123',created_at:'2026-10-07T17:01:00Z',created_by:'id',moeda:'USD',total:100,ptax_faturamento:status==='DEFINIDA'?snapshot:null,vendedores:{nome:'Teste',email:'teste@example.invalid'},clientes:{codigo:'01',razao_social:'Cliente'}}
  const admin={auth:{getUser:async()=>({data:{user:{id:'id'}},error:null})},rpc:async(name:string)=>{assert.equal(name,'registrar_ptax_faturamento');rpcCalls++;return{data:snapshot,error:null}},from:(table:string)=>{
   const data=table==='usuarios'?{perfil:'ADMIN',ativo:true}:table==='pedidos'?pedido:table==='pedido_itens'?[{quantidade:1,preco_net:100,preco_final:100,total_item:100,produtos:{nome:'Produto'}}]:null
   const q:any={select:()=>q,eq:()=>q,single:async()=>({data,error:null}),maybeSingle:async()=>({data,error:null}),insert:async()=>({error:null}),then:(resolve:any)=>Promise.resolve({data,error:null}).then(resolve)};return q
  }}
  const source=readFileSync(new URL('../supabase/functions/pedido-confirmacao/index.ts',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'')
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
  vm.runInNewContext(code,{Deno:{env:{get:(n:string)=>n==='SUPABASE_SECRET_KEYS'?'{"default":"fixture"}':'fixture'},serve:(fn:any)=>handler=fn},createClient:()=>admin,Request,Response,Intl,consultarPtaxFaturamento:async()=>snapshot,textoPtaxFaturamento,fetch:async(_u:any,opts:any)=>{mail=JSON.parse(opts.body);return Response.json({ok:true})}})
  const r=await handler(new Request('https://example.invalid',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({pedido_id:'pedido'})}));assert.equal(r.status,200)
  assert.match(mail.htmlBody,/PTAX/);assert.match(mail.htmlBody,status==='DEFINIDA'?/5,1991/:/pendente|aguardando/i);assert.equal(rpcCalls,status==='DEFINIDA'?0:1);assert.equal(pedido.total,100)
 }
})

