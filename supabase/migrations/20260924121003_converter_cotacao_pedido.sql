-- Preserve the original quote and record its single order atomically.
alter table public.cotacoes
  add column if not exists pedido_convertido_id uuid references public.pedidos(id),
  add column if not exists convertida_em timestamptz;
create unique index if not exists cotacoes_pedido_convertido_uidx
  on public.cotacoes(pedido_convertido_id) where pedido_convertido_id is not null;

create or replace function private.converter_cotacao_pedido_impl(
  p_cotacao_id uuid, p_cabecalho jsonb, p_itens jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  u public.usuarios%rowtype;
  q public.cotacoes%rowtype;
  source_item jsonb; requested jsonb; calc jsonb; confirmed jsonb;
  items jsonb := '[]'::jsonb; result jsonb; header jsonb;
  branch_id uuid; quantity numeric; net numeric; final numeric; ipi numeric;
  approval text; idx integer; pid uuid;
begin
  select * into u from public.usuarios where id = (select auth.uid()) and ativo;
  if not found then raise exception 'Usuário não autenticado ou inativo.'; end if;
  select * into q from public.cotacoes where id = p_cotacao_id for update;
  if not found or (q.created_by <> u.id and u.perfil <> 'ADMIN') then
    raise exception 'Cotação não encontrada ou sem permissão.';
  end if;
  if q.pedido_convertido_id is not null then
    return (select jsonb_build_object('sucesso',true,'pedido_id',p.id,'numero',p.numero,
      'duplicado_bloqueado',true,'cotacao_numero',q.numero)
      from public.pedidos p where p.id=q.pedido_convertido_id);
  end if;
  if q.validade is null or q.validade < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Cotação vencida ou sem validade. Emita uma nova proposta antes de converter.';
  end if;
  if jsonb_typeof(p_cabecalho) is distinct from 'object' then raise exception 'Informe os dados do pedido.'; end if;
  if (p_cabecalho->>'cliente_id')::uuid is distinct from q.cliente_id
     or p_cabecalho->>'moeda' is distinct from q.moeda then
    raise exception 'Cliente e moeda devem corresponder à cotação.';
  end if;
  branch_id := nullif(p_cabecalho->>'filial_id','')::uuid;
  if not exists(select 1 from public.filiais where id=branch_id and ativo) then raise exception 'Selecione uma filial ativa.'; end if;
  if not exists(select 1 from public.prazos_pagamento where id=nullif(p_cabecalho->>'prazo_pagamento_id','')::uuid and ativo)
     or not exists(select 1 from public.fretes where id=nullif(p_cabecalho->>'frete_id','')::uuid and ativo) then
    raise exception 'Revise o prazo de pagamento e o frete.';
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_typeof(q.documento->'itens') is distinct from 'array' then
    raise exception 'Itens inválidos.';
  end if;
  if jsonb_array_length(p_itens)=0 or jsonb_array_length(p_itens)>500
     or jsonb_array_length(p_itens)<>jsonb_array_length(q.documento->'itens') then
    raise exception 'Revise todos os itens da cotação.';
  end if;
  -- The quote UUID is the server-owned idempotency key; never trust a new browser key.
  if exists(select 1 from public.pedido_idempotencia where chave=q.id) then
    raise exception 'Identificador já utilizado em outro pedido. Solicite revisão ao administrador.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('COLORNET_ESTOQUE_GLOBAL',0));
  for idx in 0..jsonb_array_length(p_itens)-1 loop
    source_item := q.documento->'itens'->idx;
    requested := p_itens->idx;
    if requested->>'produto_id' is distinct from source_item->>'produto_id' then raise exception 'Os produtos devem corresponder à cotação.'; end if;
    if not exists(select 1 from public.produtos where id=(source_item->>'produto_id')::uuid and ativo) then raise exception 'Há produto inativo ou indisponível.'; end if;
    quantity := nullif(requested->>'quantidade','')::numeric;
    net := nullif(source_item->>'preco_net','')::numeric;
    if quantity is null or not(quantity>0 and quantity<=1000000000)
      or net is null or not(net>0 and net<=1000000000) then raise exception 'Informe quantidade e preço válidos em todos os itens.'; end if;
    calc := private.calcular_item_pedido_impl(q.cliente_id,(source_item->>'produto_id')::uuid,branch_id,net);
    approval := nullif(trim(requested->>'observacao_preco'),'');
    ipi := coalesce((calc->>'ipi')::numeric,0);
    if not(ipi>=0 and ipi<=1) then raise exception 'IPI inválido.'; end if;
    if coalesce((calc->>'automatico')::boolean,false) then
      final := (calc->>'preco_final')::numeric;
    else
      final := round(nullif(requested->>'preco_final_manual','')::numeric,2);
      if approval is null then raise exception 'Preço manual exige observação/aprovação.'; end if;
    end if;
    if final is null or not(final>0 and final<=1000000000) then raise exception 'Preço final inválido.'; end if;
    confirmed := requested->'calculo_confirmado';
    if confirmed is null or (confirmed->>'automatico')::boolean is distinct from coalesce((calc->>'automatico')::boolean,false)
      or (confirmed->>'preco_net')::numeric is distinct from net
      or (confirmed->>'preco_final')::numeric is distinct from final
      or (confirmed->>'ipi')::numeric is distinct from ipi
      or (confirmed->>'divisor')::numeric is distinct from (calc->>'divisor')::numeric then
      raise exception 'O cálculo fiscal mudou. Recalcule e revise antes de confirmar.';
    end if;
    items := items || jsonb_build_array(jsonb_build_object('produto_id',source_item->>'produto_id',
      'quantidade',quantity,'preco_net',net,'preco_final_manual',final,'observacao_preco',approval));
  end loop;
  header := p_cabecalho || jsonb_build_object('cliente_id',q.cliente_id,'moeda',q.moeda,'vendedor_id',q.vendedor_id,
    'observacoes',concat('Convertido da cotação ',q.numero,'. ',coalesce(p_cabecalho->>'observacoes','')));
  result := private.criar_pedido_v4_impl(header,items,q.id);
  pid := nullif(result->>'pedido_id','')::uuid;
  if pid is null or coalesce((result->>'duplicado_bloqueado')::boolean,false) then
    raise exception 'Não foi possível vincular a cotação a um novo pedido.';
  end if;
  update public.cotacoes set pedido_convertido_id=pid,convertida_em=now() where id=q.id;
  return result || jsonb_build_object('cotacao_numero',q.numero);
end;
$$;
revoke all on function private.converter_cotacao_pedido_impl(uuid,jsonb,jsonb) from public,anon;
grant execute on function private.converter_cotacao_pedido_impl(uuid,jsonb,jsonb) to authenticated;

create or replace function public.converter_cotacao_pedido(p_cotacao_id uuid,p_cabecalho jsonb,p_itens jsonb)
returns jsonb language sql security invoker set search_path=''
begin atomic
  select private.converter_cotacao_pedido_impl(p_cotacao_id,p_cabecalho,p_itens);
end;
revoke all on function public.converter_cotacao_pedido(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.converter_cotacao_pedido(uuid,jsonb,jsonb) to authenticated;
