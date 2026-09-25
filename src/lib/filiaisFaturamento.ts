export interface FilialFaturamento {
  id?: string; codigo?: string; nome: string; uf?: string
  razao_social?: string; cnpj?: string; inscricao_estadual?: string; endereco?: string; cep?: string
}
type CadastroFilial = { id: string; codigo: string; nome: string; uf: string }
type ItemOrigem = { filial_origem_id?: string | null; fiscal?: { filial_origem_id?: string | null }; filial_faturamento?: FilialFaturamento }
type DocumentoOrigem = { filial?: FilialFaturamento; filiais_faturamento?: FilialFaturamento[]; itens: ItemOrigem[] }

// Fonte: FICHA CADASTRAL COLORNET 27 05 2025, fornecida pela empresa.
// Usar o código da unidade, não codigo_regra: Mauá e Matriz compartilham a regra fiscal.
export const unidadesFaturamento: Record<string, Omit<FilialFaturamento, 'id' | 'codigo'>> = {
  '0101': {
    nome: 'Matriz-SP', uf: 'SP', razao_social: 'ColorNet Comércio Exterior Ltda.',
    cnpj: '01.382.160/0001-05', inscricao_estadual: '114.926.807.111',
    endereco: 'Av. Roque Petroni Junior, 850, conj. 32-33 - Torre Jacerú\nJd. das Acácias - São Paulo/SP', cep: '04707-000',
  },
  '0102': {
    nome: 'Filial-Itajaí', uf: 'SC', razao_social: 'ColorNet Comércio Exterior Ltda.',
    cnpj: '01.382.160/0002-96', inscricao_estadual: '256.347.590',
    endereco: 'Rodovia Antonio Heil, 3201 - Armazém M14\nItaipava - Itajaí/SC', cep: '88316-000',
  },
  '0103': {
    nome: 'Filial-Mauá', uf: 'SP', razao_social: 'ColorNet Comércio Exterior Ltda.',
    cnpj: '01.382.160/0003-77', inscricao_estadual: '442.737.618.111',
    endereco: 'Avenida Papa João XXIII, 2479 - Armazém 4\nVila Noemia - Mauá/SP', cep: '09370-800',
  },
}

export function identificarFilial(filial: FilialFaturamento): FilialFaturamento {
  const nome = filial.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  const codigo = filial.codigo || (nome.includes('MAUA') ? '0103' : nome.includes('ITAJAI') ? '0102' : nome.includes('MATRIZ') && (filial.uf === 'SP' || nome.includes('SP')) ? '0101' : '')
  const unidade = unidadesFaturamento[codigo]
  return unidade ? { ...filial, ...unidade, codigo } : filial
}

export function preencherFiliaisCotacao<T extends DocumentoOrigem>(documento: T, cadastros: CadastroFilial[]): T {
  const byId = new Map(cadastros.map(f => [f.id, identificarFilial(f)]))
  const padrao = documento.filial ? identificarFilial(documento.filial) : undefined
  const itens = documento.itens.map(item => {
    const id = item.filial_origem_id || item.fiscal?.filial_origem_id
    const filial = item.filial_faturamento ? identificarFilial(item.filial_faturamento) : id ? byId.get(id) : padrao
    return { ...item, ...(filial ? { filial_faturamento: filial } : {}) }
  })
  const presentes = itens.flatMap(i => i.filial_faturamento ? [i.filial_faturamento] : [])
  const filiais = presentes.length ? presentes : documento.filiais_faturamento?.map(identificarFilial) || (padrao ? [padrao] : [])
  const distintas = [...new Map(filiais.map(f => [f.id || f.codigo || f.nome, f])).values()]
  return { ...documento, itens, filiais_faturamento: distintas }
}
