import { jsPDF } from 'jspdf'
import {regular,bold} from './cotacaoFont'
import autoTable from 'jspdf-autotable'

export interface DocumentoCotacao {
 numero: string; titulo: string; created_at: string; moeda: 'USD' | 'BRL';
 cliente: {codigo: string; nome: string; cnpj_cpf?: string; municipio?: string; uf?: string};
 vendedor: {nome: string}; filial?: {nome: string; uf: string};
 itens: Array<{codigo: string|null; produto: string; ncm?: string|null; colour_index?: string|null; quantidade: number|null; preco_net?: number; preco_final: number;
 aliquota_icms: number|null; ipi: number; total_item: number|null}>;
 subtotal: number|null; valor_ipi: number|null; total: number|null; observacoes?: string;
}
export function criarPdfCotacao(c: DocumentoCotacao) {
 const doc = new jsPDF(); doc.addFileToVFS('Colornet.ttf',regular);doc.addFont('Colornet.ttf','Colornet','normal');doc.addFileToVFS('ColornetBold.ttf',bold);doc.addFont('ColornetBold.ttf','Colornet','bold');doc.setFont('Colornet'); const money=(v:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:c.moeda}).format(v).replace(/\u00a0/g,' ')
 const pct=(v:number)=>`${(v*100).toLocaleString('pt-BR',{maximumFractionDigits:2})}%`
 doc.setProperties({title:c.titulo,author:'Colornet',subject:'Cotação / Lista de preço'})
 doc.setFillColor(79,48,174);doc.rect(0,0,210,25,'F');doc.setTextColor(255);doc.setFontSize(20);doc.text('ColorNet',14,16)
 doc.setFontSize(10);doc.text('COTAÇÃO / LISTA DE PREÇO',196,15,{align:'right'})
 doc.setTextColor(30);doc.setFontSize(15)
 const title=doc.splitTextToSize(c.titulo,182);doc.text(title,14,36)
 let y=39+title.length*6
 autoTable(doc,{startY:y,theme:'plain',styles:{font:'Colornet',fontSize:9,cellPadding:2},columnStyles:{0:{cellWidth:28,fontStyle:'bold'}},body:[
 ['Referência',c.numero],['Emissão',new Date(c.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília)'],
 ['Cliente',`${c.cliente.codigo} - ${c.cliente.nome}`],['CPF / CNPJ',c.cliente.cnpj_cpf||'-'],
 ['Localidade',[c.cliente.municipio,c.cliente.uf].filter(Boolean).join(' / ')],['Vendedor',c.vendedor.nome],['Moeda',c.moeda==='USD'?'Dólar americano (US$)':'Real (R$)']]})
 y=(doc as jsPDF & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY+7
 const temQuantidade=c.itens.some(i=>i.quantidade!=null)
 autoTable(doc,{startY:y,margin:{top:15,bottom:20},head:[['Produto / Código / NCM',...(temQuantidade?['Qtd. (KG)']:[]),'Preço NET','Preço final¹',...(temQuantidade?['Total²']:[])]],
 body:c.itens.map(i=>[
  [i.produto,i.codigo||'Sem código',`NCM: ${i.ncm||'Não informado'}`,i.colour_index?`Colour Index: ${i.colour_index}`:'',i.ipi>0?`IPI: ${pct(i.ipi)}`:''].filter(Boolean).join('\n'),
  ...(temQuantidade?[i.quantidade==null?'-':i.quantidade.toLocaleString('pt-BR',{maximumFractionDigits:3})]:[]),
  i.preco_net==null?'-':new Intl.NumberFormat('pt-BR',{style:'currency',currency:c.moeda,minimumFractionDigits:4,maximumFractionDigits:4}).format(i.preco_net).replace(/\u00a0/g,' '),money(i.preco_final),
  ...(temQuantidade?[i.total_item==null?'-':money(i.total_item)]:[])]),
 styles:{font:'Colornet',fontSize:8,cellPadding:3,overflow:'linebreak'},headStyles:{fillColor:[79,48,174]},
 columnStyles:{0:{cellWidth:temQuantidade?65:100},1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'}},rowPageBreak:'avoid'})
 y=(doc as jsPDF & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY+7
 if (c.total!=null && c.itens.every(i=>i.quantidade!=null)) {
  autoTable(doc,{startY:y,theme:'plain',styles:{font:'Colornet',fontSize:9},body:[['Subtotal',money(c.subtotal??0)],['IPI',money(c.valor_ipi??0)],['Total',money(c.total)]],columnStyles:{0:{fontStyle:'bold'},1:{halign:'right'}}})
  y=(doc as jsPDF & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY+5
 }
 autoTable(doc,{startY:y,theme:'plain',styles:{font:'Colornet',fontSize:8},body:[
 ['¹ Preço final unitário com ICMS, sem IPI. NET e final expressos por KG.'],
 ...(temQuantidade?[['² Total do item inclui IPI. Itens sem quantidade não possuem total.']]:[]),
 ['Disponibilidade sujeita à confirmação. Esta cotação não reserva estoque.'],...(c.observacoes?[[`Observações: ${c.observacoes}`]]:[])]})
 const pages=doc.getNumberOfPages();for(let p=1;p<=pages;p++){doc.setPage(p);doc.setFontSize(8);doc.setTextColor(100);doc.text(`${c.numero} | ${p} / ${pages}`,196,288,{align:'right'})}
 return doc
}
export function baixarPdfCotacao(c: DocumentoCotacao) {
 criarPdfCotacao(c).save(`${c.numero}-${c.titulo.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9-]/g,'_').slice(0,80)}.pdf`)
}
