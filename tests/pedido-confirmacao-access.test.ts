import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
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

