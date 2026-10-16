-- Modelos XLSX privados; nunca publicados como assets do site.
create table public.forecast_modelos (
 vendedor_id uuid primary key references public.vendedores(id),
 nome_arquivo text not null check(nome_arquivo ~ '^Forecast_[A-Z_]+[.]xlsx$'),
 arquivo_base64 text not null check(length(arquivo_base64) between 1 and 1400000),
 periodo text not null,
 atualizado_em timestamptz not null default now()
);
alter table public.forecast_modelos enable row level security;
revoke all on public.forecast_modelos from public,anon,authenticated;
grant select on public.forecast_modelos to authenticated;
grant all on public.forecast_modelos to service_role;
create policy forecast_modelos_leitura on public.forecast_modelos for select to authenticated
using ((select private.has_commercial_overview()) or vendedor_id=(select private.current_vendedor_id()));
notify pgrst,'reload schema';
