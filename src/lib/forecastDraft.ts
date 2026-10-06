export interface ForecastLinha {
  id: string
  vendedorId: string
  clienteId: string
  produtoId: string
  quantidades: Record<string, string>
}
export interface ForecastCadastro { id: string; nome: string; codigo: string }
export function filtrarForecast(linhas: ForecastLinha[], filtros: { vendedorId?: string; clienteId?: string; produtoId?: string }) {
  return linhas.filter(l => (!filtros.vendedorId || l.vendedorId === filtros.vendedorId) && (!filtros.clienteId || l.clienteId === filtros.clienteId) && (!filtros.produtoId || l.produtoId === filtros.produtoId))
}
export function agruparForecastClientes(linhas: ForecastLinha[]) {
  const grupos = new Map<string, ForecastLinha[]>()
  for (const linha of linhas) {
    const grupo = grupos.get(linha.clienteId) || []
    grupo.push(linha)
    grupos.set(linha.clienteId, grupo)
  }
  return Array.from(grupos, ([clienteId, itens]) => ({ clienteId, linhas: itens }))
}
export const clientesExemplo: ForecastCadastro[] = [
  { id: 'cliente-a', nome: 'Cliente exemplo A', codigo: 'DEMO-001' },
  { id: 'cliente-b', nome: 'Cliente exemplo B', codigo: 'DEMO-002' },
  { id: 'cliente-c', nome: 'Cliente exemplo C', codigo: 'DEMO-003' },
]
export const produtosExemplo: ForecastCadastro[] = [
  { id: 'produto-a', nome: 'Pigmento amarelo — exemplo', codigo: 'DEMO.2SC25' },
  { id: 'produto-b', nome: 'Pigmento amarelo — exemplo', codigo: 'DEMO.7SC25' },
  { id: 'produto-c', nome: 'Pigmento azul — exemplo', codigo: 'DEMO.2AZ25' },
  { id: 'produto-d', nome: 'Pigmento vermelho — exemplo', codigo: 'DEMO.2VM25' },
]
export function mesAtualForecast(data = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(data)
  return `${partes.find(p => p.type === 'year')!.value}-${partes.find(p => p.type === 'month')!.value}`
}
export function mesesForecast(inicio: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(inicio)) return []
  const [ano, mes] = inicio.split('-').map(Number)
  return Array.from({ length: 12 }, (_, i) => {
    const data = new Date(Date.UTC(ano, mes - 1 + i, 1))
    return { id: data.toISOString().slice(0, 7), label: data.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', '') }
  })
}
export function quantidadeForecast(valor: string | undefined): number | null {
  if (valor == null || !valor.trim()) return null
  if (!/^\d+(?:[.,]\d{1,3})?$/.test(valor.trim())) return null
  const numero = Number(valor.replace(',', '.'))
  return Number.isFinite(numero) && numero >= 0 && numero <= 999_999_999 ? numero : null
}
export function totalForecast(linhas: ForecastLinha[], meses: string[]) {
  return Math.round(linhas.reduce((total, linha) => total + meses.reduce((soma, mes) => soma + (quantidadeForecast(linha.quantidades[mes]) ?? 0), 0), 0) * 1000) / 1000
}
export function totalInformadoForecast(linhas: ForecastLinha[], meses: string[]) {
  return linhas.some(linha => meses.some(mes => quantidadeForecast(linha.quantidades[mes]) !== null)) ? totalForecast(linhas, meses) : null
}
export function exemploForecast(inicio: string, vendedores: string[]): ForecastLinha[] {
  const meses = mesesForecast(inicio)
  const linhas = [
    { clienteId: 'cliente-a', produtoId: 'produto-a', vendedorId: vendedores[0], base: 500 },
    { clienteId: 'cliente-a', produtoId: 'produto-c', vendedorId: vendedores[0], base: 200 },
    { clienteId: 'cliente-b', produtoId: 'produto-b', vendedorId: vendedores[0], base: 125 },
    { clienteId: 'cliente-c', produtoId: 'produto-a', vendedorId: vendedores[1] || vendedores[0], base: 300 },
  ]
  return linhas.map((linha, index) => ({ id: `exemplo-${index}`, vendedorId: linha.vendedorId, clienteId: linha.clienteId, produtoId: linha.produtoId,
    quantidades: Object.fromEntries(meses.slice(0, 6).map((mes, i) => [mes.id, String(linha.base + i * 25)])) }))
}
export function lerForecast(raw: string | null, vendedores: string[]): { linhas: ForecastLinha[]; salvoEm: string } | null {
  if (!raw || raw.length > 1_000_000) return null
  try {
    const valor = JSON.parse(raw)
    if (valor.version !== 1 || !Array.isArray(valor.linhas) || valor.linhas.length > 200 || typeof valor.salvoEm !== 'string' || !Number.isFinite(Date.parse(valor.salvoEm))) return null
    const ids = new Set<string>(), combinacoes = new Set<string>()
    for (const linha of valor.linhas) {
      if (!linha || typeof linha.id !== 'string' || ids.has(linha.id) || !vendedores.includes(linha.vendedorId) || !clientesExemplo.some(c => c.id === linha.clienteId) || !produtosExemplo.some(p => p.id === linha.produtoId)) return null
      const chave = `${linha.vendedorId}:${linha.clienteId}:${linha.produtoId}`
      if (combinacoes.has(chave) || !linha.quantidades || typeof linha.quantidades !== 'object' || Array.isArray(linha.quantidades)) return null
      if (Object.entries(linha.quantidades).some(([mes, qtd]) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) || typeof qtd !== 'string' || qtd.length > 20)) return null
      ids.add(linha.id); combinacoes.add(chave)
    }
    return { linhas: valor.linhas, salvoEm: valor.salvoEm }
  } catch { return null }
}
