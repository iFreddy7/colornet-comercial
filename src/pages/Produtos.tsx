import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Produto, UsuarioApp } from '../types'
import { Loading } from '../components/Loading'

function money(value: number | null | undefined) {
  if (value == null) return '—'
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
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
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    carregar('')
  }, [])

  async function carregar(termo: string) {
    setCarregando(true)
    setErro('')

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
      `)
      .eq('ativo', true)
      .order('nome')
      .limit(60)

    const filtro = termo.trim()

    if (filtro) {
      const safe = filtro.replace(/[%(),]/g, ' ')
      query = query.or(
        `nome.ilike.%${safe}%,codigo_protheus.ilike.%${safe}%`
      )
    }

    const { data, error } = await query

    if (error) {
      setErro(error.message)
      setProdutos([])
    } else {
      setProdutos((data ?? []) as Produto[])
    }

    setCarregando(false)
  }

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
    carregar(busca)
  }

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">CADASTRO</span>
          <h1>Produtos</h1>
          <p>Pesquisa direta no PostgreSQL com as faixas NET vinculadas.</p>
        </div>
      </div>

      <form className="search-bar" onSubmit={pesquisar}>
        <input
          value={busca}
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
          <div className="table-headline">
            <strong>{produtos.length} produto(s)</strong>
            <span>máximo de 60 por pesquisa</span>
          </div>

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
        </div>
      )}
    </section>
  )
}
