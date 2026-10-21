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
insert into usuarios values('${id(1)}','VENDEDOR',true),('${id(2)}','VENDEDOR',true),('${id(3)}','ADMIN',true),('${id(4)}','ADMIN',false);
insert into filiais values('${id(5)}',true);insert into prazos_pagamento values('${id(6)}',true);insert into fretes values('${id(7)}',true);insert into produtos values('${id(8)}',true),('${id(9)}',true);
`)
const migration = await readFile(new URL('../supabase/migrations/20260924121003_converter_cotacao_pedido.sql',import.meta.url),'utf8')
await db.exec(migration)
await db.exec(await readFile(new URL('../supabase/migrations/20260925134514_gestao_comercial_conversao_cotacao.sql',import.meta.url),'utf8'))
await db.exec("alter table cotacoes add column aprovacao_status text not null default 'APROVADA'")
await db.exec(await readFile(new URL('../supabase/migrations/20260925150446_exigir_aprovacao_conversao.sql',import.meta.url),'utf8'))
await db.exec(await readFile(new URL('./fixtures/order-schema.sql',import.meta.url),'utf8'))
await db.exec(await readFile(new URL('./fixtures/order-creation-before-approved-conversion.sql',import.meta.url),'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20260925162819_preservar_cotacao_aprovada_no_pedido.sql',import.meta.url),'utf8'))
const updated = await readFile(new URL('../supabase/migrations/20261021135320_cotacao_lista_selecao_estoque.sql',import.meta.url),'utf8')
for (const name of ['converter_cotacao_pedido_impl', 'criar_pedido_cotacao_impl']) {
  const match = updated.match(new RegExp('CREATE OR REPLACE FUNCTION private\\.' + name + '\\([\\s\\S]*?\\$function\\$\\s*;'))
  assert.ok(match); await db.exec(match[0])
}
await db.exec('create trigger fail_after_reservation before update on cotacoes for each row execute function public.fail_after_reservation()')
await db.query('update usuarios set vendedor_id=$1',[id(11)])
await db.query('insert into clientes values($1,true,$2)',[id(10),id(11)])
await db.query("insert into estoque values($1,$2,1000,now()-interval '1 day')",[id(8),id(5)])
const header={cliente_id:id(10),moeda:'USD',filial_id:id(5),prazo_pagamento_id:id(6),frete_id:id(7)}
const item=(manual=false)=>({produto_id:id(manual?9:8),quantidade:25})
async function actor(n=1,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);await db.exec(`set role ${role}`)}
async function quote(n:number,manual=false,days=7){await db.exec('reset role');await db.query("insert into cotacoes(id,numero,created_by,cliente_id,vendedor_id,moeda,validade,documento) values($1,'COT-TESTE',$2,$3,$4,'USD',current_date+$5::integer,$6)",[id(n),id(1),id(10),id(11),days,JSON.stringify({itens:[{produto_id:id(manual?9:8),preco_net:25.1234,preco_final:30.12,ipi:0.05,aliquota_icms:0.04,quantidade:null,observacao_preco:manual?'Aprovado na cotação':null,fiscal:{automatico:!manual,divisor:0.8712,regra:'COTAÇÃO'}}]})]);await actor()}
async function convert(n:number,items:unknown[]=[item()],cab=header){return (await db.query<{r:any}>('select public.converter_cotacao_pedido($1,$2,$3) r',[id(n),JSON.stringify(cab),JSON.stringify(items)])).rows[0].r}
test('Invocação autenticada funciona sem acesso ao schema privado e não altera a proposta',async()=>{await quote(20);const result=await convert(20);await db.exec('reset role');const q=(await db.query<any>('select * from cotacoes where id=$1',[id(20)])).rows[0];assert.equal(q.pedido_convertido_id,result.pedido_id);assert.equal(q.documento.itens[0].quantidade,null);const p=(await db.query<any>('select * from pedidos where id=$1',[result.pedido_id])).rows[0];const line=(await db.query<any>('select * from pedido_itens where pedido_id=$1',[p.id])).rows[0];assert.equal(Number(line.preco_net),25.1234);assert.equal(Number(line.preco_final),30.12);assert.equal(Number(line.ipi),0.05);assert.equal(Number(line.quantidade),25);assert.equal(Number(p.total),790.65)})
test('Pendentes e reprovadas não geram pedido nem reserva, mesmo com chamada direta por Admin',async()=>{
  await quote(28)
  for(const status of ['PENDENTE','REPROVADA']) {
    await db.exec('reset role');await db.query('update cotacoes set aprovacao_status=$1 where id=$2',[status,id(28)])
    const antes=(await db.query<any>('select count(*)::int n from pedidos')).rows[0].n
    await actor(3);await assert.rejects(()=>convert(28),/precisa ser aprovada/)
    await db.exec('reset role');assert.equal((await db.query<any>('select count(*)::int n from pedidos')).rows[0].n,antes)
    assert.equal((await db.query<any>('select count(*)::int n from pedido_idempotencia where chave=$1',[id(28)])).rows[0].n,0)
  }
  await db.query("update cotacoes set aprovacao_status='APROVADA' where id=$1",[id(28)]);await actor();assert.ok((await convert(28)).pedido_id)
})
test('Gerente e Diretor convertem propostas de outro vendedor, mas inativos não',async()=>{
  for (const [n,perfil] of [[30,'GERENTE'],[31,'DIRETOR']] as const) {
    await quote(n); await db.exec('reset role')
    await db.query('insert into usuarios(id,perfil,ativo,vendedor_id) values($1,$2,true,null)',[id(n+100),perfil])
    await actor(n+100); assert.ok((await convert(n)).pedido_id)
    await quote(n+10); await db.exec('reset role')
    await db.query('update usuarios set ativo=false where id=$1',[id(n+100)])
    await actor(n+100); await assert.rejects(()=>convert(n+10),/inativo/)
  }
})
test('Reenvio retorna o mesmo pedido e não repete a reserva, mesmo após vencer',async()=>{await actor();const first=await convert(20);await db.exec('reset role');await db.query('update cotacoes set validade=current_date-1 where id=$1',[id(20)]);await actor();const retry=await convert(20);assert.equal(first.pedido_id,retry.pedido_id);assert.equal(retry.duplicado_bloqueado,true);await db.exec('reset role');assert.equal((await db.query<any>('select count(*)::int n from movimentos_estoque where pedido_id=$1',[first.pedido_id])).rows[0].n,1)})
test('Outros vendedores, inativos e anônimos não convertem',async()=>{await quote(21);await actor(2);await assert.rejects(()=>convert(21),/permissão/);await actor(4);await assert.rejects(()=>convert(21),/inativo/);await actor(1,'anon');await assert.rejects(()=>convert(21),/permission denied/);await actor(3);assert.ok((await convert(21)).pedido_id)})
test('Cotação vencida, quantidade ausente ou inválida e item trocado são rejeitados',async()=>{await quote(22,false,-2);await assert.rejects(()=>convert(22),/vencida/);await quote(23);for(const quantidade of [null,0,-1,0.0001,'NaN','Infinity'])await assert.rejects(()=>convert(23,[{...item(),quantidade}]),/quantidade/);await assert.rejects(()=>convert(23,[{...item(),produto_id:id(9)}]),/produtos/);await assert.rejects(()=>convert(23,[]),/itens/);await assert.rejects(()=>convert(23,[item()],{...header,moeda:'BRL'}),/moeda/);await assert.rejects(()=>convert(23,[item()],{...header,filial_id:id(99)}),/filial/)})
test('Preços vêm da proposta aprovada sem recálculo, mesmo com valores forjados pelo navegador',async()=>{
  await quote(24);await db.exec('reset role');const before=(await db.query<any>('select count(*)::int n from calculation_calls')).rows[0].n;await actor()
  const result=await convert(24,[{produto_id:id(8),quantidade:25,preco_net:1,preco_final_manual:1}] as any)
  await db.exec('reset role');const line=(await db.query<any>('select * from pedido_itens where pedido_id=$1',[result.pedido_id])).rows[0]
  assert.equal(Number(line.preco_net),25.1234);assert.equal(Number(line.preco_final),30.12);assert.equal(Number(line.ipi),0.05)
  assert.equal((await db.query<any>('select count(*)::int n from calculation_calls')).rows[0].n,before)
})
test('Preço manual já aprovado preserva valor e observação originais, sem pedir nova aprovação',async()=>{
  await quote(25,true);const result=await convert(25,[{produto_id:id(9),quantidade:25}] as any);await db.exec('reset role')
  const line=(await db.query<any>('select * from pedido_itens where pedido_id=$1',[result.pedido_id])).rows[0]
  assert.equal(line.modo_fiscal,'MANUAL');assert.equal(Number(line.preco_final),30.12);assert.equal(line.observacao_preco,'Aprovado na cotação')
})
test('Falha posterior à reserva desfaz pedido, movimentos, chave e vínculo',async()=>{await quote(26);await db.exec('reset role');const before=(await db.query<any>('select count(*)::int n from pedidos')).rows[0].n;await actor();await assert.rejects(()=>convert(26,[item()],{...header,observacoes:'FORCAR_FALHA'} as typeof header),/falha posterior/);await db.exec('reset role');assert.equal((await db.query<any>('select count(*)::int n from pedidos')).rows[0].n,before);assert.equal((await db.query<any>('select pedido_convertido_id from cotacoes where id=$1',[id(26)])).rows[0].pedido_convertido_id,null);assert.equal((await db.query<any>('select count(*)::int n from pedido_idempotencia where chave=$1',[id(26)])).rows[0].n,0)})

test('Tela antiga com preço recalculado diferente precisa atualizar antes da conversão',async()=>{
  await quote(50);await assert.rejects(()=>convert(50,[{...item(),calculo_confirmado:{preco_net:25.1234,preco_final:99,ipi:0.15}}] as any),/Atualize a página/)
})
test('Conversão preserva vendedor original e dados de entrega preenchidos',async()=>{
  await quote(51);await db.exec('reset role');await db.query('update clientes set vendedor_id=$1 where id=$2',[id(12),id(10)]);await actor(3)
  try {
    const r=await convert(51,[item()],{...header,transportadora:'Transportadora',data_entrega:'2099-01-02',observacoes:'Condições aprovadas',observacoes_transporte:'Agendar'} as any)
    await db.exec('reset role');const p=(await db.query<any>('select * from pedidos where id=$1',[r.pedido_id])).rows[0]
    assert.equal(p.vendedor_id,id(11));assert.equal(p.transportadora,'Transportadora');assert.equal(new Date(p.data_entrega).toISOString().slice(0,10),'2099-01-02');assert.equal(p.observacoes_transporte,'Agendar');assert.match(p.observacoes,/Condições aprovadas/)
  } finally {await db.exec('reset role');await db.query('update clientes set vendedor_id=$1 where id=$2',[id(11),id(10)])}
})
test('Reserva imediata e futura continuam atômicas e respeitam o saldo',async()=>{
  await quote(52,true);await db.exec('reset role')
  await db.query("insert into estoque values($1,$2,10,now()-interval '1 day')",[id(9),id(5)])
  await db.query("insert into previsoes_estoque values($1,$2,current_date+1,'PROCESSO','PC','LOTE','Fornecedor',7,'ABERTO')",[id(9),id(5)])
  // Existing earlier manual-price order reserved zero before this ERP snapshot existed.
  await actor();const r=await convert(52,[{produto_id:id(9),quantidade:20}]);assert.equal(r.estoque.quantidade_reservada,10);assert.equal(r.previsao.quantidade_reservada,7);assert.equal(r.previsao.sem_cobertura,3)
  const retry=await convert(52);assert.equal(retry.pedido_id,r.pedido_id);await db.exec('reset role');assert.equal((await db.query<any>('select count(*)::int n from movimentos_previsao where pedido_id=$1',[r.pedido_id])).rows[0].n,1)
})
test('Snapshot sem preço ou IPI não cria pedido parcial',async()=>{
  await quote(53);await db.exec('reset role');await db.query("update cotacoes set documento=documento #- '{itens,0,ipi}' where id=$1",[id(53)]);await actor()
  await assert.rejects(()=>convert(53),/preços e impostos válidos/);await db.exec('reset role')
  assert.equal((await db.query<any>('select count(*)::int n from pedido_idempotencia where chave=$1',[id(53)])).rows[0].n,0)
})
test('Helpers aprovados não são executáveis por clientes e pedidos comuns continuam calculando',async()=>{
  await db.exec('reset role')
  for(const name of ['criar_pedido_cotacao_impl(jsonb,jsonb,uuid)','criar_pedido_cotacao_v3_impl(jsonb,jsonb,uuid,uuid)','criar_pedido_cotacao_v4_impl(jsonb,jsonb,uuid,uuid)']) {
    for(const role of ['authenticated','anon']) assert.equal((await db.query<any>("select has_function_privilege($1,$2,'EXECUTE') ok",[role,'private.'+name])).rows[0].ok,false)
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(1)])
  const normal=(await db.query<any>('select private.criar_pedido_v4_impl($1,$2,$3) r',[JSON.stringify({...header,cotacao_id:id(20),preservar_precos:true}),JSON.stringify([{produto_id:id(8),quantidade:10,preco_net:25,preco_final_manual:1}]),id(999)])).rows[0].r
  const line=(await db.query<any>('select * from pedido_itens where pedido_id=$1',[normal.pedido_id])).rows[0]
  assert.equal(Number(line.preco_final),99.99);assert.equal(Number(line.ipi),0.15)
})

test('Seleção parcial preserva o preço da linha original e reserva somente o selecionado',async()=>{
 await quote(80);await db.exec('reset role')
 await db.query("update cotacoes set documento=jsonb_set(documento,'{itens}',(documento->'itens') || jsonb_build_array(jsonb_set(documento->'itens'->0,'{preco_final}','44.55'::jsonb))) where id=$1",[id(80)])
 await actor()
 const result=await convert(80,[{produto_id:id(8),quantidade:2,item_indice:1}] as any)
 await db.exec('reset role')
 const rows=(await db.query<any>('select quantidade,preco_final from pedido_itens where pedido_id=$1',[result.pedido_id])).rows
 assert.equal(rows.length,1);assert.equal(Number(rows[0].quantidade),2);assert.equal(Number(rows[0].preco_final),44.55)
})
test('Conversão rejeita índices inexistentes e repetidos',async()=>{
 await quote(81);await actor()
 for(const itens of [[{produto_id:id(8),quantidade:1,item_indice:-1}],[{produto_id:id(8),quantidade:1,item_indice:99}],[{produto_id:id(8),quantidade:1,item_indice:0},{produto_id:id(8),quantidade:1,item_indice:0}]]) await assert.rejects(()=>convert(81,itens as any),/Seleção/)
})

