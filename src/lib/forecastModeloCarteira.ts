import ExcelJS from 'exceljs'

/** Prepara os modelos aprovados sem alterar clientes, produtos ou histórico. */
export async function limparPrevisoesModelo(bytes:Uint8Array):Promise<Uint8Array> {
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes as any)
 const s=wb.getWorksheet('Forecast');if(!s)throw Error('Modelo sem aba Forecast.')
 s.getCell('A2').value='Preencha as quantidades mensais (kg) dos produtos. O histórico e as médias são referências; os meses começam em branco.'
 s.getCell('A4').value='Digite nos meses: vazio mantém a previsão atual no portal; zero zera o mês. Os totais aparecem após o preenchimento.'
 s.eachRow((row,n)=>{
  if(n<7)return
  if(row.getCell(2).value==='Produto'){
   row.getCell(5).value=null
   for(let col=6;col<=20;col++)row.getCell(col).value=null
  }
  for(const col of [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,22,23,24]){
   const cell=row.getCell(col)
   if(!cell.formula)continue
   const f=cell.formula
   const groupSum=f.match(/^SUM\(([A-Z]+\d+:[A-Z]+\d+)\)$/)
   if(groupSum)cell.value={formula:`IF(COUNT(${groupSum[1]})=0,"",${f})`}
   else if(n===7)cell.value={formula:`IF(COUNT(${cell.address.replace('7','8')}:${cell.address.replace('7',String(s.rowCount))})=0,"",${f})`}
  }
 })
 wb.calcProperties.fullCalcOnLoad=true
 return new Uint8Array(await wb.xlsx.writeBuffer())
}
