import { jsPDF } from 'jspdf'
import { regular, bold } from './cotacaoFont.ts'
import autoTable from 'jspdf-autotable'
import { preencherFiliaisCotacao, type FilialFaturamento } from './filiaisFaturamento.ts'

export interface DocumentoCotacao {
 numero: string; titulo: string; created_at: string; moeda: 'USD' | 'BRL';
 cliente: {codigo: string; nome: string; cnpj_cpf?: string; municipio?: string; uf?: string};
 vendedor: {nome: string}; filial?: FilialFaturamento; filiais_faturamento?: FilialFaturamento[];
 validade?: string | null;
 prazo_pagamento?: {codigo?: string | null; descricao: string} | null;
 frete?: {codigo?: string | null; descricao: string} | null;
 itens: Array<{codigo: string|null; produto: string; ncm?: string|null; colour_index?: string|null; quantidade: number|null; preco_net?: number; preco_final: number;
 filial_origem_id?: string | null; fiscal?: {filial_origem_id?: string | null}; filial_faturamento?: FilialFaturamento;
 aliquota_icms: number|null; ipi: number; total_item: number|null}>;
 subtotal: number|null; valor_ipi: number|null; total: number|null; observacoes?: string;
}

const colors = {
 brand: [25, 51, 127] as [number, number, number], ink: [32, 46, 73] as [number, number, number],
 muted: [100, 114, 138] as [number, number, number], line: [226, 232, 240] as [number, number, number],
 canvas: [245, 247, 251] as [number, number, number], red: [201, 25, 67] as [number, number, number], green: [6, 155, 97] as [number, number, number],
}
function dataBr(value?: string | null) {
 if (!value) return '-'
 const iso=String(value).slice(0,10);const m=iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
 return m?`${m[3]}/${m[2]}/${m[1]}`:String(value)
}
function nomePdfCotacao(c: DocumentoCotacao) {
 return `${c.numero}-${c.titulo.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9-]/g,'_').slice(0,80)}.pdf`
}

export function criarPdfCotacao(original: DocumentoCotacao) {
 const c = preencherFiliaisCotacao(original, [])
 const doc = new jsPDF()
 doc.addFileToVFS('Colornet.ttf',regular);doc.addFont('Colornet.ttf','Colornet','normal')
 doc.addFileToVFS('ColornetBold.ttf',bold);doc.addFont('ColornetBold.ttf','Colornet','bold')
 doc.setFont('Colornet');doc.setProperties({title:c.titulo,author:'ColorNet',subject:'Cotação comercial'})
 const money=(v:number,digits=2)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:c.moeda,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(v).replace(/\u00a0/g,' ')
 const pct=(v:number)=>`${(v*100).toLocaleString('pt-BR',{maximumFractionDigits:2})}%`
 const icms=(v:number|null)=>v==null?'MANUAL':pct(v)
 const decorated = new Set<number>()
 const header = () => {
  const page = doc.getCurrentPageInfo().pageNumber
  if (decorated.has(page)) return
  decorated.add(page)
  doc.setFillColor(...colors.red);doc.rect(0,0,40,1.5,'F')
  doc.setFillColor(...colors.brand);doc.rect(40,0,130,1.5,'F')
  doc.setFillColor(...colors.green);doc.rect(170,0,40,1.5,'F')
  doc.setFont('Colornet','bold');doc.setFontSize(21);doc.setTextColor(...colors.brand);doc.text('ColorNet',14,15)
  doc.setFont('Colornet','normal');doc.setFontSize(8);doc.setTextColor(...colors.muted);doc.text('PORTAL COMERCIAL',14,21)
  doc.setFont('Colornet','bold');doc.setTextColor(...colors.brand);doc.setFontSize(10);doc.text('COTAÇÃO',196,13,{align:'right'})
  doc.setFont('Colornet','normal');doc.setFontSize(8);doc.setTextColor(...colors.muted);doc.text(c.numero,196,20,{align:'right'})
  doc.setDrawColor(...colors.line);doc.setLineWidth(.25);doc.line(14,25,196,25)
 }
 header()
 const tablePage = { margin:{top:31,bottom:22,left:14,right:14}, willDrawPage:header }
 const finalY=()=> (doc as jsPDF & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY
 // A table handles unusually long titles without crossing the page footer.
 autoTable(doc,{...tablePage,startY:31,theme:'plain',styles:{font:'Colornet',fontStyle:'bold',fontSize:16,textColor:colors.ink,cellPadding:0},body:[[c.titulo]]})
 let y=finalY()+7
 type Paragraph = {text:string;bold?:boolean;size?:number;gap?:number}
 const filiais = c.filiais_faturamento || []
 const pendente = c.itens.some(i=>!i.filial_faturamento)
 const varios = filiais.length>1 || (filiais.length>0 && pendente)
 const filialParagraphs: Paragraph[] = filiais.flatMap(f=>[
  {text:f.nome,bold:true,size:10},
  ...(f.razao_social?[{text:f.razao_social}]:[]),
  ...(f.cnpj?[{text:`CNPJ: ${f.cnpj}`}]:[]),
  ...(f.inscricao_estadual?[{text:`IE: ${f.inscricao_estadual}`}]:[]),
  ...(f.endereco?[{text:f.endereco}]:[{text:f.uf||''}]),
  ...(f.cep?[{text:`CEP: ${f.cep}`,gap:3}]:[]),
 ])
 if (!filiais.length || pendente) filialParagraphs.push({text:filiais.length?'Há itens com filial a confirmar.':'Filial a confirmar',bold:true})
 const clienteParagraphs: Paragraph[] = [
  {text:c.cliente.nome,bold:true,size:10},
  {text:`Código: ${c.cliente.codigo}`},
  {text:`CPF / CNPJ: ${c.cliente.cnpj_cpf||'-'}`},
  {text:[c.cliente.municipio,c.cliente.uf].filter(Boolean).join(' / ')||'Localidade não informada'},
 ]
 function layout(paragraphs: Paragraph[], width: number) {
  return paragraphs.filter(p=>p.text).map(p=>{
   doc.setFont('Colornet',p.bold?'bold':'normal');doc.setFontSize(p.size||8)
   const lines=doc.splitTextToSize(p.text,width-10) as string[]
   return {...p,lines,height:lines.length*((p.size||8)*.42)+(p.gap??1.3)}
  })
 }
 const left=layout(filialParagraphs,83),right=layout(clienteParagraphs,93)
 const height=Math.max(42,16+left.reduce((n,p)=>n+p.height,0),16+right.reduce((n,p)=>n+p.height,0))
 if(y+height>270){doc.addPage();header();y=32}
 function card(x:number,width:number,label:string,content:ReturnType<typeof layout>) {
  doc.setDrawColor(...colors.line);doc.setFillColor(255,255,255);doc.setLineWidth(.3);doc.rect(x,y,width,height,'FD')
  doc.setFillColor(...colors.brand);doc.rect(x,y,width,9,'F')
  doc.setTextColor(255);doc.setFont('Colornet','bold');doc.setFontSize(8);doc.text(label,x+5,y+6)
  let lineY=y+15
  for(const p of content){doc.setFont('Colornet',p.bold?'bold':'normal');doc.setFontSize(p.size||8);doc.setTextColor(...(p.bold?colors.brand:colors.ink));doc.text(p.lines,x+5,lineY,{lineHeightFactor:1.19});lineY+=p.height}
 }
 card(14,83,'FILIAL DE FATURAMENTO',left);card(103,93,'CLIENTE',right)
 y+=height+6
 const date=new Date(c.created_at)
 autoTable(doc,{...tablePage,startY:y,theme:'plain',styles:{font:'Colornet',fontSize:8,textColor:colors.ink,cellPadding:2.5},columnStyles:{0:{cellWidth:61},1:{cellWidth:61},2:{cellWidth:60}},body:[
  ['EMISSÃO (BRASÍLIA)','VALIDADE DA PROPOSTA','MOEDA'],
  [Number.isFinite(date.getTime())?date.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'-',dataBr(c.validade),c.moeda==='USD'?'Dólar americano (US$)':'Real (R$)'],
  ['VENDEDOR','PRAZO DE PAGAMENTO','FRETE'],
  [c.vendedor.nome,c.prazo_pagamento?.descricao||'-',c.frete?.descricao||c.frete?.codigo||'-'],
 ],didParseCell:data=>{if(data.row.index===0||data.row.index===2){data.cell.styles.fontStyle='bold';data.cell.styles.fontSize=7;data.cell.styles.textColor=colors.muted;data.cell.styles.fillColor=colors.canvas}}})
 y=finalY()+7
 const temQuantidade=c.itens.some(i=>i.quantidade!=null)
 autoTable(doc,{...tablePage,startY:y,head:[['Produto',...(temQuantidade?['Qtd. (KG)']:[]),'Preço NET','Preço final¹','ICMS',...(temQuantidade?['Total²']:[])]],
 body:c.itens.map(i=>[
  [i.produto,i.codigo||'Sem código',`NCM: ${i.ncm||'Não informado'}`,`Colour Index: ${i.colour_index||'Não informado'}`,i.ipi>0?`IPI: ${pct(i.ipi)}`:'',varios?`Faturamento: ${i.filial_faturamento?.nome||'A confirmar'}`:''].filter(Boolean).join('\n'),
  ...(temQuantidade?[i.quantidade==null?'-':i.quantidade.toLocaleString('pt-BR',{maximumFractionDigits:3})]:[]),
  i.preco_net==null?'-':money(i.preco_net,4),money(i.preco_final),icms(i.aliquota_icms),
  ...(temQuantidade?[i.total_item==null?'-':money(i.total_item)]:[])]),
 styles:{font:'Colornet',fontSize:8,cellPadding:3,textColor:colors.ink,lineColor:colors.line,overflow:'linebreak'},headStyles:{fillColor:colors.brand,textColor:255,fontStyle:'bold'},alternateRowStyles:{fillColor:colors.canvas},
 columnStyles:temQuantidade?{0:{cellWidth:58},1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'}}:{0:{cellWidth:88},1:{halign:'right'},2:{halign:'right'},3:{halign:'right'}},rowPageBreak:'avoid'})
 y=finalY()+6
 if(c.total!=null&&c.itens.every(i=>i.quantidade!=null)){
  autoTable(doc,{...tablePage,startY:y,theme:'plain',pageBreak:'avoid',styles:{font:'Colornet',fontSize:9,textColor:colors.ink,cellPadding:3},body:[['Subtotal',money(c.subtotal??0)],['IPI',money(c.valor_ipi??0)],['Total',money(c.total)]],columnStyles:{0:{fontStyle:'bold'},1:{halign:'right'}},didParseCell:data=>{if(data.row.index===2){data.cell.styles.fillColor=colors.brand;data.cell.styles.textColor=255;data.cell.styles.fontStyle='bold'}}})
  y=finalY()+5
 }
 autoTable(doc,{...tablePage,startY:y,theme:'plain',styles:{font:'Colornet',fontSize:8,textColor:colors.muted,cellPadding:2},body:[
  ['¹ Preço final unitário com ICMS, sem IPI. NET e final expressos por KG.'],
  ...(temQuantidade?[['² Total do item inclui IPI. Itens sem quantidade não possuem total.']]:[]),
  ['Disponibilidade sujeita à confirmação. Esta cotação não reserva estoque.'],
  ...(varios?[['A filial de faturamento está identificada em cada item.']]:[]),
  ...(c.observacoes?[[`Observações: ${c.observacoes}`]]:[]),
 ]})
 const pages=doc.getNumberOfPages()
 for(let p=1;p<=pages;p++){
  doc.setPage(p);doc.setDrawColor(...colors.line);doc.line(14,281,196,281)
  doc.setFont('Colornet','normal');doc.setFontSize(7);doc.setTextColor(...colors.muted)
  doc.text('ColorNet | Cotação comercial',14,287);doc.text(`${c.numero} | ${p} / ${pages}`,196,287,{align:'right'})
 }
 return doc
}

export function pdfCotacaoBase64(c: DocumentoCotacao) {
 const dataUri=criarPdfCotacao(c).output('datauristring'),comma=dataUri.indexOf(',')
 if(comma<0)throw new Error('Não foi possível gerar o PDF da cotação.')
 return {nome:nomePdfCotacao(c),base64:dataUri.slice(comma+1)}
}
export function baixarPdfCotacao(c: DocumentoCotacao) { criarPdfCotacao(c).save(nomePdfCotacao(c)) }
