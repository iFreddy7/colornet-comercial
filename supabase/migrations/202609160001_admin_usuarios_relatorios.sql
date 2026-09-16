-- Fase 9: executar UMA VEZ no SQL Editor do projeto Supabase existente.
-- Pré-requisitos: fases 4, 5 e 7 (pedidos, usuários, reservas e cancelamento).
-- Não cria usuários de teste nem modifica pedidos existentes.
begin;

create table if not exists public.admin_usuario_eventos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null,
  administrador_id uuid not null,
  nome text not null,
  email text not null,
  perfil text not null,
  vendedor_id uuid,
  criado_em timestamptz not null default now()
);
alter table public.admin_usuario_eventos enable row level security;
revoke all on public.admin_usuario_eventos from public, anon, authenticated;
grant select on public.admin_usuario_eventos to authenticated;
drop policy if exists "admin consulta criacao usuarios" on public.admin_usuario_eventos;
create policy "admin consulta criacao usuarios" on public.admin_usuario_eventos
  for select to authenticated using ((select private.is_admin()));

-- Exclusiva da Edge Function: jamais disponível ao navegador.
create or replace function private.admin_finalizar_novo_usuario_impl(
  p_administrador_id uuid, p_usuario_id uuid, p_criacao_id uuid,
  p_nome text, p_email text, p_perfil text, p_vendedor_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare v_usuario_auth auth.users%rowtype;
begin
  if not exists (select 1 from public.usuarios
    where id = p_administrador_id and ativo and perfil = 'ADMIN') then
    raise exception 'Acesso restrito a ADMIN ativo.' using errcode = '42501';
  end if;
  if p_perfil is null or p_perfil not in ('VENDEDOR', 'GERENTE', 'ADMIN') then
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
$$;
revoke all on function private.admin_finalizar_novo_usuario_impl(uuid,uuid,uuid,text,text,text,uuid)
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.admin_finalizar_novo_usuario_impl(uuid,uuid,uuid,text,text,text,uuid) to service_role;

create or replace function public.admin_finalizar_novo_usuario(
  p_administrador_id uuid, p_usuario_id uuid, p_criacao_id uuid,
  p_nome text, p_email text, p_perfil text, p_vendedor_id uuid
) returns void language sql security invoker set search_path = '' as $$
  select private.admin_finalizar_novo_usuario_impl(p_administrador_id, p_usuario_id,
    p_criacao_id, p_nome, p_email, p_perfil, p_vendedor_id);
$$;
revoke all on function public.admin_finalizar_novo_usuario(uuid,uuid,uuid,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.admin_finalizar_novo_usuario(uuid,uuid,uuid,text,text,text,uuid) to service_role;

-- Um documento JSON, em uma consulta consistente. Não sofre o limite de 100/1000
-- linhas da listagem da tela/PostgREST; nenhuma informação é paginada ou descartada.
create or replace function public.admin_exportar_pedidos_v1(
  p_data_inicio date default null, p_data_fim date default null,
  p_vendedor_id uuid default null, p_filial_id uuid default null,
  p_status text default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_resultado jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Acesso restrito a ADMIN ativo.' using errcode = '42501';
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
    'emails', coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object('numero_pedido',p.numero)
      order by e.criado_em,e.id) from selecionados p join public.email_logs e on e.pedido_id=p.id), '[]'::jsonb)
  ) into v_resultado;
  return v_resultado;
end;
$$;
revoke all on function public.admin_exportar_pedidos_v1(date,date,uuid,uuid,text) from public, anon;
grant execute on function public.admin_exportar_pedidos_v1(date,date,uuid,uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
