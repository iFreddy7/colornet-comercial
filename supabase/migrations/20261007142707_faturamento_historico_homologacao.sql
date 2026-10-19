-- Histórico de faturamento: habilitar inicialmente apenas na homologação.
create table private.faturamento_importacoes (
  arquivo_sha256 text primary key check(arquivo_sha256 ~ '^[a-f0-9]{64}$'),
  arquivo_nome text not null,
  linhas_esperadas integer not null check(linhas_esperadas>0),
  quantidade_esperada numeric not null,
  publicado boolean not null default false,
  criado_em timestamptz not null default now()
);
alter table private.faturamento_importacoes enable row level security;
revoke all on private.faturamento_importacoes from public,anon,authenticated;
create table public.faturamento_historico (
  arquivo_sha256 text not null references private.faturamento_importacoes(arquivo_sha256),
  linha integer not null check(linha>=2),
  periodo date not null check(periodo=date_trunc('month',periodo)::date),
  filial_codigo text not null,
  nota text not null,
  data_emissao date not null,
  vendedor_id uuid references public.vendedores(id),
  vendedor_nome text not null,
  cliente_id uuid references public.clientes(id),
  cliente_chave text not null,
  cliente_codigo text not null,
  cliente_nome text not null,
  municipio text not null,
  uf text not null,
  produto_id uuid references public.produtos(id),
  produto_codigo text not null,
  produto_nome text not null,
  quantidade numeric(18,4) not null check(quantidade>=0),
  operacao text not null,
  excluido_motivo text,
  primary key(arquivo_sha256,linha)
);
create index faturamento_vendedor_periodo on public.faturamento_historico(vendedor_id,periodo);
create index faturamento_periodo on public.faturamento_historico(periodo);
create index faturamento_cliente on public.faturamento_historico(cliente_id);
create index faturamento_produto on public.faturamento_historico(produto_id);
alter table public.faturamento_historico enable row level security;
revoke all on public.faturamento_historico from public,anon,authenticated;
grant select on public.faturamento_historico to authenticated;
grant all on public.faturamento_historico to service_role;
create policy faturamento_carteira on public.faturamento_historico for select to authenticated using (
  exists(select 1 from private.faturamento_importacoes i where i.arquivo_sha256=faturamento_historico.arquivo_sha256 and i.publicado)
  and ((select private.has_commercial_overview()) or vendedor_id=(select private.current_vendedor_id()))
);
-- Somente a existência/publicação do lote é consultada pela política, sem expor dados privados.
grant select on private.faturamento_importacoes to authenticated;
create policy faturamento_lote_publicado on private.faturamento_importacoes for select to authenticated using(publicado);
create view public.faturamento_historico_mensal with(security_invoker=true) as
select periodo,filial_codigo,vendedor_id,vendedor_nome,cliente_chave,cliente_codigo,
  min(cliente_nome) as cliente_nome,produto_codigo,min(produto_nome) as produto_nome,
  sum(quantidade) as quantidade,count(*) as linhas
from public.faturamento_historico
where excluido_motivo is null
group by periodo,filial_codigo,vendedor_id,vendedor_nome,cliente_chave,cliente_codigo,produto_codigo;
revoke all on public.faturamento_historico_mensal from public,anon,authenticated;
grant select on public.faturamento_historico_mensal to authenticated;
create function public.faturamento_periodos_v1() returns table(periodo date)
language sql stable security invoker set search_path='' as $$
select distinct h.periodo from public.faturamento_historico h
where h.excluido_motivo is null
order by h.periodo;
$$;
revoke all on function public.faturamento_periodos_v1() from public,anon;
grant execute on function public.faturamento_periodos_v1() to authenticated;
notify pgrst,'reload schema';
