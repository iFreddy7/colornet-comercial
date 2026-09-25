// Sem dependência do runtime: a autorização e as falhas também são testadas em Node.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: cors })

export async function handleCreateUser(req: Request, admin: SupabaseClient): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { erro: 'Método não permitido.' })
  const authorization = req.headers.get('authorization') || ''
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401, { erro: 'Entre novamente no portal.' })
  const token = authorization.replace(/^Bearer\s+/i, '')
  let novoId: string | null = null

  try {
    const { data: auth, error: authError } = await admin.auth.getUser(token)
    if (authError || !auth.user) return reply(401, { erro: 'Sessão inválida. Entre novamente.' })
    const { data: ator, error: perfilError } = await admin.from('usuarios')
      .select('perfil,ativo').eq('id', auth.user.id).single()
    if (perfilError) return reply(503, { erro: 'Não foi possível conferir suas permissões.' })
    if (!ator?.ativo || ator.perfil !== 'ADMIN') return reply(403, { erro: 'Acesso restrito a ADMIN ativo.' })

    const texto = await req.text()
    if (texto.length > 8192) return reply(413, { erro: 'Cadastro maior que o permitido.' })
    let body: Record<string, unknown>
    try { body = JSON.parse(texto) } catch { return reply(400, { erro: 'Cadastro inválido.' }) }
    if (!body || Array.isArray(body) || typeof body !== 'object') return reply(400, { erro: 'Cadastro inválido.' })
    const nome = typeof body.nome === 'string' ? body.nome.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const senha = typeof body.senha === 'string' ? body.senha : ''
    const perfil = typeof body.perfil === 'string' ? body.perfil : ''
    const vendedorId = body.vendedor_id == null || body.vendedor_id === '' ? null : String(body.vendedor_id)
    if (nome.length < 2 || nome.length > 120) return reply(400, { erro: 'Informe um nome entre 2 e 120 caracteres.' })
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { erro: 'Informe um e-mail válido.' })
    if (senha.length < 8 || senha.length > 128 || !senha.trim()) return reply(400, { erro: 'A senha inicial deve ter entre 8 e 128 caracteres.' })
    if (!['VENDEDOR','GERENTE','DIRETOR','ADMIN'].includes(perfil)) return reply(400, { erro: 'Perfil inválido.' })
    if ((perfil === 'VENDEDOR' && !vendedorId) || (vendedorId && !uuid.test(vendedorId))) {
      return reply(400, { erro: 'Selecione o vendedor vinculado à conta.' })
    }
    if (vendedorId) {
      const { data: vendedor, error } = await admin.from('vendedores').select('id,ativo').eq('id', vendedorId).single()
      if (error || !vendedor?.ativo) return reply(400, { erro: 'Vendedor inexistente ou inativo.' })
    }

    const criacaoId = crypto.randomUUID()
    // A conta permanece bloqueada até perfil e auditoria serem gravados.
    const { data: criada, error: criarError } = await admin.auth.admin.createUser({
      email, password: senha, email_confirm: true, ban_duration: '876000h',
      user_metadata: { nome },
      app_metadata: { colornet_criado_por: auth.user.id, colornet_criacao_id: criacaoId },
    })
    if (criarError || !criada.user) {
      if (criarError?.code === 'email_exists' || criarError?.code === 'user_already_exists') {
        return reply(409, { erro: 'Este e-mail já possui uma conta. Atualize a lista de usuários ou use Redefinir senha.' })
      }
      if (criarError?.code === 'weak_password') return reply(400, { erro: 'A senha não atende à política do sistema. Escolha uma senha mais forte.' })
      return reply(502, { erro: 'Não foi possível criar a conta. Confira o e-mail e tente novamente.' })
    }
    novoId = criada.user.id
    const { error: finalizarError } = await admin.rpc('admin_finalizar_novo_usuario', {
      p_administrador_id: auth.user.id, p_usuario_id: novoId, p_criacao_id: criacaoId,
      p_nome: nome, p_email: email, p_perfil: perfil, p_vendedor_id: vendedorId,
    })
    if (finalizarError) throw new Error('Falha ao gravar o perfil da nova conta.')
    const { error: ativarError } = await admin.auth.admin.updateUserById(novoId, { ban_duration: 'none' })
    if (ativarError) throw new Error('Falha ao ativar a nova conta.')
    return reply(201, { sucesso: true, usuario_id: novoId, nome, email })
  } catch {
    // Remove somente a identidade recém-criada por esta requisição.
    // Se a exclusão falhar, bloqueia login e desativa o perfil como compensação.
    if (novoId) {
      let excluido = false
      try { const { error } = await admin.auth.admin.deleteUser(novoId); excluido = !error } catch { /* compensação abaixo */ }
      if (!excluido) {
        try { await admin.auth.admin.updateUserById(novoId, { ban_duration: '876000h' }) } catch { /* sem senha nos logs */ }
        try { await admin.from('usuarios').update({ ativo: false }).eq('id', novoId) } catch { /* sem dados sensíveis nos logs */ }
        console.error('Cadastro incompleto bloqueado; conferir identidade:', novoId)
        return reply(500, { erro: 'A criação ficou incompleta. Não repita o cadastro: informe ao suporte o ID ' + novoId + '.' })
      }
    }
    return reply(500, { erro: 'Não foi possível concluir o cadastro. Nenhuma conta foi liberada; tente novamente após conferir a configuração.' })
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
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, chaveServidor(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return await handleCreateUser(req, admin)
  } catch {
    return Response.json({ erro: 'Serviço de cadastro indisponível.' }, { status: 503, headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store',
    } })
  }
})

}
