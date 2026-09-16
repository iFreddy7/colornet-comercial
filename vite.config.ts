import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const obrigatorias = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_APP_ENV']
    const ausentes = obrigatorias.filter((nome) => !env[nome]?.trim())
    if (ausentes.length) {
      throw new Error(`Configure no Cloudflare ou em .env.local: ${ausentes.join(', ')}. Depois execute o build novamente.`)
    }

    let url: URL
    try { url = new URL(env.VITE_SUPABASE_URL.trim()) }
    catch { throw new Error('VITE_SUPABASE_URL deve conter a URL completa do projeto Supabase.') }
    if (url.protocol !== 'https:') {
      throw new Error('A publicação exige VITE_SUPABASE_URL com HTTPS.')
    }

    const chave = env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
    if (chave.startsWith('sb_secret_')) {
      throw new Error('Use a chave pública sb_publishable_ no frontend. Uma chave secreta não pode ser incluída no site.')
    }
    if (!chave.startsWith('sb_publishable_')) {
      // Compatibilidade com instalações existentes que ainda usam a chave anon.
      let role: unknown
      try { role = JSON.parse(Buffer.from(chave.split('.')[1] || '', 'base64url').toString()).role }
      catch { throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY deve ser uma chave pública do Supabase.') }
      if (role !== 'anon') {
        throw new Error('A chave informada não é pública. Use sb_publishable_ ou a chave legada anon; nunca service_role.')
      }
    }

    if (!['HOMOLOGACAO', 'PRODUCAO', 'PRODUCTION'].includes(env.VITE_APP_ENV.trim().toUpperCase())) {
      throw new Error('Defina VITE_APP_ENV como HOMOLOGACAO ou PRODUCAO.')
    }
  }
  return { plugins: [react()] }
})
