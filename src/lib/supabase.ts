import { createClient } from '@supabase/supabase-js'
import { IS_PRODUCTION } from './env'
import { recoveryLink } from './recoveryContext'
import { createAuthStorage } from './authStorage'

const PROD_REF = 'duojavyrugezvlvuuwag'
const HOMOLOG_REF = 'nqyddagfawklfqwumlie'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no ambiente de publicação ou no arquivo .env.local para desenvolvimento.'
  )
}

let projectRef = ''
try {
  projectRef = new URL(supabaseUrl).hostname.split('.')[0] || ''
} catch {
  throw new Error('VITE_SUPABASE_URL inválida.')
}

const expectedRef = IS_PRODUCTION ? PROD_REF : HOMOLOG_REF
if (projectRef !== expectedRef) {
  throw new Error(
    `Configuração bloqueada: este site é ${IS_PRODUCTION ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'}, mas está apontando para o Supabase ${projectRef || 'desconhecido'}.`
  )
}

const storageKey = `sb-${projectRef}-auth-token`
export const loginPersistence = createAuthStorage(
  storageKey, () => window.localStorage, () => window.sessionStorage,
)

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storageKey,
    storage: loginPersistence.storage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: !recoveryLink.requested,
  },
})
