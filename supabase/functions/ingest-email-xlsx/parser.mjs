export function parseClientes(sheets) {
 const text=v=>String(v??'').trim();
 const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 const code=(v,len)=>{const s=text(v);if(!/^\d+$/.test(s))throw Error('Código inválido: '+s);return s.padStart(len,'0');};
 const all=new Map();let duplicates=0;
 for(const sheet of sheets){
  const rows=sheet.rows;const h=rows.findIndex((r,i)=>i<20&&norm(r[1])==='CODIGO'&&norm(r[2])==='LOJA');
  if(h<0)throw Error('Cabeçalho de clientes não encontrado na aba '+sheet.name);
  if(norm(rows[h][29])!=='VENDEDOR')throw Error('A coluna AD deve conter Vendedor na aba '+sheet.name);
  for(let i=h+1;i<rows.length;i++){
   const r=rows[i];if(!text(r[1]))continue;
   const c={codigo:code(r[1],6),loja:code(r[2],4),razao_social:text(r[4]),nome_fantasia:text(r[5])||null,cnpj_cpf:/\d/.test(text(r[0]))?text(r[0]):null,inscricao_estadual:text(r[26])||null,tipo_cliente:text(r[8])||null,uf:text(r[9])||null,municipio:text(r[12])||null,endereco:text(r[6])||null,bairro:text(r[7])||null,cep:text(r[11])||null,telefone:text(r[20])||null,contato:text(r[24])||null,email:text(r[102])||null,vendedor_codigo:text(r[29])?code(text(r[29]).split(/\s+-\s+/)[0],6):null};
   if(!c.razao_social)throw Error('Nome vazio na linha '+(i+1));
   const status=norm(r[117]);if(!['','ATIVO','INATIVO'].includes(status))throw Error('Status inválido na linha '+(i+1));
   c.ativo=status==='INATIVO'?false:status==='ATIVO'?true:null;
   const key=c.codigo+'-'+c.loja;const old=all.get(key);
   if(old&&JSON.stringify(old)!==JSON.stringify(c))throw Error('Dados conflitantes entre abas/linhas para '+key);
   if(old)duplicates++;else all.set(key,c);
  }
 }
 if(!all.size||all.size>10000)throw Error('Quantidade de clientes inválida (1 a 10000).');
 return {linhas:[...all.values()],duplicados_identicos:duplicates};
}
