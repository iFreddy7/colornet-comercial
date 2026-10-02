import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Produto, UsuarioApp } from '../types'
import { Loading } from '../components/Loading'

const TAMANHO_PAGINA = 60

function money(value: number | null | undefined) {
  if (value == null) return '—'
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function getPreco(produto: Produto) {
  if (!produto.precos) return null
  return Array.isArray(produto.precos) ? produto.precos[0] ?? null : produto.precos
}

export function Produtos({usuario}: {usuario: UsuarioApp}) {
  const [edicao, setEdicao] = useState<{id:string;nome:string;valor:string}|null>(null)
  const [salvandoCI, setSalvandoCI] = useState(false)
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('')
  const [pagina, setPagina] = useState(0)
  const [total, setTotal] = useState(0)
  const [revisao, setRevisao] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let ativo = true
    const controller = new AbortController()
    async function carregar() {
      setCarregando(true)
      setErro('')
      try {
        const inicio = pagina * TAMANHO_PAGINA

        let query = supabase
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
          `, { count: 'exact' })
          .eq('ativo', true)
          .order('nome')
          .order('id')
          .range(inicio, inicio + TAMANHO_PAGINA - 1)
          .abortSignal(controller.signal)

        if (filtro) {
          const safe = filtro.replace(/[%(),]/g, ' ')
          query = query.or(
            `nome.ilike.%${safe}%,codigo_protheus.ilike.%${safe}%`
          )
        }

        const { data, error, count } = await query
        if (!ativo) return
        if (error) throw error
        const encontrados = count ?? 0
        const ultimaPagina = Math.max(0, Math.ceil(encontrados / TAMANHO_PAGINA) - 1)
        if (pagina > ultimaPagina) {
          setPagina(ultimaPagina)
          return
        }
        setTotal(encontrados)
        setProdutos((data ?? []) as Produto[])
      } catch (error) {
        if (!ativo) return
        setErro(error instanceof Error ? error.message : 'Não foi possível carregar os produtos. Tente pesquisar novamente.')
        setProdutos([])
        setTotal(0)
      } finally {
        if (ativo) setCarregando(false)
      }
    }
    void carregar()
    return () => { ativo = false; controller.abort() }
  }, [filtro, pagina, revisao])

  async function salvarColourIndex(event: FormEvent) {
    event.preventDefault()
    if (!edicao || salvandoCI) return
    setSalvandoCI(true); setErro('')
    try {
      const {error} = await supabase.rpc('admin_definir_colour_index', {p_produto_id: edicao.id, p_colour_index: edicao.valor})
      if (error) {setErro(error.message); return}
      setProdutos(atual => atual.map(p => p.id === edicao.id ? {...p, colour_index: edicao.valor.trim() || null} : p))
      setEdicao(null)
    } catch {setErro('Não foi possível salvar o Colour Index.')} finally {setSalvandoCI(false)}
  }

  function pesquisar(event: FormEvent) {
    event.preventDefault()
    setCarregando(true)
    setPagina(0)
    setFiltro(busca.trim())
    setRevisao(atual => atual + 1)
  }

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA))
  function navegar(destino: number) {
    setCarregando(true)
    setPagina(destino)
  }
  function paginacao(posicao: string) {
    return total > TAMANHO_PAGINA && <nav className="table-headline" aria-label={`Paginação de produtos ${posicao}`} style={{ flexWrap: 'wrap', gap: 12 }}>
      <span>Página {pagina + 1} de {totalPaginas}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="secondary-button" disabled={carregando || pagina === 0} onClick={() => navegar(0)}>Primeira</button>
        <button type="button" className="secondary-button" disabled={carregando || pagina === 0} onClick={() => navegar(pagina - 1)}>Anterior</button>
        <button type="button" className="secondary-button" disabled={carregando || pagina >= totalPaginas - 1} onClick={() => navegar(pagina + 1)}>Próxima</button>
        <button type="button" className="secondary-button" disabled={carregando || pagina >= totalPaginas - 1} onClick={() => navegar(totalPaginas - 1)}>Última</button>
      </div>
    </nav>
  }

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">CADASTRO</span>
          <h1>Produtos</h1>
          <p>Consulte o catálogo completo e as faixas de preço por nome ou código.</p>
        </div>
      </div>

      <form className="search-bar" onSubmit={pesquisar}>
        <input
          value={busca}
          aria-label="Nome ou código do produto"
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Digite nome ou código do produto..."
        />
        <button className="primary-button">Pesquisar</button>
      </form>

      {erro && <div className="alert error">{erro}</div>}
      {edicao && usuario.perfil === 'ADMIN' && <form className="form-card" onSubmit={salvarColourIndex}>
        <div className="field"><label>Colour Index - {edicao.nome}</label><input maxLength={200} value={edicao.valor} onChange={e => setEdicao({...edicao,valor:e.target.value})} placeholder="Informe conforme cadastro técnico do produto" /></div>
        <button className="primary-button" disabled={salvandoCI}>Salvar Colour Index</button>{' '}
        <button type="button" className="secondary-button" disabled={salvandoCI} onClick={()=>setEdicao(null)}>Cancelar</button>
      </form>}

      {carregando ? (
        <Loading texto="Buscando produtos..." />
      ) : (
        <div className="table-card">
          <div className="table-headline" role="status" style={{ flexWrap: 'wrap', gap: 8 }}>
            <strong>{total.toLocaleString('pt-BR')} produto(s) encontrado(s)</strong>
            <span>{total > 0 ? `Exibindo ${pagina * TAMANHO_PAGINA + 1} a ${pagina * TAMANHO_PAGINA + produtos.length} de ${total.toLocaleString('pt-BR')}` : 'Nenhum resultado'}</span>
          </div>
          {paginacao('acima da tabela')}

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Código</th>
                  <th>Fiscal</th>
                  <th>Faixa 1</th>
                  <th>Faixa 2</th>
                  <th>Faixa 3</th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((produto) => {
                  const preco = getPreco(produto)

                  return (
                    <tr key={produto.id}>
                      <td>
                        <strong>{produto.nome}</strong>
                        <small>
                          {produto.ncm ? `NCM ${produto.ncm}` : 'NCM não informado'}
                        </small>
                        {produto.colour_index && <small>Colour Index: {produto.colour_index}</small>}
                        {usuario.perfil === 'ADMIN' && <button className="secondary-button" onClick={()=>setEdicao({id:produto.id,nome:produto.nome,valor:produto.colour_index || ''})}>Editar Colour Index</button>}
                      </td>
                      <td>{produto.codigo_protheus || 'SEM CÓDIGO'}</td>
                      <td>
                        <span
                          className={
                            produto.status_fiscal === 'AUTOMATICO'
                              ? 'badge success'
                              : 'badge warning'
                          }
                        >
                          {produto.status_fiscal}
                        </span>
                        {produto.fiscal_pendencia && (
                          <small>{produto.fiscal_pendencia}</small>
                        )}
                      </td>
                      <td>{preco ? `US$ ${money(preco.faixa_1)}` : '—'}</td>
                      <td>{preco ? `US$ ${money(preco.faixa_2)}` : '—'}</td>
                      <td>{preco ? `US$ ${money(preco.faixa_3)}` : '—'}</td>
                    </tr>
                  )
                })}

                {!produtos.length && (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {paginacao('abaixo da tabela')}
        </div>
      )}
    </section>
  )
}
