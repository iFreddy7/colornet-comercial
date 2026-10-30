import type { UsuarioApp } from '../types'

export type SituacaoCotacao = 'PENDENTE' | 'APROVADA' | 'REPROVADA'
export const situacoesCotacao: Record<SituacaoCotacao, string> = { PENDENTE: 'Sem avaliação (opcional)', APROVADA: 'Aprovada', REPROVADA: 'Reprovada' }
export type Avaliacao = {
  id: string; numero: string; pedido_convertido_id: string | null
  aprovacao_status: SituacaoCotacao; aprovacao_nome: string | null
  aprovacao_em: string | null; aprovacao_motivo: string | null; aviso_status: string
}
export function podeAvaliarCotacao(usuario: Pick<UsuarioApp, 'ativo' | 'perfil'>): boolean {
  return usuario.ativo && ['GERENTE','DIRETOR'].includes(usuario.perfil)
}
export const situacoesAviso: Record<string, string> = {
  NAO_SOLICITADO: 'O aviso será enviado após a decisão.',
  PENDENTE: 'Aviso aguardando envio.', ENVIANDO: 'Envio em processamento. Atualize para conferir.',
  ENVIADO: 'Aviso aceito pelo servidor de e-mail para todos os destinatários.',
  ERRO: 'Há destinatários pendentes. Tente enviar o aviso novamente.',
  INCERTO: 'O envio não foi confirmado. João deve conferir o recebimento antes de solicitar outra tentativa.',
}

export function permiteConversaoSemAprovacao(status: string): boolean {
  return status === 'PENDENTE' || status === 'APROVADA'
}
