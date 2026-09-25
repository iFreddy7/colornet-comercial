import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const homologacao = 'nqyddagfawklfqwumlie'
const origins: Record<string, string> = {
  [homologacao]: 'https://homologacao.colornet-comercial.pages.dev',
  duojavyrugezvlvuuwag: 'https://colornet-comercial.vercel.app',
}
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: cors })
const emailNormalizado = (value: string) => value.trim().toLowerCase()
type Environment = { supabaseUrl: string; appUrl?: string }

export async function handlePasswordLink(req: Request, admin: SupabaseClient, env: Environment): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { erro: 'Método não permitido.' })

  try {
    const authorization = req.headers.get('authorization') || ''
    if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401, { erro: 'Entre novamente no portal.' })
    const { data: auth, error: authError } = await admin.auth.getUser(authorization.replace(/^Bearer\s+/i, ''))
    if (authError || !auth.user) return reply(401, { erro: 'Sessão inválida. Entre novamente.' })

    const { data: ator, error: atorError } = await admin.from('usuarios')
      .select('perfil,ativo').eq('id', auth.user.id).single()
    if (atorError) return reply(503, { erro: 'Não foi possível conferir suas permissões.' })
    if (!ator?.ativo || ator.perfil !== 'ADMIN') return reply(403, { erro: 'Acesso restrito a ADMIN ativo.' })

    const texto = await req.text()
    if (texto.length > 2048) return reply(413, { erro: 'Solicitação maior que o permitido.' })
    let body: Record<string, unknown>
    try { body = JSON.parse(texto) } catch { return reply(400, { erro: 'Solicitação inválida.' }) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { erro: 'Solicitação inválida.' })
    if (typeof body.usuario_id !== 'string' || !uuid.test(body.usuario_id)) return reply(400, { erro: 'Usuário inválido.' })

    const { data: alvo, error: alvoError } = await admin.from('usuarios')
      .select('id,nome,email,ativo').eq('id', body.usuario_id).single()
    if (alvoError || !alvo?.email) return reply(404, { erro: 'Cadastro ou e-mail não encontrado.' })
    if (!alvo.ativo) return reply(400, { erro: 'O usuário está inativo.' })
    const email = emailNormalizado(alvo.email)

    // Validate the destination before creating an account or issuing a token.
    const projectRef = new URL(env.supabaseUrl).hostname.split('.')[0]
    const configuredOrigin = env.appUrl || origins[projectRef]
    let portal: URL
    try { portal = new URL(configuredOrigin) } catch {
      return reply(503, { erro: 'Endereço do portal não configurado neste ambiente.' })
    }
    if (portal.protocol !== 'https:' || portal.username || portal.password ||
        /(^|\.)localhost$|^127\.|^\[::1\]$/.test(portal.hostname) ||
        Object.entries(origins).some(([ref, origin]) => ref !== projectRef && origin === portal.origin)) {
      return reply(503, { erro: 'Configure APP_URL com o endereço HTTPS deste ambiente.' })
    }
    const redirectTo = `${portal.origin}/?recovery=1`
    const podeCriar = projectRef === homologacao
    if (body.criar_acesso === true && !podeCriar) return reply(403, { erro: 'A criação de acesso para cadastros importados está disponível somente na homologação.' })

    const { data: conta, error: contaError } = await admin.auth.admin.getUserById(alvo.id)
    let contaAuth = conta?.user
    if (contaError && contaError.code !== 'user_not_found') {
      return reply(503, { erro: 'Não foi possível consultar a conta de acesso. Tente novamente.' })
    }
    let acessoCriado = false
    if (!contaAuth) {
      if (body.criar_acesso !== true) return reply(404, {
        codigo: 'AUTH_USER_MISSING', pode_criar_acesso: podeCriar,
        erro: `${alvo.nome || email} possui cadastro no portal, mas ainda não tem conta de acesso neste ambiente.`,
      })
      if (typeof body.email_confirmacao !== 'string' || emailNormalizado(body.email_confirmacao) !== email) {
        return reply(409, { erro: 'O e-mail do cadastro mudou. Atualize a lista antes de criar o acesso.' })
      }
      // Keep the original profile ID. The Auth trigger uses ON CONFLICT(id) DO NOTHING,
      // preserving role, seller, and all existing business references. No password is set.
      const { data: criada, error: criarError } = await admin.auth.admin.createUser({
        id: alvo.id, email, email_confirm: false, user_metadata: { nome: alvo.nome },
      })
      if (criarError) return reply(criarError.code === 'email_exists' ? 409 : 502, {
        erro: criarError.code === 'email_exists'
          ? 'Este e-mail já pertence a outra conta de acesso. O vínculo precisa ser conferido antes de gerar o link.'
          : 'Não foi possível criar a conta de acesso. Atualize a lista e tente novamente.',
      })
      contaAuth = criada?.user
      acessoCriado = true
      console.info('Conta de acesso criada para cadastro existente', { administrador_id: auth.user.id, usuario_id: alvo.id })
    }
    if (!contaAuth || contaAuth.id !== alvo.id || emailNormalizado(contaAuth.email || '') !== email) {
      return reply(409, { erro: 'O cadastro e a conta de acesso não correspondem. Confira o vínculo antes de gerar o link.' })
    }

    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
    if (error) return reply(error.status === 429 ? 429 : 502, { erro: error.status === 429
      ? 'Muitas solicitações. Aguarde um pouco antes de gerar outro link.'
      : 'Não foi possível gerar o link de redefinição. Tente novamente.' })
    // Never return a token belonging to an identity different from the selected profile.
    if (data?.user?.id !== alvo.id) return reply(409, { erro: 'A conta retornada não corresponde ao cadastro selecionado.' })
    const tokenHash = data?.properties?.hashed_token
    if (!tokenHash) return reply(502, { erro: 'O Supabase não retornou o link de redefinição.' })
    const link = `${redirectTo}#type=recovery&token_hash=${encodeURIComponent(tokenHash)}`
    console.info('Link de recuperação gerado', { administrador_id: auth.user.id, usuario_id: alvo.id, gerado_em: new Date().toISOString() })
    return reply(200, { sucesso: true, acesso_criado: acessoCriado, usuario_id: alvo.id, nome: alvo.nome, email, link })
  } catch {
    return reply(500, { erro: 'Serviço de redefinição indisponível. Tente novamente.' })
  }
}

function chaveServidor(): string {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (raw) {
    const keys = JSON.parse(raw)
    const key = keys.default || Object.values(keys)[0]
    if (typeof key === 'string' && key) return key
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  throw new Error('Chave de servidor ausente no ambiente da função.')
}

if (typeof Deno !== 'undefined') {
  const { createClient } = await import('npm:@supabase/supabase-js@2.116.0')
  Deno.serve(async (req) => {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const admin = createClient(supabaseUrl, chaveServidor(), { auth: { persistSession: false, autoRefreshToken: false } })
      return await handlePasswordLink(req, admin, { supabaseUrl, appUrl: Deno.env.get('APP_URL') })
    } catch { return reply(503, { erro: 'Serviço de redefinição indisponível.' }) }
  })
}
