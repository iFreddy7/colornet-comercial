const text=v=>String(v??'').trim();
const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function documentoValido(value){
 const s=text(value).replace(/\D/g,'');if(![11,14].includes(s.length)||/^(\d)\1+$/.test(s))return false;
 const a=[...s].map(Number);
 if(a.length===11){for(let len=9;len<=10;len++){let d=(a.slice(0,len).reduce((n,v,i)=>n+v*(len+1-i),0)*10)%11;if(d===10)d=0;if(d!==a[len])return false;}return true;}
 for(let len=12;len<=13;len++){let sum=0,w=2;for(let i=len-1;i>=0;i--){sum+=a[i]*w;w=w===9?2:w+1;}const d=sum%11<2?0:11-sum%11;if(d!==a[len])return false;}return true;
}
export function fiscalCliente(r){
 const ie=text(r[26]);const tipoOriginal=text(r[8]);const nt=norm(tipoOriginal);
 const tipo=['CONSFINAL','CONSUMIDORFINAL','REVENDEDOR'].includes(nt)?'Revendedor':tipoOriginal;
 const possui_ie=/^\d{2,14}$/.test(ie.replace(/[.\-\/\s]/g,''))&&!/^0+$/.test(ie.replace(/\D/g,''));
 const indicador=norm(r[161]);const contribuinte=indicador==='SIM'?true:indicador==='NAO'?false:indicador===''?possui_ie:false;
 const suframa=text(r[65])||null;const zf=!!suframa||norm(r[82])==='SIM'||!!text(r[103]);
 const uf=text(r[9]).toUpperCase();const pais=text(r[27]);let motivo=null;
 if(nt==='EXPORTACAO'||uf==='EX'||(pais&&Number(pais)!==105))motivo='EXPORTAÇÃO: CÁLCULO MANUAL';
 else if(!documentoValido(r[0]))motivo='CNPJ/CPF AUSENTE OU INVÁLIDO';
 else if(!'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(uf))motivo='UF AUSENTE OU INVÁLIDA';
 else if(!possui_ie)motivo='CLIENTE SEM IE';
 else if(!['','SIM','NAO'].includes(indicador))motivo='INDICADOR DE CONTRIBUINTE NÃO RECONHECIDO';
 else if(!contribuinte)motivo='CLIENTE NÃO CONTRIBUINTE';
 else if(zf)motivo='ZONA FRANCA/SUFRAMA: CÁLCULO MANUAL';
 else if(!['REVENDEDOR','SOLIDARIO','PRODUTORRURAL'].includes(norm(tipo)))motivo='TIPO DE CLIENTE NÃO HOMOLOGADO';
 return {versao:1,possui_ie,contribuinte_icms:contribuinte,zona_franca:zf,suframa,grupo_cliente:text(r[84])||null,tipo_cliente:tipo,finalidade_compra:tipo,consumidor_final:false,calculo_automatico:!motivo,motivo_calculo_manual:motivo};
}
