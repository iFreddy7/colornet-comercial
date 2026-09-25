const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ptax-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: cors })

function secretKey() {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!raw) throw new Error('SUPABASE_SECRET_KEYS ausente')
  const keys = JSON.parse(raw)
  return String(keys.default || Object.values(keys)[0] || '')
}

function brtParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date)
  const get = (type: string) => parts.find(p => p.type === type)?.value || ''
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')) }
}

function shiftDate(days: number) {
  const p = brtParts()
  const base = new Date(Date.UTC(p.y, p.m - 1, p.d + days, 12, 0, 0))
  return { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate() }
}

function bcbDate(p: { y: number; m: number; d: number }) {
  return `${String(p.m).padStart(2,'0')}-${String(p.d).padStart(2,'0')}-${p.y}`
}

function isoDate(raw: unknown) {
  const s = String(raw ?? '')
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{2})[-\/]?(\d{2})[-\/]?(\d{4})/)
  if (m) return `${m[3]}-${m[1]}-${m[2]}`
  throw new Error(`Data PTAX inválida: ${s}`)
}

export async function atualizarPtax(req: Request, admin: any, consultar: typeof fetch = fetch) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { erro: 'POST obrigatório' })

  try {
    const cronSecret = req.headers.get('x-ptax-secret')
    if (cronSecret !== null) {
      if (!cronSecret.trim()) return reply(401, { erro: 'Agendamento não autenticado.' })
      const { data: valido, error } = await admin.rpc('validar_ptax_cron_secret', { p_secret: cronSecret })
      if (error || valido !== true) return reply(401, { erro: 'Agendamento não autenticado.' })
    } else {
      const auth = req.headers.get('authorization') || ''
      if (!/^Bearer\s+\S+$/i.test(auth)) return reply(401, { erro: 'Não autenticado.' })
      const { data: userData, error: userError } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ''))
      if (userError || !userData.user) return reply(401, { erro: 'Sessão inválida.' })
      const { data: perfil, error } = await admin.from('usuarios').select('ativo').eq('id', userData.user.id).single()
      if (error || perfil?.ativo !== true) return reply(403, { erro: 'Usuário sem acesso ativo.' })
    }

    // Regra ColorNet: PTAX D-1. Consultamos até ontem e, em feriados/fins de semana,
    // usamos o último fechamento disponível dos 10 dias anteriores.
    const fim = shiftDate(-1)
    const inicio = shiftDate(-10)
    const endpoint = new URL('https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)')
    endpoint.searchParams.set('@dataInicial', `'${bcbDate(inicio)}'`)
    endpoint.searchParams.set('@dataFinalCotacao', `'${bcbDate(fim)}'`)
    endpoint.searchParams.set('$orderby', 'dataHoraCotacao desc')
    endpoint.searchParams.set('$top', '1')
    endpoint.searchParams.set('$select', 'cotacaoVenda,dataHoraCotacao')
    endpoint.searchParams.set('$format', 'json')

    // O serviço Olinda exige %20: interpreta "+" literalmente em $orderby.
    const bcb = await consultar(endpoint.toString().replace(/\+/g, '%20'), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
    if (!bcb.ok) throw new Error(`BCB respondeu HTTP ${bcb.status}`)
    const payload = await bcb.json()
    const row = Array.isArray(payload?.value) ? payload.value[0] : null
    const valor = Number(row?.cotacaoVenda)
    if (!row || !Number.isFinite(valor) || valor <= 0) throw new Error('BCB não retornou fechamento PTAX válido.')

    const referencia = isoDate(row.dataHoraCotacao)
    const updates = [
      ['PTAX_VALOR', valor],
      ['PTAX_DATA_REFERENCIA', referencia],
      ['PTAX_MODO', 'ULTIMO_FECHAMENTO_DISPONIVEL'],
      ['PTAX_TIPO', 'VENDA'],
    ] as const

    for (const [chave, valorConfig] of updates) {
      const { error } = await admin.from('configuracoes').update({ valor: valorConfig }).eq('chave', chave)
      if (error) throw error
    }

    return reply(200, { sucesso: true, valor, data_referencia: referencia, tipo: 'VENDA', regra: 'D-1 / último fechamento disponível' })
  } catch (e) {
    return reply(503, { erro: 'Não foi possível atualizar a PTAX pelo Banco Central. Tente novamente.' })
  }
}

if (typeof Deno !== 'undefined') {
  const { createClient } = await import('npm:@supabase/supabase-js@2.116.0')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } })
  Deno.serve(req => atualizarPtax(req, admin))
}
