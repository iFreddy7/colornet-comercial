alter table public.cotacoes
  add column if not exists frete_id uuid references public.fretes(id);

create index if not exists cotacoes_frete_id_idx
  on public.cotacoes(frete_id)
  where frete_id is not null;

create or replace function private.criar_cotacao_v4_impl(
  p_cabecalho jsonb,
  p_itens jsonb,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  frete public.fretes%rowtype;
  resultado jsonb;
  cotacao_id uuid;
begin
  select * into frete
  from public.fretes f
  where f.id = nullif(p_cabecalho->>'frete_id','')::uuid
    and f.ativo
    and upper(coalesce(f.codigo,'')) in ('CIF','FOB');

  if not found then
    raise exception 'Selecione um tipo de frete válido: CIF ou FOB.';
  end if;

  resultado := private.criar_cotacao_v3_impl(
    p_cabecalho,
    p_itens,
    p_idempotency_key
  );

  cotacao_id := nullif(resultado->>'id','')::uuid;

  if cotacao_id is not null then
    update public.cotacoes c
       set frete_id = frete.id,
           documento = jsonb_set(
             c.documento,
             '{frete}',
             jsonb_build_object(
               'id', frete.id,
               'codigo', frete.codigo,
               'descricao', frete.descricao
             ),
             true
           )
     where c.id = cotacao_id;
  end if;

  return resultado;
end;
$$;

revoke all on function private.criar_cotacao_v4_impl(jsonb,jsonb,uuid) from public,anon;
grant execute on function private.criar_cotacao_v4_impl(jsonb,jsonb,uuid) to authenticated;

create or replace function public.criar_cotacao_v4(
  p_cabecalho jsonb,
  p_itens jsonb,
  p_idempotency_key uuid
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.criar_cotacao_v4_impl(p_cabecalho,p_itens,p_idempotency_key);
$$;

revoke all on function public.criar_cotacao_v4(jsonb,jsonb,uuid) from public,anon;
grant execute on function public.criar_cotacao_v4(jsonb,jsonb,uuid) to authenticated;