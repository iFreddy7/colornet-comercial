import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const PROD_REF = 'duojavyrugezvlvuuwag'
const HOMOLOG_REF = 'nqyddagfawklfqwumlie'

function projetoDaUrl(raw: string) {
  let url: URL
  try { url = new URL(raw.trim()) }
  catch { throw new Error('VITE_SUPABASE_URL deve conter a URL completa do projeto Supabase.') }

  if (url.protocol !== 'https:') {
    throw new Error('A publicação exige VITE_SUPABASE_URL com HTTPS.')
  }

  const ref = url.hostname.split('.')[0]
  if (!ref) throw new Error('Não foi possível identificar o projeto Supabase pela URL.')
  return ref
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const obrigatorias = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_APP_ENV']
    const ausentes = obrigatorias.filter((nome) => !env[nome]?.trim())
    if (ausentes.length) {
      throw new Error(`Configure no Cloudflare ou em .env.local: ${ausentes.join(', ')}. Depois execute o build novamente.`)
    }

    const appEnv = env.VITE_APP_ENV.trim().toUpperCase()
    if (!['HOMOLOGACAO', 'PRODUCAO', 'PRODUCTION'].includes(appEnv)) {
      throw new Error('Defina VITE_APP_ENV como HOMOLOGACAO ou PRODUCAO.')
    }

    const ref = projetoDaUrl(env.VITE_SUPABASE_URL)
    const cfBranch = (process.env.CF_PAGES_BRANCH || '').trim()
    const vercelEnv = (process.env.VERCEL_ENV || '').trim().toLowerCase()
    const vercelBranch = (process.env.VERCEL_GIT_COMMIT_REF || '').trim()

    let esperadoPorBranch: 'PRODUCAO' | 'HOMOLOGACAO'
    if (cfBranch) {
      esperadoPorBranch = cfBranch === 'main' ? 'PRODUCAO' : 'HOMOLOGACAO'
    } else if (vercelEnv) {
      esperadoPorBranch = vercelEnv === 'production' ? 'PRODUCAO' : 'HOMOLOGACAO'
      if (vercelEnv === 'production' && vercelBranch && vercelBranch !== 'main') {
        throw new Error(`Deploy de produção na Vercel bloqueado: a branch ${vercelBranch} não é a main.`)
      }
    } else {
      esperadoPorBranch = appEnv === 'HOMOLOGACAO' ? 'HOMOLOGACAO' : 'PRODUCAO'
    }

    const refEsperado = esperadoPorBranch === 'PRODUCAO' ? PROD_REF : HOMOLOG_REF

    if (esperadoPorBranch === 'PRODUCAO' && !['PRODUCAO', 'PRODUCTION'].includes(appEnv)) {
      throw new Error('A branch main só pode ser publicada com VITE_APP_ENV=PRODUCAO.')
    }
    if (esperadoPorBranch === 'HOMOLOGACAO' && appEnv !== 'HOMOLOGACAO') {
      throw new Error('Branches de preview só podem ser publicadas com VITE_APP_ENV=HOMOLOGACAO.')
    }
    if (ref !== refEsperado) {
      throw new Error(
        `Ambiente bloqueado: ${esperadoPorBranch} deve usar o Supabase ${refEsperado}, mas a URL aponta para ${ref}.`
      )
    }

    const chave = env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
    if (chave.startsWith('sb_secret_')) {
      throw new Error('Use a chave pública sb_publishable_ no frontend. Uma chave secreta não pode ser incluída no site.')
    }
    if (!chave.startsWith('sb_publishable_')) {
      let role: unknown
      try { role = JSON.parse(Buffer.from(chave.split('.')[1] || '', 'base64url').toString()).role }
      catch { throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY deve ser uma chave pública do Supabase.') }
      if (role !== 'anon') {
        throw new Error('A chave informada não é pública. Use sb_publishable_ ou a chave legada anon; nunca service_role.')
      }
    }
  }

  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const production = ['PRODUCAO', 'PRODUCTION'].includes((env.VITE_APP_ENV || '').trim().toUpperCase())
  return { plugins: [react(), {
    name: 'colornet-installable-app',
    generateBundle(_options, bundle) {
      const version = createHash('sha256').update(Object.values(bundle).map(item => item.type === 'chunk' ? item.code : String(item.source)).join('')).digest('hex').slice(0, 16)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: readFileSync('pwa/sw.js', 'utf8').replace('__BUILD_VERSION__', version) })
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify({
        id: '/', name: production ? 'ColorNet Comercial' : 'ColorNet — Homologação',
        short_name: production ? 'ColorNet' : 'ColorNet Teste', lang: 'pt-BR',
        description: 'Clientes, cotações e pedidos da ColorNet.', start_url: '/', scope: '/',
        display: 'standalone', background_color: '#f5f7fb', theme_color: '#19337f',
        icons: [192, 512].map(size => ({ src: `/icons/colornet-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
      }, null, 2) })
    },
  }] }
})
