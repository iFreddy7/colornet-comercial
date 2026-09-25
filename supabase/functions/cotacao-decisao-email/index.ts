import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' }
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: cors })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const escape = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export type Mail = { to: string[]; subject: string; text: string; html: string; messageId: string }
type Cotacao = { id: string; numero: string; titulo: string; cliente_nome: string; vendedor_nome: string; moeda: string; total: number | null; aprovacao_status: string; aprovacao_nome: string; aprovacao_em: string; aprovacao_motivo: string | null }
export type Transport = { ready: boolean; send: (mail: Mail) => Promise<{ accepted: string[] }> }

export function mensagem(q: Cotacao, to: string[], homologacao: boolean): Mail {
  const decisao = q.aprovacao_status === 'APROVADA' ? 'aprovada' : 'reprovada'
  const ambiente = homologacao ? '[HOMOLOGAÇÃO] ' : ''
  const total = q.total == null ? 'Lista de preços unitários, sem total geral' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: q.moeda }).format(q.total)
  const linhas = [
    `${ambiente}Cotação ${q.numero} ${decisao}`,
    `Título: ${q.titulo}`, `Cliente: ${q.cliente_nome}`, `Vendedor: ${q.vendedor_nome}`, `Valor: ${total}`,
    `Decisão de: ${q.aprovacao_nome}`, `Data: ${new Date(q.aprovacao_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília)`,
    ...(q.aprovacao_status === 'REPROVADA' ? [`Motivo da reprovação: ${q.aprovacao_motivo}`] : []),
    'Esta mensagem registra a avaliação comercial da cotação.',
  ]
  return {
    to, subject: `${ambiente}ColorNet | ${q.numero} ${decisao}`.replace(/[\r\n]/g, ' '),
    text: linhas.join('\n\n'),
    html: `<div style="font-family:Arial,sans-serif;color:#152d4d;max-width:640px"><h1 style="font-size:24px">${escape(linhas[0])}</h1>${linhas.slice(1).map(l => `<p style="white-space:pre-wrap">${escape(l)}</p>`).join('')}</div>`,
    messageId: `<cotacao-decisao-${q.id}@colornet.com.br>`,
  }
}

// Só falhas anteriores ao envio, ou recusas explícitas do servidor, permitem repetir.
export function falhaConhecida(e: unknown): boolean {
  const erro = e as { code?: string; command?: string; responseCode?: number }
  return ['EAUTH','EDNS','ETLS','EENVELOPE'].includes(erro?.code || '') ||
    (erro?.code === 'ECONNECTION' && erro.command === 'CONN') ||
    !!(erro?.responseCode && erro.responseCode >= 400 && erro.responseCode < 600)
}

export async function handleDecisionEmail(req: Request, admin: SupabaseClient, transport: Transport, homologacao: boolean): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { erro: 'Método não permitido.' })
  const bearer = req.headers.get('authorization') || ''
  if (!/^Bearer\s+\S+$/i.test(bearer)) return reply(401, { erro: 'Entre novamente no portal.' })
  try {
    const { data: auth, error: authError } = await admin.auth.getUser(bearer.replace(/^Bearer\s+/i, ''))
    if (authError || !auth.user) return reply(401, { erro: 'Sessão inválida.' })
    const { data: ator, error: perfilError } = await admin.from('usuarios').select('perfil,ativo').eq('id', auth.user.id).single()
    if (perfilError) return reply(503, { erro: 'Não foi possível conferir suas permissões.' })
    if (!ator?.ativo || !['GERENTE','DIRETOR'].includes(ator.perfil)) return reply(403, { erro: 'Apenas Gerente ou Diretor ativo pode enviar a decisão.' })
    const texto = await req.text()
    if (texto.length > 1024) return reply(413, { erro: 'Solicitação inválida.' })
    let body: { cotacao_id?: unknown }
    try { body = JSON.parse(texto) } catch { return reply(400, { erro: 'Solicitação inválida.' }) }
    if (!body || typeof body.cotacao_id !== 'string' || !uuid.test(body.cotacao_id)) return reply(400, { erro: 'Cotação inválida.' })
    if (!transport.ready) return reply(503, { erro: 'A decisão está salva. O envio de e-mail ainda precisa ser configurado.', status: 'PENDENTE' })
    const { data: envio, error: reservarError } = await admin.rpc('reservar_aviso_cotacao', { p_cotacao_id: body.cotacao_id, p_ator_id: auth.user.id })
    if (reservarError) return reply(409, { erro: 'Não foi possível reservar o envio. Atualize a cotação.' })
    if (envio.status !== 'RESERVADO') return reply(200, envio)
    let aceitos: string[] = [], incerto = false, erro: string | null = null
    try {
      const result = await transport.send(mensagem(envio.cotacao, envio.destinatarios, homologacao))
      aceitos = result.accepted.map(s => s.toLowerCase()).filter(s => envio.destinatarios.includes(s))
      if (aceitos.length < envio.destinatarios.length) erro = 'Um ou mais destinatários foram recusados. A nova tentativa enviará apenas aos pendentes.'
    } catch (e) {
      incerto = !falhaConhecida(e)
      erro = incerto ? 'O servidor não confirmou o resultado. Confira o recebimento antes de repetir.' : 'O servidor recusou o envio. Confira a configuração e tente novamente.'
    }
    const { data: status, error: finalizarError } = await admin.rpc('finalizar_aviso_cotacao', {
      p_cotacao_id: body.cotacao_id, p_tentativa: envio.tentativa, p_aceitos: aceitos, p_incerto: incerto, p_erro: erro,
    })
    if (finalizarError) return reply(503, { status: 'INCERTO', erro: 'A decisão está salva, mas não foi possível registrar a confirmação do envio. Confira o recebimento.' })
    return reply(200, { status, ...(erro ? { erro } : {}) })
  } catch {
    return reply(503, { erro: 'Não foi possível concluir o envio. A decisão continua salva; atualize a cotação antes de tentar novamente.' })
  }
}

if (typeof Deno !== 'undefined') {
  const { createClient } = await import('npm:@supabase/supabase-js@2.116.0')
  const { default: nodemailer } = await import('npm:nodemailer@10.0.10')
  const user = Deno.env.get('COTACOES_SMTP_USER')?.trim() || ''
  const pass = Deno.env.get('COTACOES_SMTP_PASSWORD')?.replace(/\s/g, '') || ''
  const mailer = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user, pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false })
  const url = Deno.env.get('SUPABASE_URL')!
  const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
  const key = keys.default || Object.values(keys)[0] || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const homologacao = url.includes('nqyddagfawklfqwumlie')
  const transport: Transport = { ready: !!user && !!pass, send: async mail => {
    const result = await mailer.sendMail({ ...mail, from: { name: homologacao ? 'ColorNet Homologação' : 'ColorNet Comercial', address: user }, replyTo: 'jrodrigues@colornet.com.br' })
    return { accepted: result.accepted.map((a: string | { address: string }) => typeof a === 'string' ? a : a.address) }
  } }
  Deno.serve(async req => {
    // Diagnóstico operacional, sem envio de mensagem e exclusivo do servidor.
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const serverToken = (token && (token === key || token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))) || req.headers.get('apikey') === key
    if (req.method === 'POST' && serverToken) {
      const body = await req.json().catch(() => null)
      if (body?.acao !== 'verificar_smtp') return reply(400, { erro: 'Ação operacional inválida.' })
      if (!transport.ready) return reply(503, { configurado: false })
      try { await mailer.verify(); return reply(200, { configurado: true, conexao: true, email_enviado: false }) }
      catch (e) {
        const failure = e as { code?: string; command?: string; responseCode?: number; name?: string }
        return reply(503, { configurado: true, conexao: false, codigo: failure.code || failure.name || 'SMTP_ERROR', etapa: failure.command || null, smtp_status: failure.responseCode || null })
      }
    }
    return handleDecisionEmail(req, admin, transport, homologacao)
  })
}
