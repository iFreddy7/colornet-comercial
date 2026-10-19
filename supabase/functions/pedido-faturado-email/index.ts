import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' }
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: cors })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const escape = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export type Mail = { to: string[]; subject: string; text: string; html: string; messageId: string }
type Pedido = { id: string; numero: string; cliente_nome: string; vendedor_nome: string; registrado_por: string; registrado_em: string }
export type Transport = { ready: boolean; send: (mail: Mail) => Promise<{ accepted: string[] }> }
export function mensagem(p: Pedido, to: string[], homologacao: boolean): Mail {
  const ambiente = homologacao ? '[HOMOLOGAÇÃO] ' : ''
  const linhas = [
    `${ambiente}Pedido ${p.numero} faturado`,
    `Cliente: ${p.cliente_nome}`, `Vendedor: ${p.vendedor_nome}`,
    `Marcado como faturado por: ${p.registrado_por}`,
    `Registro no portal: ${new Date(p.registrado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília)`,
    'O pedido foi marcado como faturado por completo no ColorNet Comercial.',
  ]
  return {
    to, subject: `${ambiente}ColorNet | Pedido ${p.numero} faturado`.replace(/[\r\n]/g, ' '), text: linhas.join('\n\n'),
    html: `<div style="background:#f5f7fb;padding:24px 12px;font-family:Arial,Segoe UI,sans-serif;color:#202e49"><div style="max-width:720px;margin:auto;background:white;border:1px solid #e2e8f0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="20%" height="4" bgcolor="#c91943"></td><td width="60%" height="4" bgcolor="#19337f"></td><td width="20%" height="4" bgcolor="#069b61"></td></tr></table><div style="background:#19337f;color:white;padding:22px 26px;font-size:26px;font-weight:bold">ColorNet</div><div style="padding:26px"><h1 style="font-size:21px;color:#19337f">${escape(linhas[0])}</h1>${linhas.slice(1).map(l => `<p style="white-space:pre-wrap;line-height:1.6">${escape(l)}</p>`).join('')}<p style="font-size:11px;color:#64728a">Aviso automático do Portal Comercial.</p></div></div></div>`,
    messageId: `<pedido-faturado-${p.id}@colornet.com.br>`,
  }
}

// Só falhas anteriores ao envio, ou recusas explícitas do servidor, permitem repetir.
export function falhaConhecida(e: unknown): boolean {
  const erro = e as { code?: string; command?: string; responseCode?: number }
  return ['EAUTH','EDNS','ETLS','EENVELOPE'].includes(erro?.code || '') ||
    (erro?.code === 'ECONNECTION' && erro.command === 'CONN') ||
    !!(erro?.responseCode && erro.responseCode >= 400 && erro.responseCode < 600)
}

export async function handleInvoicedEmail(req: Request, admin: SupabaseClient, transport: Transport, homologacao: boolean): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { erro: 'Método não permitido.' })
  const bearer = req.headers.get('authorization') || ''
  if (!/^Bearer\s+\S+$/i.test(bearer)) return reply(401, { erro: 'Entre novamente no portal.' })
  try {
    const { data: auth, error: authError } = await admin.auth.getUser(bearer.replace(/^Bearer\s+/i, ''))
    if (authError || !auth.user) return reply(401, { erro: 'Sessão inválida.' })
    const { data: ator, error: perfilError } = await admin.from('usuarios').select('perfil,ativo').eq('id', auth.user.id).single()
    if (perfilError) return reply(503, { erro: 'Não foi possível conferir suas permissões.' })
    if (!ator?.ativo || !['ADMIN','GERENTE','DIRETOR'].includes(ator.perfil)) return reply(403, { erro: 'Apenas ADMIN, Gerente ou Diretor ativo pode enviar este aviso.' })
    const texto = await req.text()
    if (texto.length > 1024) return reply(413, { erro: 'Solicitação inválida.' })
    let body: { pedido_id?: unknown }
    try { body = JSON.parse(texto) } catch { return reply(400, { erro: 'Solicitação inválida.' }) }
    if (!body || typeof body.pedido_id !== 'string' || !uuid.test(body.pedido_id)) return reply(400, { erro: 'Pedido inválido.' })
    if (!transport.ready) return reply(503, { erro: 'A marcação está salva. O envio de e-mail ainda precisa ser configurado.', status: 'PENDENTE' })
    const { data: envio, error: reservarError } = await admin.rpc('reservar_aviso_pedido_faturado', { p_pedido_id: body.pedido_id, p_ator_id: auth.user.id })
    if (reservarError) return reply(409, { erro: 'Não foi possível reservar o envio. Atualize o pedido.' })
    if (envio.status !== 'RESERVADO') return reply(200, envio)
    let aceitos: string[] = [], incerto = false, erro: string | null = null
    try {
      const result = await transport.send(mensagem(envio.pedido, envio.destinatarios, homologacao))
      aceitos = result.accepted.map(s => s.toLowerCase()).filter(s => envio.destinatarios.includes(s))
      if (aceitos.length < envio.destinatarios.length) erro = 'Um ou mais destinatários foram recusados. A nova tentativa enviará apenas aos pendentes.'
    } catch (e) {
      incerto = !falhaConhecida(e)
      erro = incerto ? 'O servidor não confirmou o resultado. Confira o recebimento antes de repetir.' : 'O servidor recusou o envio. Confira a configuração e tente novamente.'
    }
    const { data: status, error: finalizarError } = await admin.rpc('finalizar_aviso_pedido_faturado', {
      p_pedido_id: body.pedido_id, p_tentativa: envio.tentativa, p_aceitos: aceitos, p_incerto: incerto, p_erro: erro,
    })
    if (finalizarError) return reply(503, { status: 'INCERTO', erro: 'A marcação está salva, mas não foi possível registrar a confirmação do envio. Confira o recebimento.' })
    return reply(200, { status, ...(erro ? { erro } : {}) })
  } catch {
    return reply(503, { erro: 'Não foi possível concluir o envio. A marcação continua salva; atualize o pedido antes de tentar novamente.' })
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
    return handleInvoicedEmail(req, admin, transport, homologacao)
  })
}
