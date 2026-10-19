export function dataCotacaoMaisDias(dias: number, agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora)
  const valor = (tipo: string) => partes.find(p => p.type === tipo)!.value
  const data = new Date(`${valor('year')}-${valor('month')}-${valor('day')}T12:00:00Z`)
  data.setUTCDate(data.getUTCDate() + dias)
  return data.toISOString().slice(0, 10)
}
export function erroValidadeCotacao(validade: string, agora = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validade)) return 'Informe a validade da proposta.'
  const data = new Date(`${validade}T12:00:00Z`)
  if (!Number.isFinite(data.getTime()) || data.toISOString().slice(0,10) !== validade) return 'Validade da proposta inválida.'
  if (validade < dataCotacaoMaisDias(0, agora)) return 'A validade da proposta não pode estar no passado.'
  if (validade > dataCotacaoMaisDias(30, agora)) return 'A validade máxima da cotação é de 30 dias corridos após a inclusão.'
  return ''
}
