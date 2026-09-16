-- Cotações são documentos comerciais imutáveis, sem reservas ou e-mails automáticos.
create table public.cotacoes (
 id uuid primary key default gen_random_uuid(),
 numero text not null unique,
 titulo text not null check (length(trim(titulo)) between 1 and 180),
 created_at timestamptz not null default now(),
 created_by uuid not null references public.usuarios(id),
 vendedor_id uuid not null references public.vendedores(id),
 cliente_id uuid not null references public.clientes(id),
 filial_id uuid not null references public.filiais(id),
 moeda text not null check (moeda in ('USD','BRL')),
 observacoes text,
 cliente_nome text not null, vendedor_nome text not null,
 documento jsonb not null,
 idempotency_key uuid not null,
 unique(created_by,idempotency_key)
);
create index cotacoes_vendedor_data on public.cotacoes(vendedor_id,created_at desc);
create index cotacoes_cliente_data on public.cotacoes(cliente_id,created_at desc);
create index cotacoes_autor_data on public.cotacoes(created_by,created_at desc);
alter table public.cotacoes enable row level security;
revoke all on public.cotacoes from anon, authenticated;
grant select on public.cotacoes to authenticated;
create policy cotacoes_leitura on public.cotacoes for select to authenticated using (
 exists(select 1 from public.usuarios u where u.id=(select auth.uid()) and u.ativo
 and (u.perfil='ADMIN' or u.id=created_by))
);
create function private.criar_cotacao_impl(p_cabecalho jsonb,p_itens jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u public.usuarios%rowtype; c public.clientes%rowtype; f public.filiais%rowtype;
 v public.vendedores%rowtype; p public.produtos%rowtype; existente public.cotacoes%rowtype;
 cid uuid := gen_random_uuid(); num text; titulo text; moeda text;
 item jsonb; calc jsonb; items jsonb := '[]'; qtd numeric; net numeric; final numeric;
 ipi numeric; sub numeric; imposto numeric; total numeric:=0; subtotal numeric:=0; impostos numeric:=0;
 obs text; doc jsonb;
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
 select * into c from public.clientes where id=(p_cabecalho->>'cliente_id')::uuid and ativo;
 if not found then raise exception 'Cliente indisponível.'; end if;
 if u.perfil<>'ADMIN' and (u.vendedor_id is null or c.vendedor_id is distinct from u.vendedor_id) then
 raise exception 'Cliente fora da carteira.' using errcode='42501'; end if;
 select * into v from public.vendedores where id=case when u.perfil='ADMIN' then coalesce(c.vendedor_id,nullif(p_cabecalho->>'vendedor_id','')::uuid) else u.vendedor_id end and ativo;
 if not found then raise exception 'Selecione um vendedor ativo.'; end if;
 select * into f from public.filiais where id=(p_cabecalho->>'filial_id')::uuid and ativo;
 if not found then raise exception 'Filial indisponível.'; end if;
 for item in select value from jsonb_array_elements(p_itens) loop
  qtd:=(item->>'quantidade')::numeric; net:=(item->>'preco_net')::numeric;
  if qtd is null or net is null or not(qtd>0 and qtd<=100000000 and net>0 and net<=100000000) then raise exception 'Quantidade ou preço inválido.'; end if;
  select * into p from public.produtos where id=(item->>'produto_id')::uuid and ativo;
  if not found then raise exception 'Produto indisponível.'; end if;
  calc:=public.calcular_item_pedido(c.id,p.id,f.id,net);
  obs:=nullif(trim(item->>'observacao_preco'),'');
  if coalesce((calc->>'automatico')::boolean,false) then final:=(calc->>'preco_final')::numeric;
  else
   final:=(item->>'preco_final_manual')::numeric;
   if obs is null then raise exception 'Informe a aprovação do preço manual.'; end if;
  end if;
  if final is null or not(final>0 and final<=100000000) then raise exception 'Preço final inválido.'; end if;
  ipi:=coalesce((calc->>'ipi')::numeric,0);
  if not(ipi>=0 and ipi<=1) then raise exception 'IPI inválido.'; end if;
  sub:=round(final*qtd,2); imposto:=round(sub*ipi,2);
  subtotal:=subtotal+sub; impostos:=impostos+imposto; total:=total+sub+imposto;
  items:=items||jsonb_build_array(jsonb_build_object('produto_id',p.id,'codigo',p.codigo_protheus,'produto',p.nome,'ncm',p.ncm,
   'quantidade',qtd,'preco_net',net,'preco_final',final,'ipi',ipi,'aliquota_icms',calc->'aliquota',
   'subtotal',sub,'valor_ipi',imposto,'total_item',sub+imposto,'fiscal',calc,'observacao_preco',obs));
 end loop;
 num:='COT-'||to_char(now() at time zone 'America/Sao_Paulo','YYYYMMDD')||'-'||upper(substr(replace(cid::text,'-',''),1,12));
 doc:=jsonb_build_object('versao',1,'numero',num,'titulo',titulo,'created_at',now(),'moeda',moeda,
 'cliente',jsonb_build_object('codigo',c.codigo,'nome',c.razao_social,'cnpj_cpf',c.cnpj_cpf,'municipio',c.municipio,'uf',c.uf),
 'vendedor',jsonb_build_object('nome',v.nome), 'filial',jsonb_build_object('nome',f.nome,'uf',f.uf),
 'itens',items,'subtotal',subtotal,'valor_ipi',impostos,'total',total,'observacoes',p_cabecalho->>'observacoes');
 insert into public.cotacoes(id,numero,titulo,created_by,vendedor_id,cliente_id,filial_id,moeda,observacoes,cliente_nome,vendedor_nome,documento,idempotency_key)
 values(cid,num,titulo,u.id,v.id,c.id,f.id,moeda,p_cabecalho->>'observacoes',c.razao_social,v.nome,doc,p_idempotency_key);
 return jsonb_build_object('id',cid,'numero',num);
end; $$;
revoke all on function private.criar_cotacao_impl(jsonb,jsonb,uuid) from public,anon;
grant execute on function private.criar_cotacao_impl(jsonb,jsonb,uuid) to authenticated;
create function public.criar_cotacao(p_cabecalho jsonb,p_itens jsonb,p_idempotency_key uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.criar_cotacao_impl(p_cabecalho,p_itens,p_idempotency_key); $$;
revoke all on function public.criar_cotacao(jsonb,jsonb,uuid) from public,anon;
grant execute on function public.criar_cotacao(jsonb,jsonb,uuid) to authenticated;
