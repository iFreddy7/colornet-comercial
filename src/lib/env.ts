export const APP_ENV = (import.meta.env.VITE_APP_ENV?.trim() || 'HOMOLOGACAO').toUpperCase()
export const IS_PRODUCTION = APP_ENV === 'PRODUCAO' || APP_ENV === 'PRODUCTION'
export const APP_ENV_LABEL = IS_PRODUCTION ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'
