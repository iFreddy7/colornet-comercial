import test from 'node:test'
import assert from 'node:assert/strict'
import { handleInvoicedEmail, mensagem, type Mail } from '../supabase/functions/pedido-faturado-email/index.ts'
const id='00000000-0000-0000-0000-000000000001'
const pedido={id,numero:'PED-01',cliente_nome:'Cliente <script> & Cia',vendedor_nome:'Vendedor',registrado_por:'João',registrado_em:'2026-10-07T14:00:00Z'}
function fixture(options:{perfil?:string;ativo?:boolean;status?:string;erro?:unknown;accepted?:string[];ready?:boolean;finalError?:boolean}={}) {
  const calls:Array<{name:string;args:any}>=[],mails:Mail[]=[]
  const admin:any={auth:{getUser:async(token:string)=>({data:{user:token==='invalid'?null:{id}}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{perfil:options.perfil||'ADMIN',ativo:options.ativo??true}})})})}),rpc:async(name:string,args:any)=>{
    calls.push({name,args});return name==='reservar_aviso_pedido_faturado'?{data:{status:options.status||'RESERVADO',tentativa:id,destinatarios:['vendedor@colornet.com.br','jrodrigues@colornet.com.br','marcia@colornet.com.br'],pedido}}:{error:options.finalError?{}:null,data:args.p_incerto?'INCERTO':args.p_aceitos.length===3?'ENVIADO':'ERRO'}
  }}
  const transport={ready:options.ready??true,send:async(mail:Mail)=>{mails.push(mail);if(options.erro)throw options.erro;return {accepted:options.accepted||mail.to}}}
  const run=(body:unknown={pedido_id:id},token='token')=>handleInvoicedEmail(new Request('https://example.invalid',{method:'POST',headers:token?{authorization:`Bearer ${token}`}:{},body:JSON.stringify(body)}),admin,transport,true)
  return {calls,mails,run}
}
test('Somente ADMIN, Gerente e Diretor ativos e autenticados enviam',async()=>{
  for(const perfil of ['ADMIN','GERENTE','DIRETOR','VENDEDOR'])for(const ativo of [true,false]){
    const f=fixture({perfil,ativo});const r=await f.run();assert.equal(r.status,ativo&&perfil!=='VENDEDOR'?200:403)
    if(r.status===403)assert.equal(f.mails.length,0)
  }
  for(const token of ['','invalid']){const f=fixture();assert.equal((await f.run(undefined,token)).status,401);assert.equal(f.calls.length,0)}
})
test('Conteúdo e destinatários são do servidor, HTML escapado, horário de Brasília',async()=>{
  const f=fixture();await f.run({pedido_id:id,to:['intruso@example.invalid'],pedido:{numero:'FALSO'}})
  assert.equal(f.mails.length,1);const m=f.mails[0]
  assert.deepEqual(m.to,['vendedor@colornet.com.br','jrodrigues@colornet.com.br','marcia@colornet.com.br'])
  assert.match(m.subject,/HOMOLOGAÇÃO.*PED-01 faturado/);assert.match(m.text,/11:00:00/)
  assert.match(m.html,/&lt;script&gt;/);assert.doesNotMatch(m.html,/<script>/)
  assert.equal(f.calls[0].args.p_ator_id,id);assert.match(m.text,/Marcado como faturado por: João/)
})
test('Dados inválidos, SMTP ausente e estados concluídos ou em curso não enviam',async()=>{
  for(const body of [null,{}, {pedido_id:'x'}]){const f=fixture();assert.equal((await f.run(body)).status,400);assert.equal(f.calls.length,0)}
  const f=fixture({ready:false});assert.equal((await f.run()).status,503);assert.equal(f.calls.length,0)
  for(const status of ['ENVIADO','ENVIANDO','INCERTO','ERRO']){const f=fixture({status});await f.run();assert.equal(f.mails.length,0)}
})
test('Falha conhecida, parcial, incerta e falha ao finalizar mantêm resultados distintos',async()=>{
  const f=fixture({erro:{code:'EAUTH',message:'segredo'}});const a=await (await f.run()).json();assert.equal(a.status,'ERRO');assert.doesNotMatch(JSON.stringify(a),/segredo/)
  const g=fixture({erro:{code:'ETIMEDOUT',command:'DATA'}});assert.equal((await (await g.run()).json()).status,'INCERTO')
  const h=fixture({accepted:['marcia@colornet.com.br','intruso@example.invalid']});await h.run();assert.deepEqual(h.calls[1].args.p_aceitos,['marcia@colornet.com.br'])
  const i=fixture({finalError:true});assert.equal((await (await i.run()).json()).status,'INCERTO')
})
test('Identificador de mensagem estável e assunto sem injeção de cabeçalhos',()=>{
  const m=mensagem({...pedido,numero:'PED\r\nBcc: intruso'},[],false)
  assert.doesNotMatch(m.subject,/[\r\n]|HOMOLOGAÇÃO/);assert.equal(m.messageId,`<pedido-faturado-${id}@colornet.com.br>`)
})
