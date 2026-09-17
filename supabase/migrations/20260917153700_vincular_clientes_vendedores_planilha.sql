do $$
declare
  v_colornet uuid;
  v_gabriel uuid;
begin
  select id into v_colornet
  from public.vendedores
  where codigo_protheus = '000009' and ativo = true;

  select id into v_gabriel
  from public.vendedores
  where codigo_protheus = '000020' and ativo = true;

  if v_colornet is null then
    raise exception 'Vendedor COLORNET 000009 não encontrado/ativo';
  end if;

  if v_gabriel is null then
    raise exception 'Vendedor GABRIEL 000020 não encontrado/ativo';
  end if;

  update public.clientes
  set vendedor_id = v_colornet
  where (codigo, loja) in (
    ('03719001','0001'),
    ('019402','0001'),
    ('020715','0001'),
    ('020565','0001'),
    ('06202344','0001'),
    ('020283','0001'),
    ('000388','0001'),
    ('020562','0001'),
    ('000329','0001'),
    ('020680','0001'),
    ('020336','0001'),
    ('020616','0001'),
    ('21271031','0001'),
    ('020388','0001'),
    ('000819','0001'),
    ('01254752','0001')
  );

  update public.clientes
  set vendedor_id = v_gabriel
  where codigo = '005377' and loja = '0001';
end $$;
