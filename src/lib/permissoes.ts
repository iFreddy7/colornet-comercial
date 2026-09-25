import type { UsuarioApp } from '../types'

export function temVisaoComercial(usuario: Pick<UsuarioApp, 'perfil' | 'ativo'>): boolean {
  return usuario.ativo && ['ADMIN', 'GERENTE', 'DIRETOR'].includes(usuario.perfil)
}
