import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}

const reply = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: cors })

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { erro: 'Método não permitido.' })

  try {
    const authorization = req.headers.get('authorization') || ''
    if (!/^Bearer\s+\S+$/i.test(authorization)) {
      return reply(401, { erro: 'Entre novamente no portal.' })
    }

    const token = authorization.replace(/^Bearer\s+/i, '')
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, chaveServidor(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: auth, error: authError } = await admin.auth.getUser(token)
    if (authError || !auth.user) return reply(401, { erro: 'Sessão inválida. Entre novamente.' })

    const { data: ator, error: atorError } = await admin
      .from('usuarios')
      .select('perfil,ativo')
      .eq('id', auth.user.id)
      .single()

    if (atorError) return reply(503, { erro: 'Não foi possível conferir suas permissões.' })
    if (!ator?.ativo || ator.perfil !== 'ADMIN') {
      return reply(403, { erro: 'Acesso restrito a ADMIN ativo.' })
    }

    const body = await req.json().catch(() => null)
    const usuarioId = typeof body?.usuario_id === 'string' ? body.usuario_id : ''
    if (!usuarioId) return reply(400, { erro: 'Usuário não informado.' })

    const { data: alvo, error: alvoError } = await admin
      .from('usuarios')
      .select('id,nome,email,ativo')
      .eq('id', usuarioId)
      .single()

    if (alvoError || !alvo?.email) return reply(404, { erro: 'Usuário ou e-mail não encontrado.' })
    if (!alvo.ativo) return reply(400, { erro: 'O usuário está inativo.' })

    const projectRef = new URL(Deno.env.get('SUPABASE_URL')!).hostname.split('.')[0]
    const defaultOrigins: Record<string, string> = {
      nqyddagfawklfqwumlie: 'https://homologacao.colornet-comercial.pages.dev',
      duojavyrugezvlvuuwag: 'https://colornet-comercial.pages.dev',
    }
    const configuredOrigin = Deno.env.get('APP_URL') || defaultOrigins[projectRef]
    if (!configuredOrigin) return reply(503, { erro: 'Endereço do portal não configurado neste ambiente.' })
    const portal = new URL(configuredOrigin)
    if (portal.protocol !== 'https:' || portal.username || portal.password || ['localhost', '127.0.0.1', '[::1]'].includes(portal.hostname)) {
      return reply(503, { erro: 'Configure APP_URL com o endereço HTTPS deste ambiente.' })
    }
    const redirectTo = `${portal.origin}/?recovery=1`

    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: alvo.email,
      options: { redirectTo },
    })

    if (error) {
      if (String(error.message || '').toLowerCase().includes('user')) {
        return reply(404, { erro: 'Este perfil ainda não possui usuário no Supabase Auth deste ambiente.' })
      }
      return reply(502, { erro: 'Não foi possível gerar o link de redefinição.' })
    }

    const tokenHash = data?.properties?.hashed_token
    if (!tokenHash) return reply(502, { erro: 'O Supabase não retornou o link de redefinição.' })
    // The page verifies only after the user presses Continue, not on an email scanner GET.
    const link = `${redirectTo}#type=recovery&token_hash=${encodeURIComponent(tokenHash)}`

    console.info('Link de recuperação gerado', {
      administrador_id: auth.user.id,
      usuario_id: alvo.id,
      gerado_em: new Date().toISOString(),
    })

    return reply(200, {
      sucesso: true,
      usuario_id: alvo.id,
      nome: alvo.nome,
      email: alvo.email,
      link,
      aviso: 'Link sensível e de uso temporário. Compartilhe somente com o usuário correto.',
    })
  } catch {
    return reply(500, { erro: 'Serviço de redefinição indisponível.' })
  }
})
