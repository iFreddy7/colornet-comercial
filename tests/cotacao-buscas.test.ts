import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const db=new PGlite(),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
await db.exec(`create role anon;create role authenticated;create schema private;create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;
create table usuarios(id uuid,ativo boolean,perfil text,vendedor_id uuid);
create table clientes(id uuid,ativo boolean,vendedor_id uuid);
create table prazos_pagamento(id uuid,ativo boolean);
create table cotacoes(id uuid,cliente_id uuid,prazo_pagamento_id uuid,created_at timestamptz);
create table produtos(id uuid,ativo boolean,nome text,codigo_protheus text,colour_index text);
create table precos(produto_id uuid,faixa_1 numeric);
create table chegadas(produto_id uuid,quantidade_prevista numeric);
create function consultar_previsoes_disponiveis_produto(uuid) returns table(quantidade_prevista numeric) language sql as $$select quantidade_prevista from public.chegadas where produto_id=$1$$;
create table saldos(produto_id uuid,disponivel numeric);
create function consultar_disponibilidade_produto(uuid) returns table(disponivel numeric) language sql as $$select disponivel from public.saldos where produto_id=$1$$;
grant select on all tables in schema public to authenticated;`)
const sql=await readFile(new URL('../supabase/migrations/20261021135320_cotacao_lista_selecao_estoque.sql',import.meta.url),'utf8')
await db.exec(sql.slice(sql.indexOf('create or replace function public.buscar_produtos_cotacao_estoque')))
await db.query("insert into usuarios values($1,true,'VENDEDOR',$2),($3,true,'ADMIN',null),($4,false,'ADMIN',null)",[id(1),id(2),id(3),id(4)])
await db.query('insert into clientes values($1,true,$2),($3,true,$4)',[id(5),id(2),id(6),id(7)])
await db.query('insert into prazos_pagamento values($1,true),($2,true)',[id(8),id(9)])
await db.query("insert into cotacoes values($1,$2,$3,'2026-10-01'),($4,$2,$5,'2026-10-02')",[id(10),id(5),id(8),id(11),id(9)])
for(let n=20;n<81;n++) {
 await db.query('insert into produtos values($1,true,$2,$3,null)',[id(n),'Azul Net',`AZ${n}`])
 await db.query('insert into saldos values($1,$2)',[id(n),n>=79?10:0])
}
await db.query('insert into chegadas values($1,25)',[id(78)])
async function actor(n:number){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);await db.exec('set role authenticated')}
test('Busca inclui importação sem estoque, aplica filtro antes do limite e mantém variantes',async()=>{
 await actor(1);const rows=(await db.query<any>("select buscar_produtos_cotacao_estoque('Azul') p")).rows
 assert.deepEqual(rows.map(r=>r.p.codigo_protheus),['AZ78','AZ79','AZ80'])
 assert.equal((await db.query("select buscar_produtos_cotacao_estoque('Z')")).rows.length,0)
})
test('Último prazo é recuperado por cliente, respeitando carteira e usuário ativo',async()=>{
 await actor(1);assert.equal((await db.query<any>('select ultimo_prazo_cliente($1) prazo',[id(5)])).rows[0].prazo,id(9))
 await assert.rejects(()=>db.query('select ultimo_prazo_cliente($1)',[id(6)]),/carteira/)
 await actor(3);assert.equal((await db.query<any>('select ultimo_prazo_cliente($1) prazo',[id(6)])).rows[0].prazo,null)
 await actor(4);await assert.rejects(()=>db.query('select ultimo_prazo_cliente($1)',[id(5)]),/ativo/)
 await db.exec('reset role;set role anon');await assert.rejects(()=>db.query("select buscar_produtos_cotacao_estoque('Azul')"),/permission/)
})

