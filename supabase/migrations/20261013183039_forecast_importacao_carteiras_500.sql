-- Amplia o lote para as carteiras por vendedor, mantendo autorização, RLS e limite de dados.
do $$
declare corpo text;
begin
  corpo:=pg_get_functiondef('private.forecast_importar_impl(uuid,text,jsonb)'::regprocedure);
  if position('jsonb_array_length(p_planos) not between 1 and 100' in corpo)=0
     or position('Importe de 1 a 100 carteiras por arquivo, até 1 MB de dados.' in corpo)=0 then
    raise exception 'Definição de importação divergente; revisar antes de ampliar o limite.';
  end if;
  corpo:=replace(corpo,'jsonb_array_length(p_planos) not between 1 and 100','jsonb_array_length(p_planos) not between 1 and 500');
  corpo:=replace(corpo,'Importe de 1 a 100 carteiras por arquivo, até 1 MB de dados.','Importe de 1 a 500 carteiras por arquivo, até 1 MB de dados.');
  execute corpo;
end $$;
notify pgrst,'reload schema';
