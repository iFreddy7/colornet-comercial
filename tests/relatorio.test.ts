import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { gerarExcelPedidos, validarRelatorio, type RelatorioPedidos } from '../src/lib/relatorioPedidos.ts'

function fixture(): RelatorioPedidos {
  const base = { created_at: '2026-09-16T02:30:00Z', moeda: 'USD', status: 'ABERTO', subtotal: 28.75, valor_ipi: 1.87, total: 30.62 }
  return { versao: 1, gerado_em: '2026-09-16T14:00:00Z', filtros: {},
    pedidos: [
      { pedido: { ...base, id: 'p1', numero: 'PED-1', data_entrega: '2026-09-20' }, cliente: { codigo: '00123', cnpj_cpf: '00123456000199', razao_social: '=HYPERLINK("url","texto")' } },
      { pedido: { ...base, id: 'p2', numero: 'PED-2', moeda: 'BRL' } },
      { pedido: { ...base, id: 'p3', numero: 'PED-3', status: 'CANCELADO', observacoes: 'á'.repeat(40000) } },
    ],
    itens: [{ numero_pedido: 'PED-1', moeda: 'USD', item: { quantidade: 1, ipi: .065, aliquota_icms: .04, total_item: 30.62 }, produto: { codigo_protheus: 'AL031.2BD25', ncm: '3212.90.10' } }],
    eventos: [{ pedido_id: 'p3', tipo: 'CANCELAMENTO', detalhes: { motivo: 'Teste', quantidade: 1 } }],
    estoque: [{ pedido_id: 'p1', quantidade: 1 }], previsoes: [], emails: [],
  }
}
async function workbook() {
  const w = new ExcelJS.Workbook(); await w.xlsx.load(await gerarExcelPedidos(fixture()) as any); return w
}
function cell(w: ExcelJS.Worksheet, row: number, header: string) {
  let coluna = 0
  w.getRow(1).eachCell((c, i) => { if (c.value === header) coluna = i })
  assert.ok(coluna, `Coluna ${header}`)
  return w.getRow(row).getCell(coluna)
}
test('XLSX reabre com as oito abas e todas as linhas', async () => {
  const w = await workbook()
  assert.deepEqual(w.worksheets.map(s => s.name), ['Resumo','Pedidos','Itens','Historico','Estoque','Previsoes','Emails','Informacoes'])
  assert.equal(w.getWorksheet('Pedidos')!.rowCount, 4)
  assert.equal(w.getWorksheet('Itens')!.rowCount, 2)
})
test('Totais por moeda/status não misturam cancelamentos nem multiplicam itens', async () => {
  const w = await workbook(); const s = w.getWorksheet('Resumo')!
  assert.equal(s.rowCount, 4)
  for (let r = 2; r <= 4; r++) assert.equal(cell(s,r,'Total').value,30.62)
  assert.equal(cell(s,3,'Moeda').value,'BRL')
  assert.equal(cell(s,4,'Status').value,'CANCELADO')
})
test('Código/CNPJ preservam zeros e texto iniciado em = não vira fórmula', async () => {
  const w = await workbook(); const s = w.getWorksheet('Pedidos')!
  assert.equal(cell(s,2,'Cliente • Código').value,'00123')
  assert.equal(cell(s,2,'Cliente • CNPJ/CPF').value,'00123456000199')
  assert.equal(cell(s,2,'Cliente • Razão social').type,ExcelJS.ValueType.String)
  assert.equal(cell(s,2,'Cliente • Razão social').formula,undefined)
})
test('Hora vira Brasília, preserva original e data de entrega não muda de dia', async () => {
  const w = await workbook(); const s = w.getWorksheet('Pedidos')!
  assert.equal((cell(s,2,'Pedido • Data de criação (Brasília)').value as Date).toISOString(),'2026-09-15T23:30:00.000Z')
  assert.equal(cell(s,2,'Pedido • Data de criação (original)').value,'2026-09-16T02:30:00Z')
  assert.equal((cell(s,2,'Pedido • Data de entrega').value as Date).toISOString(),'2026-09-20T00:00:00.000Z')
})
test('Observação longa e histórico JSON são preservados integralmente', async () => {
  const w = await workbook(); const s = w.getWorksheet('Pedidos')!
  assert.equal(String(cell(s,4,'Pedido • Observações').value) + String(cell(s,4,'Pedido • Observações [continuação 2]').value),'á'.repeat(40000))
  assert.equal(cell(w.getWorksheet('Historico')!,2,'detalhes • motivo').value,'Teste')
})
test('Relatório incompleto é rejeitado em vez de baixar arquivo parcial', () => {
  assert.throws(() => validarRelatorio({ pedidos: [] }), /incompleto/)
})
