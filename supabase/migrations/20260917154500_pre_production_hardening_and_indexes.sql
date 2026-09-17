-- Hardening e otimizações de baixo risco antes da produção.

-- 1) A função administrativa pode respeitar RLS normalmente; ela já valida ADMIN.
alter function public.admin_clientes_sem_vendedor() security invoker;

-- 2) Implementações internas de escrita não devem ser executáveis diretamente
-- por clientes. Os wrappers públicos SECURITY DEFINER continuam chamando-as
-- como owner (postgres).
revoke execute on function private.criar_pedido_impl(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function private.criar_pedido_v3_impl(jsonb, jsonb, uuid) from public, anon, authenticated;
revoke execute on function private.criar_pedido_v4_impl(jsonb, jsonb, uuid) from public, anon, authenticated;
revoke execute on function private.cancelar_pedido_impl(uuid, text) from public, anon, authenticated;
revoke execute on function private.cancelar_pedido_v1_impl(uuid, text) from public, anon, authenticated;

-- O frontend atual usa cancelar_pedido. Mantemos cancelar_pedido_v1 apenas
-- para administração/service role, retirando a rota legada de usuários comuns.
revoke execute on function public.cancelar_pedido_v1(uuid, text) from public, anon, authenticated;

-- 3) Evita reavaliar auth.uid() para cada linha nas policies.
alter policy "usuarios leem movimentos permitidos"
on public.movimentos_estoque
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.pedidos p
    where p.id = movimentos_estoque.pedido_id
      and (
        p.created_by = (select auth.uid())
        or p.vendedor_id = (select private.current_vendedor_id())
      )
  )
);

alter policy "usuarios leem movimentos previsao permitidos"
on public.movimentos_previsao
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.pedidos p
    where p.id = movimentos_previsao.pedido_id
      and (
        p.created_by = (select auth.uid())
        or p.vendedor_id = (select private.current_vendedor_id())
      )
  )
);

alter policy "usuarios leem cancelamentos permitidos"
on public.pedido_cancelamentos
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.pedidos p
    where p.id = pedido_cancelamentos.pedido_id
      and p.created_by = (select auth.uid())
  )
);

alter policy "usuarios leem eventos dos pedidos permitidos"
on public.pedido_eventos
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.pedidos p
    where p.id = pedido_eventos.pedido_id
      and p.created_by = (select auth.uid())
  )
);

-- Uma única policy SELECT evita duas policies permissivas concorrentes.
drop policy if exists "admin le todos usuarios" on public.usuarios;
drop policy if exists "usuario le seu proprio perfil" on public.usuarios;
create policy "usuario le proprio perfil ou admin"
on public.usuarios
for select
to authenticated
using (
  id = (select auth.uid())
  or (select private.is_admin())
);

-- 4) Índices de cobertura para FKs mais usadas pelo portal e rotinas.
create index if not exists idx_cliente_contatos_created_by_fk on public.cliente_contatos(created_by);
create index if not exists idx_clientes_vendedor_id_fk on public.clientes(vendedor_id);
create index if not exists idx_cotacoes_filial_id_fk on public.cotacoes(filial_id);
create index if not exists idx_cotacoes_prazo_pagamento_id_fk on public.cotacoes(prazo_pagamento_id);
create index if not exists idx_estoque_filial_id_fk on public.estoque(filial_id);
create index if not exists idx_movimentos_previsao_created_by_fk on public.movimentos_previsao(created_by);
create index if not exists idx_movimentos_previsao_filial_id_fk on public.movimentos_previsao(filial_id);
create index if not exists idx_pedido_cancelamentos_cancelado_por_fk on public.pedido_cancelamentos(cancelado_por);
create index if not exists idx_pedido_eventos_created_by_fk on public.pedido_eventos(created_by);
create index if not exists idx_pedido_idempotencia_created_by_fk on public.pedido_idempotencia(created_by);
create index if not exists idx_pedido_idempotencia_pedido_id_fk on public.pedido_idempotencia(pedido_id);
create index if not exists idx_pedido_itens_produto_id_fk on public.pedido_itens(produto_id);
create index if not exists idx_pedidos_filial_id_fk on public.pedidos(filial_id);
create index if not exists idx_pedidos_frete_id_fk on public.pedidos(frete_id);
create index if not exists idx_pedidos_prazo_pagamento_id_fk on public.pedidos(prazo_pagamento_id);
create index if not exists idx_previsoes_estoque_filial_id_fk on public.previsoes_estoque(filial_id);
create index if not exists idx_previsoes_estoque_produto_id_fk on public.previsoes_estoque(produto_id);
create index if not exists idx_usuarios_vendedor_id_fk on public.usuarios(vendedor_id);

-- 5) Remove apenas a constraint duplicada; a unicidade original permanece.
alter table public.estoque drop constraint if exists estoque_produto_id_filial_id_key;
