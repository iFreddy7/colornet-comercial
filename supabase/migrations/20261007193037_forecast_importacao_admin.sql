create table public.forecast_importacoes (
  id uuid primary key, criado_por uuid not null default auth.uid() references public.usuarios(id),
  criado_em timestamptz not null default now(), arquivo text not null,
  payload_hash text not null, resultado jsonb not null
);
alter table public.forecast_importacoes enable row level security;
revoke all on public.forecast_importacoes from public,anon,authenticated;
grant select,insert on public.forecast_importacoes to authenticated;
create policy forecast_importacoes_admin_ler on public.forecast_importacoes for select to authenticated
using(exists(select 1 from public.usuarios where id=auth.uid() and ativo and perfil='ADMIN'));
create policy forecast_importacoes_admin_criar on public.forecast_importacoes for insert to authenticated
with check(criado_por=auth.uid() and exists(select 1 from public.usuarios where id=auth.uid() and ativo and perfil='ADMIN'));
create index forecast_importacoes_autor on public.forecast_importacoes(criado_por);

create or replace function private.forecast_importar_impl(p_importacao_id uuid,p_arquivo text,p_planos jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare anterior public.forecast_importacoes; plano jsonb; atual public.forecast_planos; item jsonb; mes record;
  cliente uuid; vendedor uuid; produto uuid; documento jsonb; esperado bigint;
  hash text; resultado jsonb; alterados int:=0; celulas int:=0;
begin
  if not exists(select 1 from public.usuarios where id=auth.uid() and ativo and perfil='ADMIN') then raise exception 'Somente ADMIN ativo pode importar forecast.' using errcode='42501'; end if;
  if p_importacao_id is null or p_arquivo is null or length(p_arquivo) not between 1 and 200 then raise exception 'Identificação da importação inválida.'; end if;
  if jsonb_typeof(p_planos) is distinct from 'array' or jsonb_array_length(p_planos) not between 1 and 100 or pg_column_size(p_planos)>1000000 then raise exception 'Importe de 1 a 100 carteiras por arquivo, até 1 MB de dados.'; end if;
  hash:=md5(p_planos::text);
  perform pg_advisory_xact_lock(hashtextextended('forecast-import:'||p_importacao_id::text,0));
  select * into anterior from public.forecast_importacoes where id=p_importacao_id;
  if found then
    if anterior.criado_por<>auth.uid() or anterior.payload_hash<>hash then raise exception 'Identificador de importação já utilizado com outros dados.'; end if;
    return anterior.resultado||jsonb_build_object('ja_importado',true);
  end if;
  if (select count(distinct (x->>'cliente_id',x->>'vendedor_id')) from jsonb_array_elements(p_planos) x)<>jsonb_array_length(p_planos) then raise exception 'Carteiras repetidas na importação.'; end if;
  for plano in select value from jsonb_array_elements(p_planos) order by value->>'cliente_id',value->>'vendedor_id' loop
    cliente:=(plano->>'cliente_id')::uuid; vendedor:=(plano->>'vendedor_id')::uuid;
    esperado:=(plano->>'revisao')::bigint;
    if esperado is null or esperado<0 then raise exception 'Revisão de forecast inválida.'; end if;
    if not exists(select 1 from public.clientes where id=cliente and ativo and vendedor_id=vendedor)
      or not exists(select 1 from public.vendedores where id=vendedor and ativo) then raise exception 'Cliente fora da carteira atual ou cadastro inativo. Revise a planilha.'; end if;
    if jsonb_typeof(plano->'itens') is distinct from 'array' or jsonb_array_length(plano->'itens') not between 1 and 200 then raise exception 'Informe de 1 a 200 produtos por cliente.'; end if;
    if (select count(distinct x->>'produto_id') from jsonb_array_elements(plano->'itens') x)<>jsonb_array_length(plano->'itens') then raise exception 'Produtos repetidos no mesmo cliente.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(cliente::text||':'||vendedor::text,0));
    select * into atual from public.forecast_planos where cliente_id=cliente and vendedor_id=vendedor for update;
    if coalesce(atual.revisao,0)<>esperado then raise exception 'O forecast mudou após a revisão. Carregue o arquivo novamente.' using errcode='40001'; end if;
    documento:=coalesce(atual.documento,'{}'::jsonb);
    for item in select value from jsonb_array_elements(plano->'itens') loop
      produto:=(item->>'produto_id')::uuid;
      if not exists(select 1 from public.produtos where id=produto and ativo) then raise exception 'Produto inativo ou inexistente.'; end if;
      if jsonb_typeof(item->'quantidades') is distinct from 'object' or item->'quantidades'='{}'::jsonb then raise exception 'Informe pelo menos uma quantidade por produto.'; end if;
      for mes in select * from jsonb_each(item->'quantidades') loop
        if mes.key !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or jsonb_typeof(mes.value) is distinct from 'number'
          or (mes.value#>>'{}')::numeric<0 or (mes.value#>>'{}')::numeric>999999999
          or (mes.value#>>'{}')::numeric<>round((mes.value#>>'{}')::numeric,3) then raise exception 'Mês ou quantidade inválida na importação.'; end if;
        celulas:=celulas+1;
      end loop;
      documento:=documento||jsonb_build_object(produto::text,coalesce(documento->produto::text,'{}'::jsonb)||(item->'quantidades'));
    end loop;
    if documento is distinct from atual.documento then
      insert into public.forecast_planos(cliente_id,vendedor_id,documento) values(cliente,vendedor,documento)
      on conflict(cliente_id,vendedor_id) do update set documento=excluded.documento;
      alterados:=alterados+1;
    end if;
  end loop;
  resultado:=jsonb_build_object('sucesso',true,'planos_alterados',alterados,'celulas_informadas',celulas,'ja_importado',false);
  insert into public.forecast_importacoes(id,arquivo,payload_hash,resultado) values(p_importacao_id,p_arquivo,hash,resultado);
  return resultado;
end $$;
revoke all on function private.forecast_importar_impl(uuid,text,jsonb) from public,anon;
grant execute on function private.forecast_importar_impl(uuid,text,jsonb) to authenticated;
create or replace function public.forecast_importar_v1(p_importacao_id uuid,p_arquivo text,p_planos jsonb)
returns jsonb language sql security invoker set search_path=''
begin atomic select private.forecast_importar_impl(p_importacao_id,p_arquivo,p_planos); end;
revoke all on function public.forecast_importar_v1(uuid,text,jsonb) from public,anon;
grant execute on function public.forecast_importar_v1(uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
