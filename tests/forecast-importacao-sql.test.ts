import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role;
grant usage on schema public,auth to authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table usuarios(id uuid primary key,perfil text,vendedor_id uuid,ativo boolean);
create table vendedores(id uuid primary key,ativo boolean);
create table clientes(id uuid primary key,vendedor_id uuid,ativo boolean);
create table produtos(id uuid primary key,ativo boolean);
create function private.has_commercial_overview() returns boolean language sql stable as $$select exists(select 1 from public.usuarios where id=auth.uid() and ativo and perfil in ('ADMIN','GERENTE','DIRETOR'))$$;
create function private.current_vendedor_id() returns uuid language sql stable as $$select vendedor_id from public.usuarios where id=auth.uid() and ativo$$;
insert into usuarios values('${id(1)}','ADMIN',null,true),('${id(2)}','VENDEDOR','${id(10)}',true),('${id(3)}','GERENTE',null,true),('${id(4)}','DIRETOR',null,true),('${id(5)}','ADMIN',null,false);
insert into vendedores values('${id(10)}',true);insert into clientes values('${id(20)}','${id(10)}',true),('${id(21)}','${id(10)}',true);insert into produtos values('${id(30)}',true);
grant select on usuarios,vendedores,clientes,produtos to authenticated;`)
for(const file of ['20261006144001_forecast_homologacao_supabase.sql','20261006144202_forecast_politicas_vendedor.sql','20261006144327_forecast_rpc_perfil_invoker.sql','20261007193037_forecast_importacao_admin.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
const plano=(revisao=0,quantidades:any={'2026-01':10},cliente=20)=>({cliente_id:id(cliente),vendedor_id:id(10),revisao,itens:[{produto_id:id(30),quantidades}]})
async function run(n:number,plans:any[],user=1){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(user)]);await db.exec('set role authenticated');try{return(await db.query<any>('select public.forecast_importar_v1($1,$2,$3) r',[id(n),'Teste.xlsx',plans])).rows[0].r}finally{await db.exec('reset role')}}
test('Importação exige ADMIN ativo no servidor',async()=>{for(const u of [2,3,4,5])await assert.rejects(()=>run(100,[plano()],u),/Somente ADMIN/);assert.equal((await db.query<any>('select count(*) n from forecast_planos')).rows[0].n,0)})
test('Importação preserva meses omitidos, aceita zero e é idempotente',async()=>{
 await run(101,[plano(0,{'2026-01':80,'2026-02':50,'2026-03':25})]);const plans=[plano(1,{'2026-02':0,'2026-03':12.5})];await run(102,plans);assert.equal((await run(102,plans)).ja_importado,true)
 const row=(await db.query<any>('select documento,revisao from forecast_planos')).rows[0];assert.deepEqual(row.documento[id(30)],{'2026-01':80,'2026-02':0,'2026-03':12.5});assert.equal(row.revisao,2)
 await assert.rejects(()=>run(102,[plano(2,{'2026-01':90})]),/outros dados/)
})
test('Conflito de revisão e arquivo com erro são atômicos',async()=>{
 await assert.rejects(()=>run(103,[plano(1)]),/mudou após/)
 await assert.rejects(()=>run(104,[plano(2,{'2026-01':999}),plano(0,{'2026-01':-1},21)]),/quantidade inválida/)
 assert.equal((await db.query<any>('select documento from forecast_planos')).rows[0].documento[id(30)]['2026-01'],80)
 assert.equal((await db.query<any>('select count(*) n from forecast_importacoes')).rows[0].n,2)
})
test('Carteira inválida e mês malformado não são aceitos',async()=>{
 await assert.rejects(()=>run(105,[{...plano(2),vendedor_id:id(11)}]),/carteira/)
 await assert.rejects(()=>run(106,[plano(2,{'2026-13':1})]),/quantidade inválida/)
})
test.after(()=>db.close())

