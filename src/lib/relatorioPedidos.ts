import ExcelJS from 'exceljs'

type Registro = Record<string, unknown>
type ValorCelula = string | number | boolean | Date | null
type Linha = Record<string, ValorCelula>

export interface RelatorioPedidos {
  versao: number
  gerado_em: string
  filtros: Registro
  pedidos: Array<{ pedido: Registro } & Registro>
  itens: Registro[]
  eventos: Registro[]
  estoque: Registro[]
  previsoes: Registro[]
  emails: Registro[]
}

const nomes: Record<string, string> = {
  pedido: 'Pedido', cliente: 'Cliente', vendedor: 'Vendedor', filial: 'Filial',
  prazo_pagamento: 'Prazo', frete: 'Frete', autor: 'Criado por', cancelado_por: 'Cancelado por',
  item: 'Item', produto: 'Produto', numero_pedido: 'Número do pedido', id: 'ID',
  numero: 'Número', created_at: 'Data de criação', criado_em: 'Data do registro',
  created_by: 'ID do autor', codigo: 'Código', codigo_protheus: 'Código Protheus',
  nome: 'Nome', razao_social: 'Razão social', nome_fantasia: 'Nome fantasia',
  cnpj_cpf: 'CNPJ/CPF', inscricao_estadual: 'Inscrição estadual',
  moeda: 'Moeda', status: 'Status', quantidade: 'Quantidade (KG)',
  preco_net: 'Preço NET', preco_final: 'Preço final', aliquota_icms: 'ICMS (%)',
  divisor_icms: 'Divisor ICMS', ipi: 'IPI (%)', valor_ipi: 'Valor do IPI',
  subtotal: 'Subtotal', total: 'Total', total_item: 'Total do item',
  modo_fiscal: 'Modo fiscal', regra_icms: 'Regra ICMS', motivo_fiscal: 'Motivo fiscal',
  faixa_interna: 'Faixa interna', observacao_preco: 'Observação de preço',
  data_entrega: 'Data de entrega', observacoes_transporte: 'Observações de transporte',
  observacoes: 'Observações', cancelado_em: 'Data do cancelamento',
  motivo_cancelamento: 'Motivo do cancelamento', vendedor_id: 'ID do vendedor',
  cliente_id: 'ID do cliente', filial_id: 'ID da filial', produto_id: 'ID do produto',
  pedido_id: 'ID do pedido', email: 'E-mail', ncm: 'NCM', uf: 'UF',
}
const label = (key: string) => key.split('.').map(k => {
  const sufixo = k.match(/ (?:\(|\[).*$/)?.[0] || ''
  const campo = sufixo ? k.slice(0, -sufixo.length) : k
  return (nomes[campo] || campo.replaceAll('_', ' ')) + sufixo
}).join(' • ')
const partsBrasilia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function dataExcelBrasilia(iso: string): Date {
  const p = Object.fromEntries(partsBrasilia.formatToParts(new Date(iso)).map(x => [x.type, x.value]))
  // Excel armazena data/hora sem fuso. Os componentes já estão em Brasília.
  return new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`)
}

function textoCompleto(linha: Linha, chave: string, valor: string) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(valor)) {
    // Preserve caracteres de controle como escapes legíveis no XML do Excel.
    valor = JSON.stringify(valor)
    chave += ' [JSON com caracteres de controle]'
  }
  // Não corta conteúdo no limite de 32767 caracteres por célula.
  let parte = 1
  do {
    let tamanho = 30000
    const ultimo = valor.charCodeAt(tamanho - 1)
    if (ultimo >= 0xD800 && ultimo <= 0xDBFF) tamanho--
    linha[parte === 1 ? chave : `${chave} [continuação ${parte}]`] = valor.slice(0, tamanho)
    valor = valor.slice(tamanho)
    parte++
  } while (valor.length)
}

function achatar(registro: Registro, prefixo = '', linha: Linha = Object.create(null)): Linha {
  for (const [nome, valor] of Object.entries(registro)) {
    const chave = prefixo ? `${prefixo}.${nome}` : nome
    if (valor == null) linha[chave] = null
    else if (typeof valor === 'object' && !Array.isArray(valor)) achatar(valor as Registro, chave, linha)
    else if (typeof valor === 'number') {
      if (!Number.isFinite(valor)) throw new Error('O relatório contém um número inválido.')
      linha[chave] = valor
    } else if (typeof valor === 'boolean') linha[chave] = valor
    else if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(valor) && Number.isFinite(Date.parse(valor))) {
      linha[`${chave} (Brasília)`] = dataExcelBrasilia(valor)
      linha[`${chave} (original)`] = valor
    } else if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && Number.isFinite(Date.parse(valor))) {
      linha[chave] = new Date(valor + 'T00:00:00Z')
    } else textoCompleto(linha, chave, typeof valor === 'string' ? valor : JSON.stringify(valor))
  }
  return linha
}

function planilha(wb: ExcelJS.Workbook, nome: string, registros: Registro[], preferidas: string[] = []) {
  if (registros.length > 1_048_575) throw new Error('O relatório excede o limite de linhas do Excel. Selecione um período menor.')
  const linhas = registros.map(r => achatar(r))
  const disponiveis = new Set(linhas.flatMap(l => Object.keys(l)))
  const colunas = [...preferidas.filter(k => disponiveis.has(k)), ...Array.from(disponiveis).filter(k => !preferidas.includes(k))]
  if (colunas.length > 16384) throw new Error('O relatório excede o limite de colunas do Excel.')
  const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: 1 }], properties: { defaultRowHeight: 20 } })
  if (!linhas.length) { ws.addRow(['Nenhum registro para os filtros selecionados.']); return }
  ws.columns = colunas.map(c => ({ header: label(c), key: c, width: /observa|detalh|razao|nome|email|ID|_id|^id$/.test(c) ? 32 : 22 }))
  for (const linha of linhas) {
    // Valores de texto são sempre strings. Nunca são interpretados como fórmula.
    const row = ws.addRow(colunas.map(c => linha[c] ?? null))
    colunas.forEach((chave, i) => {
      const cell = row.getCell(i + 1)
      const v = linha[chave]
      if (v instanceof Date) cell.numFmt = chave.includes('(Brasília)') ? 'dd/mm/yyyy hh:mm:ss' : 'dd/mm/yyyy'
      else if (typeof v === 'number') {
        const campo = chave.split('.').at(-1) || ''
        cell.numFmt = /^(ipi|aliquota_icms)$/.test(campo) ? '0.00%' :
          /quantidade|saldo/.test(campo) ? '#,##0.000' :
          /preco|divisor|faixa_[123]/.test(campo) ? '#,##0.000000' : '#,##0.00'
      }
    })
  }
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5635BE' } }
  ws.getRow(1).height = 32
  ws.getRow(1).alignment = { vertical: 'middle', wrapText: true }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: linhas.length + 1, column: colunas.length } }
}

export function validarRelatorio(valor: unknown): RelatorioPedidos {
  const r = valor as RelatorioPedidos
  if (!r || r.versao !== 1 || !r.gerado_em || !r.filtros ||
    !['pedidos','itens','eventos','estoque','previsoes','emails'].every(k => Array.isArray((r as unknown as Registro)[k])) ||
    r.pedidos.some(p => !p?.pedido?.id || !p.pedido.numero)) {
    throw new Error('O servidor retornou um relatório incompleto. Nenhum arquivo foi gerado.')
  }
  return r
}

export async function gerarExcelPedidos(relatorio: RelatorioPedidos): Promise<Uint8Array> {
  validarRelatorio(relatorio)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Colornet Comercial'
  wb.created = new Date(relatorio.gerado_em)
  const grupos = new Map<string, { moeda: string; status: string; pedidos: number; subtotal: number; ipi: number; total: number }>()
  for (const { pedido } of relatorio.pedidos) {
    const chave = `${pedido.moeda}|${pedido.status}`
    const g = grupos.get(chave) || { moeda: String(pedido.moeda), status: String(pedido.status), pedidos: 0, subtotal: 0, ipi: 0, total: 0 }
    g.pedidos++
    g.subtotal += Math.round(Number(pedido.subtotal || 0) * 100)
    g.ipi += Math.round(Number(pedido.valor_ipi || 0) * 100)
    g.total += Math.round(Number(pedido.total || 0) * 100)
    grupos.set(chave, g)
  }
  planilha(wb, 'Resumo', Array.from(grupos.values()).map(g => ({
    moeda: g.moeda, status: g.status, 'Quantidade de pedidos': g.pedidos,
    subtotal: g.subtotal / 100, valor_ipi: g.ipi / 100, total: g.total / 100,
  })))
  planilha(wb, 'Pedidos', relatorio.pedidos, ['pedido.numero','pedido.created_at (Brasília)','pedido.status','pedido.moeda','cliente.razao_social','vendedor.nome','filial.nome','pedido.total'])
  planilha(wb, 'Itens', relatorio.itens, ['numero_pedido','moeda','produto.codigo_protheus','produto.nome','item.quantidade','item.preco_net','item.preco_final','item.aliquota_icms','item.ipi','item.total_item'])
  planilha(wb, 'Historico', relatorio.eventos, ['numero_pedido','criado_em (Brasília)','tipo','autor_nome'])
  planilha(wb, 'Estoque', relatorio.estoque, ['numero_pedido','produto_nome','filial_nome','criado_em (Brasília)','tipo','quantidade'])
  planilha(wb, 'Previsoes', relatorio.previsoes, ['numero_pedido','produto_nome','filial_nome','tipo','quantidade'])
  planilha(wb, 'Emails', relatorio.emails, ['numero_pedido','criado_em (Brasília)','status','destinatarios','cc'])
  planilha(wb, 'Informacoes', [
    { Campo: 'Gerado em', Valor: relatorio.gerado_em },
    { Campo: 'Filtros', Valor: JSON.stringify(relatorio.filtros) },
    { Campo: 'Horários', Valor: 'Datas com hora exibidas em Brasília. A coluna original preserva o instante e sua precisão.' },
    { Campo: 'Totais', Valor: 'Resumo separado por moeda e status. Cancelados não são somados aos pedidos ativos. O total do pedido aparece uma vez na aba Pedidos.' },
    { Campo: 'Cadastros', Valor: 'Cliente, vendedor, filial e produto refletem o cadastro na data da exportação. Preços, impostos e condições do pedido são os valores gravados no pedido.' },
    { Campo: 'Conteúdo longo', Valor: 'Campos com mais de 30000 caracteres continuam nas colunas seguintes, sem descarte.' },
  ])
  return new Uint8Array(await wb.xlsx.writeBuffer())
}
