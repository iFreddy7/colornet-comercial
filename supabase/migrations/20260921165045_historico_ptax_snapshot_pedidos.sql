create table if not exists public.ptax_historico (
  data_referencia date primary key,
  cotacao_venda numeric(12,6) not null check (cotacao_venda > 0),
  origem text not null default 'BCB_PTAX',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.ptax_historico enable row level security;

drop policy if exists "ptax historico leitura autenticada" on public.ptax_historico;
create policy "ptax historico leitura autenticada"
on public.ptax_historico
for select
to authenticated
using (true);

alter table public.pedidos
  add column if not exists ptax_valor numeric(12,6),
  add column if not exists ptax_data_referencia date;

comment on column public.pedidos.ptax_valor is
  'Snapshot da PTAX venda usada para converter pedido BRL em USD no momento da inclusão.';
comment on column public.pedidos.ptax_data_referencia is
  'Data de referência do fechamento PTAX associado ao pedido.';

create or replace function private.registrar_ptax_historico_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_valor numeric;
  v_data date;
begin
  if new.chave <> 'PTAX_DATA_REFERENCIA' then
    return new;
  end if;

  begin
    v_data := trim(both '"' from new.valor::text)::date;
  exception when others then
    return new;
  end;

  select case
           when jsonb_typeof(c.valor) = 'number' then (c.valor::text)::numeric
           else trim(both '"' from c.valor::text)::numeric
         end
    into v_valor
  from public.configuracoes c
  where c.chave = 'PTAX_VALOR';

  if v_data is not null and v_valor is not null and v_valor > 0 then
    insert into public.ptax_historico(data_referencia,cotacao_venda,origem,atualizado_em)
    values(v_data,v_valor,'BCB_PTAX',now())
    on conflict(data_referencia) do update
      set cotacao_venda=excluded.cotacao_venda,
          origem=excluded.origem,
          atualizado_em=now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_registrar_ptax_historico_config on public.configuracoes;
create trigger trg_registrar_ptax_historico_config
after insert or update of valor on public.configuracoes
for each row
when (new.chave = 'PTAX_DATA_REFERENCIA')
execute function private.registrar_ptax_historico_config();

create or replace function private.snapshot_ptax_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_valor numeric;
  v_data date;
begin
  if upper(coalesce(new.moeda,'')) <> 'BRL' then
    new.ptax_valor := null;
    new.ptax_data_referencia := null;
    return new;
  end if;

  select h.cotacao_venda,h.data_referencia
    into v_valor,v_data
  from public.ptax_historico h
  order by h.data_referencia desc
  limit 1;

  if v_valor is null or v_data is null then
    raise exception 'PTAX não disponível para registrar pedido em BRL.';
  end if;

  new.ptax_valor := v_valor;
  new.ptax_data_referencia := v_data;
  return new;
end;
$$;

drop trigger if exists trg_snapshot_ptax_pedido on public.pedidos;
create trigger trg_snapshot_ptax_pedido
before insert on public.pedidos
for each row
execute function private.snapshot_ptax_pedido();

insert into public.ptax_historico(data_referencia,cotacao_venda,origem)
select
  trim(both '"' from d.valor::text)::date,
  case
    when jsonb_typeof(v.valor)='number' then (v.valor::text)::numeric
    else trim(both '"' from v.valor::text)::numeric
  end,
  'CONFIG_INICIAL'
from public.configuracoes d
join public.configuracoes v on v.chave='PTAX_VALOR'
where d.chave='PTAX_DATA_REFERENCIA'
  and nullif(trim(both '"' from d.valor::text),'') is not null
on conflict(data_referencia) do nothing;

create index if not exists idx_pedidos_ptax_data_referencia
  on public.pedidos(ptax_data_referencia)
  where ptax_data_referencia is not null;
