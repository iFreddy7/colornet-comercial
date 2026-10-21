import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import { preencherFiliaisCotacao } from '../src/lib/filiaisFaturamento.ts'
import { dadosIniciaisConversao, valoresAprovados } from '../src/lib/conversaoCotacao.ts'
const db=new PGlite(),id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;
grant usage on schema public,auth,private to authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table usuarios(id uuid primary key,perfil text,vendedor_id uuid,ativo boolean);
create table vendedores(id uuid primary key,nome text,ativo boolean);
create table clientes(id uuid primary key,codigo text,razao_social text,cnpj_cpf text,municipio text,uf text,vendedor_id uuid,ativo boolean);
create table filiais(id uuid primary key,nome text,codigo text,uf text,ativo boolean);
create table produtos(id uuid primary key,codigo_protheus text,nome text,ncm text,ipi numeric,ativo boolean);
create table estoque(produto_id uuid,filial_id uuid,quantidade numeric,reservado numeric default 0);
create function public.consultar_disponibilidade_produto(p_produto_id uuid) returns table(filial_id uuid,filial_codigo text,disponivel numeric) language sql as $$
 select f.id,f.codigo,greatest(e.quantidade-e.reservado,0) from public.estoque e join public.filiais f on f.id=e.filial_id where e.produto_id=p_produto_id and f.ativo $$;
create function public.calcular_item_pedido(uuid,uuid,uuid,numeric) returns jsonb language plpgsql as $$
declare taxa numeric;divisor numeric;
begin
 if $2='${id(8)}' then return jsonb_build_object('automatico',false,'ipi',.065,'motivo','Manual');end if;
 taxa:=case when $3='${id(12)}' then .18 when $2='${id(10)}' then .12 when $2='${id(15)}' then .07 else .04 end;
 divisor:=case taxa when .18 then .7442 when .12 then .7986 when .07 then .8440 else .8712 end;
 return jsonb_build_object('automatico',true,'preco_final',round($4/divisor,2),'aliquota',taxa,'divisor',divisor,'ipi',.065);
end $$;
grant select on usuarios to authenticated;
insert into usuarios values('${id(1)}','ADMIN',null,true),('${id(2)}','VENDEDOR','${id(4)}',true),('${id(3)}','VENDEDOR','${id(5)}',true),('${id(14)}','ADMIN',null,false);
insert into vendedores values('${id(4)}','Vendedor A',true),('${id(5)}','Vendedor B',true);
insert into clientes values('${id(6)}','00001','Cliente A','00123456000199','São Paulo','SP','${id(4)}',true);
insert into filiais values('${id(7)}','SC - ITAJAÍ','0102','SC',true),('${id(12)}','MAUÁ','0103','SP',true);
insert into produtos values('${id(8)}','MAN','Manual','32129010',.065,true),('${id(9)}','IMPORT','Importado','32129010',.065,true),('${id(10)}','NACIONAL','Nacional','32129010',.065,true),('${id(11)}','SP','Produto SP','32129010',.065,true),('${id(15)}','SETE','Produto 7','32129010',0,true);
insert into estoque values('${id(9)}','${id(7)}',100,0),('${id(9)}','${id(12)}',80,0),('${id(10)}','${id(7)}',200,0),('${id(11)}','${id(12)}',300,0),('${id(15)}','${id(7)}',20,0);`)
await db.exec(await readFile(new URL('../supabase/migrations/20260916153149_cotacoes_listas_preco.sql',import.meta.url),'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20260916155712_cotacao_origem_precos_inversos.sql',import.meta.url),'utf8'))
await db.exec(`create table prazos_pagamento(id uuid primary key,codigo text,descricao text,ativo boolean);
insert into prazos_pagamento values('${id(16)}','30','30 DIAS',true);
alter table cotacoes add column validade date,add column prazo_pagamento_id uuid;
insert into filiais values('${id(17)}','SP - MATRIZ','0101','SP',true),('${id(18)}','INATIVA','0999','SP',false);`)
await db.exec(await readFile(new URL('../supabase/migrations/20260928125350_filial_faturamento_cotacao.sql',import.meta.url),'utf8'))

await db.exec(`create role service_role; create table pedidos(id uuid primary key,created_at timestamptz);`)
const source=await readFile(new URL('../supabase/migrations/20261021135320_cotacao_lista_selecao_estoque.sql',import.meta.url),'utf8')
await db.exec(source.slice(source.indexOf('CREATE OR REPLACE FUNCTION private.criar_cotacao_v3_impl'),source.indexOf('CREATE OR REPLACE FUNCTION private.converter_cotacao_pedido_impl')))
await db.exec(source.slice(source.indexOf('create or replace function private.validar_nova_cotacao_prazos'),source.indexOf('create or replace function public.buscar_produtos_cotacao_estoque')))
await db.exec('create trigger trg_validar_nova_cotacao_prazos before insert on cotacoes for each row execute function private.validar_nova_cotacao_prazos()')
const date=(await db.query<any>("select (now() at time zone 'America/Sao_Paulo')::date::text d")).rows[0].d
async function create(n:number,tipo:string,quantidade:any,entrega:any='') {
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(2)]);await db.exec('set role authenticated')
 try { return (await db.query<any>('select private.criar_cotacao_v3_impl($1,$2,$3) r',[{titulo:'Teste',tipo_documento:tipo,cliente_id:id(6),filial_id:id(12),moeda:'USD',validade:date,prazo_pagamento_id:id(16)},[{produto_id:id(9),quantidade,preco_net:25.05,prazo_entrega:entrega}],id(n)])).rows[0].r }
 finally {await db.exec('reset role')}
}
test('Cotação exige quantidade; lista permite vazio e ambas permitem entrega vazia',async()=>{
 await assert.rejects(()=>create(900,'COTACAO',null),/quantidade/)
 assert.ok((await create(901,'LISTA_PRECOS',null)).id)
 const q=await create(902,'COTACAO',25)
 const d=(await db.query<any>('select documento from cotacoes where id=$1',[q.id])).rows[0].documento
 assert.equal(d.tipo_documento,'COTACAO');assert.equal(d.itens[0].prazo_entrega,'')
})
test('Entrega aceita data válida e rejeita texto e datas inexistentes',async()=>{
 assert.ok((await create(903,'LISTA_PRECOS',null,date)).id)
 await assert.rejects(()=>create(904,'LISTA_PRECOS',null,'10 dias'),/Data de entrega/)
 await assert.rejects(()=>create(905,'LISTA_PRECOS',null,'2026-02-30'))
 await assert.rejects(()=>create(906,'OUTRO',10),/Tipo de documento/)
})

