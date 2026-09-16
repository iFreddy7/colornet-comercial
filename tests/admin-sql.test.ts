import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const admin = id(1), seller = id(2), inactive = id(3), vendor = id(4), branch = id(5), customer = id(6), product = id(7), created = id(8), creation = id(9)
const db = new PGlite()
const migration = await readFile(new URL('../supabase/migrations/202609160001_admin_usuarios_relatorios.sql', import.meta.url), 'utf8')

await db.exec(`
  create schema auth; create schema private;
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public, auth, private to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}');
  create table usuarios(id uuid primary key references auth.users(id) on delete cascade,
    nome text, email text, perfil text, vendedor_id uuid, ativo boolean);
  create table vendedores(id uuid primary key, codigo_protheus text, nome text, email text, ativo boolean);
  create table filiais(id uuid primary key, codigo text, nome text, uf text);
  create table clientes(id uuid primary key, codigo text, razao_social text, cnpj_cpf text);
  create table produtos(id uuid primary key, codigo_protheus text, nome text, ncm text);
  create table prazos_pagamento(id uuid primary key, descricao text);
  create table fretes(id uuid primary key, descricao text);
  create table pedidos(id uuid primary key, numero text, created_at timestamptz,
    created_by uuid, vendedor_id uuid, cliente_id uuid, filial_id uuid,
    prazo_pagamento_id uuid, frete_id uuid, cancelado_por uuid, cancelado_em timestamptz,
    motivo_cancelamento text, moeda text, status text, subtotal numeric, valor_ipi numeric,
    total numeric, observacoes text);
  create table pedido_itens(id uuid primary key, pedido_id uuid, produto_id uuid,
    quantidade numeric, preco_net numeric, total_item numeric, ipi numeric);
  create table pedido_eventos(id uuid primary key, pedido_id uuid, tipo text,
    detalhes jsonb, created_by uuid, criado_em timestamptz);
  create table movimentos_estoque(id uuid primary key, pedido_id uuid, produto_id uuid,
    filial_id uuid, quantidade numeric, tipo text, created_by uuid, criado_em timestamptz);
  create table movimentos_previsao(like movimentos_estoque including all);
  create table email_logs(id uuid primary key, pedido_id uuid, status text,
    destinatarios text[], criado_em timestamptz);
  create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
    select exists(select 1 from public.usuarios where id=auth.uid() and ativo and perfil='ADMIN') $$;
`)
await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4),($5,$6)',[admin,'admin@example.invalid',seller,'seller@example.invalid',inactive,'inactive@example.invalid'])
await db.query("insert into usuarios values ($1,'Admin','admin@example.invalid','ADMIN',null,true),($2,'Seller','seller@example.invalid','VENDEDOR',$4,true),($3,'Inativo','inactive@example.invalid','ADMIN',null,false)",[admin,seller,inactive,vendor])
await db.query("insert into vendedores values ($1,'00001','Vendedor','seller@example.invalid',true)",[vendor])
await db.query("insert into filiais values ($1,'SC','SC - ITAJAÍ','SC')",[branch])
await db.query("insert into clientes values ($1,'000123','CLIENTE DE TESTE','00123456000199')",[customer])
await db.query("insert into produtos values ($1,'AL031.2BD25','SILVER NET 3891','3212.90.10')",[product])
for (const [n, date] of [[10,'2026-09-16T02:59:59Z'],[11,'2026-09-16T03:00:00Z'],[12,'2026-09-17T02:59:59Z'],[13,'2026-09-17T03:00:00Z']] as const) {
  await db.query(`insert into pedidos(id,numero,created_at,created_by,vendedor_id,cliente_id,filial_id,moeda,status,subtotal,valor_ipi,total)
    values ($1,$2,$3,$4,$5,$6,$7,'USD','ABERTO',28.75,1.87,30.62)`,[id(n),'PED-'+n,date,seller,vendor,customer,branch])
}
await db.query("insert into pedido_itens values ($1,$2,$3,1,25.05,30.62,.065)",[id(20),id(11),product])
await db.query("insert into pedido_eventos values ($1,$2,'TESTE','{\"observacao\":\"histórico\"}',$3,now())",[id(21),id(11),admin])
await db.query("insert into movimentos_estoque values ($1,$2,$3,$4,1,'SAIDA_PEDIDO',$5,now())",[id(22),id(11),product,branch,seller])
await db.query("insert into movimentos_previsao values ($1,$2,$3,$4,2,'RESERVA_PREVISAO',$5,now())",[id(23),id(11),product,branch,seller])
await db.query("insert into email_logs values ($1,$2,'ENVIADO',ARRAY['destino@example.invalid'],now())",[id(24),id(11)])
await db.exec(migration)

async function asRole<T>(role: string, actor: string, run: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor])
  await db.exec(`set role ${role}`)
  try { return await run() } finally { await db.exec('reset role') }
}
async function report(params: any[] = [null,null,null,null,null], actor = admin, role = 'authenticated') {
  return asRole(role,actor,async () => (await db.query<{ r: any }>('select public.admin_exportar_pedidos_v1($1,$2,$3,$4,$5) r',params)).rows[0].r)
}
const finishParams = [admin,created,creation,'Nova Pessoa','nova@example.invalid','VENDEDOR',vendor]
async function finish(params = finishParams, role = 'service_role') {
  return asRole(role,admin,async () => db.query('select public.admin_finalizar_novo_usuario($1,$2,$3,$4,$5,$6,$7)',params))
}

test('Migração é reaplicável', async () => { await db.exec(migration) })
test('Exportação completa inclui todas as tabelas relacionadas', async () => {
  const r = await report()
  assert.equal(r.pedidos.length,4); assert.equal(r.itens.length,1)
  for (const key of ['eventos','estoque','previsoes','emails']) assert.equal(r[key].length,1,key)
  assert.equal(r.pedidos[1].cliente.codigo,'000123')
  assert.equal(r.itens[0].produto.codigo_protheus,'AL031.2BD25')
})
test('Datas inclusivas são dias de Brasília e filtros se combinam', async () => {
  const r = await report(['2026-09-16','2026-09-16',vendor,branch,'ABERTO'])
  assert.deepEqual(r.pedidos.map((p: any) => p.pedido.numero),['PED-11','PED-12'])
  assert.equal((await report([null,null,id(999),null,null])).pedidos.length,0)
  await assert.rejects(() => report(['2026-09-17','2026-09-16',null,null,null]),/Período inválido/)
  await assert.rejects(() => report([null,null,null,null,'INVALIDO']),/Status inválido/)
})
test('Vendedor, ADMIN inativo e anônimo não exportam pela API', async () => {
  for (const actor of [seller,inactive]) await assert.rejects(() => report(undefined,actor),/ADMIN ativo/)
  await assert.rejects(() => report(undefined,'','anon'),/permission denied/)
})
test('RPC de provisionamento não é executável pelo navegador, nem por ADMIN', async () => {
  await assert.rejects(() => finish(finishParams,'authenticated'),/permission denied/)
  await assert.rejects(() => finish(finishParams,'anon'),/permission denied/)
})
test('Provisionamento revalida ADMIN e impede alterar identidade existente', async () => {
  await assert.rejects(() => finish([seller,...finishParams.slice(1)]),/ADMIN ativo/)
  await assert.rejects(() => finish([admin,admin,...finishParams.slice(2)]),/não corresponde/)
})
test('Conta criada no Auth recebe perfil, vínculo e auditoria numa transação', async () => {
  await db.query('insert into auth.users values ($1,$2,$3)',[created,'nova@example.invalid',{colornet_criado_por:admin,colornet_criacao_id:creation}])
  // Simula o trigger de criação de perfil já existente no Supabase.
  await db.query("insert into usuarios(id,nome,email,perfil,ativo) values ($1,'Antigo','nova@example.invalid','VENDEDOR',false)",[created])
  await finish()
  const u = (await db.query<any>('select * from usuarios where id=$1',[created])).rows[0]
  assert.equal(u.nome,'Nova Pessoa'); assert.equal(u.ativo,true); assert.equal(u.vendedor_id,vendor)
  assert.equal((await db.query<any>('select count(*)::int n from admin_usuario_eventos')).rows[0].n,1)
})
test('Vínculo obrigatório e marcador de criação protegem a configuração', async () => {
  await assert.rejects(() => finish([...finishParams.slice(0,6),null] as any),/Selecione o vendedor/)
  await assert.rejects(() => finish([admin,created,id(999),...finishParams.slice(3)]),/não corresponde/)
  await db.query('update vendedores set ativo=false where id=$1',[vendor])
  await assert.rejects(() => finish(),/inexistente ou inativo/)
  await db.query('update vendedores set ativo=true where id=$1',[vendor])
  assert.equal((await db.query<any>('select count(*)::int n from admin_usuario_eventos')).rows[0].n,1)
})
test('Relatório exporta mais de mil pedidos, sem truncar na listagem da tela', async () => {
  await db.query(`insert into pedidos(id,numero,created_at,created_by,vendedor_id,cliente_id,filial_id,moeda,status,subtotal,valor_ipi,total)
    select gen_random_uuid(),'HIST-'||g,'2026-08-01T12:00:00Z',$1,$2,$3,$4,'BRL','CANCELADO',10,0,10
    from generate_series(1,1005) g`,[seller,vendor,customer,branch])
  const r = await report(); assert.equal(r.pedidos.length,1009)
  assert.equal((await report([null,null,null,null,'CANCELADO'])).pedidos.length,1005)
})
test.after(async () => { await db.close() })
