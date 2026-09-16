// Instantes do Supabase continuam gravados em UTC (timestamptz).
// O fuso da exibição é explícito e não depende do dispositivo do vendedor.
export const FUSO_BRASILIA = 'America/Sao_Paulo'

const formatoBrasilia = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: FUSO_BRASILIA,
  hourCycle: 'h23',
})

export function dataHoraBrasilia(value: string | null | undefined): string {
  if (!value) return '—'
  // Só aceita instantes com offset. Uma data sem fuso não prova ser UTC.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return 'Horário sem fuso'
  const instante = new Date(value)
  if (!Number.isFinite(instante.getTime())) return 'Horário inválido'
  return formatoBrasilia.format(instante)
}
