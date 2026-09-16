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
async function actor(n=2,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);await db.exec(`set role ${role}`)}
async function calc(product=9,net:number|null=25.05,final:number|null=null,quote=true,branch:number|null=null){return (await db.query<{r:any}>('select public.calcular_preco_comercial($1,$2,$3,$4,$5,$6) r',[id(6),id(product),branch==null?null:id(branch),net,final,quote])).rows[0].r}
const cab={titulo:'Lista sem quantidade',cliente_id:id(6),moeda:'USD'}
const item=(p=9,q:any=null)=>({produto_id:id(p),quantidade:q,preco_net:25.05})
async function criar(key:number,items:any[]=[item()]){const r=(await db.query<{r:any}>('select public.criar_cotacao_v2($1,$2,$3) r',[JSON.stringify(cab),JSON.stringify(items),id(key)])).rows[0].r;return (await db.query<{documento:any}>('select documento from cotacoes where id=$1',[r.id])).rows[0].documento}
test('Maior saldo escolhe SC 4%, SC 12% e SP 18% por item',async()=>{await actor();for(const [p,taxa,f] of [[9,.04,7],[10,.12,7],[11,.18,12]]){const c=await calc(p);assert.equal(c.aliquota,taxa);assert.equal(c.filial_origem_id,id(f))}})
test('Reservas afetam a escolha: maior saldo bruto não vence maior disponível',async()=>{await db.exec('reset role');await db.exec(`update estoque set reservado=50 where produto_id='${id(9)}' and filial_id='${id(7)}'`);await actor();assert.equal((await calc()).filial_origem_id,id(12));await db.exec('reset role');await db.exec('update estoque set reservado=0')})
test('Lista mista sem quantidade conserva null, NCM e Colour Index, sem totais inventados',async()=>{await actor(1);await db.query('select admin_definir_colour_index($1,$2)',[id(9),'Pigment Blue 15:3']);await actor();const d=await criar(20,[item(),item(10),item(11)]);assert.equal(d.filial,undefined);assert.equal(d.total,null);assert.equal(d.itens[0].quantidade,null);assert.equal(d.itens[0].total_item,null);assert.equal(d.itens[0].ncm,'32129010');assert.equal(d.itens[0].colour_index,'Pigment Blue 15:3');assert.equal(d.itens[1].colour_index,null);assert.deepEqual(d.itens.map((i:any)=>i.aliquota_icms),[.04,.12,.18])})
test('Quantidade parcial não soma preços unitários num total geral',async()=>{await actor();const d=await criar(21,[item(9,25),item(11)]);assert.equal(d.total,null);assert.equal(d.itens[0].total_item,765.47);assert.equal(d.itens[1].total_item,null)})
test('Quantidade em todos os itens preserva totais com IPI',async()=>{await actor();const d=await criar(22,[item(9,25)]);assert.equal(d.total,765.47);assert.equal(d.valor_ipi,46.72)})
test('Inverso usa divisores 4/7/12/18 e volta ao mesmo final após arredondar NET',async()=>{await actor();for(const [p,f,d] of [[9,7,.8712],[15,7,.8440],[10,7,.7986],[11,12,.7442]])for(const valor of [.01,28.75,123.45]){const c=await calc(p,null,valor,false,f);assert.equal(c.preco_final,valor);assert.equal(c.preco_net,Math.round(Math.round(valor*100)*Math.round(d*10000)/100)/10000);assert.equal(Number((c.preco_net/c.divisor).toFixed(2)),valor)}})
test('Pedido usa sua filial selecionada e cotação ignora filial do cabeçalho',async()=>{await actor();assert.equal((await calc(9,null,30,false,12)).aliquota,.18);assert.equal((await calc(9,null,30,true,12)).aliquota,.04)})
test('Gravação por preço final recalcula NET no servidor',async()=>{await actor();const d=await criar(23,[{...item(),preco_net:null,entrada_preco:'FINAL',preco_final:28.75}]);assert.equal(d.itens[0].preco_net,25.047);assert.equal(d.itens[0].preco_final,28.75)})
test('Sem estoque exige dois preços e aprovação manual; não inventa origem',async()=>{await actor();const c=await calc(8,null,30);assert.equal(c.automatico,false);assert.equal(c.filial_origem_id,null);await assert.rejects(()=>criar(24,[item(8)]),/aprovação/);const d=await criar(25,[{...item(8),preco_final_manual:30,observacao_preco:'Aprovado'}]);assert.equal(d.itens[0].filial_origem_id,null);assert.equal(d.itens[0].preco_final,30)})
test('Mudança entre prévia e gravação exige revisão e mantém a transação íntegra',async()=>{await actor();const c=await calc();const confirmado={automatico:c.automatico,filial_origem_id:id(12),preco_net:25.05,preco_final:c.preco_final,divisor:c.divisor};await assert.rejects(()=>criar(26,[{...item(),calculo_confirmado:confirmado}]),/Estoque ou regra fiscal mudou/)})
test('Reenvio idempotente não duplica cotação',async()=>{await actor();assert.equal((await criar(22,[item(9,25)])).numero,(await criar(22,[item(9,25)])).numero)})
test('Vendedor não altera Colour Index e carteira alheia não calcula',async()=>{await actor();await assert.rejects(()=>db.query('select admin_definir_colour_index($1,$2)',[id(9),'Outro']),/ADMIN/);await actor(3);await assert.rejects(()=>calc(),/carteira/)})
test('Inativo e anônimo não calculam nem criam',async()=>{await actor(14);await assert.rejects(()=>calc(),/ativo/);await actor(1,'anon');await assert.rejects(()=>calc(),/permission denied/);await assert.rejects(()=>criar(27),/permission denied/)})
test('Quantidade negativa, zero, NaN e preços inválidos são rejeitados',async()=>{await actor();for(const q of [0,-1,'NaN'])await assert.rejects(()=>criar(28,[item(9,q)]),/Quantidade/);for(const v of [0,-1,NaN])await assert.rejects(()=>calc(9,v));await assert.rejects(()=>calc(9,null,.001),/válido/)})
