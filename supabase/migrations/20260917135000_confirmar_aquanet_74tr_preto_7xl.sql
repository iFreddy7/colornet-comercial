update public.produtos
set codigo_protheus = 'DI042.3BD20'
where nome = 'AQUANET AMARELO 74 TR'
  and codigo_protheus is null;

update public.produtos
set grupo_tributario = '218'
where nome = 'AQUANET PRETO 7 XL'
  and codigo_protheus = 'DI030.3BD20';
