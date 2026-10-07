alter table public.pedidos add column if not exists faturamento_aviso_status text not null default 'NAO_SOLICITADO'
  check (faturamento_aviso_status in ('NAO_SOLICITADO','PENDENTE','ENVIANDO','ENVIADO','ERRO','INCERTO'));
create table if not exists private.pedido_faturamento_avisos (
  pedido_id uuid primary key references public.pedidos(id), destinatarios text[],
  aceitos text[] not null default '{}', tentativa uuid, iniciado_em timestamptz,
  enviado_em timestamptz, tentativas integer not null default 0, erro text
);
alter table private.pedido_faturamento_avisos enable row level security;
revoke all on private.pedido_faturamento_avisos from public,anon,authenticated;

-- Status manual; não altera itens, preços, estoque ou reservas do ERP.
-- Escritas permanecem limitadas à RPC: authenticated tem apenas SELECT em pedidos.
create or replace function private.marcar_pedido_faturado_impl(p_pedido_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_usuario public.usuarios%rowtype;
  v_pedido public.pedidos%rowtype;
  v_registrado_em timestamptz;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;
  select * into v_usuario from public.usuarios where id = v_uid for share;
  if not found or not coalesce(v_usuario.ativo, false)
    or v_usuario.perfil is null or v_usuario.perfil not in ('ADMIN','GERENTE','DIRETOR') then
    raise exception 'Somente ADMIN, Gerente ou Diretor ativos podem marcar um pedido como faturado.';
  end if;
  if p_pedido_id is null then raise exception 'Pedido obrigatório.'; end if;
  select * into v_pedido from public.pedidos where id = p_pedido_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_pedido.cancelado_em is not null or v_pedido.status = 'CANCELADO' then
    raise exception 'Pedido cancelado não pode ser marcado como faturado.';
  end if;
  if v_pedido.status = 'FATURADO' then
    return jsonb_build_object('sucesso',true,'pedido_id',v_pedido.id,'status','FATURADO','ja_faturado',true);
  end if;
  if v_pedido.status is null or v_pedido.status not in ('ABERTO','ENVIADO') then
    raise exception 'O status atual não permite marcar este pedido como faturado.';
  end if;
  v_registrado_em := clock_timestamp();
  update public.pedidos set status = 'FATURADO', faturamento_aviso_status = 'PENDENTE' where id = v_pedido.id;
  insert into public.pedido_eventos(pedido_id,tipo,detalhes,created_by,criado_em)
  values(v_pedido.id,'FATURAMENTO_MANUAL',jsonb_build_object(
    'status_anterior',v_pedido.status,'status_novo','FATURADO',
    'registrado_por_nome',coalesce(nullif(trim(v_usuario.nome),''),'Usuário'),
    'origem','MARCACAO_MANUAL_PORTAL'),v_uid,v_registrado_em);
  insert into private.pedido_faturamento_avisos(pedido_id) values(v_pedido.id);
  return jsonb_build_object('sucesso',true,'pedido_id',v_pedido.id,'status','FATURADO','ja_faturado',false);
end;
$$;
revoke all on function private.marcar_pedido_faturado_impl(uuid) from public, anon;
grant execute on function private.marcar_pedido_faturado_impl(uuid) to authenticated;

create or replace function public.marcar_pedido_faturado(p_pedido_id uuid)
returns jsonb language sql security invoker set search_path = ''
begin atomic
  select private.marcar_pedido_faturado_impl(p_pedido_id);
end;
revoke all on function public.marcar_pedido_faturado(uuid) from public, anon;
grant execute on function public.marcar_pedido_faturado(uuid) to authenticated;
notify pgrst, 'reload schema';

create or replace function private.reservar_aviso_pedido_faturado_impl(p_pedido_id uuid,p_ator_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.pedidos; a private.pedido_faturamento_avisos; email text; token uuid; restantes text[];
begin
  if not exists(select 1 from public.usuarios where id=p_ator_id and ativo and perfil in ('ADMIN','GERENTE','DIRETOR')) then
    raise exception 'Acesso restrito à gestão comercial ativa.' using errcode='42501';
  end if;
  select * into q from public.pedidos where id=p_pedido_id for update;
  select * into a from private.pedido_faturamento_avisos where pedido_id=p_pedido_id for update;
  if q.id is null or a.pedido_id is null or q.status <> 'FATURADO' or q.cancelado_em is not null then raise exception 'Nenhum faturamento aguardando envio.'; end if;
  if q.faturamento_aviso_status in ('ENVIADO','INCERTO') then return jsonb_build_object('status',q.faturamento_aviso_status); end if;
  if q.faturamento_aviso_status='ENVIANDO' then
    if a.iniciado_em < now()-interval '5 minutes' then
      update public.pedidos set faturamento_aviso_status='INCERTO' where id=q.id;
      update private.pedido_faturamento_avisos set erro='Envio interrompido. Conferir recebimento antes de repetir.' where pedido_id=q.id;
      return jsonb_build_object('status','INCERTO');
    end if;
    return jsonb_build_object('status','ENVIANDO');
  end if;
  if a.iniciado_em > now()-interval '30 seconds' then return jsonb_build_object('status',q.faturamento_aviso_status,'aguarde',true); end if;
  if a.destinatarios is null then
    select lower(btrim(v.email)) into email from public.vendedores v where v.id=q.vendedor_id;
    if email is null or length(email)>254 or email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' then
      update public.pedidos set faturamento_aviso_status='ERRO' where id=q.id;
      update private.pedido_faturamento_avisos set erro='Cadastre um e-mail válido para o vendedor.' where pedido_id=q.id;
      return jsonb_build_object('status','ERRO','erro','Cadastre um e-mail válido para o vendedor.');
    end if;
    select array_agg(distinct x order by x) into a.destinatarios from unnest(array[email,'jrodrigues@colornet.com.br','marcia@colornet.com.br']) x;
  end if;
  select array_agg(x order by x) into restantes from unnest(a.destinatarios) x where not (x=any(a.aceitos));
  token:=gen_random_uuid();
  update private.pedido_faturamento_avisos set destinatarios=a.destinatarios,tentativa=token,iniciado_em=now(),tentativas=tentativas+1,erro=null where pedido_id=q.id;
  update public.pedidos set faturamento_aviso_status='ENVIANDO' where id=q.id;
  return jsonb_build_object('status','RESERVADO','tentativa',token,'destinatarios',restantes,
    'pedido',jsonb_build_object('id',q.id,'numero',q.numero,
      'cliente_nome',(select c.razao_social from public.clientes c where c.id=q.cliente_id),
      'vendedor_nome',(select v.nome from public.vendedores v where v.id=q.vendedor_id),
      'registrado_por',(select e.detalhes->>'registrado_por_nome' from public.pedido_eventos e where e.pedido_id=q.id and e.tipo='FATURAMENTO_MANUAL' order by e.criado_em desc limit 1),
      'registrado_em',(select e.criado_em from public.pedido_eventos e where e.pedido_id=q.id and e.tipo='FATURAMENTO_MANUAL' order by e.criado_em desc limit 1)));

end $$;
revoke all on function private.reservar_aviso_pedido_faturado_impl(uuid,uuid) from public,anon,authenticated;
grant execute on function private.reservar_aviso_pedido_faturado_impl(uuid,uuid) to service_role;
create or replace function public.reservar_aviso_pedido_faturado(p_pedido_id uuid,p_ator_id uuid)
returns jsonb language sql security invoker set search_path=''
begin atomic select private.reservar_aviso_pedido_faturado_impl(p_pedido_id,p_ator_id); end;
revoke all on function public.reservar_aviso_pedido_faturado(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reservar_aviso_pedido_faturado(uuid,uuid) to service_role;

create or replace function private.finalizar_aviso_pedido_faturado_impl(p_pedido_id uuid,p_tentativa uuid,p_aceitos text[],p_incerto boolean,p_erro text)
returns text language plpgsql security definer set search_path='' as $$
declare a private.pedido_faturamento_avisos; enviados text[]; estado text;
begin
  perform 1 from public.pedidos where id=p_pedido_id for update;
  select * into a from private.pedido_faturamento_avisos where pedido_id=p_pedido_id for update;
  if a.pedido_id is null or a.tentativa is distinct from p_tentativa or p_tentativa is null then raise exception 'Tentativa de envio inválida.'; end if;
  select coalesce(array_agg(distinct x order by x),'{}') into enviados
    from unnest(a.aceitos || coalesce(p_aceitos,'{}')) x where x=any(a.destinatarios);
  estado:=case when p_incerto then 'INCERTO' when a.destinatarios<@enviados then 'ENVIADO' else 'ERRO' end;
  update private.pedido_faturamento_avisos set aceitos=enviados,tentativa=null,enviado_em=case when estado='ENVIADO' then now() else null end,
    erro=left(p_erro,300) where pedido_id=p_pedido_id;
  update public.pedidos set faturamento_aviso_status=estado where id=p_pedido_id;
  return estado;
end $$;
revoke all on function private.finalizar_aviso_pedido_faturado_impl(uuid,uuid,text[],boolean,text) from public,anon,authenticated;
grant execute on function private.finalizar_aviso_pedido_faturado_impl(uuid,uuid,text[],boolean,text) to service_role;
create or replace function public.finalizar_aviso_pedido_faturado(p_pedido_id uuid,p_tentativa uuid,p_aceitos text[],p_incerto boolean,p_erro text default null)
returns text language sql security invoker set search_path=''
begin atomic select private.finalizar_aviso_pedido_faturado_impl(p_pedido_id,p_tentativa,p_aceitos,p_incerto,p_erro); end;
revoke all on function public.finalizar_aviso_pedido_faturado(uuid,uuid,text[],boolean,text) from public,anon,authenticated;
grant execute on function public.finalizar_aviso_pedido_faturado(uuid,uuid,text[],boolean,text) to service_role;
notify pgrst, 'reload schema';
