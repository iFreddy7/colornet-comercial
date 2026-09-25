create table clientes(id uuid primary key,ativo boolean,vendedor_id uuid);
alter table usuarios add column vendedor_id uuid;
alter table pedido_idempotencia add column created_by uuid;
alter table pedidos add column created_by uuid,add column vendedor_id uuid,add column cliente_id uuid,
  add column filial_id uuid,add column moeda text,add column prazo_pagamento_id uuid,add column frete_id uuid,
  add column transportadora text,add column data_entrega date,add column observacoes_transporte text,
  add column observacoes text,add column status text,add column subtotal numeric,add column valor_ipi numeric,
  add column total numeric,add column idempotency_key uuid;
create table pedido_itens(
  pedido_id uuid,produto_id uuid,quantidade numeric,preco_net numeric,preco_final numeric,
  aliquota_icms numeric,divisor_icms numeric,ipi numeric,valor_ipi numeric,subtotal numeric,total_item numeric,
  modo_fiscal text,regra_icms text,motivo_fiscal text,faixa_interna text,observacao_preco text);
create table estoque(produto_id uuid,filial_id uuid,quantidade numeric,atualizado_em timestamptz);
create table movimentos_estoque(
  pedido_id uuid,produto_id uuid,filial_id uuid,quantidade_solicitada numeric,quantidade numeric,tipo text,
  data_base_estoque timestamptz,saldo_antes numeric,saldo_depois numeric,created_by uuid,observacao text,
  chave_idempotencia text unique,criado_em timestamptz default now());
create table previsoes_estoque(produto_id uuid,filial_id uuid,previsao date,processo text,pedido_compra text,lote text,fornecedor text,quantidade numeric,status text);
create table movimentos_previsao(
  pedido_id uuid,produto_id uuid,filial_id uuid,chave_previsao text,quantidade numeric,tipo text,
  previsao_original date,processo text,pedido_compra text,fornecedor text,lote text,created_by uuid,
  observacao text,chave_idempotencia text unique,criado_em timestamptz default now());
create function private.chave_previsao_estoque(uuid,uuid,date,text,text,text,text) returns text language sql immutable
  as $$select concat_ws(':',$1,$2,$3,$4,$5,$6,$7)$$;
create sequence pedido_numero;
create function private.gerar_numero_pedido() returns text language sql as $$select 'PED-'||nextval('public.pedido_numero')$$;
create table calculation_calls(id integer);
create or replace function private.calcular_item_pedido_impl(uuid,uuid,uuid,numeric) returns jsonb language plpgsql as $$
begin
  insert into public.calculation_calls values(1);
  return jsonb_build_object('automatico',true,'preco_final',99.99,'ipi',0.15,'divisor',0.7);
end$$;
create function public.fail_after_reservation() returns trigger language plpgsql as $$
begin
  if exists(select 1 from public.pedidos where id=new.pedido_convertido_id and observacoes like '%FORCAR_FALHA%') then
    raise exception 'falha posterior à reserva';
  end if;
  return new;
end$$;
