import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite(), id = (n:number) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
await db.exec(`create schema auth; create schema private; create role anon; create role authenticated;
grant usage on schema public,auth to authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table usuarios(id uuid primary key,perfil text,ativo boolean);
create table pedidos(id uuid primary key default gen_random_uuid(),numero text,header jsonb,items jsonb);
create table cotacoes(id uuid primary key,numero text,created_by uuid,cliente_id uuid,vendedor_id uuid,moeda text,validade date,documento jsonb);
create table filiais(id uuid primary key,ativo boolean); create table prazos_pagamento(like filiais including all); create table fretes(like filiais including all); create table produtos(like filiais including all);
create table pedido_idempotencia(chave uuid primary key,pedido_id uuid);
create table reserves(pedido_id uuid,quantidade numeric);
create function private.calcular_item_pedido_impl(uuid,uuid,uuid,numeric) returns jsonb language sql as $$select jsonb_build_object('automatico',$2<>'${id(9)}','preco_final',round($4/0.8,2),'ipi',0.065,'divisor',case when $2='${id(9)}' then null else 0.8 end)$$;
create function private.criar_pedido_v4_impl(jsonb,jsonb,uuid) returns jsonb language plpgsql as $$declare pid uuid;begin
insert into public.pedidos(numero,header,items) values('PED-TESTE',$1,$2) returning id into pid;
insert into public.pedido_idempotencia values($3,pid);insert into public.reserves select pid,sum((x->>'quantidade')::numeric) from jsonb_array_elements($2) x;
if $1->>'observacoes' like '%FORCAR_FALHA%' then raise exception 'falha posterior à reserva';end if;
return jsonb_build_object('pedido_id',pid,'numero','PED-TESTE');end$$;
insert into usuarios values('${id(1)}','VENDEDOR',true),('${id(2)}','VENDEDOR',true),('${id(3)}','ADMIN',true),('${id(4)}','ADMIN',false);
insert into filiais values('${id(5)}',true);insert into prazos_pagamento values('${id(6)}',true);insert into fretes values('${id(7)}',true);insert into produtos values('${id(8)}',true),('${id(9)}',true);
`)
const migration = await readFile(new URL('../supabase/migrations/20260924121003_converter_cotacao_pedido.sql',import.meta.url),'utf8')
await db.exec(migration)
const header={cliente_id:id(10),moeda:'USD',filial_id:id(5),prazo_pagamento_id:id(6),frete_id:id(7)}
const item=(manual=false)=>({produto_id:id(manual?9:8),quantidade:25,preco_final_manual:31.25,observacao_preco:manual?'Aprovado':'',calculo_confirmado:{automatico:!manual,preco_net:25,preco_final:31.25,ipi:0.065,divisor:manual?null:0.8}})
async function actor(n=1,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);await db.exec(`set role ${role}`)}
async function quote(n:number,manual=false,days=7){await db.exec('reset role');await db.query("insert into cotacoes values($1,'COT-TESTE',$2,$3,$4,'USD',current_date+$5::integer,$6)",[id(n),id(1),id(10),id(11),days,JSON.stringify({itens:[{produto_id:id(manual?9:8),preco_net:25,quantidade:null}]})]);await actor()}
async function convert(n:number,items:unknown[]=[item()],cab=header){return (await db.query<{r:any}>('select public.converter_cotacao_pedido($1,$2,$3) r',[id(n),JSON.stringify(cab),JSON.stringify(items)])).rows[0].r}
test('Invocação autenticada funciona sem acesso ao schema privado e não altera a proposta',async()=>{await quote(20);const result=await convert(20);await db.exec('reset role');const q=(await db.query<any>('select * from cotacoes where id=$1',[id(20)])).rows[0];assert.equal(q.pedido_convertido_id,result.pedido_id);assert.equal(q.documento.itens[0].quantidade,null);const p=(await db.query<any>('select * from pedidos where id=$1',[result.pedido_id])).rows[0];assert.equal(p.items[0].preco_net,25);assert.equal(p.items[0].quantidade,25)})
test('Reenvio retorna o mesmo pedido e não repete a reserva, mesmo após vencer',async()=>{await actor();const first=await convert(20);await db.exec('reset role');await db.query('update cotacoes set validade=current_date-1 where id=$1',[id(20)]);await actor();const retry=await convert(20);assert.equal(first.pedido_id,retry.pedido_id);assert.equal(retry.duplicado_bloqueado,true);await db.exec('reset role');assert.equal((await db.query<any>('select count(*)::int n from reserves where pedido_id=$1',[first.pedido_id])).rows[0].n,1)})
test('Outros vendedores, inativos e anônimos não convertem',async()=>{await quote(21);await actor(2);await assert.rejects(()=>convert(21),/permissão/);await actor(4);await assert.rejects(()=>convert(21),/inativo/);await actor(1,'anon');await assert.rejects(()=>convert(21),/permission denied/);await actor(3);assert.ok((await convert(21)).pedido_id)})
test('Cotação vencida, quantidade ausente ou inválida e item trocado são rejeitados',async()=>{await quote(22,false,-2);await assert.rejects(()=>convert(22),/vencida/);await quote(23);for(const quantidade of [null,0,-1,'NaN','Infinity'])await assert.rejects(()=>convert(23,[{...item(),quantidade}]),/quantidade/);await assert.rejects(()=>convert(23,[{...item(),produto_id:id(9)}]),/produtos/);await assert.rejects(()=>convert(23,[]),/itens/);await assert.rejects(()=>convert(23,[item()],{...header,moeda:'BRL'}),/moeda/);await assert.rejects(()=>convert(23,[item()],{...header,filial_id:id(99)}),/filial/)})
test('Cálculo alterado ou não confirmado exige nova revisão sem criar pedido',async()=>{await quote(24);for(const change of [{preco_final:30},{preco_net:24},{ipi:0},{divisor:1},{automatico:false}])await assert.rejects(()=>convert(24,[{...item(),calculo_confirmado:{...item().calculo_confirmado,...change}}]),/cálculo fiscal mudou/);await assert.rejects(()=>convert(24,[{...item(),calculo_confirmado:null}]),/cálculo fiscal mudou/);await db.exec('reset role');assert.equal((await db.query<any>('select count(*)::int n from pedido_idempotencia where chave=$1',[id(24)])).rows[0].n,0)})
test('Preço manual exige aprovação e preserva final explicitamente revisado',async()=>{await quote(25,true);await assert.rejects(()=>convert(25,[{...item(true),observacao_preco:''}]),/aprovação/);assert.ok((await convert(25,[item(true)])).pedido_id)})
test('Falha posterior à reserva desfaz pedido, movimentos, chave e vínculo',async()=>{await quote(26);await db.exec('reset role');const before=(await db.query<any>('select count(*)::int n from pedidos')).rows[0].n;await actor();await assert.rejects(()=>convert(26,[item()],{...header,observacoes:'FORCAR_FALHA'} as typeof header),/falha posterior/);await db.exec('reset role');assert.equal((await db.query<any>('select count(*)::int n from pedidos')).rows[0].n,before);assert.equal((await db.query<any>('select pedido_convertido_id from cotacoes where id=$1',[id(26)])).rows[0].pedido_convertido_id,null);assert.equal((await db.query<any>('select count(*)::int n from pedido_idempotencia where chave=$1',[id(26)])).rows[0].n,0)})
