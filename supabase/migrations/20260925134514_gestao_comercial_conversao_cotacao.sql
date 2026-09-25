do $roles$
declare f record; definition text;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='private' and p.proname='converter_cotacao_pedido_impl'
 loop
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition, 'u.perfil <> ''ADMIN''', 'u.perfil not in (''ADMIN'',''GERENTE'',''DIRETOR'')');
  execute definition;
 end loop;
end $roles$;

