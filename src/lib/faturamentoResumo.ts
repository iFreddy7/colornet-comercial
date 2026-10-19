export type LinhaHistorica={periodo:string;filial_codigo:string;vendedor_nome:string;cliente_chave:string;cliente_codigo:string;cliente_nome:string;produto_codigo:string;produto_nome:string;quantidade:number}
export function resumirFaturamento(linhas:LinhaHistorica[]){
  const grupos=new Map<string,{ano:string;vendedor:string;cliente:string;codigoCliente:string;produto:string;codigoProduto:string;filial:string;meses:(number|null)[]}>()
  for(const l of linhas){
    const ano=l.periodo.slice(0,4);const chave=JSON.stringify([ano,l.vendedor_nome,l.cliente_chave,l.produto_codigo,l.filial_codigo])
    let g=grupos.get(chave)
    if(!g){g={ano,vendedor:l.vendedor_nome,cliente:l.cliente_nome,codigoCliente:l.cliente_codigo,produto:l.produto_nome,codigoProduto:l.produto_codigo,filial:l.filial_codigo,meses:Array(12).fill(null)};grupos.set(chave,g)}
    const mes=Number(l.periodo.slice(5,7))-1
    g.meses[mes]=(g.meses[mes]??0)+Number(l.quantidade)
  }
  return [...grupos.values()].sort((a,b)=>a.cliente.localeCompare(b.cliente,'pt-BR')||a.codigoProduto.localeCompare(b.codigoProduto)||a.ano.localeCompare(b.ano))
}
