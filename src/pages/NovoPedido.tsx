import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { APP_ENV_LABEL, IS_PRODUCTION } from '../lib/env'
import type {
  CalculoFiscal,
  Cliente,
  Filial,
  ItemPedidoLocal,
  Moeda,
  OpcaoCadastro,
  PrecoProduto,
  Produto,
  UsuarioApp,
} from '../types'
import { Loading } from '../components/Loading'
import { DraftNotice } from '../components/DraftNotice'
import { draftKey, type CommercialDraft } from '../lib/commercialDraft'
import { useCommercialDraft } from '../lib/useCommercialDraft'

type FilialRel = {
  id: string
  codigo: string
  nome: string
  uf: string
}

type EstoqueLinha = {
  filial_id: string
  filial_codigo: string
  filial_nome: string
  filial_uf: string
  estoque_erp: number
  reservado_portal: number
  disponivel: number
  atualizado_em: string | null
}

type ReservaPedidoResposta = {
  quantidade_solicitada?: number
  quantidade_reservada?: number
  nao_coberto_imediato?: number
  alocacoes?: Array<{
    produto_id: string
    quantidade_solicitada: number
    quantidade_reservada: number
    nao_coberto_imediato: number
    estoque_erp: number
    reservado_antes: number
    saldo_antes: number
    saldo_depois: number
    data_base_estoque: string | null
  }>
}

type ReservaPrevisaoResposta = {
  quantidade_necessaria?: number
  quantidade_reservada?: number
  sem_cobertura?: number
  data_cobertura?: string | null
  alocacoes?: Array<{
    produto_id: string
    filial_id: string
    previsao: string | null
    quantidade_reservada: number
    processo: string | null
    pedido_compra: string | null
    fornecedor: string | null
    lote: string | null
    chave_previsao: string
  }>
}

type CriarPedidoResposta = {
  numero?: string
  pedido_id?: string
  duplicado_bloqueado?: boolean
  estoque?: ReservaPedidoResposta
  previsao?: ReservaPrevisaoResposta
}

type PrevisaoDisponivelLinha = {
  filial_id: string
  filial_codigo: string
  filial_nome: string
  filial_uf: string
  previsao: string | null
  processo: string | null
  pedido_compra: string | null
  fornecedor: string | null
  lote: string | null
  status: string
  quantidade_prevista: number
  reservado_portal: number
  disponivel: number
  excesso_reservado: number
  chave_previsao: string
  atualizado_em: string
}

function rel<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function precoOf(produto: Produto | null): PrecoProduto | null {
  if (!produto?.precos) return null
  return Array.isArray(produto.precos)
    ? produto.precos[0] ?? null
    : produto.precos
}

function n(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function money(value: number, moeda: Moeda, casas = 2) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: moeda,
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(value)
}

function idLocal() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function quantidadeBr(value: unknown) {
  return n(value).toLocaleString('pt-BR', {
    maximumFractionDigits: 3,
  })
}

function dataBr(value: string | null | undefined) {
  if (!value) return 'Sem data'

  const iso = String(value).slice(0, 10)
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value)
}

export function NovoPedido({
  usuario,
  onPedidoCriado,
  pedidoDuplicarId,
  onDuplicacaoCarregada,
  cotacao = false,
}: {
  cotacao?: boolean
  usuario: UsuarioApp
  onPedidoCriado: () => void
  pedidoDuplicarId?: string | null
  onDuplicacaoCarregada?: () => void
}) {
  const [titulo, setTitulo] = useState('')
  const envioRef = useRef(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [filiais, setFiliais] = useState<Filial[]>([])
  const [prazos, setPrazos] = useState<OpcaoCadastro[]>([])
  const [fretes, setFretes] = useState<OpcaoCadastro[]>([])
  const [vendedores, setVendedores] = useState<Array<{ id: string; nome: string }>>([])

  const [clienteBusca, setClienteBusca] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [filialId, setFilialId] = useState('')
  const [prazoId, setPrazoId] = useState('')
  const [prazoBusca, setPrazoBusca] = useState('')
  const [freteId, setFreteId] = useState('')
  const [vendedorIdAdmin, setVendedorIdAdmin] = useState('')

  const [moeda, setMoeda] = useState<Moeda>('USD')
  const [ptax, setPtax] = useState(0)

  const [transportadora, setTransportadora] = useState('')
  const [dataEntrega, setDataEntrega] = useState('')
  const [obsTransporte, setObsTransporte] = useState('')
  const [observacoes, setObservacoes] = useState('')

  const [produtoBusca, setProdutoBusca] = useState('')
  const [resultadosProduto, setResultadosProduto] = useState<Produto[]>([])
  const [produto, setProduto] = useState<Produto | null>(null)
  const [estoque, setEstoque] = useState<EstoqueLinha[]>([])
  const [previsoes, setPrevisoes] = useState<PrevisaoDisponivelLinha[]>([])
  const [carregandoDisponibilidade, setCarregandoDisponibilidade] = useState(false)

  const [quantidade, setQuantidade] = useState('')
  const [precoNet, setPrecoNet] = useState('')
  const [faixa, setFaixa] = useState<string | null>(null)

  const [calculo, setCalculo] = useState<CalculoFiscal | null>(null)
  const [precoFinalManual, setPrecoFinalManual] = useState('')
  const [entradaPreco, setEntradaPreco] = useState<'NET' | 'FINAL'>('NET')
  const precoEntrada = entradaPreco === 'FINAL' ? precoFinalManual : precoNet
  const adicionandoRef = useRef(false)
  const [observacaoPreco, setObservacaoPreco] = useState('')

  const [itens, setItens] = useState<ItemPedidoLocal[]>([])

  const [carregandoBase, setCarregandoBase] = useState(true)
  const [calculando, setCalculando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [avisoEmail, setAvisoEmail] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID())
  const [draftKind] = useState(() => pedidoDuplicarId ? `pedido-copia-${pedidoDuplicarId}` : 'pedido')
  const [duplicando, setDuplicando] = useState(false)

  const produtoBuscaSeq = useRef(0)
  const fiscalSeq = useRef(0)
  const disponibilidadeSeq = useRef(0)

  const admin = usuario.perfil === 'ADMIN'

  async function restaurarRascunho(saved: CommercialDraft) {
    let selected: Produto | null = null
    if (saved.productId) {
      const result = await supabase.from('produtos').select('id,codigo_protheus,nome,ncm,colour_index,grupo_tributario,status_fiscal,fiscal_pendencia,ativo,precos(*)').eq('id', saved.productId).eq('ativo', true).maybeSingle()
      if (result.error) throw new Error('Não foi possível conferir o produto do rascunho. Tente novamente.')
      selected = result.data as Produto | null
    }
    setTitulo(saved.fields.titulo || '')
    setClienteBusca(saved.fields.clienteBusca || '')
    setClienteId(saved.fields.clienteId || '')
    setPrazoBusca(saved.fields.prazoBusca || '')
    setPrazoId(saved.fields.prazoId || '')
    setFreteId(saved.fields.freteId || '')
    setVendedorIdAdmin(saved.fields.vendedorIdAdmin || '')
    setMoeda(saved.fields.moeda === 'BRL' ? 'BRL' : 'USD')
    setObservacoes(saved.fields.observacoes || '')
    setProdutoBusca(saved.fields.produtoBusca || '')
    setQuantidade(saved.fields.quantidade || '')
    setPrecoNet(saved.fields.precoNet || '')
    setEntradaPreco(saved.fields.entradaPreco === 'FINAL' ? 'FINAL' : 'NET')
    setObservacaoPreco(saved.fields.observacaoPreco || '')
    setFilialId(saved.fields.filialId || '')
    setTransportadora(saved.fields.transportadora || '')
    setDataEntrega(saved.fields.dataEntrega || '')
    setObsTransporte(saved.fields.obsTransporte || '')
    setPrecoFinalManual(saved.fields.precoFinalManual || '')
    setFaixa(saved.fields.faixa || null)
    setProduto(selected)
    setItens(saved.items)
    setIdempotencyKey(saved.idempotencyKey)
    setCalculo(null)
  }
  const draft = useCommercialDraft(
    draftKey(APP_ENV_LABEL, usuario.id, draftKind),
    { fields: { titulo, clienteBusca, clienteId, prazoBusca, prazoId, freteId, vendedorIdAdmin, moeda, observacoes, produtoBusca, quantidade, precoNet, entradaPreco, observacaoPreco, filialId, transportadora, dataEntrega, obsTransporte, precoFinalManual, faixa: faixa || '' }, items: itens, productId: produto?.id || null, idempotencyKey },
    Boolean(clienteId || clienteBusca || titulo || itens.length || produtoBusca || observacoes || quantidade || precoNet || prazoId || prazoBusca || freteId || vendedorIdAdmin || observacaoPreco || moeda !== 'USD' || transportadora || obsTransporte || dataEntrega || precoFinalManual || (filialId && filialId !== filiais[0]?.id)),
    !carregandoBase && !duplicando && !pedidoDuplicarId, restaurarRascunho
  )

  const clienteSelecionado = clientes.find((c) => c.id === clienteId) || null
  const preco = precoOf(produto)
  const filialSelecionada = filiais.find((f) => f.id === filialId) || null

  const previsoesOrdenadas = useMemo(() => {
    return [...previsoes].sort((a, b) => {
      const dataA = a.previsao || '9999-12-31'
      const dataB = b.previsao || '9999-12-31'

      if (dataA !== dataB) return dataA.localeCompare(dataB)

      return (a.filial_nome || '').localeCompare(
        b.filial_nome || '',
        'pt-BR'
      )
    })
  }, [previsoes])

  const disponibilidadeResumo = useMemo(() => {
    const solicitada = n(quantidade)

    if (!produto?.id || !filialId || solicitada <= 0) return null

    const imediato = estoque
      .filter((linha) => linha.filial_id === filialId)
      .reduce((total, linha) => total + n(linha.disponivel), 0)

    const entradas = previsoes
      .filter((linha) => linha.filial_id === filialId && linha.previsao)
      .sort((a, b) => String(a.previsao).localeCompare(String(b.previsao)))

    const previsto = entradas.reduce(
      (total, linha) => total + n(linha.disponivel),
      0
    )

    let acumulado = imediato
    let dataCobertura: string | null = null

    for (const entrada of entradas) {
      acumulado += n(entrada.disponivel)

      if (acumulado >= solicitada) {
        dataCobertura = entrada.previsao
        break
      }
    }

    let status:
      | 'IMEDIATO'
      | 'MISTO'
      | 'PROGRAMADO'
      | 'PARCIAL / SEM COBERTURA'
      | 'SEM COBERTURA' = 'SEM COBERTURA'

    if (imediato >= solicitada) {
      status = 'IMEDIATO'
    } else if (dataCobertura && imediato > 0) {
      status = 'MISTO'
    } else if (dataCobertura) {
      status = 'PROGRAMADO'
    } else if (imediato + previsto > 0) {
      status = 'PARCIAL / SEM COBERTURA'
    }

    return {
      status,
      solicitado: solicitada,
      imediato,
      previsto,
      faltante: Math.max(solicitada - imediato - previsto, 0),
      dataCobertura,
    }
  }, [produto?.id, filialId, quantidade, estoque, previsoes])

  useEffect(() => {
    carregarBase()
    return () => { disponibilidadeSeq.current += 1 }
  }, [])

  useEffect(() => {
    if (!carregandoBase && pedidoDuplicarId) {
      carregarPedidoDuplicado(pedidoDuplicarId)
    }
  }, [carregandoBase, pedidoDuplicarId])

  useEffect(() => {
    fiscalSeq.current += 1
    setCalculo(null)
    if (!clienteId || (!cotacao && !filialId) || !produto?.id || n(precoEntrada) <= 0) {
      setCalculando(false)
      return
    }
    setCalculando(true)
    const timer = window.setTimeout(() => { calcularFiscalAutomatico() }, 350)
    return () => window.clearTimeout(timer)
  }, [clienteId, filialId, produto?.id, entradaPreco, precoEntrada, cotacao])

  useEffect(() => {
    const termo = produtoBusca.trim()

    if (produto && termo === produto.nome) {
      setResultadosProduto([])
      return
    }

    if (termo.length < 2) {
      setResultadosProduto([])
      return
    }

    const timer = window.setTimeout(() => {
      pesquisarProdutosAutomatico(termo)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [produtoBusca, produto?.id])

  async function carregarBase() {
    setCarregandoBase(true)
    setErro('')

    const [cli, fil, pra, fre, cfg] = await Promise.all([
      supabase
        .from('clientes')
        .select('id,codigo,loja,razao_social,nome_fantasia,municipio,uf,calculo_automatico,vendedor_id,ativo')
        .eq('ativo', true)
        .order('razao_social')
        .limit(1500),

      supabase
        .from('filiais')
        .select('id,codigo,nome,uf')
        .eq('ativo', true)
        .order('nome'),

      supabase
        .from('prazos_pagamento')
        .select('id,codigo,descricao')
        .eq('ativo', true)
        .order('descricao'),

      supabase
        .from('fretes')
        .select('id,codigo,descricao')
        .eq('ativo', true)
        .order('descricao'),

      supabase
        .from('configuracoes')
        .select('chave,valor')
        .eq('chave', 'PTAX_VALOR')
        .maybeSingle(),
    ])

    const firstError = cli.error || fil.error || pra.error || fre.error || cfg.error

    if (firstError) {
      setErro(firstError.message)
      setCarregandoBase(false)
      return
    }

    setClientes((cli.data ?? []) as Cliente[])
    setFiliais((fil.data ?? []) as Filial[])
    setPrazos((pra.data ?? []) as OpcaoCadastro[])
    setFretes((fre.data ?? []) as OpcaoCadastro[])

    if (cfg.data?.valor != null) {
      const raw =
        typeof cfg.data.valor === 'number'
          ? cfg.data.valor
          : Number(String(cfg.data.valor).replaceAll('"', ''))

      if (Number.isFinite(raw) && raw > 0) setPtax(raw)
    }

    if (admin) {
      const vend = await supabase
        .from('vendedores')
        .select('id,nome')
        .eq('ativo', true)
        .order('nome')

      if (!vend.error) {
        setVendedores((vend.data ?? []) as Array<{ id: string; nome: string }>)
      }
    }

    if (fil.data?.length) setFilialId(fil.data[0].id)
    setCarregandoBase(false)
  }

  const clientesFiltrados = useMemo(() => {
    const termo = clienteBusca.trim().toLocaleLowerCase('pt-BR')

    if (!termo) return clientes.slice(0, 50)

    return clientes
      .filter((c) =>
        [c.codigo, c.razao_social, c.nome_fantasia]
          .filter(Boolean)
          .some((value) =>
            String(value).toLocaleLowerCase('pt-BR').includes(termo)
          )
      )
      .slice(0, 50)
  }, [clientes, clienteBusca])

  const prazosFiltrados = useMemo(() => {
    const termo = prazoBusca.trim().toLocaleLowerCase('pt-BR')

    if (!termo) return prazos.slice(0, 30)

    return prazos
      .filter((p) =>
        [p.codigo, p.descricao]
          .filter(Boolean)
          .some((value) =>
            String(value).toLocaleLowerCase('pt-BR').includes(termo)
          )
      )
      .slice(0, 30)
  }, [prazos, prazoBusca])

  const prazoSelecionado = prazos.find((p) => p.id === prazoId) || null

  function selecionarCliente(cliente: Cliente) {
    setClienteId(cliente.id)
    setClienteBusca(`${cliente.codigo} — ${cliente.razao_social}`)
    setSucesso('')
  }

  async function pesquisarProdutosAutomatico(termo: string) {
    const seq = ++produtoBuscaSeq.current
    const safe = termo.replace(/[%(),]/g, ' ')

    const { data, error } = await supabase
      .from('produtos')
      .select(`
        id,
        codigo_protheus,
        nome,
        ncm,
        colour_index,
        grupo_tributario,
        status_fiscal,
        fiscal_pendencia,
        ativo,
        precos (
          faixa_1,
          faixa_2,
          faixa_3,
          moeda
        )
      `)
      .eq('ativo', true)
      .or(`nome.ilike.%${safe}%,codigo_protheus.ilike.%${safe}%`)
      .order('nome')
      .limit(30)

    if (seq !== produtoBuscaSeq.current) return

    if (error) {
      setErro(error.message)
      setResultadosProduto([])
      return
    }

    setResultadosProduto((data ?? []) as Produto[])
  }

  async function selecionarProduto(item: Produto) {
    setProduto(item)
    setProdutoBusca(item.nome)
    setResultadosProduto([])
    setQuantidade('')
    setEntradaPreco('NET')
    setPrecoFinalManual('')
    setPrecoNet('')
    setFaixa(null)
    setCalculo(null)
    setEstoque([])
    setPrevisoes([])
    if (!cotacao) await consultarDisponibilidade(item.id)
  }

  async function consultarDisponibilidade(produtoId: string) {
    const seq = ++disponibilidadeSeq.current
    setCarregandoDisponibilidade(true)

    try {
      const [estoqueRes, previsoesRes] = await Promise.all([
        supabase.rpc('consultar_disponibilidade_produto', {
          p_produto_id: produtoId,
        }),

        supabase.rpc('consultar_previsoes_disponiveis_produto', {
          p_produto_id: produtoId,
        }),
      ])

      if (seq !== disponibilidadeSeq.current) return

      if (estoqueRes.error || previsoesRes.error) {
        setErro(
          estoqueRes.error?.message ||
            previsoesRes.error?.message ||
            'Não foi possível consultar estoque/previsão.'
        )
      }

      setEstoque((estoqueRes.data ?? []) as EstoqueLinha[])
      setPrevisoes((previsoesRes.data ?? []) as PrevisaoDisponivelLinha[])
    } catch {
      if (seq !== disponibilidadeSeq.current) return
      setEstoque([])
      setPrevisoes([])
      setErro('Não foi possível atualizar a disponibilidade. Tente novamente.')
    } finally {
      if (seq === disponibilidadeSeq.current) setCarregandoDisponibilidade(false)
    }
  }

  async function carregarPedidoDuplicado(pedidoId: string) {
    setDuplicando(true)
    setErro('')
    setSucesso('')

    const [cab, its] = await Promise.all([
      supabase.from('pedidos').select('id,numero,cliente_id,filial_id,moeda,prazo_pagamento_id,frete_id,transportadora,observacoes_transporte,observacoes').eq('id', pedidoId).single(),
      supabase.from('pedido_itens').select('produto_id,quantidade,preco_net,preco_final,modo_fiscal,observacao_preco,faixa_interna,produtos(id,codigo_protheus,nome,ipi)').eq('pedido_id', pedidoId).order('id'),
    ])

    if (cab.error || its.error) {
      setErro(cab.error?.message || its.error?.message || 'Não foi possível duplicar o pedido.')
      setDuplicando(false)
      onDuplicacaoCarregada?.()
      return
    }

    const pedido = cab.data
    const cliente = clientes.find((c) => c.id === pedido.cliente_id)
    if (!cliente) {
      setErro('O cliente do pedido original não está disponível para o seu acesso atual.')
      setDuplicando(false)
      onDuplicacaoCarregada?.()
      return
    }

    setClienteId(cliente.id)
    setClienteBusca(`${cliente.codigo} — ${cliente.razao_social}`)
    setFilialId(pedido.filial_id)
    setMoeda(pedido.moeda as Moeda)
    setPrazoId(pedido.prazo_pagamento_id || '')
    const prazo = prazos.find((p) => p.id === pedido.prazo_pagamento_id)
    setPrazoBusca(prazo?.descricao || '')
    setFreteId(pedido.frete_id || '')
    setTransportadora(pedido.transportadora || '')
    setObsTransporte(pedido.observacoes_transporte || '')
    setObservacoes(pedido.observacoes ? `Duplicado de ${pedido.numero}. ${pedido.observacoes}` : `Duplicado de ${pedido.numero}.`)
    setDataEntrega('')

    const novosItens: ItemPedidoLocal[] = []
    for (const item of (its.data ?? []) as any[]) {
      const produtoRel = Array.isArray(item.produtos) ? item.produtos[0] : item.produtos
      const { data: calc, error: calcError } = await supabase.rpc('calcular_preco_comercial', {
        p_cliente_id: pedido.cliente_id,
        p_produto_id: item.produto_id,
        p_filial_id: pedido.filial_id,
        p_preco_net: Number(item.preco_net), p_preco_final: null, p_cotacao: false,
      })
      if (calcError) continue
      const result = calc as CalculoFiscal
      const qtd = Number(item.quantidade)
      const final = result.automatico ? n(result.preco_final) : Number(item.preco_final)
      const ipi = n(result.ipi ?? produtoRel?.ipi)
      const subtotal = Number((final * (qtd ?? 0)).toFixed(2))
      const valorIpi = Number((subtotal * ipi).toFixed(2))
      novosItens.push({
        idLocal: idLocal(), produto_id: item.produto_id, codigo: produtoRel?.codigo_protheus || null,
        produto: produtoRel?.nome || 'Produto', quantidade: qtd, preco_net: Number(item.preco_net), preco_final: final,
        aliquota_icms: result.automatico && result.aliquota != null ? n(result.aliquota) : null,
        divisor_icms: result.automatico && result.divisor != null ? n(result.divisor) : null,
        ipi, valor_ipi: valorIpi, subtotal, total_item: Number((subtotal + valorIpi).toFixed(2)),
        modo_fiscal: result.automatico ? 'AUTOMATICO' : 'MANUAL', regra_icms: result.regra || null,
        motivo_fiscal: result.motivo || null, faixa_interna: item.faixa_interna || null,
        observacao_preco: result.automatico ? null : (item.observacao_preco || `Duplicado de ${pedido.numero}`),
      })
    }
    setItens(novosItens)
    setIdempotencyKey(crypto.randomUUID())
    setSucesso(`Pedido ${pedido.numero} carregado como cópia. Fiscal recalculado; revise antes de salvar.`)
    setDuplicando(false)
    onDuplicacaoCarregada?.()
  }

  function valorFaixa(valorUsd: number) {
    if (moeda === 'USD') return n(valorUsd)
    return ptax > 0 ? n(valorUsd) * ptax : 0
  }

  function escolherFaixa(chave: '1' | '2' | '3') {
    if (!preco) return

    const base =
      chave === '1'
        ? n(preco.faixa_1)
        : chave === '2'
        ? n(preco.faixa_2)
        : n(preco.faixa_3)

    const atual = valorFaixa(base)

    if (atual <= 0) return

    >

          <div className="field">
            <label>Transportadora</label>
            <input
              value={transportadora}
              onChange={(e) => setTransportadora(e.target.value)}
              placeholder="Opcional"
            />
          </div>

          <div className="field field-wide">
            <label>Observações de transporte</label>
            <textarea
              value={obsTransporte}
              onChange={(e) => setObsTransporte(e.target.value)}
              placeholder="Opcional"
              rows={2}
            />
          </div>
          </>}
        </div>
      </div>

      <div className="form-card">
        <div className="section-title">
          <span>2</span>
          <div>
            <strong>Adicionar produto</strong>
            <small>{cotacao ? 'Cotação não reserva estoque. Os preços ficam registrados na data da cotação.' : 'O estoque é reservado ao salvar o pedido.'}</small>
          </div>
        </div>

        <div className="product-search live-search">
          <input
            value={produtoBusca}
            onChange={(e) => {
              setProdutoBusca(e.target.value)
              if (produto && e.target.value !== produto.nome) {
                disponibilidadeSeq.current += 1
                setProduto(null)
                setEstoque([])
                setPrevisoes([])
                setCarregandoDisponibilidade(false)
                setPrecoNet('')
                setFaixa(null)
                setCalculo(null)
              }
            }}
            placeholder="Comece a digitar o nome ou código do produto..."
          />
          <span className="live-search-hint">
            {produtoBusca.trim().length < 2
              ? 'Digite pelo menos 2 caracteres'
              : 'Busca automática'}
          </span>
        </div>

        {!!resultadosProduto.length && (
          <div className="product-results">
            {resultadosProduto.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => selecionarProduto(item)}
              >
                <strong>{item.nome}</strong>
                <span>{item.codigo_protheus || 'SEM CÓDIGO'}</span>
              </button>
            ))}
          </div>
        )}

        {produto && (
          <div className="selected-product">
            <div className="selected-product-head">
              <div>
                <span className="eyebrow">PRODUTO SELECIONADO</span>
                <h3>{produto.nome}</h3>
                <p>
                  {produto.codigo_protheus || 'SEM CÓDIGO'} • NCM {produto.ncm || '—'}{cotacao && produto.colour_index ? ` • Colour Index ${produto.colour_index}` : ''}
                </p>
              </div>

              <span
                className={
                  produto.status_fiscal === 'AUTOMATICO'
                    ? 'badge success'
                    : 'badge warning'
                }
              >
                FISCAL {produto.status_fiscal}
              </span>
            </div>
            {produto.fiscal_pendencia && <p>{produto.fiscal_pendencia}</p>}

            {!cotacao && <>
            <div className="availability-panel">
              <div className="availability-title">
                <div>
                  <strong>Disponibilidade do produto</strong>
                  <small>
                    Saldo imediato e previsões líquidas após reservas do portal.
                  </small>
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  disabled={carregandoDisponibilidade}
                  onClick={() => consultarDisponibilidade(produto.id)}
                >
                  {carregandoDisponibilidade ? 'Atualizando...' : 'Atualizar disponibilidade'}
                </button>
              </div>

              <div className="availability-subtitle">
                <strong>Estoque imediato</strong>
                <span>ERP menos reservas feitas após o último snapshot.</span>
              </div>

              <div className="stock-strip">
                {estoque.length ? (
                  estoque.map((linha, index) => {
                    const selecionada = linha.filial_id === filialId

                    return (
                      <div
                        className={selecionada ? 'stock-card selected-branch' : 'stock-card'}
                        key={`${linha.filial_id}-${index}`}
                      >
                        <span>
                          {linha.filial_nome || 'Filial'}
                          {selecionada ? ' • FATURAMENTO' : ''}
                        </span>

                        <strong>{quantidadeBr(linha.disponivel)} KG disponíveis</strong>

                        <div className="stock-breakdown">
                          <small>
                            ERP: {quantidadeBr(linha.estoque_erp)} KG
                          </small>
                          <small>
                            Reservado: {quantidadeBr(linha.reservado_portal)} KG
                          </small>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="stock-note">
                    Sem saldo imediato informado para este produto no snapshot atual.
                  </div>
                )}
              </div>

              {disponibilidadeResumo && (
                <div
                  className={`coverage-card coverage-${disponibilidadeResumo.status
                    .toLowerCase()
                    .replaceAll(' ', '-')
                    .replaceAll('/', '-')}`}
                >
                  <div>
                    <span>Atendimento pela filial selecionada</span>
                    <strong>{disponibilidadeResumo.status}</strong>
                    <small>
                      {filialSelecionada?.nome || 'Filial'} • solicitado{' '}
                      {quantidadeBr(disponibilidadeResumo.solicitado)} KG
                    </small>
                  </div>

                  <div className="coverage-numbers">
                    <div>
                      <span>Agora</span>
                      <strong>{quantidadeBr(disponibilidadeResumo.imediato)} KG</strong>
                    </div>
                    <div>
                      <span>Previsto</span>
                      <strong>{quantidadeBr(disponibilidadeResumo.previsto)} KG</strong>
                    </div>
                    <div>
                      <span>Faltante</span>
                      <strong>{quantidadeBr(disponibilidadeResumo.faltante)} KG</strong>
                    </div>
                    <div>
                      <span>Cobertura</span>
                      <strong>
                        {disponibilidadeResumo.dataCobertura
                          ? dataBr(disponibilidadeResumo.dataCobertura)
                          : '—'}
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              <div className="forecast-block">
                <div className="availability-subtitle forecast-title">
                  <strong>Próximas entradas</strong>
                  <span>
                    {previsoesOrdenadas.length
                      ? `${previsoesOrdenadas.length} previsão(ões) encontrada(s)`
                      : 'Independentemente da filial de faturamento'}
                  </span>
                </div>

                {previsoesOrdenadas.length ? (
                  <div className="forecast-grid">
                    {previsoesOrdenadas.map((linha) => {
                      const selecionada = linha.filial_id === filialId

                      return (
                        <div
                          className={
                            selecionada
                              ? 'forecast-card selected-branch'
                              : 'forecast-card'
                          }
                          key={linha.chave_previsao}
                        >
                          <div className="forecast-card-head">
                            <div>
                              <span>{linha.filial_nome || 'Filial'}</span>
                              <strong>{dataBr(linha.previsao)}</strong>
                            </div>
                            <b>{quantidadeBr(linha.disponivel)} KG disponíveis</b>
                          </div>

                          <div className="forecast-breakdown">
                            <small>
                              Previsto: {quantidadeBr(linha.quantidade_prevista)} KG
                            </small>
                            <small>
                              Reservado: {quantidadeBr(linha.reservado_portal)} KG
                            </small>
                            {n(linha.excesso_reservado) > 0 && (
                              <small className="forecast-overbooked">
                                Excesso reservado: {quantidadeBr(linha.excesso_reservado)} KG
                              </small>
                            )}
                          </div>

                          <div className="forecast-meta">
                            {linha.processo && (
                              <span>Processo: {linha.processo}</span>
                            )}
                            {linha.pedido_compra && (
                              <span>PC: {linha.pedido_compra}</span>
                            )}
                            {linha.lote && <span>Lote: {linha.lote}</span>}
                            {linha.status && <span>Status: {linha.status}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="stock-note">
                    Sem entradas futuras com data confirmada para este produto.
                  </div>
                )}
              </div>
            </div>

            </>}
            {preco && (
              <div className="price-options">
                {[
                  ['1', preco.faixa_1],
                  ['2', preco.faixa_2],
                  ['3', preco.faixa_3],
                ].map(([key, value]) => (
                  <button
                    type="button"
                    key={key}
                    className={faixa === key ? 'price-option selected' : 'price-option'}
                    onClick={() => escolherFaixa(key as '1' | '2' | '3')}
                  >
                    <span>Preço sugerido {key}</span>
                    <strong>{money(valorFaixa(n(value)), moeda, 4)}</strong>
                  </button>
                ))}
              </div>
            )}

            <div className="form-grid compact">
              <div className="field">
                <label>{cotacao ? 'Quantidade (opcional)' : 'Quantidade *'}</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  placeholder={cotacao ? "Sem quantidade: apenas preço unitário" : "0,000"}
                />
              </div>

              <div className="field">
                <label>Preço NET *</label>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={precoNet}
                  onChange={(e) => {
                    fiscalSeq.current += 1
                    if (calculo?.automatico !== false) setPrecoFinalManual('')
                    setCalculo(null)
                    setEntradaPreco('NET')
                    setPrecoNet(e.target.value)
                    setFaixa(null)
                  }}
                  placeholder="0,0000"
                />
              </div>

              <div className="field">
                <label>Preço final (sem IPI) *</label>
                <input type="number" min="0.01" step="0.01" value={precoFinalManual}
                  onChange={e => {
                    fiscalSeq.current += 1
                    if (calculo?.automatico !== false) setPrecoNet('')
                    setCalculo(null); setEntradaPreco('FINAL'); setPrecoFinalManual(e.target.value); setFaixa(null)
                  }} placeholder="0,00" />
                <small>Preencha NET ou final; o outro é calculado automaticamente.</small>
              </div>

              <div className="field action-field">
                <label>Cálculo fiscal</label>
                <div className="auto-calc-status">
                  {calculando
                    ? 'Calculando automaticamente...'
                    : calculo
                    ? calculo.automatico
                      ? 'Calculado automaticamente'
                      : 'Validação manual necessária'
                    : 'Informe NET ou preço final'}
                </div>
              </div>
            </div>

            {calculo && (
              <div
                className={
                  calculo.automatico
                    ? 'fiscal-result automatic'
                    : 'fiscal-result manual'
                }
              >
                {calculo.automatico ? (
                  <>
                    <div>
                      <span>ICMS</span>
                      <strong>{(n(calculo.aliquota) * 100).toFixed(0)}%</strong>
                    </div>
                    <div>
                      <span>Preço final</span>
                      <strong>{money(n(calculo.preco_final), moeda)}</strong>
                    </div>
                    <div>
                      <span>IPI</span>
                      <strong>{(n(calculo.ipi) * 100).toFixed(2)}%</strong>
                    </div>
                    {!cotacao && <div className="fiscal-rule"><span>Regra</span><strong>{calculo.regra || 'Automática'}</strong></div>}
                  </>
                ) : (
                  <div className="manual-block">
                    <div>
                      <span className="badge warning">CÁLCULO MANUAL</span>
                      <p>{calculo.motivo || 'Validação manual necessária.'}</p>
                    </div>

                    <div className="form-grid compact">
                      <div className="field field-wide">
                        <label>Observação / aprovação *</label>
                        <input
                          value={observacaoPreco}
                          onChange={(e) => setObservacaoPreco(e.target.value)}
                          placeholder="Ex.: aprovado por ..."
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className="primary-button add-item-button"
              onClick={adicionarItem}
              disabled={calculando || salvando}
            >
              {cotacao ? 'Adicionar produto à cotação' : 'Adicionar produto ao pedido'}
            </button>
          </div>
        )}
      </div>

      <div className="form-card">
        <div className="section-title">
          <span>3</span>
          <div>
            <strong>{cotacao ? 'Itens da cotação' : 'Itens do pedido'}</strong>
            <small>{itens.length} item(ns) incluído(s).</small>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Qtd.</th>
                <th>NET</th>
                <th>Final</th>
                <th>ICMS</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.idLocal}>
                  <td>
                    <strong>{item.produto}</strong>
                    <small>{item.codigo || 'SEM CÓDIGO'} • {item.modo_fiscal}</small>
                    {cotacao && <small>NCM {item.ncm || 'Não informado'}{item.colour_index ? ` • Colour Index ${item.colour_index}` : ''}</small>}
                  </td>
                  <td>{item.quantidade == null ? '—' : item.quantidade.toLocaleString('pt-BR')}</td>
                  <td>{money(item.preco_net, moeda, 4)}</td>
                  <td>{money(item.preco_final, moeda)}</td>
                  <td>
                    {item.aliquota_icms == null
                      ? 'MANUAL'
                      : `${(item.aliquota_icms * 100).toFixed(0)}%`}
                  </td>
                  <td>{item.quantidade == null ? '—' : money(item.total_item, moeda)}</td>
                  <td>
                    <button
                      type="button"
                      className="danger-link"
                      onClick={() => excluirItem(item.idLocal)}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}

              {!itens.length && (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    Nenhum produto adicionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {(!cotacao || itens.every(i => i.quantidade != null)) ? (
        <div className="order-totals">
          <div>
            <span>Subtotal</span>
            <strong>{money(totais.subtotal, moeda)}</strong>
          </div>
          <div>
            <span>IPI</span>
            <strong>{money(totais.ipi, moeda)}</strong>
          </div>
          <div className="grand-total">
            <span>Total</span>
            <strong>{money(totais.total, moeda)}</strong>
          </div>
        </div>

        ) : <p>Lista de preços unitários. Total geral disponível somente com quantidade em todos os itens.</p>}
        <div className="field">
          <label>Observações gerais</label>
          <textarea
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            rows={3}
            placeholder="Opcional"
          />
        </div>

        <button
          type="button"
          className="primary-button submit-order"
          onClick={salvarPedido}
          disabled={salvando || !itens.length}
        >
          {salvando ? 'Salvando...' : cotacao ? 'Salvar Cotação / Lista' : 'Salvar Pedido no Supabase'}
        </button>
      </div>
    </section>
  )
}
