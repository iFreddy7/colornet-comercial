-- Preserva aprovação, idempotência, permissões e os preços do documento original.
CREATE OR REPLACE FUNCTION private.criar_cotacao_v3_impl(p_cabecalho jsonb, p_itens jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  u public.usuarios%rowtype; c public.clientes%rowtype; v public.vendedores%rowtype; p public.produtos%rowtype;
  filial public.filiais%rowtype; filial_id_selecionada uuid;
  prazo public.prazos_pagamento%rowtype; existente public.cotacoes%rowtype;
  cid uuid:=gen_random_uuid(); num text; titulo text; moeda text; validade date;
  item jsonb; calc jsonb; items jsonb:='[]'; qtd numeric; net numeric; final numeric; ipi numeric;
  sub numeric; imposto numeric; total numeric:=0; subtotal numeric:=0; impostos numeric:=0;
  obs text; doc jsonb; completa boolean:=true; confirmado jsonb;
begin
  select * into u from public.usuarios where id=auth.uid() and ativo;
  if not found then raise exception 'Usuário ativo obrigatório.' using errcode='42501'; end if;
  if p_idempotency_key is null then raise exception 'Identificador de envio obrigatório.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u.id::text||p_idempotency_key::text,0));
  select * into existente from public.cotacoes where created_by=u.id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('id',existente.id,'numero',existente.numero); end if;
  if coalesce(p_cabecalho->>'tipo_documento','LISTA_PRECOS') not in ('COTACAO','LISTA_PRECOS') then raise exception 'Tipo de documento inválido.'; end if;
  titulo:=trim(p_cabecalho->>'titulo'); moeda:=p_cabecalho->>'moeda';
  if titulo is null or length(titulo) not between 1 and 180 then raise exception 'Título obrigatório (até 180 caracteres).'; end if;
  if moeda is null or moeda not in ('USD','BRL') then raise exception 'Moeda inválida.'; end if;
  if jsonb_typeof(p_itens) is distinct from 'array' then raise exception 'Itens inválidos.'; end if;
  if jsonb_array_length(p_itens) not between 1 and 500 then raise exception 'Informe entre 1 e 500 itens.'; end if;
  if length(coalesce(p_cabecalho->>'observacoes',''))>10000 then raise exception 'Observações muito longas.'; end if;
  begin validade:=nullif(p_cabecalho->>'validade','')::date; exception when others then raise exception 'Validade da proposta inválida.'; end;
  if validade is null then raise exception 'Informe a validade da proposta.'; end if;
  if validade<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'A validade da proposta não pode estar no passado.'; end if;
  select * into prazo from public.prazos_pagamento pp where pp.id=nullif(p_cabecalho->>'prazo_pagamento_id','')::uuid and pp.ativo;
  if not found then raise exception 'Selecione um prazo de pagamento ativo.'; end if;
  select * into c from public.clientes cl where cl.id=(p_cabecalho->>'cliente_id')::uuid and cl.ativo;
  if not found then raise exception 'Cliente indisponível.'; end if;
  if u.perfil not in ('ADMIN','GERENTE','DIRETOR') and (u.vendedor_id is null or c.vendedor_id is distinct from u.vendedor_id) then raise exception 'Cliente fora da carteira.' using errcode='42501'; end if;
  select * into v from public.vendedores vend where vend.id=case when u.perfil in ('ADMIN','GERENTE','DIRETOR') then coalesce(c.vendedor_id,nullif(p_cabecalho->>'vendedor_id','')::uuid) else u.vendedor_id end and vend.ativo;
  if not found then raise exception 'Selecione um vendedor ativo.'; end if;
  filial_id_selecionada:=nullif(p_cabecalho->>'filial_id','')::uuid;
  if filial_id_selecionada is not null then
    select * into filial from public.filiais f where f.id=filial_id_selecionada and f.ativo;
    if not found then raise exception 'Selecione uma filial de faturamento ativa.'; end if;
  end if;
  for item in select value from jsonb_array_elements(p_itens) loop
    if nullif(item->>'prazo_entrega','') is not null then
      if (item->>'prazo_entrega') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data de entrega inválida.'; end if;
      perform (item->>'prazo_entrega')::date;
    end if;
    qtd:=nullif(item->>'quantidade','')::numeric; net:=(item->>'preco_net')::numeric;
    if qtd is not null and not(qtd>0 and qtd<=100000000) then raise exception 'Quantidade inválida.'; end if;
    if qtd is null and p_cabecalho->>'tipo_documento'='COTACAO' then raise exception 'Informe a quantidade de todos os produtos da cotação.'; end if;
    if qtd is null then completa:=false; end if;
    if coalesce(item->>'entrada_preco','NET') not in ('NET','FINAL') then raise exception 'Entrada de preço inválida.'; end if;
    select * into p from public.produtos prod where prod.id=(item->>'produto_id')::uuid and prod.ativo;
    if not found then raise exception 'Produto indisponível.'; end if;
    calc:=public.calcular_preco_comercial(c.id,p.id,filial_id_selecionada,net,case when item->>'entrada_preco'='FINAL' then (item->>'preco_final')::numeric else null end,true);
    if coalesce((calc->>'automatico')::boolean,false) then net:=(calc->>'preco_net')::numeric; end if;
    if net is null or not(net>0 and net<=100000000) then raise exception 'Preço NET inválido.'; end if;
    obs:=nullif(trim(item->>'observacao_preco'),'');
    if coalesce((calc->>'automatico')::boolean,false) then final:=(calc->>'preco_final')::numeric;
    else final:=(item->>'preco_final_manual')::numeric; if obs is null then raise exception 'Informe a aprovação do preço manual.'; end if; end if;
    if final is null or not(final>0 and final<=100000000) then raise exception 'Preço final inválido.'; end if;
    confirmado:=item->'calculo_confirmado';
    if confirmado is not null and (
      (confirmado->>'automatico')::boolean is distinct from (calc->>'automatico')::boolean
      or (confirmado->>'filial_origem_id') is distinct from (calc->>'filial_origem_id')
      or (confirmado->>'preco_final')::numeric is distinct from final
      or (confirmado->>'preco_net')::numeric is distinct from net
      or (confirmado->>'divisor')::numeric is distinct from (calc->>'divisor')::numeric
    ) then raise exception 'Estoque ou regra fiscal mudou. Remova e adicione novamente o produto % para revisar os preços.',p.nome; end if;
    ipi:=coalesce((calc->>'ipi')::numeric,0);
    if not(ipi>=0 and ipi<=1) then raise exception 'IPI inválido.'; end if;
    sub:=round(final*qtd,2); imposto:=round(sub*ipi,2);
    subtotal:=subtotal+coalesce(sub,0); impostos:=impostos+coalesce(imposto,0); total:=total+coalesce(sub+imposto,0);
    items:=items||jsonb_build_array(jsonb_build_object('produto_id',p.id,'codigo',p.codigo_protheus,'produto',p.nome,'ncm',p.ncm,
      'colour_index',nullif(trim(p.colour_index),''),'filial_origem_id',calc->'filial_origem_id','prazo_entrega',btrim(item->>'prazo_entrega'),'quantidade',qtd,'preco_net',net,'preco_final',final,
      'ipi',ipi,'aliquota_icms',calc->'aliquota','subtotal',sub,'valor_ipi',imposto,'total_item',sub+imposto,'fiscal',calc,'observacao_preco',obs));
  end loop;
  num:='COT-'||to_char(now() at time zone 'America/Sao_Paulo','YYYYMMDD')||'-'||upper(substr(replace(cid::text,'-',''),1,12));
  doc:=jsonb_build_object('tipo_documento',coalesce(p_cabecalho->>'tipo_documento','LISTA_PRECOS'),'versao',3,'numero',num,'titulo',titulo,'created_at',now(),'moeda',moeda,'validade',validade,
    'prazo_pagamento',jsonb_build_object('id',prazo.id,'codigo',prazo.codigo,'descricao',prazo.descricao),
    'cliente',jsonb_build_object('codigo',c.codigo,'nome',c.razao_social,'cnpj_cpf',c.cnpj_cpf,'municipio',c.municipio,'uf',c.uf),
    'vendedor',jsonb_build_object('nome',v.nome),'itens',items,'quantidades_completas',completa,
    'subtotal',case when completa then subtotal end,'valor_ipi',case when completa then impostos end,'total',case when completa then total end,
    'observacoes',p_cabecalho->>'observacoes');
  if filial_id_selecionada is not null then
    doc:=doc||jsonb_build_object('filial',jsonb_build_object('id',filial.id,'codigo',filial.codigo,'nome',filial.nome,'uf',filial.uf));
  end if;
  insert into public.cotacoes(id,numero,titulo,created_by,vendedor_id,cliente_id,filial_id,moeda,observacoes,cliente_nome,vendedor_nome,documento,idempotency_key,validade,prazo_pagamento_id)
  values(cid,num,titulo,u.id,v.id,c.id,filial_id_selecionada,moeda,p_cabecalho->>'observacoes',c.razao_social,v.nome,doc,p_idempotency_key,validade,prazo.id);
  return jsonb_build_object('id',cid,'numero',num);
end;
$function$
;
CREATE OR REPLACE FUNCTION private.converter_cotacao_pedido_impl(p_cotacao_id uuid, p_cabecalho jsonb, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  u public.usuarios%rowtype;
  q public.cotacoes%rowtype;
  source_item jsonb; requested jsonb;
  items jsonb := '[]'::jsonb; result jsonb; header jsonb;
  branch_id uuid; quantity numeric; net numeric;
  idx integer; source_idx integer; seen integer[] := ARRAY[]::integer[]; pid uuid;
begin
  select * into u from public.usuarios where id = (select auth.uid()) and ativo;
  if not found then raise exception 'Usuário não autenticado ou inativo.'; end if;
  select * into q from public.cotacoes where id = p_cotacao_id for update;
  if not found or (q.created_by <> u.id and u.perfil not in ('ADMIN','GERENTE','DIRETOR')) then
    raise exception 'Cotação não encontrada ou sem permissão.';
  end if;
  if q.pedido_convertido_id is not null then
    return (select jsonb_build_object('sucesso',true,'pedido_id',p.id,'numero',p.numero,
      'duplicado_bloqueado',true,'cotacao_numero',q.numero)
      from public.pedidos p where p.id=q.pedido_convertido_id);
  end if;
  if q.aprovacao_status is distinct from 'APROVADA' then
    raise exception 'A cotação precisa ser aprovada por Gerente ou Diretor antes de virar pedido.';
  end if;
  if q.validade is null or q.validade < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Cotação vencida ou sem validade. Emita uma nova proposta antes de converter.';
  end if;
  if jsonb_typeof(p_cabecalho) is distinct from 'object' then raise exception 'Informe os dados do pedido.'; end if;
  if (p_cabecalho->>'cliente_id')::uuid is distinct from q.cliente_id
     or p_cabecalho->>'moeda' is distinct from q.moeda then
    raise exception 'Cliente e moeda devem corresponder à cotação.';
  end if;
  branch_id := nullif(p_cabecalho->>'filial_id','')::uuid;
  if not exists(select 1 from public.filiais where id=branch_id and ativo) then raise exception 'Selecione uma filial ativa.'; end if;
  if not exists(select 1 from public.prazos_pagamento where id=nullif(p_cabecalho->>'prazo_pagamento_id','')::uuid and ativo)
     or not exists(select 1 from public.fretes where id=nullif(p_cabecalho->>'frete_id','')::uuid and ativo) then
    raise exception 'Revise o prazo de pagamento e o frete.';
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_typeof(q.documento->'itens') is distinct from 'array' then
    raise exception 'Itens inválidos.';
  end if;
  if jsonb_array_length(p_itens)=0 or jsonb_array_length(p_itens)>500 then
    raise exception 'Revise todos os itens da cotação.';
  end if;
  -- The quote UUID is the server-owned idempotency key; never trust a new browser key.
  if exists(select 1 from public.pedido_idempotencia where chave=q.id) then
    raise exception 'Identificador já utilizado em outro pedido. Solicite revisão ao administrador.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('COLORNET_ESTOQUE_GLOBAL',0));
  for idx in 0..jsonb_array_length(p_itens)-1 loop
    requested := p_itens->idx;
    source_idx := coalesce((requested->>'item_indice')::integer,idx);
    if source_idx<0 or source_idx>=jsonb_array_length(q.documento->'itens') or source_idx=any(seen) then raise exception 'Seleção de produtos inválida ou repetida.'; end if;
    seen:=array_append(seen,source_idx);
    source_item := q.documento->'itens'->source_idx;
    if requested->>'produto_id' is distinct from source_item->>'produto_id' then raise exception 'Os produtos devem corresponder à cotação.'; end if;
    if not exists(select 1 from public.produtos where id=(source_item->>'produto_id')::uuid and ativo) then raise exception 'Há produto inativo ou indisponível.'; end if;
    quantity := nullif(requested->>'quantidade','')::numeric;
    if quantity is distinct from round(quantity,3) then raise exception 'Informe quantidade com até três casas decimais.'; end if;
    net := nullif(source_item->>'preco_net','')::numeric;
    if quantity is null or not(quantity>0 and quantity<=1000000000)
      or net is null or not(net>0 and net<=1000000000) then raise exception 'Informe quantidade e preço válidos em todos os itens.'; end if;
    -- A browser still running the old review screen must not confirm different prices.
    if requested->'calculo_confirmado' is not null and requested->'calculo_confirmado'<>'null'::jsonb
       and ((requested->'calculo_confirmado'->>'preco_final')::numeric is distinct from (source_item->>'preco_final')::numeric
         or (requested->'calculo_confirmado'->>'preco_net')::numeric is distinct from net
         or (requested->'calculo_confirmado'->>'ipi')::numeric is distinct from coalesce((source_item->>'ipi')::numeric,(source_item->'fiscal'->>'ipi')::numeric)) then
      raise exception 'Atualize a página para usar os preços da cotação aprovada, sem recálculo.';
    end if;
    items := items || jsonb_build_array(jsonb_build_object('produto_id',source_item->>'produto_id',
      'quantidade',quantity,'item_indice',source_idx));
  end loop;
  header := p_cabecalho || jsonb_build_object('cliente_id',q.cliente_id,'moeda',q.moeda,'vendedor_id',q.vendedor_id,
    'observacoes',concat('Convertido da cotação ',q.numero,'. ',coalesce(p_cabecalho->>'observacoes','')));
  result := private.criar_pedido_cotacao_v4_impl(header,items,q.id,q.id);
  pid := nullif(result->>'pedido_id','')::uuid;
  if pid is null or coalesce((result->>'duplicado_bloqueado')::boolean,false) then
    raise exception 'Não foi possível vincular a cotação a um novo pedido.';
  end if;
  update public.cotacoes set pedido_convertido_id=pid,convertida_em=now() where id=q.id;
  return result || jsonb_build_object('cotacao_numero',q.numero);
end;
$function$
;
CREATE OR REPLACE FUNCTION private.criar_pedido_cotacao_impl(p_cabecalho jsonb, p_itens jsonb, p_cotacao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  q public.cotacoes%rowtype; source_item jsonb; item_index integer := 0;
  v_uid uuid := (select auth.uid());
  v_usuario public.usuarios%rowtype;
  v_cliente public.clientes%rowtype;
  v_cliente_id uuid; v_filial_id uuid; v_vendedor_id uuid;
  v_prazo uuid; v_frete uuid; v_numero text; v_pedido_id uuid;
  v_item jsonb; v_produto_id uuid; v_quantidade numeric; v_preco_net numeric;
  v_preco_final numeric; v_observacao_preco text; v_faixa text;
  v_calc jsonb; v_auto boolean; v_aliquota numeric; v_divisor numeric; v_ipi numeric;
  v_subtotal numeric; v_valor_ipi numeric; v_total_item numeric;
  v_subtotal_pedido numeric:=0; v_ipi_pedido numeric:=0; v_total_pedido numeric:=0; v_qtd_itens integer:=0;
begin
  if v_uid is null then raise exception 'Sessão expirada ou usuário não autenticado.'; end if;
  select * into v_usuario from public.usuarios where id=v_uid and ativo=true;
  if not found then raise exception 'Usuário não possui perfil ativo.'; end if;
  if p_cabecalho is null then raise exception 'Cabeçalho do pedido não informado.'; end if;
  if p_itens is null or jsonb_typeof(p_itens)<>'array' or jsonb_array_length(p_itens)=0 then raise exception 'O pedido precisa possuir pelo menos um item.'; end if;
  select * into q from public.cotacoes where id=p_cotacao_id for update;
  if not found or (q.created_by<>v_uid and v_usuario.perfil not in ('ADMIN','GERENTE','DIRETOR'))
     or q.aprovacao_status is distinct from 'APROVADA' or q.pedido_convertido_id is not null
     or q.validade is null or q.validade < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Cotação indisponível para conversão.';
  end if;
  if (p_cabecalho->>'cliente_id')::uuid is distinct from q.cliente_id
     or p_cabecalho->>'moeda' is distinct from q.moeda then
    raise exception 'Os dados devem corresponder à cotação aprovada.';
  end if;
  v_cliente_id:=nullif(p_cabecalho->>'cliente_id','')::uuid;
  v_filial_id:=nullif(p_cabecalho->>'filial_id','')::uuid;
  v_prazo:=nullif(p_cabecalho->>'prazo_pagamento_id','')::uuid;
  v_frete:=nullif(p_cabecalho->>'frete_id','')::uuid;
  if v_cliente_id is null or v_filial_id is null then raise exception 'Cliente e filial são obrigatórios.'; end if;
  select * into v_cliente from public.clientes where id=v_cliente_id and ativo=true;
  if not found then raise exception 'Cliente não encontrado ou inativo.'; end if;
  if v_usuario.perfil in ('ADMIN','GERENTE','DIRETOR') then
    v_vendedor_id:=q.vendedor_id;
    if v_vendedor_id is null then raise exception 'Cliente sem vendedor. Informe um vendedor para o pedido.'; end if;
  else
    if v_usuario.vendedor_id is null then raise exception 'Seu usuário não está vinculado a um vendedor.'; end if;
    if v_cliente.vendedor_id is distinct from v_usuario.vendedor_id then raise exception 'Cliente fora da sua carteira.'; end if;
    if q.vendedor_id is distinct from v_usuario.vendedor_id then raise exception 'Vendedor diferente da cotação.'; end if;
    v_vendedor_id:=q.vendedor_id;
  end if;
  if not exists(select 1 from public.filiais f where f.id=v_filial_id and f.ativo=true) then raise exception 'Filial inválida.'; end if;
  v_numero:=private.gerar_numero_pedido();
  insert into public.pedidos(numero,created_by,vendedor_id,cliente_id,filial_id,moeda,prazo_pagamento_id,frete_id,transportadora,data_entrega,observacoes_transporte,observacoes,status)
  values(v_numero,v_uid,v_vendedor_id,v_cliente_id,v_filial_id,
    case when upper(coalesce(p_cabecalho->>'moeda','USD'))='BRL' then 'BRL' else 'USD' end,
    v_prazo,v_frete,nullif(trim(p_cabecalho->>'transportadora'),''),nullif(p_cabecalho->>'data_entrega','')::date,
    nullif(trim(p_cabecalho->>'observacoes_transporte'),''),nullif(trim(p_cabecalho->>'observacoes'),''),'ABERTO')
  returning id into v_pedido_id;
  for v_item in select value from jsonb_array_elements(p_itens) loop
    v_produto_id:=nullif(v_item->>'produto_id','')::uuid;
    v_quantidade:=nullif(v_item->>'quantidade','')::numeric;
    source_item:=q.documento->'itens'->coalesce((v_item->>'item_indice')::integer,item_index);
    if source_item is null then raise exception 'Item da cotação inexistente.'; end if;
    item_index:=item_index+1;
    if v_produto_id is distinct from (source_item->>'produto_id')::uuid then raise exception 'Os produtos devem corresponder à cotação.'; end if;
    v_preco_net:=nullif(source_item->>'preco_net','')::numeric;
    v_observacao_preco:=nullif(trim(source_item->>'observacao_preco'),'');
    v_faixa:=coalesce(nullif(trim(source_item->>'faixa_interna'),''),nullif(trim(source_item->'fiscal'->>'faixa_interna'),''));
    if v_produto_id is null or v_quantidade is null or v_quantidade<=0 or v_preco_net is null or v_preco_net<=0 then
      raise exception 'Item inválido: produto, quantidade e preço NET são obrigatórios.';
    end if;
    -- Only the locked, approved database document supplies unit prices and taxes.
    -- Browser values and current pricing rules cannot change an approved proposal.
    v_calc:=coalesce(source_item->'fiscal','{}'::jsonb);
    v_auto:=coalesce((v_calc->>'automatico')::boolean,false);
    v_preco_final:=nullif(source_item->>'preco_final','')::numeric;
    v_ipi:=coalesce(nullif(source_item->>'ipi','')::numeric,nullif(v_calc->>'ipi','')::numeric);
    v_aliquota:=coalesce(nullif(source_item->>'aliquota_icms','')::numeric,nullif(v_calc->>'aliquota','')::numeric);
    v_divisor:=nullif(v_calc->>'divisor','')::numeric;
    if v_preco_net is null or not(v_preco_net>0 and v_preco_net<=1000000000)
       or v_preco_final is null or not(v_preco_final>0 and v_preco_final<=1000000000)
       or v_ipi is null or not(v_ipi>=0 and v_ipi<=1)
       or (v_aliquota is not null and not(v_aliquota>=0 and v_aliquota<=1))
       or (v_divisor is not null and not(v_divisor>0 and v_divisor<=1)) then
      raise exception 'A cotação não possui preços e impostos válidos para conversão. Emita uma nova proposta.';
    end if;
    v_subtotal:=round(v_preco_final*v_quantidade,2);
    v_valor_ipi:=round(v_subtotal*v_ipi,2);
    v_total_item:=round(v_subtotal+v_valor_ipi,2);
    insert into public.pedido_itens(pedido_id,produto_id,quantidade,preco_net,preco_final,aliquota_icms,divisor_icms,ipi,valor_ipi,subtotal,total_item,modo_fiscal,regra_icms,motivo_fiscal,faixa_interna,observacao_preco)
    values(v_pedido_id,v_produto_id,v_quantidade,v_preco_net,v_preco_final,v_aliquota,v_divisor,v_ipi,v_valor_ipi,v_subtotal,v_total_item,
      case when v_auto then 'AUTOMATICO' else 'MANUAL' end,nullif(v_calc->>'regra',''),case when v_auto then null else nullif(v_calc->>'motivo','') end,v_faixa,v_observacao_preco);
    v_subtotal_pedido:=v_subtotal_pedido+v_subtotal;
    v_ipi_pedido:=v_ipi_pedido+v_valor_ipi;
    v_total_pedido:=v_total_pedido+v_total_item;
    v_qtd_itens:=v_qtd_itens+1;
  end loop;
  update public.pedidos set subtotal=round(v_subtotal_pedido,2),valor_ipi=round(v_ipi_pedido,2),total=round(v_total_pedido,2) where id=v_pedido_id;
  return jsonb_build_object('sucesso',true,'pedido_id',v_pedido_id,'numero',v_numero,'itens',v_qtd_itens,'subtotal',round(v_subtotal_pedido,2),'valor_ipi',round(v_ipi_pedido,2),'total',round(v_total_pedido,2));
end;
$function$
;

create or replace function private.validar_nova_cotacao_prazos()
returns trigger language plpgsql security invoker set search_path='' as $$
declare emissao date := (new.created_at at time zone 'America/Sao_Paulo')::date; item jsonb;
begin
 if new.validade is null or new.validade<emissao or new.validade>emissao+30 then raise exception 'A validade deve estar entre a inclusão e 30 dias após essa data.'; end if;
 if jsonb_typeof(new.documento->'itens') is distinct from 'array' then raise exception 'Itens inválidos.'; end if;
 for item in select value from jsonb_array_elements(new.documento->'itens') loop
  if new.documento->>'tipo_documento'='COTACAO' and (nullif(item->>'quantidade','') is null or not ((item->>'quantidade')::numeric>0 and (item->>'quantidade')::numeric<=100000000)) then raise exception 'Informe quantidade em todos os produtos da cotação.'; end if;
  if nullif(item->>'prazo_entrega','') is not null then
   if (item->>'prazo_entrega') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data de entrega inválida.'; end if;
   perform (item->>'prazo_entrega')::date;
  end if;
 end loop;
 return new;
end $$;
revoke all on function private.validar_nova_cotacao_prazos() from public,anon,authenticated;

create or replace function public.buscar_produtos_cotacao_estoque(p_termo text)
returns setof jsonb language sql stable security invoker set search_path='' as $$
 select to_jsonb(p)||jsonb_build_object('precos',(select coalesce(jsonb_agg(to_jsonb(pr)),'[]'::jsonb) from public.precos pr where pr.produto_id=p.id))
 from public.produtos p
 where p.ativo and length(btrim(p_termo))>=2 and length(p_termo)<=120
 and (p.nome ilike '%'||p_termo||'%' or p.codigo_protheus ilike '%'||p_termo||'%' or p.colour_index ilike '%'||p_termo||'%')
 and (exists(select 1 from public.consultar_disponibilidade_produto(p.id) d where d.disponivel>0)
 or exists(select 1 from public.consultar_previsoes_disponiveis_produto(p.id) e where e.quantidade_prevista>0))
 order by p.nome,p.codigo_protheus limit 50;
$$;
revoke all on function public.buscar_produtos_cotacao_estoque(text) from public,anon;
grant execute on function public.buscar_produtos_cotacao_estoque(text) to authenticated;

-- Return only the last payment term, after checking current portfolio access.
create or replace function private.ultimo_prazo_cliente_impl(p_cliente_id uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare u public.usuarios; prazo uuid;
begin
 select * into u from public.usuarios where id=auth.uid() and ativo;
 if not found then raise exception 'Usuário ativo obrigatório.'; end if;
 if not exists(select 1 from public.clientes c where c.id=p_cliente_id and c.ativo and (u.perfil in ('ADMIN','GERENTE','DIRETOR') or c.vendedor_id=u.vendedor_id)) then raise exception 'Cliente fora da carteira.'; end if;
 select c.prazo_pagamento_id into prazo from public.cotacoes c join public.prazos_pagamento p on p.id=c.prazo_pagamento_id and p.ativo
 where c.cliente_id=p_cliente_id order by c.created_at desc,c.id desc limit 1;
 return prazo;
end $$;
revoke all on function private.ultimo_prazo_cliente_impl(uuid) from public,anon;
grant execute on function private.ultimo_prazo_cliente_impl(uuid) to authenticated;
create or replace function public.ultimo_prazo_cliente(p_cliente_id uuid)
returns uuid language sql stable security invoker set search_path='' begin atomic select private.ultimo_prazo_cliente_impl(p_cliente_id); end;
revoke all on function public.ultimo_prazo_cliente(uuid) from public,anon;
grant execute on function public.ultimo_prazo_cliente(uuid) to authenticated;
notify pgrst,'reload schema';

