-- Homologação somente. Todas as gravações de teste são revertidas.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11b0de3a-32bb-422c-900b-f588e9cc4391',true);
do $test$
declare r bigint; d jsonb; failed boolean;
begin
  r:=public.forecast_salvar_v1('00f23eb2-ed43-4497-b071-f8f7505f1c58','b0d35394-5b24-4ce8-afba-357567c1542c','2026-10-01','[{"produto_id":"0112bad8-a101-4a43-b6c0-94ef854e0570","quantidades":{"2026-10":125.5,"2026-11":0}}]',0);
  if r<>1 then raise exception 'revisao inicial'; end if;
  select documento into d from public.forecast_planos where cliente_id='00f23eb2-ed43-4497-b071-f8f7505f1c58' and vendedor_id='b0d35394-5b24-4ce8-afba-357567c1542c';
  if d->'0112bad8-a101-4a43-b6c0-94ef854e0570'->>'2026-11'<>'0' then raise exception 'zero perdido'; end if;
  failed:=false;
  begin
    perform public.forecast_salvar_v1('00f23eb2-ed43-4497-b071-f8f7505f1c58','b0d35394-5b24-4ce8-afba-357567c1542c','2026-10-01','[{"produto_id":"0112bad8-a101-4a43-b6c0-94ef854e0570","quantidades":{"2026-10":2}}]',0);
  exception when serialization_failure then failed:=true; end;
  if not failed then raise exception 'conflito nao bloqueado'; end if;
failed:=false; begin perform public.forecast_salvar_v1('00f23eb2-ed43-4497-b071-f8f7505f1c58','8e9de1f0-19aa-478c-a404-b53ade23c058','2026-10-01','[{"produto_id":"0112bad8-a101-4a43-b6c0-94ef854e0570","quantidades":{"2026-10":1}}]',0); exception when insufficient_privilege then failed:=true; end; if not failed then raise exception 'Falhou bloqueio: outro vendedor'; end if;
failed:=false; begin insert into public.forecast_planos(cliente_id,vendedor_id,documento) values('00f23eb2-ed43-4497-b071-f8f7505f1c58','8e9de1f0-19aa-478c-a404-b53ade23c058','{}'); exception when insufficient_privilege then failed:=true; end; if not failed then raise exception 'Falhou bloqueio: REST outro vendedor'; end if;
failed:=false; begin perform public.forecast_salvar_v1('00f23eb2-ed43-4497-b071-f8f7505f1c58','b0d35394-5b24-4ce8-afba-357567c1542c','2026-10-01','[{"produto_id":"0112bad8-a101-4a43-b6c0-94ef854e0570","quantidades":{"2026-10":-1}}]',1); exception when raise_exception then failed:=true; end; if not failed then raise exception 'Falhou bloqueio: quantidade invalida'; end if;
failed:=false; begin perform public.forecast_salvar_v1('00f23eb2-ed43-4497-b071-f8f7505f1c58','b0d35394-5b24-4ce8-afba-357567c1542c','2026-10-01','[{"produto_id":"0112bad8-a101-4a43-b6c0-94ef854e0570","quantidades":{"2026-10":1.0001}}]',1); exception when raise_exception then failed:=true; end; if not failed then raise exception 'Falhou bloqueio: quantidade invalida'; end if;
failed:=false; begin perform public.forecast_salvar_v1('00f23eb2-ed43-4497-b071-f8f7505f1c58','b0d35394-5b24-4ce8-afba-357567c1542c','2026-10-01','[{"produto_id":"0112bad8-a101-4a43-b6c0-94ef854e0570","quantidades":{"2029-10":1}}]',1); exception when raise_exception then failed:=true; end; if not failed then raise exception 'Falhou bloqueio: mes fora'; end if;
failed:=false; begin perform public.forecast_salvar_v1('00f23eb2-ed43-4497-b071-f8f7505f1c58','b0d35394-5b24-4ce8-afba-357567c1542c','2026-10-01','[{"produto_id":"0112bad8-a101-4a43-b6c0-94ef854e0570","quantidades":{"2026-10":1}},{"produto_id":"0112bad8-a101-4a43-b6c0-94ef854e0570","quantidades":{"2026-10":2}}]',1); exception when raise_exception then failed:=true; end; if not failed then raise exception 'Falhou bloqueio: duplicados'; end if;
r:=public.forecast_salvar_v1('00f23eb2-ed43-4497-b071-f8f7505f1c58','b0d35394-5b24-4ce8-afba-357567c1542c','2027-10-01','[{"produto_id":"0112bad8-a101-4a43-b6c0-94ef854e0570","quantidades":{"2027-10":42}}]',1);
select documento into d from public.forecast_planos where cliente_id='00f23eb2-ed43-4497-b071-f8f7505f1c58' and vendedor_id='b0d35394-5b24-4ce8-afba-357567c1542c';
if r<>2 or d->'0112bad8-a101-4a43-b6c0-94ef854e0570'->>'2026-10'<>'125.5' or d->'0112bad8-a101-4a43-b6c0-94ef854e0570'->>'2027-10'<>'42' then raise exception 'periodo anterior perdido'; end if;
end $test$;
select set_config('request.jwt.claim.sub','12102155-c7eb-4d17-b5b0-3ebde14d5095',true);
do $test$ begin if exists(select 1 from public.forecast_planos where cliente_id='00f23eb2-ed43-4497-b071-f8f7505f1c58') then raise exception 'vazamento entre carteiras'; end if; end $test$;
select set_config('request.jwt.claim.sub','9400ea83-a7fe-4106-8965-e88039537a34',true);
do $test$ declare r bigint; begin
select revisao into r from public.forecast_planos where cliente_id='00f23eb2-ed43-4497-b071-f8f7505f1c58' and vendedor_id='b0d35394-5b24-4ce8-afba-357567c1542c';
if r is null then raise exception 'gestao sem leitura global'; end if;
perform public.forecast_salvar_v1('00f23eb2-ed43-4497-b071-f8f7505f1c58','b0d35394-5b24-4ce8-afba-357567c1542c','2027-10-01','[{"produto_id":"0112bad8-a101-4a43-b6c0-94ef854e0570","quantidades":{"2027-10":43}}]',r);
end $test$;
select set_config('request.jwt.claim.sub','23cf888d-1e89-4124-8ae5-906f72d4a3b0',true);
do $test$ declare r bigint; begin
select revisao into r from public.forecast_planos where cliente_id='00f23eb2-ed43-4497-b071-f8f7505f1c58' and vendedor_id='b0d35394-5b24-4ce8-afba-357567c1542c';
if r is null then raise exception 'gestao sem leitura global'; end if;
perform public.forecast_salvar_v1('00f23eb2-ed43-4497-b071-f8f7505f1c58','b0d35394-5b24-4ce8-afba-357567c1542c','2027-10-01','[{"produto_id":"0112bad8-a101-4a43-b6c0-94ef854e0570","quantidades":{"2027-10":43}}]',r);
end $test$;
select set_config('request.jwt.claim.sub','db9e6978-464e-4b4d-aa95-e3b06e9a8ef5',true);
do $test$ declare r bigint; begin
select revisao into r from public.forecast_planos where cliente_id='00f23eb2-ed43-4497-b071-f8f7505f1c58' and vendedor_id='b0d35394-5b24-4ce8-afba-357567c1542c';
if r is null then raise exception 'gestao sem leitura global'; end if;
perform public.forecast_salvar_v1('00f23eb2-ed43-4497-b071-f8f7505f1c58','b0d35394-5b24-4ce8-afba-357567c1542c','2027-10-01','[{"produto_id":"0112bad8-a101-4a43-b6c0-94ef854e0570","quantidades":{"2027-10":43}}]',r);
end $test$;
reset role;
do $test$ begin
if has_table_privilege('anon','public.forecast_planos','SELECT') or has_function_privilege('anon','public.forecast_salvar_v1(uuid,uuid,date,jsonb,bigint)','EXECUTE') then raise exception 'acesso anonimo'; end if;
end $test$;
select 'PASS: gravacao, zero, revisao, conflito, carteira, REST, quantidades, periodo, duplicados, gestao e anonimo' as resultado;
rollback;
