const RAW_APP_ENV = (import.meta.env.VITE_APP_ENV?.trim() || '').toUpperCase()

const HOSTNAME =
  typeof window !== 'undefined'
    ? window.location.hostname.toLowerCase()
    : ''

const CLOUDFLARE_PRODUCTION_HOST = 'colornet-comercial.pages.dev'
const CLOUDFLARE_PROJECT_SUFFIX = '.colornet-comercial.pages.dev'

const IS_CLOUDFLARE_PRODUCTION = HOSTNAME === CLOUDFLARE_PRODUCTION_HOST
const IS_CLOUDFLARE_PREVIEW =
  HOSTNAME.endsWith(CLOUDFLARE_PROJECT_SUFFIX) &&
  HOSTNAME !== CLOUDFLARE_PRODUCTION_HOST

export const IS_PRODUCTION = IS_CLOUDFLARE_PRODUCTION
  ? true
  : IS_CLOUDFLARE_PREVIEW
    ? false
    : RAW_APP_ENV === 'PRODUCAO' || RAW_APP_ENV === 'PRODUCTION'

export const APP_ENV = IS_PRODUCTION ? 'PRODUCAO' : 'HOMOLOGACAO'
export const APP_ENV_LABEL = IS_PRODUCTION ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'
