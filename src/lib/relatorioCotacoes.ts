import ExcelJS from 'exceljs'
import { planilha } from './relatorioPedidos.ts'

type Registro = Record<string, unknown>
export interface RelatorioCotacoes { versao: number; gerado_em: string; filtros: Registro; cotacoes: Registro[]; itens: Registro[] }
export function validarRelatorioCotacoes(valor: unknown): RelatorioCotacoes {
  const r = valor as RelatorioCotacoes
  if (!r || r.versao !== 1 || !Number.isFinite(Date.parse(r.gerado_em)) || !r.filtros || !Array.isArray(r.cotacoes) || !Array.isArray(r.itens) || r.cotacoes.some(c => !c?.id || !c.numero || !['BRL','USD'].includes(String(c.moeda)) || !['PENDENTE','APROVADA','REPROVADA'].includes(String(c.aprovacao_status)) || (c.total != null && (typeof c.total !== 'number' || !Number.isFinite(c.total))))) {
    throw new Error('O servidor retornou um relatório incompleto. Nenhum arquivo foi gerado.')
  }
  return r
}
export async function gerarExcelCotacoes(valor: RelatorioCotacoes): Promise<Uint8Array> {
  const r = validarRelatorioCotacoes(valor), wb = new ExcelJS.Workbook()
  wb.creator = 'ColorNet Comercial'; wb.created = new Date(r.gerado_em)
  const grupos = new Map<string, { moeda: string; situacao: string; cotacoes: number; listas_sem_total: number; total: number }>()
  for (const c of r.cotacoes) {
    const key = `${c.moeda}|${c.aprovacao_status}`
    const g = grupos.get(key) || { moeda: String(c.moeda), situacao: String(c.aprovacao_status), cotacoes: 0, listas_sem_total: 0, total: 0 }
    g.cotacoes++
    if (c.total == null) g.listas_sem_total++
    else g.total += Math.round(Number(c.total) * 100)
    grupos.set(key, g)
  }
  planilha(wb, 'Resumo', Array.from(grupos.values()).map(g => ({ Moeda: g.moeda, Situação: g.situacao, 'Quantidade de cotações': g.cotacoes, 'Listas sem total': g.listas_sem_total, 'Total das cotações com quantidade': g.cotacoes === g.listas_sem_total ? null : g.total / 100 })))
  const rotulos: Record<string, string> = { cliente_nome: 'Cliente', vendedor_nome: 'Vendedor', titulo: 'Título', aprovacao_status: 'Situação', aprovacao_motivo: 'Motivo da reprovação', aprovacao_nome: 'Avaliado por', aprovacao_em: 'Data da avaliação', aviso_status: 'Situação do aviso', pedido_convertido_id: 'ID do pedido convertido', numero_cotacao: 'Número da cotação', posicao: 'Posição' }
  const renomear = (registro: Registro) => Object.fromEntries(Object.entries(registro).map(([k,v]) => [rotulos[k] || k,v]))
  planilha(wb, 'Cotacoes', r.cotacoes.map(renomear), ['numero','Título','created_at (Brasília)','Cliente','Vendedor','Situação','moeda','total'])
  planilha(wb, 'Itens', r.itens.map(renomear), ['Número da cotação','moeda','Posição','item.produto','item.codigo','item.quantidade','item.preco_net','item.preco_final','item.total_item'])
  planilha(wb, 'Informacoes', [
    { Campo: 'Gerado em', Valor: r.gerado_em }, { Campo: 'Filtros', Valor: JSON.stringify(r.filtros) },
    { Campo: 'Datas', Valor: 'Período de emissão e horários em Brasília. Datas originais também são preservadas.' },
    { Campo: 'Valores', Valor: 'Resumo separado por moeda e situação. Listas sem quantidade não têm total e não são tratadas como valor zero. O total da cotação aparece uma vez na aba Cotacoes.' },
    { Campo: 'Dados', Valor: 'Preços, impostos, cliente e vendedor refletem o documento emitido. A avaliação e a situação do aviso refletem o momento da exportação.' },
  ])
  return new Uint8Array(await wb.xlsx.writeBuffer())
}
