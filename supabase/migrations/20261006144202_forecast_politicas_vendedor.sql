alter policy forecast_inserir on public.forecast_planos with check (
  exists(select 1 from public.clientes c where c.id=forecast_planos.cliente_id and c.ativo and
    ((select private.has_commercial_overview()) or (forecast_planos.vendedor_id=(select private.current_vendedor_id()) and c.vendedor_id=(select private.current_vendedor_id()))))
  and exists(select 1 from public.vendedores v where v.id=forecast_planos.vendedor_id and v.ativo)
);
alter policy forecast_atualizar on public.forecast_planos with check (
  exists(select 1 from public.clientes c where c.id=forecast_planos.cliente_id and c.ativo and
    ((select private.has_commercial_overview()) or (forecast_planos.vendedor_id=(select private.current_vendedor_id()) and c.vendedor_id=(select private.current_vendedor_id()))))
  and exists(select 1 from public.vendedores v where v.id=forecast_planos.vendedor_id and v.ativo)
);
