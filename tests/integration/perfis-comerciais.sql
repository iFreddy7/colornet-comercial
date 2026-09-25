-- Execute somente na homologação após aplicar a migração de perfis.
-- O rollback desfaz pedidos, reservas, cancelamentos e alterações de perfis.
begin;
do $$ begin
 if not exists(select 1 from public.usuarios where id='b918a17c-9015-4599-a9ac-5c0846e8d523' and email='jrodrigues@colornet.com.br') then
  raise exception 'Ambiente de homologação não identificado. Teste interrompido.';
 end if;
end $$;
update public.usuarios set perfil=case lower(email) when 'luciano@colornet.com.br' then 'DIRETOR' else 'GERENTE' end where (id,email) in (('fe8c70c0-6e09-4cc2-b922-4379f1acf859'::uuid,'fsilva@colornet.com.br'),('db9e6978-464e-4b4d-aa95-e3b06e9a8ef5'::uuid,'gferreira@colornet.com.br'),('d09ec255-8ce7-4d70-af30-2904a75231de'::uuid,'luciano@colornet.com.br'));

create temp table role_test_results (test text, result jsonb);
grant all on role_test_results to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','fe8c70c0-6e09-4cc2-b922-4379f1acf859',true);
insert into role_test_results select 'GERENTE', jsonb_build_object(
  'pedidos',(select count(*) from public.pedidos),
  'clientes',(select count(*) from public.clientes),
  'report_pedidos',jsonb_array_length(public.exportar_pedidos_comercial_v1()->'pedidos'),
  'usuarios',(select count(*) from public.usuarios),
  'admin_audit',(select count(*) from public.admin_usuario_eventos),
  'email_logs',(select count(*) from public.email_logs),
  'calculo', public.calcular_preco_comercial('a8b98f19-6acd-489e-bf16-1bb750f6f281','c31eafd9-2455-4a7b-bc8d-408d73a730c0','635c3ea4-eccb-4442-aca7-6da1301da9b9',30.05,null,false)->'preco_net'
);
do $test$ begin
  begin
    perform public.admin_atualizar_usuario('fe8c70c0-6e09-4cc2-b922-4379f1acf859','ADMIN',null,true);
    raise exception 'FAIL: manager promoted itself';
  exception when others then
    if sqlerrm not like 'Acesso restrito a ADMIN%' then raise; end if;
  end;
end $test$;
insert into role_test_results select 'create_by_manager',public.criar_pedido_v4(
 '{"cliente_id":"a8b98f19-6acd-489e-bf16-1bb750f6f281","filial_id":"635c3ea4-eccb-4442-aca7-6da1301da9b9","moeda":"USD","vendedor_id":"8e9de1f0-19aa-478c-a404-b53ade23c058","observacoes":"ROLE TEST ROLLBACK"}',
 '[{"produto_id":"c31eafd9-2455-4a7b-bc8d-408d73a730c0","quantidade":1,"preco_net":30.05,"preco_final":34.49}]',
 gen_random_uuid());
select set_config('request.jwt.claim.sub','d09ec255-8ce7-4d70-af30-2904a75231de',true);
insert into role_test_results select 'DIRETOR',jsonb_build_object(
  'pedidos',(select count(*) from public.pedidos),
  'clientes',(select count(*) from public.clientes),
  'report_pedidos',jsonb_array_length(public.exportar_pedidos_comercial_v1()->'pedidos'),
  'usuarios',(select count(*) from public.usuarios));
insert into role_test_results select 'cancel_by_director',public.cancelar_pedido((result->>'pedido_id')::uuid,'ROLE TEST ROLLBACK') from role_test_results where test='create_by_manager';
do $test$ begin
  begin
    perform public.admin_atualizar_usuario('d09ec255-8ce7-4d70-af30-2904a75231de','ADMIN',null,true);
    raise exception 'FAIL: director promoted itself';
  exception when others then
    if sqlerrm not like 'Acesso restrito a ADMIN%' then raise; end if;
  end;
end $test$;
select set_config('request.jwt.claim.sub','12102155-c7eb-4d17-b5b0-3ebde14d5095',true);
insert into role_test_results select 'VENDEDOR',jsonb_build_object('pedidos',(select count(*) from public.pedidos),'clientes',(select count(*) from public.clientes));
do $test$ begin
  begin
    perform public.exportar_pedidos_comercial_v1();
    raise exception 'FAIL: seller exported globally';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.calcular_preco_comercial('a8b98f19-6acd-489e-bf16-1bb750f6f281','c31eafd9-2455-4a7b-bc8d-408d73a730c0','635c3ea4-eccb-4442-aca7-6da1301da9b9',30.05,null,false);
    raise exception 'FAIL: seller accessed foreign customer';
  exception when insufficient_privilege then null;
  end;
end $test$;
reset role;

select * from role_test_results;
rollback;
