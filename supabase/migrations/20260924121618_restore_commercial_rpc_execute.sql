-- Resolve private calls at definition time; keep private schema inaccessible.
-- These implementations enforce active identity and customer ownership.
grant execute on function private.calcular_item_pedido_impl(uuid,uuid,uuid,numeric) to authenticated;
grant execute on function private.calcular_preco_comercial_impl(uuid,uuid,uuid,numeric,numeric,boolean) to authenticated;
grant execute on function private.criar_cotacao_v4_impl(jsonb,jsonb,uuid) to authenticated;
revoke all on function private.calcular_item_pedido_impl(uuid,uuid,uuid,numeric), private.calcular_preco_comercial_impl(uuid,uuid,uuid,numeric,numeric,boolean), private.criar_cotacao_v4_impl(jsonb,jsonb,uuid) from public,anon;
create or replace function public.calcular_item_pedido(p_cliente_id uuid,p_produto_id uuid,p_filial_id uuid,p_preco_net numeric)
returns jsonb language sql security invoker set search_path=''
begin atomic
 select private.calcular_item_pedido_impl(p_cliente_id,p_produto_id,p_filial_id,p_preco_net);
end;
create or replace function public.calcular_preco_comercial(p_cliente_id uuid,p_produto_id uuid,p_filial_id uuid,p_preco_net numeric,p_preco_final numeric,p_cotacao boolean)
returns jsonb language sql security invoker set search_path=''
begin atomic
 select private.calcular_preco_comercial_impl(p_cliente_id,p_produto_id,p_filial_id,p_preco_net,p_preco_final,p_cotacao);
end;
create or replace function public.criar_cotacao_v4(p_cabecalho jsonb,p_itens jsonb,p_idempotency_key uuid)
returns jsonb language sql security invoker set search_path=''
begin atomic
 select private.criar_cotacao_v4_impl(p_cabecalho,p_itens,p_idempotency_key);
end;
revoke all on function public.calcular_item_pedido(uuid,uuid,uuid,numeric), public.calcular_preco_comercial(uuid,uuid,uuid,numeric,numeric,boolean), public.criar_cotacao_v4(jsonb,jsonb,uuid) from public,anon;
grant execute on function public.calcular_item_pedido(uuid,uuid,uuid,numeric), public.calcular_preco_comercial(uuid,uuid,uuid,numeric,numeric,boolean), public.criar_cotacao_v4(jsonb,jsonb,uuid) to authenticated;
