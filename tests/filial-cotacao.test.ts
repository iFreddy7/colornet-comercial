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
async function actor(n=2){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);await db.exec('set role authenticated')}
async function calc(branch:number|null,product=9,net:number|null=25.05,final:number|null=null){return (await db.query<any>('select public.calcular_preco_comercial($1,$2,$3,$4,$5,true) r',[id(6),id(product),branch===null?null:id(branch),net,final])).rows[0].r}
const header={titulo:'Filial escolhida',cliente_id:id(6),filial_id:id(12),moeda:'USD',validade:'2099-12-31',prazo_pagamento_id:id(16)}
async function create(key:number,branch:number|null=12,product=9,confirmed?:any){
 return (await db.query<any>('select private.criar_cotacao_v3_impl($1,$2,$3) r',[{...header,filial_id:branch===null?null:id(branch)},[{produto_id:id(product),quantidade:25,preco_net:25.05,calculo_confirmado:confirmed}],id(key)])).rows[0].r
}
test('Cotação respeita filial escolhida mesmo quando outra unidade possui maior saldo',async()=>{
 await actor();assert.equal((await calc(12)).filial_origem_id,id(12));assert.equal((await calc(12)).aliquota,.18)
 assert.equal((await calc(7)).filial_origem_id,id(7));assert.equal((await calc(null)).filial_origem_id,id(7))
 assert.equal((await calc(17)).filial_origem_id,id(17)) // faturamento não exige saldo imediato
})
test('Filial inválida/inativa e cliente de outra carteira são rejeitados',async()=>{
 await actor();for(const b of [18,99]) {await assert.rejects(()=>calc(b),/filial/);await assert.rejects(()=>create(30+b,b),/filial/)}
 await actor(3);await assert.rejects(()=>calc(12),/carteira/);await assert.rejects(()=>create(33),/carteira/)
 await actor(14);await assert.rejects(()=>calc(12),/ativo/)
})
test('Gravação preserva filial no cabeçalho, no documento, no PDF e no início da conversão',async()=>{
 await actor();const preview=await calc(12), created=await create(40,12,9,preview), again=await create(40,12,9,preview)
 assert.equal(created.id,again.id)
 await db.exec('reset role');const q=(await db.query<any>('select * from cotacoes where id=$1',[created.id])).rows[0]
 assert.equal(q.filial_id,id(12));assert.equal(q.documento.filial.id,id(12));assert.equal(q.documento.itens[0].filial_origem_id,id(12))
 assert.equal(q.documento.itens[0].preco_final,preview.preco_final)
 const branches=[{id:id(12),codigo:'0103',nome:'MAUÁ',uf:'SP'}]
 const pdf:any=preencherFiliaisCotacao(q.documento,branches)
 assert.equal(pdf.filiais_faturamento[0].nome,'Filial-Mauá');assert.equal(pdf.filiais_faturamento[0].cnpj,'01.382.160/0003-77')
 assert.equal(dadosIniciaisConversao(q,branches).filialId,id(12));assert.equal(valoresAprovados(q.documento.itens[0],'25').final,preview.preco_final)
})
test('Preço inverso usa a filial escolhida e confirmação fiscal divergente bloqueia gravação',async()=>{
 await actor();const final=await calc(12,9,null,30);assert.equal(final.preco_final,30);assert.equal(final.preco_net,22.326)
 const wrong=await calc(7);await assert.rejects(()=>create(41,12,9,wrong),/regra fiscal mudou/)
})
test('Cliente legado sem filial mantém a escolha por estoque, sem modificar registros antigos',async()=>{
 await actor();const legacy=await create(42,null);await db.exec('reset role');const q=(await db.query<any>('select * from cotacoes where id=$1',[legacy.id])).rows[0]
 assert.equal(q.filial_id,null);assert.equal(q.documento.filial,undefined);assert.equal(q.documento.itens[0].filial_origem_id,id(7))
})
