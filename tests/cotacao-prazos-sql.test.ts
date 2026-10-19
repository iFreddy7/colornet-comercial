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
const migration=await readFile(new URL('../supabase/migrations/20261007192607_cotacao_prazo_entrega_validade_ptax_email.sql',import.meta.url),'utf8')
await db.exec(migration)
const date=(await db.query<any>("select (now() at time zone 'America/Sao_Paulo')::date::text d")).rows[0].d
const plus=(n:number)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
async function create(n:number,prazo:any='10 dias úteis',dias=30){
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(2)]);await db.exec('set role authenticated')
 try{return (await db.query<any>('select private.criar_cotacao_v3_impl($1,$2,$3) r',[{titulo:'Prazo teste',cliente_id:id(6),filial_id:id(12),moeda:'USD',validade:plus(dias),prazo_pagamento_id:id(16)},[{produto_id:id(9),quantidade:25,preco_net:25.05,prazo_entrega:prazo}],id(n)])).rows[0].r}
 finally{await db.exec('reset role')}
}
test('Prazo por item é persistido no snapshot e repetição não muda a proposta',async()=>{
 await db.exec(migration);const q=await create(100),r=await create(100,'30 dias corridos')
 assert.equal(q.id,r.id)
 const doc=(await db.query<any>('select documento from cotacoes where id=$1',[q.id])).rows[0].documento
 assert.equal(doc.itens[0].prazo_entrega,'10 dias úteis');assert.equal(doc.validade,plus(30))
 assert.equal(preencherFiliaisCotacao(doc,[]).itens[0].prazo_entrega,'10 dias úteis')
})
test('Servidor recusa validade acima de 30 dias, passada e prazo inválido',async()=>{
 await assert.rejects(()=>create(110,'Pronta entrega',31),/30 dias/)
 await assert.rejects(()=>create(111,'Pronta entrega',-1),/passado/)
 for(const prazo of ['',null,123,'x'.repeat(121)])await assert.rejects(()=>create(112,prazo),/prazo de entrega/)
 assert.equal((await db.query<any>('select count(*) n from cotacoes')).rows[0].n,1)
})
test('PTAX faturamento fica separada, fixa após definir e só servidor registra',async()=>{
 await db.query('insert into pedidos(id,created_at) values($1,$2)',[id(200),'2026-10-07T18:00:00Z'])
 await db.exec('set role authenticated');await assert.rejects(()=>db.query('select public.registrar_ptax_faturamento($1,$2,$3)',[id(200),5,'2026-10-07']),/permission denied/);await db.exec('reset role')
 const rpc=async(v:number|null,ref:string|null)=>(await db.query<any>('select public.registrar_ptax_faturamento($1,$2,$3) r',[id(200),v,ref])).rows[0].r
 assert.equal((await rpc(null,null)).status,'PENDENTE');await assert.rejects(()=>rpc(5,'2026-10-08'),/inválida/)
 let r=await rpc(5.1234,'2026-10-07');assert.equal(r.valor,5.1234);assert.equal(r.criterio,'APOS_14H')
 r=await rpc(6,'2026-10-07');assert.equal(r.valor,5.1234)
})
test.after(async()=>{await db.close()})
