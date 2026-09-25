-- Decisão comercial imutável; o envio é independente da transação de aprovação.
alter table public.cotacoes
  add column aprovacao_status text not null default 'PENDENTE' check (aprovacao_status in ('PENDENTE','APROVADA','REPROVADA')),
  add column aprovacao_motivo text,
  add column aprovacao_por uuid references public.usuarios(id),
  add column aprovacao_nome text,
  add column aprovacao_em timestamptz,
  add column aviso_status text not null default 'NAO_SOLICITADO' check (aviso_status in ('NAO_SOLICITADO','PENDENTE','ENVIANDO','ENVIADO','ERRO','INCERTO')),
  add constraint cotacoes_decisao_consistente check (
    (aprovacao_status='PENDENTE' and aprovacao_por is null and aprovacao_em is null and aprovacao_motivo is null)
    or (aprovacao_status in ('APROVADA','REPROVADA') and aprovacao_por is not null and aprovacao_em is not null
      and (aprovacao_status<>'REPROVADA' or coalesce(length(btrim(aprovacao_motivo)),0) between 1 and 2000))
  );
create index cotacoes_aprovacao_created_idx on public.cotacoes(aprovacao_status,created_at desc,id);

create table private.cotacao_avisos (
  cotacao_id uuid primary key references public.cotacoes(id),
  destinatarios text[],
  aceitos text[] not null default '{}',
  tentativa uuid,
  iniciado_em timestamptz,
  enviado_em timestamptz,
  tentativas integer not null default 0,
  erro text
);
alter table private.cotacao_avisos enable row level security;
revoke all on private.cotacao_avisos from public,anon,authenticated;

create function private.decidir_cotacao_impl(p_cotacao_id uuid,p_decisao text,p_motivo text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.usuarios; q public.cotacoes; motivo text:=nullif(btrim(p_motivo),'');
begin
  select * into u from public.usuarios where id=(select auth.uid());
  if u.id is null or not coalesce(u.ativo,false) or u.perfil not in ('GERENTE','DIRETOR') then
    raise exception 'Apenas Gerente ou Diretor ativo pode avaliar cotações.' using errcode='42501';
  end if;
  if p_decisao is null or p_decisao not in ('APROVADA','REPROVADA') then raise exception 'Decisão inválida.'; end if;
  if p_decisao='REPROVADA' and motivo is null then raise exception 'Informe o motivo da reprovação.'; end if;
  if length(motivo)>2000 then raise exception 'O motivo deve ter no máximo 2000 caracteres.'; end if;
  if p_decisao='APROVADA' then motivo:=null; end if;
  select * into q from public.cotacoes where id=p_cotacao_id for update;
  if q.id is null then raise exception 'Cotação não encontrada.'; end if;
  if q.aprovacao_status<>'PENDENTE' then
    if q.aprovacao_status=p_decisao and q.aprovacao_por=u.id and q.aprovacao_motivo is not distinct from motivo then
      return jsonb_build_object('status',q.aprovacao_status,'aviso_status',q.aviso_status,'repetida',true);
    end if;
    raise exception 'Esta cotação já foi avaliada. Atualize a página para consultar a decisão.';
  end if;
  if q.pedido_convertido_id is not null then raise exception 'Esta cotação já foi convertida em pedido e não pode ser avaliada.'; end if;
  update public.cotacoes set aprovacao_status=p_decisao,aprovacao_motivo=motivo,
    aprovacao_por=u.id,aprovacao_nome=u.nome,aprovacao_em=now(),aviso_status='PENDENTE' where id=q.id;
  insert into private.cotacao_avisos(cotacao_id) values(q.id);
  return jsonb_build_object('status',p_decisao,'aviso_status','PENDENTE','repetida',false);
end $$;
revoke all on function private.decidir_cotacao_impl(uuid,text,text) from public,anon;
grant execute on function private.decidir_cotacao_impl(uuid,text,text) to authenticated;
create function public.decidir_cotacao(p_cotacao_id uuid,p_decisao text,p_motivo text default null)
returns jsonb language sql security invoker set search_path=''
begin atomic select private.decidir_cotacao_impl(p_cotacao_id,p_decisao,p_motivo); end;
revoke all on function public.decidir_cotacao(uuid,text,text) from public,anon;
grant execute on function public.decidir_cotacao(uuid,text,text) to authenticated;

-- Somente a função de servidor, após validar a sessão, pode reservar um envio.
create function private.reservar_aviso_cotacao_impl(p_cotacao_id uuid,p_ator_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.cotacoes; a private.cotacao_avisos; email text; token uuid; restantes text[];
begin
  if not exists(select 1 from public.usuarios where id=p_ator_id and ativo and perfil in ('GERENTE','DIRETOR')) then
    raise exception 'Acesso restrito à avaliação comercial.' using errcode='42501';
  end if;
  select * into q from public.cotacoes where id=p_cotacao_id for update;
  select * into a from private.cotacao_avisos where cotacao_id=p_cotacao_id for update;
  if q.id is null or a.cotacao_id is null or q.aprovacao_status='PENDENTE' then raise exception 'Nenhuma decisão aguardando envio.'; end if;
  if q.aviso_status in ('ENVIADO','INCERTO') then return jsonb_build_object('status',q.aviso_status); end if;
  if q.aviso_status='ENVIANDO' then
    if a.iniciado_em < now()-interval '5 minutes' then
      update public.cotacoes set aviso_status='INCERTO' where id=q.id;
      update private.cotacao_avisos set erro='Envio interrompido. Conferir recebimento antes de repetir.' where cotacao_id=q.id;
      return jsonb_build_object('status','INCERTO');
    end if;
    return jsonb_build_object('status','ENVIANDO');
  end if;
  if a.iniciado_em > now()-interval '30 seconds' then return jsonb_build_object('status',q.aviso_status,'aguarde',true); end if;
  if a.destinatarios is null then
    select lower(btrim(v.email)) into email from public.vendedores v where v.id=q.vendedor_id;
    if email is null or length(email)>254 or email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' then
      update public.cotacoes set aviso_status='ERRO' where id=q.id;
      update private.cotacao_avisos set erro='Cadastre um e-mail válido para o vendedor.' where cotacao_id=q.id;
      return jsonb_build_object('status','ERRO','erro','Cadastre um e-mail válido para o vendedor.');
    end if;
    select array_agg(distinct x order by x) into a.destinatarios from unnest(array[email,'jrodrigues@colornet.com.br','marcia@colornet.com.br']) x;
  end if;
  select array_agg(x order by x) into restantes from unnest(a.destinatarios) x where not (x=any(a.aceitos));
  token:=gen_random_uuid();
  update private.cotacao_avisos set destinatarios=a.destinatarios,tentativa=token,iniciado_em=now(),tentativas=tentativas+1,erro=null where cotacao_id=q.id;
  update public.cotacoes set aviso_status='ENVIANDO' where id=q.id;
  return jsonb_build_object('status','RESERVADO','tentativa',token,'destinatarios',restantes,
    'cotacao',jsonb_build_object('id',q.id,'numero',q.numero,'titulo',q.titulo,'cliente_nome',q.cliente_nome,
      'vendedor_nome',q.vendedor_nome,'moeda',q.moeda,'total',q.documento->'total','aprovacao_status',q.aprovacao_status,
      'aprovacao_nome',q.aprovacao_nome,'aprovacao_em',q.aprovacao_em,'aprovacao_motivo',q.aprovacao_motivo));
end $$;
revoke all on function private.reservar_aviso_cotacao_impl(uuid,uuid) from public,anon,authenticated;
grant execute on function private.reservar_aviso_cotacao_impl(uuid,uuid) to service_role;
create function public.reservar_aviso_cotacao(p_cotacao_id uuid,p_ator_id uuid)
returns jsonb language sql security invoker set search_path=''
begin atomic select private.reservar_aviso_cotacao_impl(p_cotacao_id,p_ator_id); end;
revoke all on function public.reservar_aviso_cotacao(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reservar_aviso_cotacao(uuid,uuid) to service_role;

create function private.finalizar_aviso_cotacao_impl(p_cotacao_id uuid,p_tentativa uuid,p_aceitos text[],p_incerto boolean,p_erro text)
returns text language plpgsql security definer set search_path='' as $$
declare a private.cotacao_avisos; enviados text[]; estado text;
begin
  perform 1 from public.cotacoes where id=p_cotacao_id for update;
  select * into a from private.cotacao_avisos where cotacao_id=p_cotacao_id for update;
  if a.cotacao_id is null or a.tentativa is distinct from p_tentativa or p_tentativa is null then raise exception 'Tentativa de envio inválida.'; end if;
  select coalesce(array_agg(distinct x order by x),'{}') into enviados
    from unnest(a.aceitos || coalesce(p_aceitos,'{}')) x where x=any(a.destinatarios);
  estado:=case when p_incerto then 'INCERTO' when a.destinatarios<@enviados then 'ENVIADO' else 'ERRO' end;
  update private.cotacao_avisos set aceitos=enviados,tentativa=null,enviado_em=case when estado='ENVIADO' then now() else null end,
    erro=left(p_erro,300) where cotacao_id=p_cotacao_id;
  update public.cotacoes set aviso_status=estado where id=p_cotacao_id;
  return estado;
end $$;
revoke all on function private.finalizar_aviso_cotacao_impl(uuid,uuid,text[],boolean,text) from public,anon,authenticated;
grant execute on function private.finalizar_aviso_cotacao_impl(uuid,uuid,text[],boolean,text) to service_role;
create function public.finalizar_aviso_cotacao(p_cotacao_id uuid,p_tentativa uuid,p_aceitos text[],p_incerto boolean,p_erro text default null)
returns text language sql security invoker set search_path=''
begin atomic select private.finalizar_aviso_cotacao_impl(p_cotacao_id,p_tentativa,p_aceitos,p_incerto,p_erro); end;
revoke all on function public.finalizar_aviso_cotacao(uuid,uuid,text[],boolean,text) from public,anon,authenticated;
grant execute on function public.finalizar_aviso_cotacao(uuid,uuid,text[],boolean,text) to service_role;

create function private.exportar_cotacoes_impl(p_data_inicio date,p_data_fim date,p_vendedor_id uuid,p_cliente text,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare resultado jsonb;
begin
  if not exists(select 1 from public.usuarios where id=(select auth.uid()) and ativo and perfil in ('ADMIN','GERENTE','DIRETOR')) then
    raise exception 'Acesso restrito à gestão comercial.' using errcode='42501';
  end if;
  if p_data_inicio>p_data_fim then raise exception 'Período inválido.'; end if;
  if p_status is not null and p_status not in ('PENDENTE','APROVADA','REPROVADA') then raise exception 'Situação inválida.'; end if;
  with selecionadas as materialized (
    select c.* from public.cotacoes c
    where (p_data_inicio is null or c.created_at >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo'))
      and (p_data_fim is null or c.created_at < ((p_data_fim+1)::timestamp at time zone 'America/Sao_Paulo'))
      and (p_vendedor_id is null or c.vendedor_id=p_vendedor_id)
      and (nullif(btrim(p_cliente),'') is null or strpos(lower(c.cliente_nome),lower(btrim(p_cliente)))>0)
      and (p_status is null or c.aprovacao_status=p_status)
  ) select jsonb_build_object('versao',1,'gerado_em',now(),'filtros',jsonb_build_object(
    'data_inicio',p_data_inicio,'data_fim',p_data_fim,'vendedor_id',p_vendedor_id,'cliente',p_cliente,'situacao',p_status),
    'cotacoes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'numero',c.numero,'titulo',c.titulo,
      'created_at',c.created_at,'cliente_nome',c.cliente_nome,'vendedor_nome',c.vendedor_nome,'moeda',c.moeda,
      'validade',c.validade,'subtotal',c.documento->'subtotal','valor_ipi',c.documento->'valor_ipi','total',c.documento->'total',
      'aprovacao_status',c.aprovacao_status,'aprovacao_motivo',c.aprovacao_motivo,'aprovacao_nome',c.aprovacao_nome,
      'aprovacao_em',c.aprovacao_em,'aviso_status',c.aviso_status,'pedido_convertido_id',c.pedido_convertido_id,
      'observacoes',c.documento->>'observacoes') order by c.created_at,c.id) from selecionadas c),'[]'),
    'itens',coalesce((select jsonb_agg(jsonb_build_object('numero_cotacao',c.numero,'moeda',c.moeda,'posicao',i.n,'item',i.item)
      order by c.created_at,c.id,i.n) from selecionadas c cross join lateral jsonb_array_elements(c.documento->'itens') with ordinality i(item,n)),'[]')) into resultado;
  return resultado;
end $$;
revoke all on function private.exportar_cotacoes_impl(date,date,uuid,text,text) from public,anon;
grant execute on function private.exportar_cotacoes_impl(date,date,uuid,text,text) to authenticated;
create function public.exportar_cotacoes_comercial_v1(p_data_inicio date default null,p_data_fim date default null,p_vendedor_id uuid default null,p_cliente text default null,p_status text default null)
returns jsonb language sql security invoker set search_path=''
begin atomic select private.exportar_cotacoes_impl(p_data_inicio,p_data_fim,p_vendedor_id,p_cliente,p_status); end;
revoke all on function public.exportar_cotacoes_comercial_v1(date,date,uuid,text,text) from public,anon;
grant execute on function public.exportar_cotacoes_comercial_v1(date,date,uuid,text,text) to authenticated;
