import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
await db.exec(`create schema auth; create schema private;
create role anon; create role authenticated; create role service_role;
grant usage on schema public, auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table usuarios(id uuid primary key,nome text,perfil text,ativo boolean);
create table vendedores(id uuid primary key,nome text,email text);
create table clientes(id uuid primary key,razao_social text);
create table pedidos(id uuid primary key,numero text,status text,cancelado_em timestamptz,vendedor_id uuid,cliente_id uuid,total numeric default 100);
create table pedido_eventos(id uuid primary key default gen_random_uuid(),pedido_id uuid references pedidos(id),tipo text,detalhes jsonb,created_by uuid,criado_em timestamptz);
grant select on pedidos,pedido_eventos to authenticated;`)
for (const [n,perfil,ativo] of [[1,'ADMIN',true],[2,'GERENTE',true],[3,'DIRETOR',true],[4,'VENDEDOR',true],[5,'ADMIN',false]] as const)
  await db.query('insert into usuarios values($1,$2,$3,$4)',[id(n),perfil,perfil,ativo])
await db.query("insert into vendedores values($1,'Vendedor','seller@example.invalid'),($2,'João',' JRODRIGUES@COLORNET.COM.BR '),($3,'Sem e-mail',null)",[id(10),id(11),id(12)])
await db.query("insert into clientes values($1,'Cliente de teste')",[id(20)])
const migration=await readFile(new URL('../supabase/migrations/20261007190000_marcar_pedido_faturado.sql',import.meta.url),'utf8')
await db.exec(migration)
async function asRole(role:string,actor:string,sql:string,args:unknown[]=[]):Promise<any> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]); await db.exec(`set role ${role}`)
  try { return (await db.query(sql,args)).rows[0] } finally { await db.exec('reset role') }
}
async function order(n:number,status='ABERTO',vendor=10) {await db.query('insert into pedidos(id,numero,status,vendedor_id,cliente_id) values($1,$2,$3,$4,$5)',[id(n),`PED-${n}`,status,id(vendor),id(20)])}
async function mark(n:number,actor=1,role='authenticated'){return (await asRole(role,actor?id(actor):'','select public.marcar_pedido_faturado($1) r',[id(n)])).r}
async function reserve(n:number,actor=1,role='service_role'){return (await asRole(role,id(actor),'select public.reservar_aviso_pedido_faturado($1,$2) r',[id(n),id(actor)])).r}
async function finish(n:number,token:string,accepted:string[],uncertain=false){return (await asRole('service_role',id(1),'select public.finalizar_aviso_pedido_faturado($1,$2,$3,$4,null) r',[id(n),token,accepted,uncertain])).r}
test('Migração reaplicável e operação idempotente para os três cargos',async()=>{
  await db.exec(migration)
  for(const actor of [1,2,3]) {
    const n=100+actor;await order(n,actor===2?'ENVIADO':'ABERTO')
    assert.equal((await mark(n,actor)).ja_faturado,false);assert.equal((await mark(n,actor)).ja_faturado,true)
    const event=(await db.query<any>('select * from pedido_eventos where pedido_id=$1',[id(n)])).rows
    assert.equal(event.length,1);assert.equal(event[0].created_by,id(actor))
    assert.equal((await db.query<any>('select * from pedidos where id=$1',[id(n)])).rows[0].total,'100')
    assert.equal((await db.query('select * from private.pedido_faturamento_avisos where pedido_id=$1',[id(n)])).rows.length,1)
  }
})
test('Vendedores, inativos, desconhecidos e anônimos não marcam; escrita direta e reserva são bloqueadas',async()=>{
  await order(110)
  for(const actor of [4,5,99,0]) await assert.rejects(()=>mark(110,actor),/ativos|autenticado/)
  await assert.rejects(()=>mark(110,0,'anon'),/permission denied/)
  await assert.rejects(()=>asRole('authenticated',id(1),"update pedidos set status='FATURADO' where id=$1",[id(110)]),/permission denied/)
  await assert.rejects(()=>reserve(110,1,'authenticated'),/permission denied/)
  await assert.rejects(()=>reserve(110,4),/restrito/)
})
test('Cancelados, estados inesperados e inexistentes são recusados',async()=>{
  for(const [n,status] of [[120,'CANCELADO'],[121,'OUTRO']] as const){await order(n,status);await assert.rejects(()=>mark(n),/cancelado|status/)}
  await order(122);await db.query('update pedidos set cancelado_em=now() where id=$1',[id(122)]);await assert.rejects(()=>mark(122),/cancelado/)
  await assert.rejects(()=>mark(999),/não encontrado/)
})
test('Falha na auditoria desfaz status e fila atomicamente',async()=>{
  await order(130)
  await db.exec(`create function falhar_evento() returns trigger language plpgsql as $$begin raise exception 'Falha simulada'; end$$;
    create trigger falhar before insert on pedido_eventos for each row execute function falhar_evento();`)
  try {await assert.rejects(()=>mark(130),/Falha simulada/)} finally {await db.exec('drop trigger falhar on pedido_eventos')}
  assert.equal((await db.query<any>('select status from pedidos where id=$1',[id(130)])).rows[0].status,'ABERTO')
  assert.equal((await db.query('select * from private.pedido_faturamento_avisos where pedido_id=$1',[id(130)])).rows.length,0)
})
test('Destinatários são deduplicados, reservas simultâneas não enviam novamente e entrega concluída não repete',async()=>{
  await order(140,'ABERTO',11);await mark(140);const r=await reserve(140)
  assert.deepEqual(r.destinatarios,['jrodrigues@colornet.com.br','marcia@colornet.com.br']);assert.equal(r.pedido.registrado_por,'ADMIN')
  assert.equal((await reserve(140)).status,'ENVIANDO')
  await assert.rejects(()=>finish(140,id(99),r.destinatarios),/inválida/)
  assert.equal(await finish(140,r.tentativa,r.destinatarios),'ENVIADO');assert.equal((await reserve(140)).status,'ENVIADO')
})
test('Envio parcial repete apenas destinatários pendentes, sem aceitar endereço injetado',async()=>{
  await order(150);await mark(150);let r=await reserve(150)
  assert.equal(await finish(150,r.tentativa,['marcia@colornet.com.br','intruso@example.invalid']),'ERRO')
  assert.equal((await reserve(150)).aguarde,true)
  await db.query("update private.pedido_faturamento_avisos set iniciado_em=now()-interval '31 seconds' where pedido_id=$1",[id(150)])
  r=await reserve(150);assert.deepEqual(r.destinatarios,['jrodrigues@colornet.com.br','seller@example.invalid'])
  assert.equal(await finish(150,r.tentativa,r.destinatarios),'ENVIADO')
})
test('Resultado incerto ou interrupção longa impedem reenvio automático',async()=>{
  for(const n of [160,161]){await order(n);await mark(n);const r=await reserve(n)
    if(n===160)await finish(n,r.tentativa,[],true)
    else await db.query("update private.pedido_faturamento_avisos set iniciado_em=now()-interval '6 minutes' where pedido_id=$1",[id(n)])
    assert.equal((await reserve(n)).status,'INCERTO');assert.equal((await reserve(n)).status,'INCERTO')
  }
})
test('E-mail ausente não desfaz faturamento e permite corrigir cadastro antes de enviar',async()=>{
  await order(170,'ABERTO',12);await mark(170);assert.equal((await reserve(170)).status,'ERRO')
  assert.equal((await db.query<any>('select status from pedidos where id=$1',[id(170)])).rows[0].status,'FATURADO')
  await db.query("update vendedores set email='novo@example.invalid' where id=$1",[id(12)])
  assert.equal((await reserve(170)).status,'RESERVADO')
})
test.after(async()=>{await db.close()})
