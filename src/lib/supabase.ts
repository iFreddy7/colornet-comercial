import { createClient } from '@supabase/supabase-js'

const HOMOLOG_SUPABASE_URL = 'https://nqyddagfawklfqwumlie.supabase.co'
const HOMOLOG_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ac9xByDgczFxxydOnF80hw_Jrvb1OTJ'

const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
const emPreviewCloudflare =
  hostname === 'homologacao.colornet-comercial.pages.dev' ||
  (hostname.endsWith('.colornet-comercial.pages.dev') && hostname !== 'colornet-comercial.pages.dev')

const supabaseUrl = (
  emPreviewCloudflare
    ? HOMOLOG_SUPABASE_URL
    : import.meta.env.VITE_SUPABASE_URL
)?.trim()

const supabasePublishableKey = (
  emPreviewCloudflare
    ? HOMOLOG_SUPABASE_PUBLISHABLE_KEY
    : import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
)?.trim()

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no ambiente de publicação ou no arquivo .env.local para desenvolvimento.'
  )
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
