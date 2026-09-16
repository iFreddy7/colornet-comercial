export type Perfil = 'VENDEDOR' | 'GERENTE' | 'ADMIN'
export type Moeda = 'USD' | 'BRL'

export interface UsuarioApp {
  id: string
  nome: string | null
  email: string | null
  perfil: Perfil
  vendedor_id: string | null
  ativo: boolean
}

export interface DashboardStats {
  clientes: number
  produtos: number
  precos: number
  filiais: number
  pedidos: number
}

export interface PrecoProduto {
  faixa_1: number
  faixa_2: number
  faixa_3: number
  moeda: string
}

export interface Produto {
  id: string
  codigo_protheus: string | null
  nome: string
  ncm: string | null
  colour_index?: string | null
  grupo_tributario: string | null
  status_fiscal: 'AUTOMATICO' | 'MANUAL'
  fiscal_pendencia?: string | null
  ativo: boolean
  precos: PrecoProduto | PrecoProduto[] | null
}

export interface Cliente {
  id: string
  codigo: string
  loja: string | null
  razao_social: string
  nome_fantasia: string | null
  municipio: string | null
  uf: string | null
  calculo_automatico: boolean
  vendedor_id?: string | null
  cnpj_cpf?: string | null
  inscricao_estadual?: string | null
  email?: string | null
  contato?: string | null
  telefone?: string | null
  endereco?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cep?: string | null
  ativo: boolean
}

export interface ClienteContato {
  id: string
  cliente_id: string
  nome: string
  cargo: string | null
  email: string | null
  telefone: string | null
  celular: string | null
  observacoes: string | null
  principal: boolean
  ativo: boolean
}

export interface Filial {
  id: string
  codigo: string
  nome: string
  uf: string
}

export interface OpcaoCadastro {
  id: string
  codigo?: string | null
  descricao: string
}

export interface CalculoFiscal {
  preco_net?: number | null
  filial_origem_id?: string | null
  estoque_disponivel?: number | null
  ncm?: string | null
  colour_index?: string | null
  automatico: boolean
  motivo?: string
  aliquota?: number
  divisor?: number
  preco_final?: number
  ipi?: number
  regra?: string
  interna?: boolean
  origem_uf?: string
  destino_uf?: string
}

export interface ItemPedidoLocal {
  idLocal: string
  produto_id: string
  codigo: string | null
  produto: string
  ncm?: string | null
  colour_index?: string | null
  filial_origem_id?: string | null
  entrada_preco?: 'NET' | 'FINAL'
  quantidade: number | null
  preco_net: number
  preco_final: number
  aliquota_icms: number | null
  divisor_icms: number | null
  ipi: number
  valor_ipi: number
  subtotal: number
  total_item: number
  modo_fiscal: 'AUTOMATICO' | 'MANUAL'
  regra_icms: string | null
  motivo_fiscal: string | null
  faixa_interna: string | null
  observacao_preco: string | null
}

export interface PedidoResumo {
  id: string
  numero: string
  created_at: string
  status: string
  cancelado_em?: string | null
  motivo_cancelamento?: string | null
  moeda: Moeda
  subtotal: number
  valor_ipi: number
  total: number
  clientes:
    | { codigo: string; razao_social: string }
    | Array<{ codigo: string; razao_social: string }>
    | null
  vendedores:
    | { nome: string }
    | Array<{ nome: string }>
    | null
  filiais:
    | { nome: string; uf: string }
    | Array<{ nome: string; uf: string }>
    | null
}

export interface PedidoItemBanco {
  id: string
  quantidade: number
  preco_net: number
  preco_final: number
  aliquota_icms: number | null
  ipi: number
  total_item: number
  modo_fiscal: 'AUTOMATICO' | 'MANUAL'
  produtos:
    | { codigo_protheus: string | null; nome: string }
    | Array<{ codigo_protheus: string | null; nome: string }>
    | null
}


export interface AdminUsuario {
  id: string
  nome: string | null
  email: string | null
  perfil: Perfil
  vendedor_id: string | null
  ativo: boolean
  vendedores: { nome: string; codigo_protheus: string | null } | Array<{ nome: string; codigo_protheus: string | null }> | null
}

export interface IntegracaoExecucao {
  id: string
  tipo: 'ESTOQUE' | 'PRECOS' | 'PREVISAO'
  ambiente: string
  assunto: string | null
  remetente: string | null
  arquivo: string | null
  status: string
  modo: string
  linhas_total: number
  linhas_aplicadas: number
  pendencias: number
  detalhes: unknown
  criado_em: string
}
