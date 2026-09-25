type LinkFailure = { message: string; canCreateAccess: boolean }

export async function passwordLinkFailure(error: unknown): Promise<LinkFailure> {
  const fallback = { message: 'Não foi possível gerar o link. Verifique sua conexão e tente novamente.', canCreateAccess: false }
  const context = (error as { context?: unknown } | null)?.context
  if (!(context instanceof Response)) return fallback
  const data = await context.clone().json().catch(() => null)
  return {
    message: typeof data?.erro === 'string' ? data.erro
      : context.status === 401 ? 'Sua sessão expirou. Entre novamente no portal.'
      : context.status === 403 ? 'Somente um administrador ativo pode gerar links de senha.'
      : context.status === 429 ? 'Muitas solicitações. Aguarde um pouco e tente novamente.'
      : fallback.message,
    canCreateAccess: context.status === 404 && data?.codigo === 'AUTH_USER_MISSING' && data?.pode_criar_acesso === true,
  }
}
