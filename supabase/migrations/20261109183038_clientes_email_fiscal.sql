create or replace function public.aplicar_clientes_email(p_linhas jsonb,p_chave text,p_arquivo text,p_recebido timestamptz,p_apply boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare r jsonb; c public.clientes%rowtype; v uuid; matches integer; novos integer:=0; alterados integer:=0; carteiras integer:=0; sem_vendedor integer:=0; res jsonb; antes jsonb; fis jsonb; fiscais integer:=0; automaticos integer:=0; manuais integer:=0;
begin
 if p_linhas is null or jsonb_typeof(p_linhas)<>'array' or jsonb_array_length(p_linhas) not between 1 and 10000 then raise exception 'Lista de clientes inválida'; end if;
 if nullif(p_chave,'') is null or p_recebido is null then raise exception 'Identificação do e-mail obrigatória'; end if;
 lock table public.clientes in share row exclusive mode;
 if exists(select 1 from private.clientes_email_backups where chave=p_chave) then return jsonb_build_object('ja_aplicado',true); end if;
 if exists(select 1 from private.clientes_email_backups where recebido_em>p_recebido) then raise exception 'Arquivo anterior à última atualização de clientes'; end if;
 if exists(select 1 from jsonb_array_elements(p_linhas) x group by ltrim(x->>'codigo','0'),ltrim(x->>'loja','0') having count(*)>1) then raise exception 'Código e loja duplicados'; end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into antes from public.clientes t;
 for r in select value from jsonb_array_elements(p_linhas) loop
  if coalesce(r->>'codigo','') !~ '^[0-9]+$' or coalesce(r->>'loja','') !~ '^[0-9]+$' or nullif(r->>'razao_social','') is null then raise exception 'Código, loja ou nome inválido'; end if;
  v:=null; c:=null;
  if nullif(r->>'vendedor_codigo','') is not null then
   select count(*), (array_agg(id))[1] into matches,v from public.vendedores where codigo_protheus=r->>'vendedor_codigo' and ativo;
   if matches<>1 then raise exception 'Vendedor inexistente ou inativo: % (cliente %)',r->>'vendedor_codigo',r->>'codigo'; end if;
  else sem_vendedor:=sem_vendedor+1; end if;
  select count(*) into matches from public.clientes where ltrim(codigo,'0')=ltrim(r->>'codigo','0') and ltrim(coalesce(loja,''),'0')=ltrim(r->>'loja','0');
  if matches>1 then raise exception 'Cadastro ambíguo para cliente % loja %',r->>'codigo',r->>'loja'; end if;
  if matches=1 then
   select * into c from public.clientes where ltrim(codigo,'0')=ltrim(r->>'codigo','0') and ltrim(coalesce(loja,''),'0')=ltrim(r->>'loja','0');
   if v is not null and v is distinct from c.vendedor_id then carteiras:=carteiras+1; end if;
   if jsonb_build_array(c.razao_social,c.nome_fantasia,c.endereco,c.bairro,c.cep,c.municipio,c.uf,c.email,c.telefone,c.contato,c.vendedor_id,c.ativo) is distinct from
      jsonb_build_array(r->>'razao_social',coalesce(r->>'nome_fantasia',c.nome_fantasia),coalesce(r->>'endereco',c.endereco),coalesce(r->>'bairro',c.bairro),coalesce(r->>'cep',c.cep),coalesce(r->>'municipio',c.municipio),coalesce(r->>'uf',c.uf),coalesce(r->>'email',c.email),coalesce(r->>'telefone',c.telefone),coalesce(r->>'contato',c.contato),coalesce(v,c.vendedor_id),coalesce((r->>'ativo')::boolean,c.ativo)) then alterados:=alterados+1; end if;
   if p_apply then update public.clientes set razao_social=r->>'razao_social',nome_fantasia=coalesce(r->>'nome_fantasia',nome_fantasia),endereco=coalesce(r->>'endereco',endereco),bairro=coalesce(r->>'bairro',bairro),cep=coalesce(r->>'cep',cep),municipio=coalesce(r->>'municipio',municipio),uf=coalesce(r->>'uf',uf),email=coalesce(r->>'email',email),telefone=coalesce(r->>'telefone',telefone),contato=coalesce(r->>'contato',contato),vendedor_id=coalesce(v,vendedor_id),ativo=coalesce((r->>'ativo')::boolean,ativo) where id=c.id; end if;
  else
   if coalesce((r->>'ativo')::boolean,true)=false then continue; end if;
   if v is null then raise exception 'Novo cliente sem vendedor: %',r->>'codigo'; end if;
   novos:=novos+1;
   if p_apply then insert into public.clientes(chave_cliente,codigo,loja,razao_social,nome_fantasia,cnpj_cpf,inscricao_estadual,possui_ie,contribuinte_icms,calculo_automatico,motivo_calculo_manual,consumidor_final,finalidade_compra,tipo_cliente,municipio,uf,endereco,bairro,cep,email,telefone,contato,vendedor_id,ativo)
   values((r->>'codigo')||'-'||(r->>'loja'),r->>'codigo',r->>'loja',r->>'razao_social',r->>'nome_fantasia',r->>'cnpj_cpf',r->>'inscricao_estadual',coalesce(r->>'inscricao_estadual','')~'[0-9]',coalesce(r->>'inscricao_estadual','')~'[0-9]',false,'NOVO CADASTRO POR EMAIL: CONFERIR DADOS FISCAIS',coalesce(r->>'tipo_cliente','')='Cons.Final',r->>'tipo_cliente',r->>'tipo_cliente',r->>'municipio',r->>'uf',r->>'endereco',r->>'bairro',r->>'cep',r->>'email',r->>'telefone',r->>'contato',v,true); end if;
  end if;

  if r ? 'fiscal' then
   fis:=r->'fiscal';
   if fis->>'versao'<>'1' or jsonb_typeof(fis->'calculo_automatico')<>'boolean' or jsonb_typeof(fis->'contribuinte_icms')<>'boolean' or jsonb_typeof(fis->'possui_ie')<>'boolean' then raise exception 'Dados fiscais inválidos'; end if;
   -- Preserve manual restrictions explicitly set outside this importer.
   if matches=1 and not coalesce(c.calculo_automatico,false)
      and nullif(c.motivo_calculo_manual,'') is not null
      and c.motivo_calculo_manual not in ('NOVO CADASTRO POR EMAIL: CONFERIR DADOS FISCAIS','CLIENTE SEM IE','EXPORTAÇÃO: CÁLCULO MANUAL','CNPJ/CPF AUSENTE OU INVÁLIDO','UF AUSENTE OU INVÁLIDA','INDICADOR DE CONTRIBUINTE NÃO RECONHECIDO','CLIENTE NÃO CONTRIBUINTE','ZONA FRANCA/SUFRAMA: CÁLCULO MANUAL','TIPO DE CLIENTE NÃO HOMOLOGADO') then
     fis:=fis||jsonb_build_object('calculo_automatico',false,'motivo_calculo_manual',c.motivo_calculo_manual);
   end if;
   if (fis->>'calculo_automatico')::boolean then automaticos:=automaticos+1; else manuais:=manuais+1; end if;
   if matches=0 or jsonb_build_array(c.cnpj_cpf,c.inscricao_estadual,c.possui_ie,c.contribuinte_icms,c.zona_franca,c.suframa,c.calculo_automatico,c.motivo_calculo_manual,c.consumidor_final,c.finalidade_compra,c.tipo_cliente,c.grupo_cliente,c.complemento) is distinct from
    jsonb_build_array(coalesce(r->>'cnpj_cpf',c.cnpj_cpf),r->>'inscricao_estadual',(fis->>'possui_ie')::boolean,(fis->>'contribuinte_icms')::boolean,(fis->>'zona_franca')::boolean,fis->>'suframa',(fis->>'calculo_automatico')::boolean,fis->>'motivo_calculo_manual',(fis->>'consumidor_final')::boolean,fis->>'finalidade_compra',fis->>'tipo_cliente',fis->>'grupo_cliente',coalesce(r->>'complemento',c.complemento)) then fiscais:=fiscais+1; end if;
   if p_apply then
    update public.clientes set cnpj_cpf=coalesce(r->>'cnpj_cpf',cnpj_cpf),inscricao_estadual=r->>'inscricao_estadual',
     possui_ie=(fis->>'possui_ie')::boolean,contribuinte_icms=(fis->>'contribuinte_icms')::boolean,zona_franca=(fis->>'zona_franca')::boolean,suframa=fis->>'suframa',
     calculo_automatico=(fis->>'calculo_automatico')::boolean,motivo_calculo_manual=fis->>'motivo_calculo_manual',
     consumidor_final=(fis->>'consumidor_final')::boolean,finalidade_compra=fis->>'finalidade_compra',tipo_cliente=fis->>'tipo_cliente',grupo_cliente=fis->>'grupo_cliente',complemento=coalesce(r->>'complemento',complemento)
     where ltrim(codigo,'0')=ltrim(r->>'codigo','0') and ltrim(coalesce(loja,''),'0')=ltrim(r->>'loja','0');
   end if;
  end if;
 end loop;
 res:=jsonb_build_object('fiscais_atualizados',fiscais,'habilitados_automatico',automaticos,'mantidos_manual',manuais,'novos',novos,'atualizados',alterados,'carteiras_alteradas',carteiras,'sem_vendedor_mantidos',sem_vendedor,'linhas',jsonb_array_length(p_linhas));
 if p_apply then insert into private.clientes_email_backups(chave,recebido_em,arquivo,clientes_antes,resultado) values(p_chave,p_recebido,p_arquivo,antes,res); end if;
 return res;
end $fn$;
revoke all on function public.aplicar_clientes_email(jsonb,text,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.aplicar_clientes_email(jsonb,text,text,timestamptz,boolean) to service_role;
