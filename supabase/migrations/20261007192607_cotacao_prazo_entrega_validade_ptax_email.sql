-- Adiciona prazo ao snapshot, preservando a autorização e cálculo fiscal existentes.
do $migration$
declare ddl text; marker text := '    qtd:=nullif(item->>''quantidade'','''')::numeric;';
begin
  ddl:=pg_get_functiondef('private.criar_cotacao_v3_impl(jsonb,jsonb,uuid)'::regprocedure);
  if position('''prazo_entrega'',btrim(item->>''prazo_entrega'')' in ddl)=0 then
    if position(marker in ddl)=0 or position('''quantidade'',qtd,''preco_net'',net' in ddl)=0 then raise exception 'Implementação de cotação inesperada; revisar migração.'; end if;
    ddl:=replace(ddl,marker,E'    if jsonb_typeof(item->''prazo_entrega'') is distinct from ''string'' or length(btrim(item->>''prazo_entrega'')) not between 1 and 120 then raise exception ''Informe o prazo de entrega de cada produto (até 120 caracteres).''; end if;\n'||marker);
    ddl:=replace(ddl,'''quantidade'',qtd,''preco_net'',net','''prazo_entrega'',btrim(item->>''prazo_entrega''),''quantidade'',qtd,''preco_net'',net');
    execute ddl;
  end if;
end $migration$;

-- Validação no INSERT abrange todas as versões de criação e não reescreve propostas antigas.
create or replace function private.validar_nova_cotacao_prazos()
returns trigger language plpgsql security invoker set search_path='' as $$
declare emissao date := (new.created_at at time zone 'America/Sao_Paulo')::date; item jsonb;
begin
  if new.validade is null or new.validade < emissao or new.validade > emissao + 30 then
    raise exception 'A validade deve estar entre a data de inclusão e 30 dias corridos após essa data.';
  end if;
  if jsonb_typeof(new.documento->'itens') is distinct from 'array' then raise exception 'Itens da cotação inválidos.'; end if;
  for item in select value from jsonb_array_elements(new.documento->'itens') loop
    if jsonb_typeof(item->'prazo_entrega') is distinct from 'string' or length(btrim(item->>'prazo_entrega')) not between 1 and 120 then
      raise exception 'Informe o prazo de entrega de cada produto (até 120 caracteres).';
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.validar_nova_cotacao_prazos() from public,anon,authenticated;
drop trigger if exists trg_validar_nova_cotacao_prazos on public.cotacoes;
create trigger trg_validar_nova_cotacao_prazos before insert on public.cotacoes for each row execute function private.validar_nova_cotacao_prazos();

-- Snapshot de faturamento independente da taxa usada nos cálculos já existentes.
alter table public.pedidos add column if not exists ptax_faturamento jsonb;
comment on column public.pedidos.ptax_faturamento is 'PTAX venda consultada no BCB para o aviso de faturamento; não altera preços nem ptax_valor da inclusão.';
create or replace function private.registrar_ptax_faturamento_impl(p_pedido_id uuid,p_valor numeric,p_referencia date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.pedidos; local_time timestamp; limite date; criterio text; snapshot jsonb;
begin
  select * into p from public.pedidos where id=p_pedido_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if p.ptax_faturamento->>'status'='DEFINIDA' then return p.ptax_faturamento; end if;
  local_time:=p.created_at at time zone 'America/Sao_Paulo';
  limite:=local_time::date;
  if local_time::time <= time '14:00:00' then limite:=limite-1; criterio:='D_1'; else criterio:='APOS_14H'; end if;
  if p_valor is not null and (p_valor::text in ('NaN','Infinity','-Infinity') or p_valor<=0 or p_valor>1000 or p_referencia is null or p_referencia>limite or p_referencia<limite-14) then
    raise exception 'PTAX de faturamento inválida.';
  end if;
  snapshot:=jsonb_build_object('status',case when p_valor is null then 'PENDENTE' else 'DEFINIDA' end,
    'valor',p_valor,'referencia',case when p_valor is null then null else p_referencia end,
    'data_limite',limite,'criterio',criterio,'fonte','BCB_PTAX_VENDA','consultado_em',now());
  update public.pedidos set ptax_faturamento=snapshot where id=p.id;
  return snapshot;
end $$;
revoke all on function private.registrar_ptax_faturamento_impl(uuid,numeric,date) from public,anon,authenticated;
grant execute on function private.registrar_ptax_faturamento_impl(uuid,numeric,date) to service_role;
create or replace function public.registrar_ptax_faturamento(p_pedido_id uuid,p_valor numeric,p_referencia date)
returns jsonb language sql security invoker set search_path=''
begin atomic select private.registrar_ptax_faturamento_impl(p_pedido_id,p_valor,p_referencia); end;
revoke all on function public.registrar_ptax_faturamento(uuid,numeric,date) from public,anon,authenticated;
grant execute on function public.registrar_ptax_faturamento(uuid,numeric,date) to service_role;
notify pgrst,'reload schema';
