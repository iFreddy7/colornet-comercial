-- Explicit billing branch is authoritative; null preserves legacy clients during rollout.
CREATE OR REPLACE FUNCTION private.calcular_preco_comercial_impl(p_cliente_id uuid, p_produto_id uuid, p_filial_id uuid, p_preco_net numeric, p_preco_final numeric, p_cotacao boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 u public.usuarios%rowtype; c public.clientes%rowtype; p public.produtos%rowtype;
 origem uuid:=p_filial_id; saldo numeric; calc jsonb; net numeric; final numeric;
begin
 select * into u from public.usuarios where id=auth.uid() and ativo;
 if not found then raise exception 'Usuário ativo obrigatório.' using errcode='42501'; end if;
 select * into c from public.clientes where id=p_cliente_id and ativo;
 if not found then raise exception 'Cliente indisponível.'; end if;
 if u.perfil not in ('ADMIN','GERENTE','DIRETOR') and (u.vendedor_id is null or c.vendedor_id is distinct from u.vendedor_id) then raise exception 'Cliente fora da carteira.' using errcode='42501'; end if;
 select * into p from public.produtos where id=p_produto_id and ativo;
 if not found then raise exception 'Produto indisponível.'; end if;
 if p_cotacao is null then raise exception 'Tipo de cálculo obrigatório.'; end if;
 if (p_preco_net is null and p_preco_final is null)
 or (p_preco_net is not null and not(p_preco_net>0 and p_preco_net<=100000000))
 or (p_preco_final is not null and not(p_preco_final>=0.01 and p_preco_final<=100000000)) then raise exception 'Informe um preço NET ou final válido.'; end if;
 if origem is not null and not exists(select 1 from public.filiais f where f.id=origem and f.ativo) then
  raise exception 'Selecione uma filial de faturamento ativa.';
 end if;
 if p_cotacao and origem is null then
  select d.filial_id,d.disponivel into origem,saldo from public.consultar_disponibilidade_produto(p_produto_id) d
  where d.disponivel>0 order by d.disponivel desc,d.filial_codigo,d.filial_id limit 1;
 end if;
 if origem is null and p_cotacao then
  calc:=jsonb_build_object('automatico',false,'motivo','Sem estoque imediato disponível para definir a origem. Informe NET, final e aprovação manual.','ipi',coalesce(p.ipi,0));
 else
  if origem is null then raise exception 'Filial obrigatória no pedido.'; end if;
  calc:=public.calcular_item_pedido(p_cliente_id,p_produto_id,origem,case when p_preco_final is null then p_preco_net else 1 end);
 end if;
 if coalesce((calc->>'automatico')::boolean,false) then
  if p_preco_final is not null then
   if coalesce((calc->>'divisor')::numeric,0)<=0 then raise exception 'Divisor não disponível para cálculo inverso.'; end if;
   final:=round(p_preco_final,2); net:=round(final*(calc->>'divisor')::numeric,4);
   if net<=0 then raise exception 'Preço NET resultante inválido.'; end if;
   if round(net/(calc->>'divisor')::numeric,2)<>final then raise exception 'Precisão insuficiente para esse preço final.'; end if;
  else net:=p_preco_net; final:=(calc->>'preco_final')::numeric; end if;
  calc:=calc||jsonb_build_object('preco_net',net,'preco_final',final);
 else calc:=calc||jsonb_build_object('preco_net',p_preco_net); end if;
 return calc||jsonb_build_object('filial_origem_id',origem,'estoque_disponivel',saldo,'ncm',p.ncm,'colour_index',nullif(trim(p.colour_index),''));
end;
$function$
;

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
    qtd:=nullif(item->>'quantidade','')::numeric; net:=(item->>'preco_net')::numeric;
    if qtd is not null and not(qtd>0 and qtd<=100000000) then raise exception 'Quantidade inválida.'; end if;
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
      'colour_index',nullif(trim(p.colour_index),''),'filial_origem_id',calc->'filial_origem_id','quantidade',qtd,'preco_net',net,'preco_final',final,
      'ipi',ipi,'aliquota_icms',calc->'aliquota','subtotal',sub,'valor_ipi',imposto,'total_item',sub+imposto,'fiscal',calc,'observacao_preco',obs));
  end loop;
  num:='COT-'||to_char(now() at time zone 'America/Sao_Paulo','YYYYMMDD')||'-'||upper(substr(replace(cid::text,'-',''),1,12));
  doc:=jsonb_build_object('versao',3,'numero',num,'titulo',titulo,'created_at',now(),'moeda',moeda,'validade',validade,
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
