import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite(), id = (n:number) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role;
grant usage on schema public,auth to authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table usuarios(id uuid primary key,nome text,perfil text,ativo boolean);
create table vendedores(id uuid primary key,email text);
create table cotacoes(id uuid primary key,numero text,titulo text,created_at timestamptz,created_by uuid,vendedor_id uuid,cliente_nome text,vendedor_nome text,moeda text,validade date,documento jsonb,pedido_convertido_id uuid);
alter table cotacoes enable row level security;grant select on cotacoes to authenticated;
insert into usuarios values('${id(1)}','Vendedor','VENDEDOR',true),('${id(2)}','Gerente','GERENTE',true),('${id(3)}','Diretor','DIRETOR',true),('${id(4)}','Inativo','GERENTE',false),('${id(5)}','Admin','ADMIN',true);
insert into vendedores values('${id(11)}','vendedor@colornet.com.br'),('${id(12)}','marcia@colornet.com.br'),('${id(13)}',null);`)
await db.exec(await readFile(new URL('../supabase/migrations/20260925150228_aprovacao_relatorio_cotacoes.sql',import.meta.url),'utf8'))
test.after(() => db.close())
async function actor(n=2, role='authenticated') { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);await db.exec(`set role ${role}`) }
async function quote(n:number,vendedor=11) { await db.exec('reset role');await db.query(`insert into cotacoes(id,numero,titulo,created_at,created_by,vendedor_id,cliente_nome,vendedor_nome,moeda,validade,documento) values($1,$2,'Teste','2026-09-25T02:59:59Z',$3,$4,'Cliente teste','Vendedor teste','BRL','2026-10-01',$5)`,[id(n),`COT-${n}`,id(1),id(vendedor),JSON.stringify({total:null,itens:[{codigo:'001',quantidade:null,preco_net:1.1234}]})]);await actor() }
async function decide(n:number,decisao='APROVADA',motivo:string|null=null) { return (await db.query<any>('select decidir_cotacao($1,$2,$3) r',[id(n),decisao,motivo])).rows[0].r }
async function claim(n:number,ator=2) { await actor(ator,'service_role');return (await db.query<any>('select reservar_aviso_cotacao($1,$2) r',[id(n),id(ator)])).rows[0].r }
async function finish(n:number,token:string,accepted:string[],uncertain=false) { return (await db.query<any>('select finalizar_aviso_cotacao($1,$2,$3,$4,null) r',[id(n),token,accepted,uncertain])).rows[0].r }

test('Somente Gerente e Diretor ativos decidem; nem vendedor nem anônimo podem forjar decisão', async()=>{
  await quote(20)
  for(const n of [1,4,5,999]) { await actor(n);await assert.rejects(()=>decide(20),/Apenas Gerente/) }
  await actor(2,'anon');await assert.rejects(()=>decide(20),/permission denied/)
  await actor(2);const r=await decide(20);assert.equal(r.status,'APROVADA')
  await assert.rejects(()=>db.query('update cotacoes set aprovacao_status=$1 where id=$2',['REPROVADA',id(20)]),/permission denied/)
  await assert.rejects(()=>db.query('select * from private.cotacao_avisos'),/permission denied/)
  await assert.rejects(()=>db.query('select reservar_aviso_cotacao($1,$2)',[id(20),id(2)]),/permission denied/)
  await quote(21);await actor(3);assert.equal((await decide(21,'REPROVADA','Margem insuficiente')).status,'REPROVADA')
})
test('Reprovação exige motivo; decisão é única, auditada e repetição não duplica o aviso',async()=>{
  await quote(22)
  for(const motivo of [null,'  ','x'.repeat(2001)]) await assert.rejects(()=>decide(22,'REPROVADA',motivo),/motivo/)
  await assert.rejects(()=>decide(22,'OUTRA'),/inválida/)
  await decide(22,'REPROVADA','  Ajustar condições  ')
  assert.equal((await decide(22,'REPROVADA','Ajustar condições')).repetida,true)
  await assert.rejects(()=>decide(22),/já foi avaliada/)
  await actor(3);await assert.rejects(()=>decide(22,'REPROVADA','Ajustar condições'),/já foi avaliada/)
  await db.exec('reset role');const q=(await db.query<any>('select * from cotacoes where id=$1',[id(22)])).rows[0]
  assert.equal(q.aprovacao_por,id(2));assert.equal(q.aprovacao_nome,'Gerente');assert.equal(q.aprovacao_motivo,'Ajustar condições');assert.ok(q.aprovacao_em)
  assert.equal((await db.query<any>('select count(*)::int n from private.cotacao_avisos where cotacao_id=$1',[id(22)])).rows[0].n,1)
  await quote(23);await db.exec('reset role');await db.query('update cotacoes set pedido_convertido_id=$1 where id=$2',[id(999),id(23)]);await actor();await assert.rejects(()=>decide(23),/já foi convertida/)
})
test('Fila deduplica destinatários, bloqueia concorrência e repete somente os ainda não aceitos',async()=>{
  await quote(24,12);await decide(24);const first=await claim(24)
  assert.deepEqual(first.destinatarios,['jrodrigues@colornet.com.br','marcia@colornet.com.br'])
  assert.equal((await claim(24)).status,'ENVIANDO')
  await assert.rejects(()=>finish(24,id(99),first.destinatarios),/inválida/)
  assert.equal(await finish(24,first.tentativa,['marcia@colornet.com.br']),'ERRO')
  assert.equal((await claim(24)).aguarde,true)
  await db.exec('reset role');await db.query("update private.cotacao_avisos set iniciado_em=now()-interval '1 minute' where cotacao_id=$1",[id(24)])
  const retry=await claim(24);assert.deepEqual(retry.destinatarios,['jrodrigues@colornet.com.br'])
  assert.equal(await finish(24,retry.tentativa,retry.destinatarios),'ENVIADO')
  assert.equal((await claim(24)).status,'ENVIADO')
})
test('Envio incerto não é repetido, e falta de e-mail não desfaz a decisão',async()=>{
  await quote(25);await decide(25);const first=await claim(25)
  assert.equal(await finish(25,first.tentativa,[],true),'INCERTO');assert.equal((await claim(25)).status,'INCERTO')
  await quote(26,13);await decide(26);assert.equal((await claim(26)).status,'ERRO')
  await db.exec('reset role');assert.equal((await db.query<any>('select aprovacao_status from cotacoes where id=$1',[id(26)])).rows[0].aprovacao_status,'APROVADA')
  await quote(27);await decide(27);await claim(27);await db.exec('reset role');await db.query("update private.cotacao_avisos set iniciado_em=now()-interval '6 minutes' where cotacao_id=$1",[id(27)])
  assert.equal((await claim(27)).status,'INCERTO')
})
test('Relatório mantém mais de mil propostas, aplica fuso e filtros e restringe acesso',async()=>{
  await db.exec('reset role');await db.exec(`insert into cotacoes(id,numero,titulo,created_at,created_by,vendedor_id,cliente_nome,vendedor_nome,moeda,documento) select gen_random_uuid(),'LOTE-'||n,'Lote','2026-09-25T03:00:00Z','${id(1)}','${id(11)}','Cliente lote','Vendedor teste','USD','{"total":10,"itens":[{"quantidade":1,"preco_net":10}]}'::jsonb from generate_series(1,1005) n`)
  const report=async(args:any[]=[null,null,null,null,null])=>(await db.query<any>('select exportar_cotacoes_comercial_v1($1,$2,$3,$4,$5) r',args)).rows[0].r
  await actor(1);await assert.rejects(()=>report(),/restrito/);await actor(4);await assert.rejects(()=>report(),/restrito/)
  await actor(5);assert.ok((await report()).cotacoes.length>1000)
  let r=await report(['2026-09-25','2026-09-25',id(11),'lote','PENDENTE']);assert.equal(r.cotacoes.length,1005);assert.equal(r.itens.length,1005)
  r=await report(['2026-09-24','2026-09-24',null,'Cliente teste','REPROVADA']);assert.equal(r.cotacoes.length,2);assert.equal(r.cotacoes[1].aprovacao_motivo,'Ajustar condições')
  assert.equal((await report([null,null,id(12),null,null])).cotacoes.length,1)
  await assert.rejects(()=>report(['2026-09-26','2026-09-25',null,null,null]),/Período/)
  await assert.rejects(()=>report([null,null,null,null,'X']),/Situação/)
})
