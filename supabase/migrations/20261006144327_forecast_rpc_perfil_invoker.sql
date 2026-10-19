create or replace function public.forecast_salvar_v1(p_cliente_id uuid,p_vendedor_id uuid,p_inicio date,p_itens jsonb,p_revisao bigint)
returns bigint language plpgsql security invoker set search_path='' as $$
declare u public.usuarios%rowtype; atual public.forecast_planos%rowtype; documento jsonb; produto record; item jsonb; qtd record; meses text[]; chave text; novo jsonb; resultado bigint;
begin
  if auth.uid() is null or not exists(select 1 from public.usuarios where id=auth.uid() and ativo) then raise exception 'Usuário sem acesso.' using errcode='42501'; end if;
  select * into u from public.usuarios where id=auth.uid() and ativo;
  if p_cliente_id is null or p_vendedor_id is null or p_revisao is null or p_revisao<0 then raise exception 'Identificação inválida.'; end if;
  if not exists(select 1 from public.clientes c where c.id=p_cliente_id and c.ativo and
      ((u.perfil in ('ADMIN','GERENTE','DIRETOR')) or (p_vendedor_id=u.vendedor_id and c.vendedor_id=u.vendedor_id)))
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

