alter table public.cotacoes
  add column if not exists validade date,
  add column if not exists prazo_pagamento_id uuid references public.prazos_pagamento(id);

alter table public.email_logs
  add column if not exists cotacao_id uuid references public.cotacoes(id);

create index if not exists email_logs_cotacao_tipo_status
  on public.email_logs(cotacao_id,tipo,status)
  where cotacao_id is not null;

create or replace function private.admin_cadastrar_vendedor_impl(
  p_codigo_protheus text,
  p_nome text,
  p_email text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  codigo text := nullif(trim(p_codigo_protheus),'');
  nome text := nullif(trim(p_nome),'');
  email text := lower(nullif(trim(p_email),''));
  novo public.vendedores%rowtype;
begin
  if not exists(
    select 1 from public.usuarios
    where id=auth.uid() and ativo and perfil='ADMIN'
  ) then
    raise exception 'Acesso restrito a ADMIN ativo.' using errcode='42501';
  end if;

  if codigo is null or length(codigo) > 40 then
    raise exception 'Informe o código do vendedor no Protheus.';
  end if;
  if nome is null or length(nome) > 120 then
    raise exception 'Informe o nome do vendedor.';
  end if;
  if email is null or length(email) > 254 or email !~* '^[^[:space:]@]+@colornet[.]com[.]br$' then
    raise exception 'Informe um e-mail corporativo @colornet.com.br válido.';
  end if;

  if exists(select 1 from public.vendedores where codigo_protheus=codigo) then
    raise exception 'Já existe um vendedor com este código Protheus.';
  end if;
  if exists(select 1 from public.vendedores where lower(coalesce(email,''))=email) then
    raise exception 'Já existe um vendedor com este e-mail.';
  end if;

  insert into public.vendedores(codigo_protheus,nome,email,ativo)
  values(codigo,nome,email,true)
  returning * into novo;

  return jsonb_build_object(
    'id',novo.id,
    'codigo_protheus',novo.codigo_protheus,
    'nome',novo.nome,
    'email',novo.email,
    'ativo',novo.ativo
  );
end;
$$;

revoke all on function private.admin_cadastrar_vendedor_impl(text,text,text) from public,anon;
grant execute on function private.admin_cadastrar_vendedor_impl(text,text,text) to authenticated;

create or replace function public.admin_cadastrar_vendedor(
  p_codigo_protheus text,
  p_nome text,
  p_email text
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.admin_cadastrar_vendedor_impl(p_codigo_protheus,p_nome,p_email);
$$;

revoke all on function public.admin_cadastrar_vendedor(text,text,text) from public,anon;
grant execute on function public.admin_cadastrar_vendedor(text,text,text) to authenticated;

create or replace function private.criar_cotacao_v3_impl(
  p_cabecalho jsonb,
  p_itens jsonb,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u public.usuarios%rowtype;
  c public.clientes%rowtype;
  v public.vendedores%rowtype;
  p public.produtos%rowtype;
  prazo public.prazos_pagamento%rowtype;
  existente public.cotacoes%rowtype;
  cid uuid := gen_random_uuid();
  num text;
  titulo text;
  moeda text;
  validade date;
  item jsonb;
  calc jsonb;
  items jsonb := '[]';
  qtd numeric;
  net numeric;
  final numeric;
  ipi numeric;
  sub numeric;
  imposto numeric;
  total numeric := 0;
  subtotal numeric := 0;
  impostos numeric := 0;
  obs text;
  doc jsonb;
  completa boolean := true;
  confirmado jsonb;
begin
  select * into u from public.usuarios where id=auth.uid() and ativo;
  if not found then
    raise exception 'Usuário ativo obrigatório.' using errcode='42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'Identificador de envio obrigatório.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(u.id::text||p_idempotency_key::text,0));

  select * into existente
  from public.cotacoes
  where created_by=u.id and idempotency_key=p_idempotency_key;

  if found then
    return jsonb_build_object('id',existente.id,'numero',existente.numero);
  end if;

  titulo := trim(p_cabecalho->>'titulo');
  moeda := p_cabecalho->>'moeda';

  if titulo is null or length(titulo) not between 1 and 180 then
    raise exception 'Título obrigatório (até 180 caracteres).';
  end if;
  if moeda is null or moeda not in ('USD','BRL') then
    raise exception 'Moeda inválida.';
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' then
    raise exception 'Itens inválidos.';
  end if;
  if jsonb_array_length(p_itens) not between 1 and 500 then
    raise exception 'Informe entre 1 e 500 itens.';
  end if;
  if length(coalesce(p_cabecalho->>'observacoes','')) > 10000 then
    raise exception 'Observações muito longas.';
  end if;

  begin
    validade := nullif(p_cabecalho->>'validade','')::date;
  exception when others then
    raise exception 'Validade da proposta inválida.';
  end;

  if validade is null then
    raise exception 'Informe a validade da proposta.';
  end if;
  if validade < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A validade da proposta não pode estar no passado.';
  end if;

  select * into prazo
  from public.prazos_pagamento
  where id=nullif(p_cabecalho->>'prazo_pagamento_id','')::uuid and ativo;

  if not found then
    raise exception 'Selecione um prazo de pagamento ativo.';
  end if;

  select * into c
  from public.clientes
  where id=(p_cabecalho->>'cliente_id')::uuid and ativo;

  if not found then
    raise exception 'Cliente indisponível.';
  end if;

  if u.perfil<>'ADMIN' and (u.vendedor_id is null or c.vendedor_id is distinct from u.vendedor_id) then
    raise exception 'Cliente fora da carteira.' using errcode='42501';
  end if;

  select * into v
  from public.vendedores
  where id=case
    when u.perfil='ADMIN' then coalesce(c.vendedor_id,nullif(p_cabecalho->>'vendedor_id','')::uuid)
    else u.vendedor_id
  end
  and ativo;

  if not found then
    raise exception 'Selecione um vendedor ativo.';
  end if;

  for item in select value from jsonb_array_elements(p_itens)
  loop
    qtd := nullif(item->>'quantidade','')::numeric;
    net := (item->>'preco_net')::numeric;

    if qtd is not null and not(qtd>0 and qtd<=100000000) then
      raise exception 'Quantidade inválida.';
    end if;
    if qtd is null then
      completa := false;
    end if;
    if coalesce(item->>'entrada_preco','NET') not in ('NET','FINAL') then
      raise exception 'Entrada de preço inválida.';
    end if;

    select * into p
    from public.produtos
    where id=(item->>'produto_id')::uuid and ativo;

    if not found then
      raise exception 'Produto indisponível.';
    end if;

    calc := public.calcular_preco_comercial(
      c.id,
      p.id,
      null,
      net,
      case when item->>'entrada_preco'='FINAL' then (item->>'preco_final')::numeric else null end,
      true
    );

    if coalesce((calc->>'automatico')::boolean,false) then
      net := (calc->>'preco_net')::numeric;
    end if;

    if net is null or not(net>0 and net<=100000000) then
      raise exception 'Preço NET inválido.';
    end if;

    obs := nullif(trim(item->>'observacao_preco'),'');

    if coalesce((calc->>'automatico')::boolean,false) then
      final := (calc->>'preco_final')::numeric;
    else
      final := (item->>'preco_final_manual')::numeric;
      if obs is null then
        raise exception 'Informe a aprovação do preço manual.';
      end if;
    end if;

    if final is null or not(final>0 and final<=100000000) then
      raise exception 'Preço final inválido.';
    end if;

    confirmado := item->'calculo_confirmado';
    if confirmado is not null and (
      (confirmado->>'automatico')::boolean is distinct from (calc->>'automatico')::boolean
      or (confirmado->>'filial_origem_id') is distinct from (calc->>'filial_origem_id')
      or (confirmado->>'preco_final')::numeric is distinct from final
      or (confirmado->>'preco_net')::numeric is distinct from net
      or (confirmado->>'divisor')::numeric is distinct from (calc->>'divisor')::numeric
    ) then
      raise exception 'Estoque ou regra fiscal mudou. Remova e adicione novamente o produto % para revisar os preços.',p.nome;
    end if;

    ipi := coalesce((calc->>'ipi')::numeric,0);
    if not(ipi>=0 and ipi<=1) then
      raise exception 'IPI inválido.';
    end if;

    sub := round(final*qtd,2);
    imposto := round(sub*ipi,2);
    subtotal := subtotal+coalesce(sub,0);
    impostos := impostos+coalesce(imposto,0);
    total := total+coalesce(sub+imposto,0);

    items := items || jsonb_build_array(jsonb_build_object(
      'produto_id',p.id,
      'codigo',p.codigo_protheus,
      'produto',p.nome,
      'ncm',p.ncm,
      'colour_index',nullif(trim(p.colour_index),''),
      'filial_origem_id',calc->'filial_origem_id',
      'quantidade',qtd,
      'preco_net',net,
      'preco_final',final,
      'ipi',ipi,
      'aliquota_icms',calc->'aliquota',
      'subtotal',sub,
      'valor_ipi',imposto,
      'total_item',sub+imposto,
      'fiscal',calc,
      'observacao_preco',obs
    ));
  end loop;

  num := 'COT-'||to_char(now() at time zone 'America/Sao_Paulo','YYYYMMDD')||'-'||upper(substr(replace(cid::text,'-',''),1,12));

  doc := jsonb_build_object(
    'versao',3,
    'numero',num,
    'titulo',titulo,
    'created_at',now(),
    'moeda',moeda,
    'validade',validade,
    'prazo_pagamento',jsonb_build_object(
      'id',prazo.id,
      'codigo',prazo.codigo,
      'descricao',prazo.descricao
    ),
    'cliente',jsonb_build_object(
      'codigo',c.codigo,
      'nome',c.razao_social,
      'cnpj_cpf',c.cnpj_cpf,
      'municipio',c.municipio,
      'uf',c.uf
    ),
    'vendedor',jsonb_build_object('nome',v.nome),
    'itens',items,
    'quantidades_completas',completa,
    'subtotal',case when completa then subtotal end,
    'valor_ipi',case when completa then impostos end,
    'total',case when completa then total end,
    'observacoes',p_cabecalho->>'observacoes'
  );

  insert into public.cotacoes(
    id,numero,titulo,created_by,vendedor_id,cliente_id,filial_id,moeda,
    observacoes,cliente_nome,vendedor_nome,documento,idempotency_key,
    validade,prazo_pagamento_id
  ) values(
    cid,num,titulo,u.id,v.id,c.id,null,moeda,
    p_cabecalho->>'observacoes',c.razao_social,v.nome,doc,p_idempotency_key,
    validade,prazo.id
  );

  return jsonb_build_object('id',cid,'numero',num);
end;
$$;

revoke all on function private.criar_cotacao_v3_impl(jsonb,jsonb,uuid) from public,anon;
grant execute on function private.criar_cotacao_v3_impl(jsonb,jsonb,uuid) to authenticated;

create or replace function public.criar_cotacao_v3(
  p_cabecalho jsonb,
  p_itens jsonb,
  p_idempotency_key uuid
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.criar_cotacao_v3_impl(p_cabecalho,p_itens,p_idempotency_key);
$$;

revoke all on function public.criar_cotacao_v3(jsonb,jsonb,uuid) from public,anon;
grant execute on function public.criar_cotacao_v3(jsonb,jsonb,uuid) to authenticated;
