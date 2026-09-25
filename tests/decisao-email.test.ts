import test from 'node:test'
import assert from 'node:assert/strict'
import { handleDecisionEmail, mensagem, falhaConhecida, type Mail } from '../supabase/functions/cotacao-decisao-email/index.ts'
import { podeAvaliarCotacao } from '../src/lib/aprovacaoCotacao.ts'

const id='00000000-0000-0000-0000-000000000001'
const quote={id,numero:'COT-01',titulo:'<script>alert(1)</script>',cliente_nome:'Cliente & Cia',vendedor_nome:'Vendedor',moeda:'BRL',total:null,aprovacao_status:'REPROVADA',aprovacao_nome:'Gestor',aprovacao_em:'2026-09-25T14:00:00Z',aprovacao_motivo:'Rever <preço>\nCondição'}
test('Requisições sem sessão e tokens inválidos não acessam dados nem enviam',async()=>{
  const transport={ready:true,send:async()=>{throw Error('Não deveria enviar')}}
  const admin:any={auth:{getUser:async()=>({data:{user:null},error:{message:'invalid jwt'}})},from:()=>{throw Error('Não deveria consultar')}}
  for(const headers of [{},{authorization:'Bearer token-invalido'}]) {
    const response=await handleDecisionEmail(new Request('https://example.invalid',{method:'POST',headers,body:JSON.stringify({cotacao_id:id})}),admin,transport,true)
    assert.equal(response.status,401)
  }
})
function fixture(options:{perfil?:string;ativo?:boolean;status?:string;erro?:unknown;accepted?:string[];ready?:boolean}={}) {
  const calls: Array<{name:string;args:any}> = [], mails:Mail[]=[]
  const admin:any={auth:{getUser:async()=>({data:{user:{id}},error:null})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{perfil:options.perfil||'GERENTE',ativo:options.ativo??true}})})})}),rpc:async(name:string,args:any)=>{
    calls.push({name,args})
    return {data:name==='reservar_aviso_cotacao'?{status:options.status||'RESERVADO',tentativa:id,destinatarios:['vendedor@colornet.com.br','jrodrigues@colornet.com.br','marcia@colornet.com.br'],cotacao:quote}:args.p_incerto?'INCERTO':args.p_aceitos.length===3?'ENVIADO':'ERRO'}
  }}
  const transport={ready:options.ready??true,send:async(mail:Mail)=>{mails.push(mail);if(options.erro)throw options.erro;return {accepted:options.accepted||mail.to}}}
  const run=(body:any={cotacao_id:id},token='token')=>handleDecisionEmail(new Request('https://example.invalid',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify(body)}),admin,transport,true)
  return {calls,mails,run}
}
test('Permissão dos botões e da função exclui vendedor, Admin e perfis inativos',async()=>{
  for(const perfil of ['VENDEDOR','ADMIN','GERENTE','DIRETOR'] as const) for(const ativo of [true,false]) {
    assert.equal(podeAvaliarCotacao({perfil,ativo}),ativo&&['GERENTE','DIRETOR'].includes(perfil))
    if(!podeAvaliarCotacao({perfil,ativo})){const f=fixture({perfil,ativo});assert.equal((await f.run()).status,403);assert.equal(f.calls.length,0)}
  }
})
test('Destinatários e conteúdo vêm da reserva do servidor; HTML de cotação é escapado',async()=>{
  const f=fixture();assert.equal((await f.run({cotacao_id:id,to:'intruso@example.com',cotacao:{aprovacao_status:'APROVADA'}})).status,200)
  assert.equal(f.mails.length,1);assert.ok(f.mails[0].to.includes('marcia@colornet.com.br'));assert.ok(!f.mails[0].to.includes('intruso@example.com'))
  assert.match(f.mails[0].subject,/HOMOLOGAÇÃO.*reprovada/);assert.match(f.mails[0].html,/&lt;script&gt;/);assert.doesNotMatch(f.mails[0].html,/<script>/)
  assert.match(f.mails[0].text,/Motivo da reprovação: Rever <preço>/);assert.match(f.mails[0].text,/sem total geral/)
  assert.equal(f.calls[0].args.p_ator_id,id)
})
test('Sem configuração, envio duplicado ou em curso não transmite',async()=>{
  const a=fixture({ready:false});assert.equal((await a.run()).status,503);assert.equal(a.calls.length,0)
  for(const status of ['ENVIADO','ENVIANDO','INCERTO']){const f=fixture({status});await f.run();assert.equal(f.mails.length,0)}
  const f=fixture();assert.equal((await f.run({cotacao_id:'x'})).status,400);assert.equal(f.calls.length,0)
})
test('Falha conhecida, envio parcial e resposta incerta são gravados separadamente',async()=>{
  const f=fixture({erro:{code:'EAUTH',message:'secret should never leak'}});let r=await f.run();assert.equal((await r.json()).status,'ERRO');assert.equal(f.calls[1].args.p_incerto,false)
  const g=fixture({erro:{code:'ETIMEDOUT',command:'DATA'}});r=await g.run();assert.equal((await r.json()).status,'INCERTO');assert.equal(g.calls[1].args.p_incerto,true)
  const h=fixture({accepted:['marcia@colornet.com.br']});await h.run();assert.deepEqual(h.calls[1].args.p_aceitos,['marcia@colornet.com.br'])
  assert.equal(falhaConhecida({code:'ECONNECTION',command:'DATA'}),false)
  assert.equal(falhaConhecida({responseCode:550}),true)
})
test('Mensagem aprovada tem total e não apresenta motivo de reprovação',()=>{
  const m=mensagem({...quote,total:25.12,aprovacao_status:'APROVADA'},['jrodrigues@colornet.com.br'],false)
  assert.match(m.subject,/aprovada/);assert.doesNotMatch(m.subject,/HOMOLOGAÇÃO/);assert.match(m.text,/25,12/);assert.doesNotMatch(m.text,/Motivo da reprovação/)
})
