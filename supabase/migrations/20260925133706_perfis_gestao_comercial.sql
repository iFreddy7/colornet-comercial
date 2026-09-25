-- Visão comercial global não concede administração nem altera políticas de escrita.
alter table public.usuarios drop constraint usuarios_perfil_check;
alter table public.usuarios add constraint usuarios_perfil_check
  check (perfil in ('VENDEDOR','GERENTE','DIRETOR','ADMIN'));

create or replace function private.has_commercial_overview()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.usuarios u
    where u.id = (select auth.uid()) and u.ativo
      and u.perfil in ('ADMIN','GERENTE','DIRETOR'));
$$;
revoke all on function private.has_commercial_overview() from public, anon;
grant execute on function private.has_commercial_overview() to authenticated, service_role;

drop policy if exists "gestao comercial consulta global" on public.clientes;
create policy "gestao comercial consulta global" on public.clientes
for select to authenticated using ((select private.has_commercial_overview()));

drop policy if exists "gestao comercial consulta global" on public.cliente_contatos;
create policy "gestao comercial consulta global" on public.cliente_contatos
for select to authenticated using ((select private.has_commercial_overview()));

drop policy if exists "gestao comercial consulta global" on public.vendedores;
create policy "gestao comercial consulta global" on public.vendedores
for select to authenticated using ((select private.has_commercial_overview()));

drop policy if exists "gestao comercial consulta global" on public.pedidos;
create policy "gestao comercial consulta global" on public.pedidos
for select to authenticated using ((select private.has_commercial_overview()));

drop policy if exists "gestao comercial consulta global" on public.pedido_itens;
create policy "gestao comercial consulta global" on public.pedido_itens
for select to authenticated using ((select private.has_commercial_overview()));

drop policy if exists "gestao comercial consulta global" on public.pedido_eventos;
create policy "gestao comercial consulta global" on public.pedido_eventos
for select to authenticated using ((select private.has_commercial_overview()));

drop policy if exists "gestao comercial consulta global" on public.pedido_cancelamentos;
create policy "gestao comercial consulta global" on public.pedido_cancelamentos
for select to authenticated using ((select private.has_commercial_overview()));

drop policy if exists "gestao comercial consulta global" on public.movimentos_estoque;
create policy "gestao comercial consulta global" on public.movimentos_estoque
for select to authenticated using ((select private.has_commercial_overview()));

drop policy if exists "gestao comercial consulta global" on public.movimentos_previsao;
create policy "gestao comercial consulta global" on public.movimentos_previsao
for select to authenticated using ((select private.has_commercial_overview()));

drop policy if exists "gestao comercial consulta global" on public.cotacoes;
create policy "gestao comercial consulta global" on public.cotacoes
for select to authenticated using ((select private.has_commercial_overview()));

CREATE OR REPLACE FUNCTION private.admin_atualizar_usuario_impl(p_usuario_id uuid, p_perfil text, p_vendedor_id uuid, p_ativo boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (select private.is_admin()) then raise exception 'Acesso restrito a ADMIN.'; end if;
  if p_perfil not in ('VENDEDOR','GERENTE','DIRETOR','ADMIN') then raise exception 'Perfil inválido.'; end if;
  if p_perfil = 'VENDEDOR' and p_ativo and p_vendedor_id is null then raise exception 'VENDEDOR ativo precisa estar vinculado a um vendedor.'; end if;
  if p_usuario_id = auth.uid() and p_ativo = false then raise exception 'Você não pode desativar sua própria conta.'; end if;
  update public.usuarios set perfil=p_perfil, vendedor_id=p_vendedor_id, ativo=p_ativo where id=p_usuario_id;
  if not found then raise exception 'Usuário não encontrado.'; end if;
end; $function$
;
CREATE OR REPLACE FUNCTION private.admin_finalizar_novo_usuario_impl(p_administrador_id uuid, p_usuario_id uuid, p_criacao_id uuid, p_nome text, p_email text, p_perfil text, p_vendedor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_usuario_auth auth.users%rowtype;
begin
  if not exists (select 1 from public.usuarios
    where id = p_administrador_id and ativo and perfil = 'ADMIN') then
    raise exception 'Acesso restrito a ADMIN ativo.' using errcode = '42501';
  end if;
  if p_perfil is null or p_perfil not in ('VENDEDOR', 'GERENTE', 'DIRETOR', 'ADMIN') then
    raise exception 'Perfil inválido.';
  end if;
  if p_nome is null or length(trim(p_nome)) not between 2 and 120 then
    raise exception 'Informe um nome entre 2 e 120 caracteres.';
  end if;
  if p_perfil = 'VENDEDOR' and p_vendedor_id is null then
    raise exception 'Selecione o vendedor vinculado à conta.';
  end if;
  if p_vendedor_id is not null and not exists (
    select 1 from public.vendedores where id = p_vendedor_id and ativo
  ) then raise exception 'Vendedor inexistente ou inativo.'; end if;

  select * into v_usuario_auth from auth.users where id = p_usuario_id for update;
  if not found or p_usuario_id = p_administrador_id or
    p_criacao_id is null or p_email is null or
    lower(v_usuario_auth.email) is distinct from lower(trim(p_email)) or
    v_usuario_auth.raw_app_meta_data->>'colornet_criado_por' is distinct from p_administrador_id::text or
    v_usuario_auth.raw_app_meta_data->>'colornet_criacao_id' is distinct from p_criacao_id::text then
    raise exception 'A conta não corresponde a este novo cadastro.' using errcode = '42501';
  end if;
  -- Auth pode já ter criado o perfil através do trigger existente.
  insert into public.usuarios(id, nome, email, perfil, vendedor_id, ativo)
    values(p_usuario_id, trim(p_nome), lower(trim(p_email)), p_perfil, p_vendedor_id, true)
  on conflict(id) do update set nome = excluded.nome, email = excluded.email,
    perfil = excluded.perfil, vendedor_id = excluded.vendedor_id, ativo = excluded.ativo;

  insert into public.admin_usuario_eventos(usuario_id, administrador_id, nome, email, perfil, vendedor_id)
    values(p_usuario_id, p_administrador_id, trim(p_nome), lower(trim(p_email)), p_perfil, p_vendedor_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION private.exportar_pedidos_comercial_impl(p_data_inicio date DEFAULT NULL::date, p_data_fim date DEFAULT NULL::date, p_vendedor_id uuid DEFAULT NULL::uuid, p_filial_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_resultado jsonb;
begin
  if auth.uid() is null or not (select private.has_commercial_overview()) then
    raise exception 'Acesso restrito a gestão comercial ativa.' using errcode = '42501';
  end if;
  if p_data_inicio > p_data_fim then raise exception 'Período inválido.'; end if;
  if p_status is not null and p_status not in ('ABERTO', 'ENVIADO', 'FATURADO', 'CANCELADO') then
    raise exception 'Status inválido.';
  end if;

  with selecionados as materialized (
    select p.* from public.pedidos p
    where (p_data_inicio is null or p.created_at >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo'))
      and (p_data_fim is null or p.created_at < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo'))
      and (p_vendedor_id is null or p.vendedor_id = p_vendedor_id)
      and (p_filial_id is null or p.filial_id = p_filial_id)
      and (p_status is null or p.status = p_status)
  )
  select jsonb_build_object(
    'versao', 1, 'gerado_em', statement_timestamp(),
    'filtros', jsonb_build_object('data_inicio',p_data_inicio,'data_fim',p_data_fim,
      'vendedor_id',p_vendedor_id,'filial_id',p_filial_id,'status',p_status),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object(
      'pedido',to_jsonb(p), 'cliente',to_jsonb(c), 'vendedor',to_jsonb(v),
      'filial',to_jsonb(f), 'prazo_pagamento',to_jsonb(pp), 'frete',to_jsonb(fr),
      'autor',jsonb_build_object('nome',u.nome,'email',u.email),
      'cancelado_por',jsonb_build_object('nome',uc.nome,'email',uc.email)
    ) order by p.created_at,p.id)
      from selecionados p
      left join public.clientes c on c.id=p.cliente_id
      left join public.vendedores v on v.id=p.vendedor_id
      left join public.filiais f on f.id=p.filial_id
      left join public.prazos_pagamento pp on pp.id=p.prazo_pagamento_id
      left join public.fretes fr on fr.id=p.frete_id
      left join public.usuarios u on u.id=p.created_by
      left join public.usuarios uc on uc.id=p.cancelado_por), '[]'::jsonb),
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
      'numero_pedido',p.numero, 'moeda',p.moeda, 'item',to_jsonb(i), 'produto',to_jsonb(pr)
    ) order by p.created_at,p.id,i.id)
      from selecionados p join public.pedido_itens i on i.pedido_id=p.id
      left join public.produtos pr on pr.id=i.produto_id), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object(
      'numero_pedido',p.numero,'autor_nome',u.nome,'autor_email',u.email
    ) order by e.criado_em,e.id)
      from selecionados p join public.pedido_eventos e on e.pedido_id=p.id
      left join public.usuarios u on u.id=e.created_by), '[]'::jsonb),
    'estoque', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object(
      'numero_pedido',p.numero,'produto_nome',pr.nome,'produto_codigo',pr.codigo_protheus,
      'filial_nome',f.nome,'autor_nome',u.nome
    ) order by m.criado_em,m.id)
      from selecionados p join public.movimentos_estoque m on m.pedido_id=p.id
      left join public.produtos pr on pr.id=m.produto_id
      left join public.filiais f on f.id=m.filial_id
      left join public.usuarios u on u.id=m.created_by), '[]'::jsonb),
    'previsoes', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object(
      'numero_pedido',p.numero,'produto_nome',pr.nome,'produto_codigo',pr.codigo_protheus,
      'filial_nome',f.nome,'autor_nome',u.nome
    ) order by m.criado_em,m.id)
      from selecionados p join public.movimentos_previsao m on m.pedido_id=p.id
      left join public.produtos pr on pr.id=m.produto_id
      left join public.filiais f on f.id=m.filial_id
      left join public.usuarios u on u.id=m.created_by), '[]'::jsonb),
    'emails', '[]'::jsonb
  ) into v_resultado;
  return v_resultado;
end;
$function$
;

revoke all on function private.exportar_pedidos_comercial_impl(date,date,uuid,uuid,text) from public, anon;
grant execute on function private.exportar_pedidos_comercial_impl(date,date,uuid,uuid,text) to authenticated;

create or replace function public.exportar_pedidos_comercial_v1(
  p_data_inicio date default null, p_data_fim date default null,
  p_vendedor_id uuid default null, p_filial_id uuid default null, p_status text default null
) returns jsonb language sql stable security invoker set search_path = ''
begin atomic
  select private.exportar_pedidos_comercial_impl(p_data_inicio,p_data_fim,p_vendedor_id,p_filial_id,p_status);
end;
revoke all on function public.exportar_pedidos_comercial_v1(date,date,uuid,uuid,text) from public, anon;
grant execute on function public.exportar_pedidos_comercial_v1(date,date,uuid,uuid,text) to authenticated;

-- Resolve a referência privada sem expor o schema private ao navegador.
create or replace function public.admin_atualizar_usuario(
  p_usuario_id uuid, p_perfil text, p_vendedor_id uuid, p_ativo boolean
) returns void language sql security invoker set search_path = ''
begin atomic
  select private.admin_atualizar_usuario_impl(p_usuario_id,p_perfil,p_vendedor_id,p_ativo);
end;
revoke all on function private.admin_atualizar_usuario_impl(uuid,text,uuid,boolean) from public, anon;
grant execute on function private.admin_atualizar_usuario_impl(uuid,text,uuid,boolean) to authenticated;
revoke all on function public.admin_atualizar_usuario(uuid,text,uuid,boolean) from public, anon;
grant execute on function public.admin_atualizar_usuario(uuid,text,uuid,boolean) to authenticated;

-- Amplia somente as operações comerciais. As funções administrativas continuam ADMIN.
-- Modifica os predicados sobre a definição existente para preservar as diferenças
-- de estoque/PTAX entre produção e homologação.
do $roles$
declare f record; original text; revised text;
begin
  for f in select p.oid, n.nspname, p.proname from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in (
      'calcular_item_pedido_impl','calcular_preco_comercial_impl','criar_pedido_impl','cancelar_pedido_impl',
      'cancelar_pedido_v1_impl','criar_cotacao_impl','criar_cotacao_v2_impl','criar_cotacao_v3_impl'))
      or (n.nspname='public' and p.proname in (
      'estornar_reserva_estoque_pedido','estornar_reservas_previsao_pedido'))
  loop
    original := pg_get_functiondef(f.oid);
    revised := replace(original, 'private.is_admin()', 'private.has_commercial_overview()');
    revised := replace(revised, 'v_usuario.perfil <> ''ADMIN''', 'v_usuario.perfil not in (''ADMIN'',''GERENTE'',''DIRETOR'')');
    revised := replace(revised, 'v_usuario.perfil = ''ADMIN''', 'v_usuario.perfil in (''ADMIN'',''GERENTE'',''DIRETOR'')');
    revised := replace(revised, 'u.perfil<>''ADMIN''', 'u.perfil not in (''ADMIN'',''GERENTE'',''DIRETOR'')');
    revised := replace(revised, 'u.perfil=''ADMIN''', 'u.perfil in (''ADMIN'',''GERENTE'',''DIRETOR'')');
    revised := replace(revised, 'v_usuario.perfil=''ADMIN''', 'v_usuario.perfil in (''ADMIN'',''GERENTE'',''DIRETOR'')');
    revised := replace(revised, 'ADMIN deve informar', 'Informe');
    if revised = original and position('GERENTE' in original) = 0
      and position('has_commercial_overview' in original) = 0 then
      raise exception 'Predicado comercial não encontrado em %.%', f.nspname, f.proname;
    end if;
    execute revised;
  end loop;
end $roles$;

CREATE OR REPLACE FUNCTION public.calcular_item_pedido(p_cliente_id uuid, p_produto_id uuid, p_filial_id uuid, p_preco_net numeric)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
BEGIN ATOMIC
  select private.calcular_item_pedido_impl(
    p_cliente_id,
    p_produto_id,
    p_filial_id,
    p_preco_net
  );
END;

revoke all on function public.calcular_item_pedido(uuid,uuid,uuid,numeric) from public, anon;
grant execute on function public.calcular_item_pedido(uuid,uuid,uuid,numeric) to authenticated;
revoke all on function private.calcular_item_pedido_impl(uuid,uuid,uuid,numeric) from public, anon;
grant execute on function private.calcular_item_pedido_impl(uuid,uuid,uuid,numeric) to authenticated;
CREATE OR REPLACE FUNCTION public.criar_pedido_v4(p_cabecalho jsonb, p_itens jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO ''
BEGIN ATOMIC
  select private.criar_pedido_v4_impl(
    p_cabecalho,
    p_itens,
    p_idempotency_key
  );
END;

revoke all on function public.criar_pedido_v4(jsonb,jsonb,uuid) from public, anon;
grant execute on function public.criar_pedido_v4(jsonb,jsonb,uuid) to authenticated;
revoke all on function private.criar_pedido_v4_impl(jsonb,jsonb,uuid) from public, anon;
grant execute on function private.criar_pedido_v4_impl(jsonb,jsonb,uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.criar_cotacao_v4(p_cabecalho jsonb, p_itens jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
BEGIN ATOMIC
  select private.criar_cotacao_v4_impl(p_cabecalho,p_itens,p_idempotency_key);
END;

revoke all on function public.criar_cotacao_v4(jsonb,jsonb,uuid) from public, anon;
grant execute on function public.criar_cotacao_v4(jsonb,jsonb,uuid) to authenticated;
revoke all on function private.criar_cotacao_v4_impl(jsonb,jsonb,uuid) from public, anon;
grant execute on function private.criar_cotacao_v4_impl(jsonb,jsonb,uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.cancelar_pedido(p_pedido_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO ''
BEGIN ATOMIC
  select private.cancelar_pedido_impl(
    p_pedido_id,
    p_motivo
  );
END;

revoke all on function public.cancelar_pedido(uuid,text) from public, anon;
grant execute on function public.cancelar_pedido(uuid,text) to authenticated;
revoke all on function private.cancelar_pedido_impl(uuid,text) from public, anon;
grant execute on function private.cancelar_pedido_impl(uuid,text) to authenticated;

notify pgrst, 'reload schema';
CREATE OR REPLACE FUNCTION public.calcular_preco_comercial(p_cliente_id uuid, p_produto_id uuid, p_filial_id uuid, p_preco_net numeric, p_preco_final numeric, p_cotacao boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
BEGIN ATOMIC
  select private.calcular_preco_comercial_impl(p_cliente_id,p_produto_id,p_filial_id,p_preco_net,p_preco_final,p_cotacao);
END;

revoke all on function public.calcular_preco_comercial(uuid,uuid,uuid,numeric,numeric,boolean) from public, anon;
grant execute on function public.calcular_preco_comercial(uuid,uuid,uuid,numeric,numeric,boolean) to authenticated;
revoke all on function private.calcular_preco_comercial_impl(uuid,uuid,uuid,numeric,numeric,boolean) from public, anon;
grant execute on function private.calcular_preco_comercial_impl(uuid,uuid,uuid,numeric,numeric,boolean) to authenticated;
do $optional$
begin
 if to_regprocedure('private.criar_cotacao_v2_impl(jsonb,jsonb,uuid)') is not null then
 execute $ddl$CREATE OR REPLACE FUNCTION public.criar_cotacao_v2(p_cabecalho jsonb, p_itens jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
BEGIN ATOMIC
  select private.criar_cotacao_v2_impl(p_cabecalho,p_itens,p_idempotency_key);
END;

revoke all on function public.criar_cotacao_v2(jsonb,jsonb,uuid) from public, anon;
grant execute on function public.criar_cotacao_v2(jsonb,jsonb,uuid) to authenticated;
revoke all on function private.criar_cotacao_v2_impl(jsonb,jsonb,uuid) from public, anon;
grant execute on function private.criar_cotacao_v2_impl(jsonb,jsonb,uuid) to authenticated;
$ddl$;
 end if;
end $optional$;

