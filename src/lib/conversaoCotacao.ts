export type ItemCotacaoAprovada = {
  produto_id: string; produto: string; codigo: string; quantidade: number | null
  preco_net: number; preco_final: number; ipi?: number; filial_origem_id?: string | null
  fiscal?: { ipi?: number; filial_origem_id?: string | null }
}
export type CotacaoParaPedido = {
  aprovacao_status: string; id: string; numero: string; cliente_id: string; cliente_nome: string
  vendedor_nome: string; filial_id: string | null; moeda: 'USD' | 'BRL'; validade: string | null
  prazo_pagamento_id: string | null; frete_id: string | null; observacoes: string | null
  pedido_convertido_id: string | null
  documento: { itens: ItemCotacaoAprovada[]; data_entrega?: string; transportadora?: string; observacoes_transporte?: string }
}

export function dadosIniciaisConversao(q: CotacaoParaPedido, filiais: Array<{ id: string }>) {
  const origens = q.documento.itens.map(i => i.filial_origem_id || i.fiscal?.filial_origem_id || '')
  const unica = origens.length > 0 && origens.every(id => id && id === origens[0]) ? origens[0] : ''
  const filial = q.filial_id || unica
  return {
    filialId: filiais.some(f => f.id === filial) ? filial : '',
    prazoId: q.prazo_pagamento_id || '', freteId: q.frete_id || '', observacoes: q.observacoes || '',
    transportadora: q.documento.transportadora || '', dataEntrega: q.documento.data_entrega || '',
    observacoesTransporte: q.documento.observacoes_transporte || '',
    selecionados: q.documento.itens.map(() => true),
    quantidades: q.documento.itens.map(i => i.quantidade == null ? '' : String(i.quantidade)),
  }
}

export function valoresAprovados(item: ItemCotacaoAprovada, quantidade: string) {
  const net = Number(item.preco_net), final = Number(item.preco_final)
  const sourceIpi = item.ipi ?? item.fiscal?.ipi
  const ipi = sourceIpi == null ? NaN : Number(sourceIpi)
  if (!(net > 0 && net <= 1e9 && final > 0 && final <= 1e9 && ipi >= 0 && ipi <= 1)) {
    throw new Error('Esta cotação não contém preços e impostos válidos para conversão. Emita uma nova proposta.')
  }
  const qty = Number(quantidade), quantidadeValida = qty > 0 && qty <= 1e9
  const subtotal = quantidadeValida ? Math.round((final * qty + Number.EPSILON) * 100) / 100 : 0
  const valorIpi = Math.round((subtotal * ipi + Number.EPSILON) * 100) / 100
  return { net, final, ipi, quantidadeValida, total: Math.round((subtotal + valorIpi) * 100) / 100 }
}

