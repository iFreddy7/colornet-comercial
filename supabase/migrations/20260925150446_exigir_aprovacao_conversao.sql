-- O bloqueio ocorre antes de criar pedido/reserva, sob o mesmo bloqueio da cotação.
do $migration$
declare definition text; marker text:='  if q.validade is null or q.validade <';
begin
  select pg_get_functiondef('private.converter_cotacao_pedido_impl(uuid,jsonb,jsonb)'::regprocedure) into definition;
  if strpos(definition,marker)=0 then raise exception 'Conversão incompatível: revisão necessária.'; end if;
  definition:=replace(definition,marker,$guard$  if q.aprovacao_status is distinct from 'APROVADA' then
    raise exception 'A cotação precisa ser aprovada por Gerente ou Diretor antes de virar pedido.';
  end if;
$guard$ || marker);
  execute definition;
end $migration$;
