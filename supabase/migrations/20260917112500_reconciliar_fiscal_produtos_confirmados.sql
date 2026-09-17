-- Ajustes fiscais confirmados para homologação/produção em 17/09/2026.
-- Os produtos são localizados por código Protheus, sem depender de UUIDs gerados.

update public.produtos
set
  ncm = '3911.90.29',
  grupo_tributario = '001',
  origem_codigo = '7',
  ipi = 0.0325,
  fiscal_bloqueio_manual = null
where codigo_protheus = 'AD057.7TB210'; -- ADDITOL VXW 6252

update public.produtos
set
  ipi = 0.065,
  fiscal_bloqueio_manual = null
where codigo_protheus = 'AD015.7BD20'; -- ADDITOL XL 270

update public.produtos
set
  ncm = '3920.62.11',
  grupo_tributario = '001',
  origem_codigo = '7',
  ipi = 0.0925,
  fiscal_bloqueio_manual = null
where codigo_protheus = 'GL010.7CX20'; -- GLITTER NET HX-712 1/128 COFFEE

update public.produtos
set
  grupo_tributario = '001',
  ipi = 0.026,
  fiscal_bloqueio_manual = null
where codigo_protheus = 'AL010.1BD10'; -- NETCOTE PC 1291 X

-- AQUANET AMARELO 74 TR e AQUANET PRETO 7 XL permanecem inalterados,
-- conforme orientação, e portanto continuam MANUAL até o cadastro fiscal ser completado.