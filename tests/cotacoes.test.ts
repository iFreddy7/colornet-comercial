import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;
grant usage on schema public,auth,private to authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table usuarios(id uuid primary key,perfil text,vendedor_id uuid,ativo boolean);
create table vendedores(id uuid primary key,nome text,ativo boolean);
create table clientes(id uuid primary key,codigo text,razao_social text,cnpj_cpf text,municipio text,uf text,vendedor_id uuid,ativo boolean);
create table filiais(id uuid primary key,nome text,uf text,ativo boolean);
create table produtos(id uuid primary key,codigo_protheus text,nome text,ncm text,ativo boolean);
create function public.calcular_item_pedido(uuid,uuid,uuid,numeric) returns jsonb language sql as $$select jsonb_build_object('automatico',$2<>'${id(8)}'::uuid,'preco_final',round($4/.8712,2),'aliquota',.04,'ipi',.065)$$;
grant select on usuarios to authenticated;
insert into usuarios values('${id(1)}','ADMIN',null,true),('${id(2)}','VENDEDOR','${id(4)}',true),('${id(3)}','VENDEDOR','${id(5)}',true);
insert into vendedores values('${id(4)}','Vendedor A',true),('${id(5)}','Vendedor B',true);
insert into clientes values('${id(6)}','00001','Cliente A','00123456000199','São Paulo','SP','${id(4)}',true);
insert into filiais values('${id(7)}','SC - ITAJAÍ','SC',true);
insert into produtos values('${id(8)}','MAN','Manual','32129010',true),('${id(9)}','AL031','SILVER NET','32129010',true);`)
const sql=await readFile(new URL('../supabase/migrations/20260916153149_cotacoes_listas_preco.sql',import.meta.url),'utf8');await db.exec(sql)
const cab={titulo:'Lista de preço cliente X - Setembro 2026',cliente_id:id(6),filial_id:id(7),moeda:'USD'}
const items=[{produto_id:id(9),quantidade:25,preco_net:25.05,preco_final:1,total_item:1}]
async function actor(n:number,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);await db.exec(`set role ${role}`)}
async function criar(key:number,c:any=cab,i:any=items){return (await db.query<{r:any}>('select public.criar_cotacao($1,$2,$3) r',[JSON.stringify(c),JSON.stringify(i),id(key)])).rows[0].r}
test('Recalcula no servidor, conserva preços e impede duplicidade',async()=>{await actor(2);const a=await criar(20),b=await criar(20);assert.equal(a.id,b.id);const q=(await db.query<{documento:any}>('select documento from cotacoes')).rows[0].documento;assert.equal(q.itens[0].preco_final,28.75);assert.equal(q.subtotal,718.75);assert.equal(q.valor_ipi,46.72);assert.equal(q.total,765.47)})
test('Outro vendedor não lê documento nem cria para carteira alheia',async()=>{await actor(3);assert.equal((await db.query('select * from cotacoes')).rows.length,0);await assert.rejects(()=>criar(21),/fora da carteira/)})
test('ADMIN consulta todos e pode criar',async()=>{await actor(1);assert.equal((await db.query('select * from cotacoes')).rows.length,1);await criar(22);assert.equal((await db.query('select * from cotacoes')).rows.length,2)})
test('Vendedor não vê cotação criada pelo ADMIN',async()=>{await actor(2);assert.equal((await db.query('select * from cotacoes')).rows.length,1)})
test('Ninguém escreve diretamente ou altera documento',async()=>{await actor(1);await assert.rejects(()=>db.exec("update cotacoes set titulo='forjado'"),/permission denied/);await assert.rejects(()=>db.exec('delete from cotacoes'),/permission denied/)})
test('Valida título, moeda, itens e números não finitos',async()=>{await actor(2);for(const c of [{...cab,titulo:''},{...cab,moeda:'EUR'}])await assert.rejects(()=>criar(23,c));for(const i of [[],[ {...items[0],quantidade:0} ],[ {...items[0],preco_net:'NaN'} ]])await assert.rejects(()=>criar(24,cab,i))})
test('Preço manual exige aprovação e preserva valor aprovado',async()=>{await actor(2);await assert.rejects(()=>criar(25,cab,[{...items[0],produto_id:id(8),preco_final_manual:30}]),/aprovação/);await criar(26,cab,[{...items[0],produto_id:id(8),preco_final_manual:30,observacao_preco:'Aprovado'}])})
test('Inativo não consulta ou cria',async()=>{await db.exec('reset role');await db.exec(`update usuarios set ativo=false where id='${id(2)}'`);await actor(2);assert.equal((await db.query('select * from cotacoes')).rows.length,0);await assert.rejects(()=>criar(27),/ativo obrigatório/)})
test('Anônimo não executa RPC',async()=>{await actor(3,'anon');await assert.rejects(()=>criar(28),/permission denied/);await db.exec('reset role')})
test('Migração não invoca criação de pedidos ou movimentação de estoque',()=>{assert.doesNotMatch(sql,/insert into public\.(pedidos|movimentos_estoque|movimentos_previsao)|criar_pedido_v[234]/i)})
