-- Forecast: deployed to homologacao only. Commercial records are untouched.
create table public.forecast_planos (
  cliente_id uuid not null references public.clientes(id),
  vendedor_id uuid not null references public.vendedores(id),
  documento jsonb not null default '{}'::jsonb check (jsonb_typeof(documento) = 'object'),
  revisao bigint not null default 1,
  criado_por uuid not null default auth.uid() references public.usuarios(id),
  atualizado_por uuid not null default auth.uid() references public.usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, vendedor_id)
);
create index forecast_planos_vendedor on public.forecast_planos(vendedor_id,cliente_id);
create index forecast_planos_criado_por on public.forecast_planos(criado_por);
create index forecast_planos_atualizado_por on public.forecast_planos(atualizado_por);
alter table public.forecast_planos enable row level security;
revoke all on public.forecast_planos from public, anon, authenticated;
grant select, insert, update on public.forecast_planos to authenticated;
grant all on public.forecast_planos to service_role;

create policy forecast_ler on public.forecast_planos for select to authenticated using (
  (select private.has_commercial_overview()) or (
    vendedor_id = (select private.current_vendedor_id()) and
    exists(select 1 from public.clientes c where c.id=cliente_id and c.vendedor_id=(select private.current_vendedor_id()))
  )
);
create policy forecast_inserir on public.forecast_planos for insert to authenticated with check (
  exists(select 1 from public.clientes c where c.id=cliente_id and c.ativo and
    ((select private.has_commercial_overview()) or (vendedor_id=(select private.current_vendedor_id()) and c.vendedor_id=(select private.current_vendedor_id()))))
  and exists(select 1 from public.vendedores v where v.id=vendedor_id and v.ativo)
);
create policy forecast_atualizar on public.forecast_planos for update to authenticated using (
  (select private.has_commercial_overview()) or (
    vendedor_id=(select private.current_vendedor_id()) and
    exists(select 1 from public.clientes c where c.id=cliente_id and c.vendedor_id=(select private.current_vendedor_id()))
  )
) with check (
  exists(select 1 from public.clientes c where c.id=cliente_id and c.ativo and
    ((select private.has_commercial_overview()) or (vendedor_id=(select private.current_vendedor_id()) and c.vendedor_id=(select private.current_vendedor_id()))))
  and exists(select 1 from public.vendedores v where v.id=vendedor_id and v.ativo)
);

create function private.validar_forecast_plano() returns trigger language plpgsql security invoker set search_path='' as $$
declare produto record; mes record; n numeric;
begin
  if auth.uid() is null or not exists(select 1 from public.usuarios where id=auth.uid() and ativo) then
    raise exception 'Usuário sem acesso ao forecast.' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    if new.cliente_id<>old.cliente_id or new.vendedor_id<>old.vendedor_id then raise exception 'Cliente e vendedor não podem ser alterados.'; end if;
    new.criado_por:=old.criado_por; new.criado_em:=old.criado_em; new.revisao:=old.revisao+1;
  else
    new.criado_por:=auth.uid(); new.criado_em:=now(); new.revisao:=1;
  end if;
  new.atualizado_por:=auth.uid(); new.atualizado_em:=now();
  if jsonb_typeof(new.documento) is distinct from 'object' or pg_column_size(new.documento)>1000000 then raise exception 'Documento de forecast inválido.'; end if;
  if (select count(*) from jsonb_object_keys(new.documento))>200 then raise exception 'Máximo de 200 produtos por cliente e vendedor.'; end if;
  for produto in select * from jsonb_each(new.documento) loop
    if not exists(select 1 from public.produtos where id=produto.key::uuid) or jsonb_typeof(produto.value)<>'object' then raise exception 'Produto inválido no forecast.'; end if;
    for mes in select * from jsonb_each(produto.value) loop
      if mes.key !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or jsonb_typeof(mes.value)<>'number' then raise exception 'Mês ou quantidade inválida.'; end if;
      n:=(mes.value#>>'{}')::numeric;
      if n<0 or n>999999999 or n<>round(n,3) then raise exception 'Quantidade fora do intervalo permitido.'; end if;
    end loop;
  end loop;
  return new;
end $$;
revoke all on function private.validar_forecast_plano() from public,anon,authenticated;
create trigger forecast_validar before insert or update on public.forecast_planos for each row execute function private.validar_forecast_plano();

create function public.forecast_salvar_v1(p_cliente_id uuid,p_vendedor_id uuid,p_inicio date,p_itens jsonb,p_revisao bigint)
returns bigint language plpgsql security invoker set search_path='' as $$
declare atual public.forecast_planos%rowtype; documento jsonb; produto record; item jsonb; qtd record; meses text[]; chave text; novo jsonb; resultado bigint;
begin
  if auth.uid() is null or not exists(select 1 from public.usuarios where id=auth.uid() and ativo) then raise exception 'Usuário sem acesso.' using errcode='42501'; end if;
  if p_cliente_id is null or p_vendedor_id is null or p_revisao is null or p_revisao<0 then raise exception 'Identificação inválida.'; end if;
  if not exists(select 1 from public.clientes c where c.id=p_cliente_id and c.ativo and
      (private.has_commercial_overview() or (p_vendedor_id=private.current_vendedor_id() and c.vendedor_id=private.current_vendedor_id())))
      or not exists(select 1 from public.vendedores v where v.id=p_vendedor_id and v.ativo) then
    raise exception 'Cliente ou vendedor fora do seu acesso.' using errcode='42501';
  end if;
  if p_inicio is null or p_inicio<>date_trunc('month',p_inicio)::date or p_inicio<'2020-01-01' or p_inicio>'2099-01-01' then raise exception 'Período inválido.'; end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) not between 1 and 200 then raise exception 'Inclua de 1 a 200 produtos.'; end if;
  if (select count(distinct x->>'produto_id') from jsonb_array_elements(p_itens) x)<>jsonb_array_length(p_itens) then raise exception 'Produtos repetidos ou sem código.'; end if;
  select array_agg(to_char(p_inicio+(i||' months')::interval,'YYYY-MM')) into meses from generate_series(0,11) i;
  perform pg_advisory_xact_lock(hashtextextended(p_cliente_id::text||':'||p_vendedor_id::text,0));
  select * into atual from public.forecast_planos where cliente_id=p_cliente_id and vendedor_id=p_vendedor_id for update;
  if coalesce(atual.revisao,0)<>p_revisao then raise exception 'O forecast mudou desde a abertura. Carregue a previsão existente e revise novamente.' using errcode='40001'; end if;
  documento:=coalesce(atual.documento,'{}'::jsonb);
  for produto in select * from jsonb_each(documento) loop
    novo:=produto.value-meses;
    documento:=documento-produto.key;
    if novo<>'{}'::jsonb then documento:=documento||jsonb_build_object(produto.key,novo); end if;
  end loop;
  for item in select * from jsonb_array_elements(p_itens) loop
    chave:=item->>'produto_id';
    if not exists(select 1 from public.produtos where id=chave::uuid and ativo) then raise exception 'Produto inativo ou inexistente.'; end if;
    if jsonb_typeof(item->'quantidades') is distinct from 'object' or item->'quantidades'='{}'::jsonb then raise exception 'Informe pelo menos um mês por produto.'; end if;
    for qtd in select * from jsonb_each(item->'quantidades') loop
      if not(qtd.key=any(meses)) then raise exception 'Quantidade fora do período selecionado.'; end if;
    end loop;
    documento:=documento||jsonb_build_object(chave,coalesce(documento->chave,'{}'::jsonb)||(item->'quantidades'));
  end loop;
  insert into public.forecast_planos(cliente_id,vendedor_id,documento) values(p_cliente_id,p_vendedor_id,documento)
  on conflict(cliente_id,vendedor_id) do update set documento=excluded.documento
  returning revisao into resultado;
  return resultado;
end $$;
revoke all on function public.forecast_salvar_v1(uuid,uuid,date,jsonb,bigint) from public,anon;
grant execute on function public.forecast_salvar_v1(uuid,uuid,date,jsonb,bigint) to authenticated;
comment on table public.forecast_planos is 'Previsões mensais independentes de pedidos, cotações e estoque. Em validação na homologação.';
notify pgrst,'reload schema';

