import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { APP_ENV_LABEL } from '../lib/env'
import { pdfCotacaoBase64, type DocumentoCotacao } from '../lib/cotacaoPdf'
import type {
  CalculoFiscal,
  Cliente,
  ItemPedidoLocal,
  Moeda,
  OpcaoCadastro,
  PrecoProduto,
  Produto,
  UsuarioApp,
} from '../types'
import { Loading } from '../components/Loading'

function n(value: unknown) {
  const numero = Number(value)
  return Number.isFinite(numero) ? numero : 0
}

function money(value: number, moeda: Moeda, casas = 2) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: moeda,
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(value)
}

function precoOf(produto: Produto | null): PrecoProduto | null {
  if (!produto?.precos) return null
  return Array.isArray(produto.precos) ? produto.precos[0] ?? null : produto.precos
}

function idLocal() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function dataIsoMaisDias(dias: number) {
  const data = new Date()
  data.setHours(12, 0, 0, 0)
  data.setDate(data.getDate() + dias)
  const ano = data.getFullYear()
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

export function NovaCotacaoV2({
  usuario,
  onCotacaoCriada,
}: {
  usuario: UsuarioApp
  onCotacaoCriada?: () => void
}) {
  const admin = usuario.perfil === 'ADMIN'

  const [titulo, setTitulo] = useState('')
  const [validade, setValidade] = useState(() => dataIsoMaisDias(7))
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [prazos, setPrazos] = useState<OpcaoCadastro[]>([])
  const [fretes, setFretes] = useState<OpcaoCadastro[]>([])
  const [vendedores, setVendedores] = useState<Array<{ id: string; nome: string }>>([])
  const [ptax, setPtax] = useState(0)

  const [clienteBusca, setClienteBusca] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [prazoBusca, setPrazoBusca] = useState('')
  const [prazoId, setPrazoId] = useState('')
  const [freteId, setFreteId] = useState('')
  const [vendedorIdAdmin, setVendedorIdAdmin] = useState('')
  const [moeda, setMoeda] = useState<Moeda>('USD')
  const [observacoes, setObservacoes] = useState('')

  const [produtoBusca, setProdutoBusca] = useState('')
  const [resultadosProduto, setResultadosProduto] = useState<Produto[]>([])
  const [produto, setProduto] = useState<Produto | null>(null)
  const [quantidade, setQuantidade] = useState('')
  const [precoNet, setPrecoNet] = useState('')
  const [precoFinal, setPrecoFinal] = useState('')
  const [entradaPreco, setEntradaPreco] = useState<'NET' | 'FINAL'>('NET')
  const [faixa, setFaixa] = useState<string | null>(null)
  const [calculo, setCalculo] = useState<CalculoFiscal | null>(null)
  const [calculando, setCalculando] = useState(false)
  const [observacaoPreco, setObservacaoPreco] = useState('')
  const [itens, setItens] = useState<ItemPedidoLocal[]>([])

  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [avisoEmail, setAvisoEmail] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const buscaSeq = useRef(0)
  const fiscalSeq = useRef(0)
  const envioRef = useRef(false)
  const adicionandoRef = useRef(false)

  const clienteSelecionado = clientes.find((c) => c.id === clienteId) || null
  const prazoSelecionado = prazos.find((p) => p.id === prazoId) || null
  const freteSelecionado = fretes.find((f) => f.id === freteId) || null
  const preco = precoOf(produto)
  const precoEntrada = entradaPreco === 'FINAL' ? precoFinal : precoNet

  useEffect(() => {
    carregarBase()
  }, [])

  useEffect(() => {
    fiscalSeq.current += 1
    setCalculo(null)

    if (!clienteId || !produto?.id || n(precoEntrada) <= 0) {
      setCalculando(false)
      return
    }

    const timer = window.setTimeout(() => calcularFiscalAutomatico(), 350)
    return () => window.clearTimeout(timer)
  }, [clienteId, produto?.id, entradaPreco, precoEntrada])

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
    const timer = window.setTimeout(() => pesquisarProdutos(termo), 250)
    return () => window.clearTimeout(timer)
  }, [produtoBusca, produto?.id])

  async function carregarBase() {
    setCarregando(true)
    setErro('')

    const [cli, pra, fre, cfg, vend] = await Promise.all([
      supabase
        .from('clientes')
        .select('id,codigo,loja,razao_social,nome_fantasia,municipio,uf,calculo_automatico,vendedor_id,ativo')
        .eq('ativo', true)
        .order('razao_social')
        .limit(1500),
      supabase
        .from('prazos_pagamento')
        .select('id,codigo,descricao')
        .eq('ativo', true)
        .order('descricao'),
      supabase
        .from('fretes')
        .select('id,codigo,descricao')
        .eq('ativo', true)
        .in('codigo', ['CIF', 'FOB'])
        .order('codigo'),
      supabase
        .from('configuracoes')
        .select('chave,valor')
        .eq('chave', 'PTAX_VALOR')
        .maybeSingle(),
      admin
        ? supabase.from('vendedores').select('id,nome').eq('ativo', true).order('nome')
        : Promise.resolve({ data: [], error: null }),
    ])

    const firstError = cli.error || pra.error || fre.error || cfg.error || vend.error
    if (firstError) setErro(firstError.message)

    setClientes((cli.data ?? []) as Cliente[])
    setPrazos((pra.data ?? []) as OpcaoCadastro[])
    setFretes((fre.data ?? []) as OpcaoCadastro[])
    setVendedores((vend.data ?? []) as Array<{ id: string; nome: string }>)

    if (cfg.data?.valor != null) {
      const raw =
        typeof cfg.data.valor === 'number'
          ? cfg.data.valor
          : Number(String(cfg.data.valor).replaceAll('"', ''))
      if (Number.isFinite(raw) && raw > 0) setPtax(raw)
    }

    setCarregando(false)
  }

  const clientesFiltrados = useMemo(() => {
    const termo = clienteBusca.trim().toLocaleLowerCase('pt-BR')
    if (!termo) return clientes.slice(0, 50)
    return clientes
      .filter((c) =>
        [c.codigo, c.razao_social, c.nome_fantasia]
          .filter(Boolean)
          .some((v) => String(v).toLocaleLowerCase('pt-BR').includes(termo))
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
          .some((v) => String(v).toLocaleLowerCase('pt-BR').includes(termo))
      )
      .slice(0, 30)
  }, [prazos, prazoBusca])

  async function pesquisarProdutos(termo: string) {
    const seq = ++buscaSeq.current
    const safe = termo.replace(/[%(),]/g, ' ')

    const { data, error } = await supabase
      .from('produtos')
      .select(`
        id,codigo_protheus,nome,ncm,colour_index,grupo_tributario,status_fiscal,fiscal_pendencia,ativo,
        precos(faixa_1,faixa_2,faixa_3,moeda)
      `)
      .eq('ativo', true)
      .or(`nome.ilike.%${safe}%,codigo_protheus.ilike.%${safe}%,colour_index.ilike.%${safe}%`)
      .order('nome')
      .limit(30)

    if (seq !== buscaSeq.current) return
    if (error) {
      setErro(error.message)
      setResultadosProduto([])
      return
    }
    setResultadosProduto((data ?? []) as Produto[])
  }

  function selecionarProduto(item: Produto) {
    setProduto(item)
    setProdutoBusca(item.nome)
    setResultadosProduto([])
    setQuantidade('')
    setEntradaPreco('NET')
    setPrecoNet('')
    setPrecoFinal('')
    setFaixa(null)
    setCalculo(null)
    setObservacaoPreco('')
  }

  function selecionarProdutoVazio() {
    setProduto(null)
    setProdutoBusca('')
    setResultadosProduto([])
    setQuantidade('')
    setPrecoNet('')
    setPrecoFinal('')
    setFaixa(null)
    setCalculo(null)
    setObservacaoPreco('')
    setEntradaPreco('NET')
  }

  function valorFaixa(valorUsd: number) {
    if (moeda === 'USD') return n(valorUsd)
    return ptax > 0 ? n(valorUsd) * ptax : 0
  }

  function escolherFaixa(chave: '1' | '2' | '3') {
    if (!preco) return
    const base = chave === '1' ? n(preco.faixa_1) : chave === '2' ? n(preco.faixa_2) : n(preco.faixa_3)
    const atual = valorFaixa(base)
    if (atual <= 0) return

    fiscalSeq.current += 1
    setEntradaPreco('NET')
    setPrecoFinal('')
    setPrecoNet(atual.toFixed(4))
    setFaixa(chave)
    setCalculo(null)
  }

  async function calcularFiscalAutomatico() {
    const seq = ++fiscalSeq.current
    if (!clienteId || !produto || n(precoEntrada) <= 0) return null

    setCalculando(true)
    const { data, error } = await supabase
      .rpc('calcular_preco_comercial', {
        p_cliente_id: clienteId,
        p_produto_id: produto.id,
        p_filial_id: null,
        p_preco_net: entradaPreco === 'NET' ? n(precoNet) : null,
        p_preco_final: entradaPreco === 'FINAL' ? n(precoFinal) : null,
        p_cotacao: true,
      })
      .then(
        (r) => r,
        () => ({ data: null, error: { message: 'Não foi possível calcular. Tente novamente.' } })
      )

    if (seq !== fiscalSeq.current) return null
    setCalculando(false)

    if (error) {
      setErro(error.message)
      setCalculo(null)
      return null
    }

    const result = data as CalculoFiscal
    setCalculo(result)
    if (result.automatico) {
      if (entradaPreco === 'FINAL') setPrecoNet(n(result.preco_net).toFixed(4))
      else setPrecoFinal(n(result.preco_final).toFixed(2))
    }
    return result
  }

  async function adicionarItem() {
    if (adicionandoRef.current) return
    adicionandoRef.current = true

    try {
      const result = await calcularFiscalAutomatico()
      if (!result || !produto) return

      const qtd = quantidade.trim() ? n(quantidade) : null
      if (qtd !== null && qtd <= 0) {
        setErro('Quantidade inválida.')
        return
      }

      const net = result.automatico ? n(result.preco_net) : n(precoNet)
      let final = n(result.preco_final)
      let obs: string | null = null

      if (net <= 0) {
        setErro('Informe o preço NET.')
        return
      }

      if (!result.automatico) {
        final = n(precoFinal)
        obs = observacaoPreco.trim()
        if (final <= 0) {
          setErro('Este item é fiscal MANUAL. Informe o preço final.')
          return
        }
        if (!obs) {
          setErro('Informe a observação/aprovação do preço manual.')
          return
        }
      }

      const ipi = n(result.ipi)
      const subtotal = qtd == null ? 0 : Number((final * qtd).toFixed(2))
      const valorIpi = qtd == null ? 0 : Number((subtotal * ipi).toFixed(2))

      const novo: ItemPedidoLocal = {
        idLocal: idLocal(),
        produto_id: produto.id,
        codigo: produto.codigo_protheus,
        produto: produto.nome,
        ncm: result.ncm ?? produto.ncm,
        colour_index: result.colour_index ?? produto.colour_index,
        filial_origem_id: result.filial_origem_id ?? null,
        entrada_preco: entradaPreco,
        quantidade: qtd,
        preco_net: net,
        preco_final: final,
        aliquota_icms: result.aliquota == null ? null : n(result.aliquota),
        divisor_icms: result.divisor == null ? null : n(result.divisor),
        ipi,
        valor_ipi: valorIpi,
        subtotal,
        total_item: Number((subtotal + valorIpi).toFixed(2)),
        modo_fiscal: result.automatico ? 'AUTOMATICO' : 'MANUAL',
        regra_icms: result.regra || null,
        motivo_fiscal: result.motivo || null,
        faixa_interna: faixa,
        observacao_preco: obs,
      }

      setItens((atual) => [...atual, novo])
      selecionarProdutoVazio()
      setErro('')
    } finally {
      adicionandoRef.current = false
    }
  }

  const totais = useMemo(
    () =>
      itens.reduce(
        (acc, item) => ({
          subtotal: acc.subtotal + item.subtotal,
          ipi: acc.ipi + item.valor_ipi,
          total: acc.total + item.total_item,
        }),
        { subtotal: 0, ipi: 0, total: 0 }
      ),
    [itens]
  )

  async function salvarCotacao() {
    if (salvando || envioRef.current) return

    setErro('')
    setSucesso('')
    setAvisoEmail('')

    if (!titulo.trim()) return setErro('Informe o título da cotação.')
    if (!clienteId) return setErro('Selecione o cliente.')
    if (!validade) return setErro('Informe a validade da proposta.')
    if (!prazoId) return setErro('Selecione o prazo de pagamento.')
    if (!freteId) return setErro('Selecione o tipo de frete: CIF ou FOB.')
    if (admin && clienteSelecionado?.vendedor_id == null && !vendedorIdAdmin) {
      return setErro('Selecione o vendedor.')
    }
    if (!itens.length) return setErro('Adicione pelo menos um produto.')

    envioRef.current = true
    setSalvando(true)

    const cabecalho = {
      titulo: titulo.trim(),
      cliente_id: clienteId,
      filial_id: null,
      moeda,
      prazo_pagamento_id: prazoId,
      frete_id: freteId,
      validade,
      vendedor_id: vendedorIdAdmin || null,
      observacoes: observacoes.trim() || null,
    }

    const payloadItens = itens.map((item) => ({
      produto_id: item.produto_id,
      quantidade: item.quantidade,
      preco_net: item.preco_net,
      preco_final: item.preco_final,
      entrada_preco: item.entrada_preco || 'NET',
      calculo_confirmado: {
        automatico: item.modo_fiscal === 'AUTOMATICO',
        filial_origem_id: item.filial_origem_id ?? null,
        preco_net: item.preco_net,
        preco_final: item.preco_final,
        divisor: item.divisor_icms,
      },
      preco_final_manual: item.modo_fiscal === 'MANUAL' ? item.preco_final : null,
      observacao_preco: item.observacao_preco,
      faixa_interna: item.faixa_interna,
    }))

    const { data, error } = await supabase
      .rpc('criar_cotacao_v4', {
        p_cabecalho: cabecalho,
        p_itens: payloadItens,
        p_idempotency_key: idempotencyKey,
      })
      .then(
        (r) => r,
        () => ({ data: null, error: { message: 'Falha de conexão. Tente novamente; o envio não será duplicado.' } })
      )

    if (error || !data?.id) {
      envioRef.current = false
      setSalvando(false)
      setErro(error?.message || 'A cotação não retornou identificação.')
      return
    }

    const numero = data.numero || 'Cotação'
    let emailOk = false

    try {
      const { data: registro, error: registroError } = await supabase
        .from('cotacoes')
        .select('documento')
        .eq('id', data.id)
        .single()

      if (registroError || !registro?.documento) {
        throw registroError || new Error('Documento da cotação não encontrado.')
      }

      const pdf = pdfCotacaoBase64(registro.documento as DocumentoCotacao)
      const { error: emailError } = await supabase.functions.invoke('cotacao-confirmacao', {
        body: {
          cotacao_id: data.id,
          pdf_nome: pdf.nome,
          pdf_base64: pdf.base64,
        },
      })
      if (emailError) throw emailError
      emailOk = true
    } catch (emailError) {
      console.error('Confirmação da cotação:', emailError)
      setAvisoEmail(
        'Cotação salva, porém o e-mail “Cotação Incluída” não foi enviado. O PDF continua disponível em Cotações.'
      )
    }

    setSucesso(
      emailOk
        ? `${numero} salva. Confirmação enviada ao vendedor, João e Márcia com o PDF em anexo.`
        : `${numero} salva com sucesso.`
    )

    setTitulo('')
    setValidade(dataIsoMaisDias(7))
    setClienteBusca('')
    setClienteId('')
    setPrazoBusca('')
    setPrazoId('')
    setFreteId('')
    setVendedorIdAdmin('')
    setObservacoes('')
    setItens([])
    setIdempotencyKey(crypto.randomUUID())
    selecionarProdutoVazio()

    envioRef.current = false
    setSalvando(false)
    onCotacaoCriada?.()
  }

  if (carregando) {
    return (
      <section className="page">
        <Loading texto="Preparando Nova Cotação..." />
      </section>
    )
  }

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">NOVA COTAÇÃO • {APP_ENV_LABEL}</span>
          <h1>Nova Cotação</h1>
          <p>Monte a proposta com NET e final, validade, prazo de pagamento e frete.</p>
        </div>
        <div className="status-pill"><span className="status-dot" />Validação server-side</div>
      </div>

      {erro && <div className="alert error">{erro}</div>}
      {sucesso && <div className="alert success">{sucesso}</div>}
      {avisoEmail && <div className="alert warning-box">{avisoEmail}</div>}

      <div className="form-card">
        <div className="section-title">
          <span>1</span>
          <div>
            <strong>Dados comerciais</strong>
            <small>Cliente, validade, prazo, frete, moeda e vendedor responsável.</small>
          </div>
        </div>

        <div className="form-grid">
          <div className="field field-wide">
            <label>Título da cotação *</label>
            <input
              maxLength={180}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Cotação cliente X - Setembro 2026"
            />
          </div>

          <div className="field field-wide autocomplete-wrap">
            <label>Cliente *</label>
            <input
              value={clienteBusca}
              disabled={itens.length > 0}
              onChange={(e) => {
                setClienteBusca(e.target.value)
                setClienteId('')
              }}
              placeholder={admin ? 'Pesquise qualquer cliente...' : 'Pesquise sua carteira...'}
            />
            {clienteBusca && !clienteId && (
              <div className="autocomplete">
                {clientesFiltrados.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => {
                      setClienteId(c.id)
                      setClienteBusca(`${c.codigo} — ${c.razao_social}`)
                      setVendedorIdAdmin('')
                    }}
                  >
                    <strong>{c.codigo} — {c.razao_social}</strong>
                    <span>{[c.municipio, c.uf].filter(Boolean).join(' / ')}</span>
                  </button>
                ))}
                {!clientesFiltrados.length && <div className="autocomplete-empty">Nenhum cliente disponível.</div>}
              </div>
            )}
            {clienteSelecionado && (
              <small className="field-help">
                {clienteSelecionado.codigo} • {clienteSelecionado.municipio || '—'} / {clienteSelecionado.uf || '—'}
              </small>
            )}
          </div>

          <div className="field">
            <label>Validade da proposta *</label>
            <input
              type="date"
              min={dataIsoMaisDias(0)}
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
            />
          </div>

          <div className="field autocomplete-wrap">
            <label>Prazo de pagamento *</label>
            <input
              value={prazoBusca}
              onChange={(e) => {
                setPrazoBusca(e.target.value)
                setPrazoId('')
              }}
              placeholder="Digite código ou descrição..."
            />
            {prazoBusca && !prazoId && (
              <div className="autocomplete">
                {prazosFiltrados.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => {
                      setPrazoId(p.id)
                      setPrazoBusca(p.descricao)
                    }}
                  >
                    <strong>{p.descricao}</strong>
                    {p.codigo && <span>Código {p.codigo}</span>}
                  </button>
                ))}
                {!prazosFiltrados.length && <div className="autocomplete-empty">Nenhum prazo encontrado.</div>}
              </div>
            )}
            {prazoSelecionado && <small className="field-help">Selecionado: {prazoSelecionado.descricao}</small>}
          </div>

          <div className="field">
            <label>Frete *</label>
            <select value={freteId} onChange={(e) => setFreteId(e.target.value)}>
              <option value="">Selecione CIF ou FOB</option>
              {fretes.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.descricao}
                </option>
              ))}
            </select>
            {freteSelecionado && <small className="field-help">Selecionado: {freteSelecionado.descricao}</small>}
          </div>

          <div className="field">
            <label>Moeda *</label>
            <select
              disabled={itens.length > 0}
              value={moeda}
              onChange={(e) => setMoeda(e.target.value as Moeda)}
            >
              <option value="USD">US$ — Dólar</option>
              <option value="BRL" disabled={ptax <= 0}>R$ — Real {ptax <= 0 ? '(PTAX indisponível)' : ''}</option>
            </select>
            {ptax > 0 && <small className="field-help">PTAX disponível: R$ {ptax.toFixed(4)}</small>}
          </div>

          {admin && clienteSelecionado?.vendedor_id == null && (
            <div className="field">
              <label>Vendedor *</label>
              <select value={vendedorIdAdmin} onChange={(e) => setVendedorIdAdmin(e.target.value)}>
                <option value="">Selecione</option>
                {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="form-card">
        <div className="section-title">
          <span>2</span>
          <div>
            <strong>Adicionar produto</strong>
            <small>A quantidade é opcional. O Colour Index fica visível junto ao produto.</small>
          </div>
        </div>

        <div className="product-search live-search">
          <input
            value={produtoBusca}
            onChange={(e) => {
              setProdutoBusca(e.target.value)
              if (produto && e.target.value !== produto.nome) selecionarProdutoVazio()
            }}
            placeholder="Comece a digitar nome, código ou Colour Index..."
          />
          <span className="live-search-hint">
            {produtoBusca.trim().length < 2 ? 'Digite pelo menos 2 caracteres' : 'Busca automática'}
          </span>
        </div>

        {!!resultadosProduto.length && (
          <div className="product-results">
            {resultadosProduto.map((item) => (
              <button type="button" key={item.id} onClick={() => selecionarProduto(item)}>
                <strong>{item.nome}</strong>
                <span>
                  {item.codigo_protheus || 'SEM CÓDIGO'} • NCM {item.ncm || '—'} • Colour Index {item.colour_index || 'Não informado'}
                </span>
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
                <p><b>Código:</b> {produto.codigo_protheus || 'SEM CÓDIGO'}</p>
                <p><b>NCM:</b> {produto.ncm || 'Não informado'}</p>
                <p><b>Colour Index:</b> {produto.colour_index || 'Não informado'}</p>
              </div>
              <span className={produto.status_fiscal === 'AUTOMATICO' ? 'badge success' : 'badge warning'}>
                FISCAL {produto.status_fiscal}
              </span>
            </div>

            {produto.fiscal_pendencia && <p>{produto.fiscal_pendencia}</p>}

            {preco && (
              <div className="price-options">
                {([['1', preco.faixa_1], ['2', preco.faixa_2], ['3', preco.faixa_3]] as const).map(([key, value]) => (
                  <button
                    type="button"
                    key={key}
                    className={faixa === key ? 'price-option selected' : 'price-option'}
                    onClick={() => escolherFaixa(key)}
                  >
                    <span>Preço sugerido {key}</span>
                    <strong>{money(valorFaixa(n(value)), moeda, 4)}</strong>
                  </button>
                ))}
              </div>
            )}

            <div className="form-grid compact">
              <div className="field">
                <label>Quantidade (opcional)</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  placeholder="Sem quantidade: preço unitário"
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
                    if (calculo?.automatico !== false) setPrecoFinal('')
                    setEntradaPreco('NET')
                    setPrecoNet(e.target.value)
                    setFaixa(null)
                    setCalculo(null)
                  }}
                  placeholder="0,0000"
                />
              </div>

              <div className="field">
                <label>Preço final (sem IPI) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={precoFinal}
                  onChange={(e) => {
                    fiscalSeq.current += 1
                    if (calculo?.automatico !== false) setPrecoNet('')
                    setEntradaPreco('FINAL')
                    setPrecoFinal(e.target.value)
                    setFaixa(null)
                    setCalculo(null)
                  }}
                  placeholder="0,00"
                />
                <small>Preencha NET ou final; o outro é calculado.</small>
              </div>

              <div className="field action-field">
                <label>Cálculo fiscal</label>
                <div className="auto-calc-status">
                  {calculando
                    ? 'Calculando...'
                    : calculo
                    ? calculo.automatico
                      ? 'Calculado automaticamente'
                      : 'Validação manual necessária'
                    : 'Informe NET ou final'}
                </div>
              </div>
            </div>

            {calculo && (
              <div className={calculo.automatico ? 'fiscal-result automatic' : 'fiscal-result manual'}>
                {calculo.automatico ? (
                  <>
                    <div><span>ICMS</span><strong>{(n(calculo.aliquota) * 100).toFixed(0)}%</strong></div>
                    <div><span>Preço final</span><strong>{money(n(calculo.preco_final), moeda)}</strong></div>
                    <div><span>IPI</span><strong>{(n(calculo.ipi) * 100).toFixed(2)}%</strong></div>
                  </>
                ) : (
                  <div className="manual-block">
                    <div><span className="badge warning">CÁLCULO MANUAL</span><p>{calculo.motivo || 'Validação manual necessária.'}</p></div>
                    <div className="field field-wide">
                      <label>Observação / aprovação *</label>
                      <input value={observacaoPreco} onChange={(e) => setObservacaoPreco(e.target.value)} placeholder="Ex.: aprovado por ..." />
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
              Adicionar produto à cotação
            </button>
          </div>
        )}
      </div>

      <div className="form-card">
        <div className="section-title">
          <span>3</span>
          <div>
            <strong>Itens da cotação</strong>
            <small>{itens.length} item(ns) incluído(s).</small>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Produto</th><th>Qtd.</th><th>NET</th><th>Final</th><th>ICMS</th><th>Total</th><th></th></tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.idLocal}>
                  <td>
                    <strong>{item.produto}</strong>
                    <small>{item.codigo || 'SEM CÓDIGO'} • NCM {item.ncm || 'Não informado'}</small>
                    <small>Colour Index: {item.colour_index || 'Não informado'}</small>
                  </td>
                  <td>{item.quantidade == null ? '—' : item.quantidade.toLocaleString('pt-BR')}</td>
                  <td>{money(item.preco_net, moeda, 4)}</td>
                  <td>{money(item.preco_final, moeda)}</td>
                  <td>{item.aliquota_icms == null ? 'MANUAL' : `${(item.aliquota_icms * 100).toFixed(0)}%`}</td>
                  <td>{item.quantidade == null ? '—' : money(item.total_item, moeda)}</td>
                  <td>
                    <button
                      type="button"
                      className="danger-link"
                      onClick={() => {
                        if (window.confirm('Excluir este produto?')) {
                          setItens((atual) => atual.filter((i) => i.idLocal !== item.idLocal))
                        }
                      }}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
              {!itens.length && <tr><td colSpan={7} className="empty-cell">Nenhum produto adicionado.</td></tr>}
            </tbody>
          </table>
        </div>

        {itens.length > 0 && itens.every((i) => i.quantidade != null) && (
          <div className="order-totals">
            <div><span>Subtotal</span><strong>{money(totais.subtotal, moeda)}</strong></div>
            <div><span>IPI</span><strong>{money(totais.ipi, moeda)}</strong></div>
            <div className="grand-total"><span>Total</span><strong>{money(totais.total, moeda)}</strong></div>
          </div>
        )}

        <div className="field">
          <label>Observações gerais</label>
          <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} placeholder="Opcional" />
        </div>

        <button
          type="button"
          className="primary-button submit-order"
          onClick={salvarCotacao}
          disabled={salvando || !itens.length}
        >
          {salvando ? 'Salvando e enviando...' : 'Salvar Cotação'}
        </button>
      </div>
    </section>
  )
}
