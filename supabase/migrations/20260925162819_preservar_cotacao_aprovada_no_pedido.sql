-- Approved quotes preserve their database snapshot, including NET, final price and IPI.
-- Ordinary order creation remains unchanged. These private quote-only helpers reproduce
-- the existing v3/v4 reservation workflow; keep allocation fixes synchronized with it.
-- No client can call these helpers or opt into approved pricing through JSON fields.

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
     or p_cabecalho->>'moeda' is distinct from q.moeda
     or jsonb_array_length(p_itens) is distinct from jsonb_array_length(q.documento->'itens') then
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
    source_item:=q.documento->'itens'->item_index;
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
$function$;

CREATE OR REPLACE FUNCTION private.criar_pedido_cotacao_v3_impl(p_cabecalho jsonb, p_itens jsonb, p_idempotency_key uuid, p_cotacao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid:=auth.uid(); v_inseriu uuid; v_existente uuid; v_res jsonb; v_pid uuid; v_filial_id uuid;
  v_produto_id uuid; v_qtd_solicitada numeric; v_estoque_erp numeric; v_data_base timestamptz;
  v_impacto_movimentos numeric; v_saldo_antes numeric; v_qtd_reservada numeric; v_saldo_depois numeric; v_nao_coberto numeric;
  v_total_solicitado numeric:=0; v_total_reservado numeric:=0; v_total_nao_coberto numeric:=0; v_alocacoes jsonb:='[]'::jsonb;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;
  if p_idempotency_key is null then raise exception 'Chave de idempotência obrigatória.'; end if;
  insert into public.pedido_idempotencia(chave,created_by) values(p_idempotency_key,v_uid)
  on conflict(chave) do nothing returning chave into v_inseriu;
  if v_inseriu is null then
    select pedido_id into v_existente from public.pedido_idempotencia where chave=p_idempotency_key and created_by=v_uid;
    if v_existente is null then raise exception 'Esta solicitação já está sendo processada.'; end if;
    return (
      select jsonb_build_object('sucesso',true,'pedido_id',p.id,'numero',p.numero,'subtotal',p.subtotal,'valor_ipi',p.valor_ipi,'total',p.total,'duplicado_bloqueado',true,
        'estoque',jsonb_build_object('alocacoes',coalesce((select jsonb_agg(jsonb_build_object(
          'produto_id',m.produto_id,'quantidade_solicitada',m.quantidade_solicitada,'quantidade_reservada',m.quantidade,
          'nao_coberto_imediato',greatest(m.quantidade_solicitada-m.quantidade,0),'saldo_antes',m.saldo_antes,'saldo_depois',m.saldo_depois)
          order by m.criado_em,m.produto_id) from public.movimentos_estoque m where m.pedido_id=p.id and m.tipo='SAIDA_PEDIDO'),'[]'::jsonb)))
      from public.pedidos p where p.id=v_existente
    );
  end if;
  perform pg_advisory_xact_lock(hashtextextended('COLORNET_ESTOQUE_GLOBAL',0));
  v_res:=private.criar_pedido_cotacao_impl(p_cabecalho,p_itens,p_cotacao_id);
  v_pid:=nullif(v_res->>'pedido_id','')::uuid;
  if v_pid is null then raise exception 'Pedido criado sem identificador.'; end if;
  select filial_id into v_filial_id from public.pedidos where id=v_pid;
  if v_filial_id is null then raise exception 'Pedido criado sem filial.'; end if;
  for v_produto_id,v_qtd_solicitada in
    select pi.produto_id,sum(pi.quantidade)::numeric from public.pedido_itens pi where pi.pedido_id=v_pid group by pi.produto_id order by pi.produto_id
  loop
    v_estoque_erp:=0; v_data_base:=null; v_impacto_movimentos:=0;
    select e.quantidade,e.atualizado_em into v_estoque_erp,v_data_base from public.estoque e where e.produto_id=v_produto_id and e.filial_id=v_filial_id;
    if not found then v_estoque_erp:=0; v_data_base:=null; end if;
    if v_data_base is not null then
      select coalesce(sum(case when m.tipo in ('SAIDA_PEDIDO','AJUSTE_SAIDA') then m.quantidade when m.tipo in ('ESTORNO_PEDIDO','AJUSTE_ENTRADA') then -m.quantidade else 0 end),0)
      into v_impacto_movimentos from public.movimentos_estoque m where m.produto_id=v_produto_id and m.filial_id=v_filial_id and m.criado_em>v_data_base;
    end if;
    v_saldo_antes:=greatest(coalesce(v_estoque_erp,0)-coalesce(v_impacto_movimentos,0),0);
    v_qtd_reservada:=least(v_qtd_solicitada,v_saldo_antes);
    v_saldo_depois:=greatest(v_saldo_antes-v_qtd_reservada,0);
    v_nao_coberto:=greatest(v_qtd_solicitada-v_qtd_reservada,0);
    insert into public.movimentos_estoque(pedido_id,produto_id,filial_id,quantidade_solicitada,quantidade,tipo,data_base_estoque,saldo_antes,saldo_depois,created_by,observacao,chave_idempotencia)
    values(v_pid,v_produto_id,v_filial_id,v_qtd_solicitada,v_qtd_reservada,'SAIDA_PEDIDO',v_data_base,v_saldo_antes,v_saldo_depois,v_uid,
      case when v_nao_coberto>0 then 'Reserva imediata parcial. Quantidade restante deverá ser atendida por previsão/futuro.' else 'Reserva imediata integral.' end,
      'PEDIDO:'||v_pid::text||':PRODUTO:'||v_produto_id::text||':SAIDA');
    v_total_solicitado:=v_total_solicitado+v_qtd_solicitada;
    v_total_reservado:=v_total_reservado+v_qtd_reservada;
    v_total_nao_coberto:=v_total_nao_coberto+v_nao_coberto;
    v_alocacoes:=v_alocacoes||jsonb_build_array(jsonb_build_object('produto_id',v_produto_id,'quantidade_solicitada',v_qtd_solicitada,
      'quantidade_reservada',v_qtd_reservada,'nao_coberto_imediato',v_nao_coberto,'estoque_erp',v_estoque_erp,
      'reservado_antes',v_impacto_movimentos,'saldo_antes',v_saldo_antes,'saldo_depois',v_saldo_depois,'data_base_estoque',v_data_base));
  end loop;
  update public.pedido_idempotencia set pedido_id=v_pid where chave=p_idempotency_key;
  update public.pedidos set idempotency_key=p_idempotency_key where id=v_pid;
  return v_res||jsonb_build_object('estoque',jsonb_build_object('quantidade_solicitada',v_total_solicitado,'quantidade_reservada',v_total_reservado,
    'nao_coberto_imediato',v_total_nao_coberto,'alocacoes',v_alocacoes));
end;
$function$;

CREATE OR REPLACE FUNCTION private.criar_pedido_cotacao_v4_impl(p_cabecalho jsonb, p_itens jsonb, p_idempotency_key uuid, p_cotacao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid:=auth.uid(); v_res jsonb; v_pid uuid; v_filial_id uuid;
  v_produto_id uuid; v_solicitada numeric; v_reservada_imediata numeric; v_restante numeric;
  v_slot record; v_reservar_slot numeric;
  v_total_necessario numeric:=0; v_total_reservado numeric:=0; v_total_sem_cobertura numeric:=0;
  v_data_cobertura date:=null; v_alocacoes jsonb:='[]'::jsonb;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;
  v_res:=private.criar_pedido_cotacao_v3_impl(p_cabecalho,p_itens,p_idempotency_key,p_cotacao_id);
  v_pid:=nullif(v_res->>'pedido_id','')::uuid;
  if v_pid is null then raise exception 'Pedido criado sem identificador.'; end if;
  select filial_id into v_filial_id from public.pedidos where id=v_pid;
  if v_filial_id is null then raise exception 'Pedido criado sem filial.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('COLORNET_PREVISAO_GLOBAL',0));

  if exists(select 1 from public.movimentos_previsao mp where mp.pedido_id=v_pid and mp.tipo='RESERVA_PREVISAO') then
    select coalesce(sum(mp.quantidade),0),max(mp.previsao_original),coalesce(jsonb_agg(jsonb_build_object(
      'produto_id',mp.produto_id,'filial_id',mp.filial_id,'previsao',mp.previsao_original,'quantidade_reservada',mp.quantidade,
      'processo',mp.processo,'pedido_compra',mp.pedido_compra,'fornecedor',mp.fornecedor,'lote',mp.lote,'chave_previsao',mp.chave_previsao)
      order by mp.previsao_original,mp.criado_em),'[]'::jsonb)
    into v_total_reservado,v_data_cobertura,v_alocacoes
    from public.movimentos_previsao mp where mp.pedido_id=v_pid and mp.tipo='RESERVA_PREVISAO';
    select coalesce(sum(greatest(me.quantidade_solicitada-me.quantidade,0)),0) into v_total_necessario
    from public.movimentos_estoque me where me.pedido_id=v_pid and me.tipo='SAIDA_PEDIDO';
    v_total_sem_cobertura:=greatest(v_total_necessario-v_total_reservado,0);
    return v_res||jsonb_build_object('previsao',jsonb_build_object('quantidade_necessaria',v_total_necessario,'quantidade_reservada',v_total_reservado,
      'sem_cobertura',v_total_sem_cobertura,'data_cobertura',v_data_cobertura,'alocacoes',v_alocacoes));
  end if;

  for v_produto_id,v_solicitada,v_reservada_imediata in
    select me.produto_id,me.quantidade_solicitada,me.quantidade from public.movimentos_estoque me
    where me.pedido_id=v_pid and me.tipo='SAIDA_PEDIDO' order by me.produto_id
  loop
    v_restante:=greatest(v_solicitada-v_reservada_imediata,0);
    v_total_necessario:=v_total_necessario+v_restante;
    if v_restante<=0 then continue; end if;
    for v_slot in
      with snapshot as (
        select pe.produto_id,pe.filial_id,
          private.chave_previsao_estoque(pe.produto_id,pe.filial_id,pe.previsao,pe.processo,pe.pedido_compra,pe.lote,pe.fornecedor) as chave_previsao,
          min(pe.previsao) as previsao,max(pe.processo) as processo,max(pe.pedido_compra) as pedido_compra,
          max(pe.fornecedor) as fornecedor,max(pe.lote) as lote,sum(pe.quantidade)::numeric as quantidade_prevista
        from public.previsoes_estoque pe
        where pe.produto_id=v_produto_id and pe.filial_id=v_filial_id and pe.previsao is not null and pe.previsao>=current_date and pe.quantidade>0
          and upper(coalesce(pe.status,'')) not like '%CANCEL%'
          and upper(coalesce(pe.status,'')) not like '%FINALIZ%'
          and upper(coalesce(pe.status,'')) not like '%ENCERR%'
        group by pe.produto_id,pe.filial_id,private.chave_previsao_estoque(pe.produto_id,pe.filial_id,pe.previsao,pe.processo,pe.pedido_compra,pe.lote,pe.fornecedor)
      ), reservado as (
        select mp.chave_previsao,coalesce(sum(case when mp.tipo='RESERVA_PREVISAO' then mp.quantidade when mp.tipo='ESTORNO_PREVISAO' then -mp.quantidade else 0 end),0)::numeric as reservado
        from public.movimentos_previsao mp where mp.produto_id=v_produto_id and mp.filial_id=v_filial_id group by mp.chave_previsao
      )
      select s.chave_previsao,s.previsao,s.processo,s.pedido_compra,s.fornecedor,s.lote,s.quantidade_prevista,
        coalesce(r.reservado,0)::numeric as reservado,greatest(s.quantidade_prevista-coalesce(r.reservado,0),0)::numeric as disponivel
      from snapshot s left join reservado r on r.chave_previsao=s.chave_previsao
      where greatest(s.quantidade_prevista-coalesce(r.reservado,0),0)>0 order by s.previsao,s.chave_previsao
    loop
      exit when v_restante<=0;
      v_reservar_slot:=least(v_restante,v_slot.disponivel);
      if v_reservar_slot<=0 then continue; end if;
      insert into public.movimentos_previsao(pedido_id,produto_id,filial_id,chave_previsao,quantidade,tipo,previsao_original,processo,pedido_compra,fornecedor,lote,created_by,observacao,chave_idempotencia)
      values(v_pid,v_produto_id,v_filial_id,v_slot.chave_previsao,v_reservar_slot,'RESERVA_PREVISAO',v_slot.previsao,v_slot.processo,v_slot.pedido_compra,
        v_slot.fornecedor,v_slot.lote,v_uid,'Reserva automática de previsão para quantidade sem cobertura imediata.',
        'PEDIDO:'||v_pid::text||':PRODUTO:'||v_produto_id::text||':PREV:'||md5(v_slot.chave_previsao))
      on conflict do nothing;
      if found then
        v_restante:=v_restante-v_reservar_slot;
        v_total_reservado:=v_total_reservado+v_reservar_slot;
        if v_data_cobertura is null or v_slot.previsao>v_data_cobertura then v_data_cobertura:=v_slot.previsao; end if;
        v_alocacoes:=v_alocacoes||jsonb_build_array(jsonb_build_object('produto_id',v_produto_id,'filial_id',v_filial_id,'previsao',v_slot.previsao,
          'quantidade_reservada',v_reservar_slot,'processo',v_slot.processo,'pedido_compra',v_slot.pedido_compra,'fornecedor',v_slot.fornecedor,
          'lote',v_slot.lote,'chave_previsao',v_slot.chave_previsao));
      end if;
    end loop;
    v_total_sem_cobertura:=v_total_sem_cobertura+greatest(v_restante,0);
  end loop;
  return v_res||jsonb_build_object('previsao',jsonb_build_object('quantidade_necessaria',v_total_necessario,'quantidade_reservada',v_total_reservado,
    'sem_cobertura',v_total_sem_cobertura,'data_cobertura',v_data_cobertura,'alocacoes',v_alocacoes));
end;
$function$;
revoke all on function private.criar_pedido_cotacao_impl(jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function private.criar_pedido_cotacao_v3_impl(jsonb,jsonb,uuid,uuid) from public,anon,authenticated;
revoke all on function private.criar_pedido_cotacao_v4_impl(jsonb,jsonb,uuid,uuid) from public,anon,authenticated;

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
  idx integer; pid uuid;
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
  if jsonb_array_length(p_itens)=0 or jsonb_array_length(p_itens)>500
     or jsonb_array_length(p_itens)<>jsonb_array_length(q.documento->'itens') then
    raise exception 'Revise todos os itens da cotação.';
  end if;
  -- The quote UUID is the server-owned idempotency key; never trust a new browser key.
  if exists(select 1 from public.pedido_idempotencia where chave=q.id) then
    raise exception 'Identificador já utilizado em outro pedido. Solicite revisão ao administrador.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('COLORNET_ESTOQUE_GLOBAL',0));
  for idx in 0..jsonb_array_length(p_itens)-1 loop
    source_item := q.documento->'itens'->idx;
    requested := p_itens->idx;
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
      'quantidade',quantity));
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
$function$;

