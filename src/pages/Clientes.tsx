import { temVisaoComercial } from '../lib/permissoes'
import { Fragment, FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Cliente, ClienteContato, UsuarioApp } from '../types'
import { Loading } from '../components/Loading'

const contatoVazio = {
  nome: '',
  cargo: '',
  email: '',
  telefone: '',
  celular: '',
  observacoes: '',
  principal: false,
}

export function Clientes({ usuario }: { usuario: UsuarioApp }) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [busca, setBusca] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const [clienteAberto, setClienteAberto] = useState<Cliente | null>(null)
  const [contatos, setContatos] = useState<ClienteContato[]>([])
  const [carregandoContatos, setCarregandoContatos] = useState(false)

  const [formContato, setFormContato] = useState(contatoVazio)
  const [contatoEditandoId, setContatoEditandoId] = useState<string | null>(null)
  const [salvandoContato, setSalvandoContato] = useState(false)

  const admin = usuario.perfil === 'ADMIN'
  const visaoComercial = temVisaoComercial(usuario)

  useEffect(() => {
    carregar('')
  }, [])

  async function carregar(termo: string) {
    setCarregando(true)
    setErro('')

    let query = supabase
      .from('clientes')
      .select(`
        id,
        codigo,
        loja,
        razao_social,
        nome_fantasia,
        cnpj_cpf,
        inscricao_estadual,
        municipio,
        uf,
        email,
        contato,
        telefone,
        endereco,
        numero,
        complemento,
        bairro,
        cep,
        calculo_automatico,
        vendedor_id,
        ativo
      `)
      .eq('ativo', true)
      .order('razao_social')
      .limit(80)

    const filtro = termo.trim()

    if (filtro) {
      const safe = filtro.replace(/[%(),]/g, ' ')
      query = query.or(
        `razao_social.ilike.%${safe}%,nome_fantasia.ilike.%${safe}%,codigo.ilike.%${safe}%,cnpj_cpf.ilike.%${safe}%`
      )
    }

    const { data, error } = await query

    if (error) {
      setErro(error.message)
      setClientes([])
    } else {
      setClientes((data ?? []) as Cliente[])
    }

    setCarregando(false)
  }

  function pesquisar(event: FormEvent) {
    event.preventDefault()
    carregar(busca)
  }

  async function abrirCliente(cliente: Cliente) {
    setClienteAberto(cliente)
    setErro('')
    setFormContato(contatoVazio)
    setContatoEditandoId(null)
    await carregarContatos(cliente.id)
  }

  async function carregarContatos(clienteId: string) {
    setCarregandoContatos(true)

    const { data, error } = await supabase
      .from('cliente_contatos')
      .select(`
        id,
        cliente_id,
        nome,
        cargo,
        email,
        telefone,
        celular,
        observacoes,
        principal,
        ativo
      `)
      .eq('cliente_id', clienteId)
      .eq('ativo', true)
      .order('principal', { ascending: false })
      .order('nome')

    if (error) {
      setErro(error.message)
      setContatos([])
    } else {
      setContatos((data ?? []) as ClienteContato[])
    }

    setCarregandoContatos(false)
  }

  function editarContato(contato: ClienteContato) {
    setContatoEditandoId(contato.id)
    setFormContato({
      nome: contato.nome || '',
      cargo: contato.cargo || '',
      email: contato.email || '',
      telefone: contato.telefone || '',
      celular: contato.celular || '',
      observacoes: contato.observacoes || '',
      principal: contato.principal,
    })
  }

  function cancelarContato() {
    setContatoEditandoId(null)
    setFormContato(contatoVazio)
  }

  async function salvarContato(event: FormEvent) {
    event.preventDefault()

    if (!clienteAberto) return

    if (!formContato.nome.trim()) {
      setErro('Informe o nome do contato.')
      return
    }

    setSalvandoContato(true)
    setErro('')

    const payload = {
      cliente_id: clienteAberto.id,
      nome: formContato.nome.trim(),
      cargo: formContato.cargo.trim() || null,
      email: formContato.email.trim() || null,
      telefone: formContato.telefone.trim() || null,
      celular: formContato.celular.trim() || null,
      observacoes: formContato.observacoes.trim() || null,
      principal: formContato.principal,
      ativo: true,
    }

    const resposta = contatoEditandoId
      ? await supabase
          .from('cliente_contatos')
          .update(payload)
          .eq('id', contatoEditandoId)
      : await supabase
          .from('cliente_contatos')
          .insert(payload)

    setSalvandoContato(false)

    if (resposta.error) {
      setErro(resposta.error.message)
      return
    }

    cancelarContato()
    await carregarContatos(clienteAberto.id)
  }

  async function excluirContato(contato: ClienteContato) {
    if (!window.confirm(`Excluir o contato "${contato.nome}"?`)) return

    const { error } = await supabase
      .from('cliente_contatos')
      .delete()
      .eq('id', contato.id)

    if (error) {
      setErro(error.message)
      return
    }

    if (clienteAberto) {
      await carregarContatos(clienteAberto.id)
    }
  }

  function enderecoCompleto(cliente: Cliente) {
    const linha1 = [
      cliente.endereco,
      cliente.numero,
      cliente.complemento,
    ].filter(Boolean).join(', ')

    const linha2 = [
      cliente.bairro,
      cliente.municipio,
      cliente.uf,
      cliente.cep,
    ].filter(Boolean).join(' • ')

    return [linha1, linha2].filter(Boolean)
  }

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">{admin ? 'ADMINISTRAÇÃO' : 'CARTEIRA COMERCIAL'}</span>
          <h1>{visaoComercial ? 'Todos os clientes' : 'Minha carteira'}</h1>
          <p>
            {visaoComercial
              ? 'Consulte os dados e contatos de todos os clientes.'
              : 'Você vê os dados completos dos clientes da sua carteira e pode manter a agenda de contatos.'}
          </p>
        </div>

        <div className="status-pill">
          <span className="status-dot" />
          RLS ativo
        </div>
      </div>

      <form className="search-bar" onSubmit={pesquisar}>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Código, CNPJ, razão social ou nome fantasia..."
        />
        <button className="primary-button">Pesquisar</button>
      </form>

      {erro && <div className="alert error">{erro}</div>}

      {carregando ? (
        <Loading texto="Buscando clientes..." />
      ) : (
        <div className="table-card">
          <div className="table-headline">
            <strong>{clientes.length} cliente(s) nesta consulta</strong>
            <span>Clique em um cliente para abrir os dados completos</span>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Código</th>
                  <th>CNPJ</th>
                  <th>Cidade / UF</th>
                  <th>Contato principal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((cliente) => {
                  const expandido = clienteAberto?.id === cliente.id
                  const podeEditarContatos = admin || Boolean(usuario.vendedor_id && cliente.vendedor_id === usuario.vendedor_id)

                  return (
                    <Fragment key={cliente.id}>
                      <tr className={expandido ? 'client-row expanded' : 'client-row'}>
                        <td>
                          <strong>{cliente.razao_social}</strong>
                          <small>{cliente.nome_fantasia || '—'}</small>
                        </td>
                        <td>
                          {cliente.codigo}
                          {cliente.loja ? ` / ${cliente.loja}` : ''}
                        </td>
                        <td>{cliente.cnpj_cpf || '—'}</td>
                        <td>
                          {[cliente.municipio, cliente.uf].filter(Boolean).join(' / ') || '—'}
                        </td>
                        <td>
                          <strong>{cliente.contato || '—'}</strong>
                          <small>{cliente.telefone || cliente.email || '—'}</small>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="secondary-button compact-button"
                            onClick={() =>
                              expandido
                                ? setClienteAberto(null)
                                : abrirCliente(cliente)
                            }
                          >
                            {expandido ? 'Fechar' : 'Abrir'}
                          </button>
                        </td>
                      </tr>

                      {expandido && (
                        <tr className="client-inline-row">
                          <td colSpan={6} className="client-inline-cell">
                            <div className="client-detail inline">
                              <div className="client-detail-header">
                                <div>
                                  <span className="eyebrow">CADASTRO DO CLIENTE</span>
                                  <h2>{clienteAberto.razao_social}</h2>
                                  <p>{clienteAberto.nome_fantasia || 'Sem nome fantasia'}</p>
                                </div>
                              </div>

                              <div className="client-info-grid">
                                <div>
                                  <span>Código</span>
                                  <strong>
                                    {clienteAberto.codigo}
                                    {clienteAberto.loja ? ` / ${clienteAberto.loja}` : ''}
                                  </strong>
                                </div>

                                <div>
                                  <span>CNPJ / CPF</span>
                                  <strong>{clienteAberto.cnpj_cpf || 'Não informado'}</strong>
                                </div>

                                <div>
                                  <span>Inscrição Estadual</span>
                                  <strong>{clienteAberto.inscricao_estadual || 'Não informada'}</strong>
                                </div>

                                <div>
                                  <span>Cálculo fiscal</span>
                                  <strong>
                                    {clienteAberto.calculo_automatico ? 'AUTOMÁTICO' : 'MANUAL'}
                                  </strong>
                                </div>

                                <div className="client-info-wide">
                                  <span>Endereço</span>
                                  {enderecoCompleto(clienteAberto).length ? (
                                    enderecoCompleto(clienteAberto).map((linha) => (
                                      <strong key={linha}>{linha}</strong>
                                    ))
                                  ) : (
                                    <strong>
                                      {[clienteAberto.municipio, clienteAberto.uf]
                                        .filter(Boolean)
                                        .join(' / ') || 'Endereço ainda não importado'}
                                    </strong>
                                  )}
                                </div>

                                <div>
                                  <span>Contato do cadastro</span>
                                  <strong>{clienteAberto.contato || 'Não informado'}</strong>
                                </div>

                                <div>
                                  <span>Telefone</span>
                                  <strong>{clienteAberto.telefone || 'Não informado'}</strong>
                                </div>

                                <div>
                                  <span>E-mail</span>
                                  <strong>{clienteAberto.email || 'Não informado'}</strong>
                                </div>
                              </div>

                              <div className="contacts-section">
                                <div className="section-title">
                                  <span>+</span>
                                  <div>
                                    <strong>Contatos comerciais</strong>
                                    <small>
                                      Vendedores podem manter esta agenda para os clientes
                                      permitidos pelo RLS.
                                    </small>
                                  </div>
                                </div>

                                {carregandoContatos ? (
                                  <Loading texto="Carregando contatos..." />
                                ) : (
                                  <div className="contacts-grid">
                                    <div className="contacts-list">
                                      {contatos.map((contato) => (
                                        <article className="contact-card" key={contato.id}>
                                          <div>
                                            <div className="contact-title">
                                              <strong>{contato.nome}</strong>
                                              {contato.principal && (
                                                <span className="badge success">PRINCIPAL</span>
                                              )}
                                            </div>
                                            <span>{contato.cargo || 'Cargo não informado'}</span>
                                          </div>

                                          <div className="contact-lines">
                                            <span>{contato.email || 'Sem e-mail'}</span>
                                            <span>
                                              {contato.celular ||
                                                contato.telefone ||
                                                'Sem telefone'}
                                            </span>
                                            {contato.observacoes && (
                                              <span>{contato.observacoes}</span>
                                            )}
                                          </div>

                                          {podeEditarContatos && <div className="contact-actions">
                                            <button
                                              type="button"
                                              className="secondary-button compact-button"
                                              onClick={() => editarContato(contato)}
                                            >
                                              Editar
                                            </button>
                                            <button
                                              type="button"
                                              className="danger-link"
                                              onClick={() => excluirContato(contato)}
                                            >
                                              Excluir
                                            </button>
                                          </div>}
                                        </article>
                                      ))}

                                      {!contatos.length && (
                                        <div className="empty-panel">
                                          Nenhum contato cadastrado ainda.
                                        </div>
                                      )}
                                    </div>

                                    {podeEditarContatos && <form className="contact-form" onSubmit={salvarContato}>
                                      <h3>
                                        {contatoEditandoId
                                          ? 'Editar contato'
                                          : 'Novo contato'}
                                      </h3>

                                      <label>
                                        Nome *
                                        <input
                                          value={formContato.nome}
                                          onChange={(e) =>
                                            setFormContato((v) => ({
                                              ...v,
                                              nome: e.target.value,
                                            }))
                                          }
                                          required
                                        />
                                      </label>

                                      <label>
                                        Cargo
                                        <input
                                          value={formContato.cargo}
                                          onChange={(e) =>
                                            setFormContato((v) => ({
                                              ...v,
                                              cargo: e.target.value,
                                            }))
                                          }
                                        />
                                      </label>

                                      <label>
                                        E-mail
                                        <input
                                          type="email"
                                          value={formContato.email}
                                          onChange={(e) =>
                                            setFormContato((v) => ({
                                              ...v,
                                              email: e.target.value,
                                            }))
                                          }
                                        />
                                      </label>

                                      <div className="contact-form-two">
                                        <label>
                                          Telefone
                                          <input
                                            value={formContato.telefone}
                                            onChange={(e) =>
                                              setFormContato((v) => ({
                                                ...v,
                                                telefone: e.target.value,
                                              }))
                                            }
                                          />
                                        </label>

                                        <label>
                                          Celular
                                          <input
                                            value={formContato.celular}
                                            onChange={(e) =>
                                              setFormContato((v) => ({
                                                ...v,
                                                celular: e.target.value,
                                              }))
                                            }
                                          />
                                        </label>
                                      </div>

                                      <label>
                                        Observações
                                        <textarea
                                          rows={3}
                                          value={formContato.observacoes}
                                          onChange={(e) =>
                                            setFormContato((v) => ({
                                              ...v,
                                              observacoes: e.target.value,
                                            }))
                                          }
                                        />
                                      </label>

                                      <label className="checkbox-line">
                                        <input
                                          type="checkbox"
                                          checked={formContato.principal}
                                          onChange={(e) =>
                                            setFormContato((v) => ({
                                              ...v,
                                              principal: e.target.checked,
                                            }))
                                          }
                                        />
                                        Contato principal
                                      </label>

                                      <div className="contact-form-actions">
                                        {contatoEditandoId && (
                                          <button
                                            type="button"
                                            className="secondary-button"
                                            onClick={cancelarContato}
                                          >
                                            Cancelar
                                          </button>
                                        )}

                                        <button
                                          className="primary-button"
                                          disabled={salvandoContato}
                                        >
                                          {salvandoContato
                                            ? 'Salvando...'
                                            : contatoEditandoId
                                            ? 'Salvar alterações'
                                            : 'Adicionar contato'}
                                        </button>
                                      </div>
                                    </form>}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}

                {!clientes.length && (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      {visaoComercial
                        ? 'Nenhum cliente encontrado.'
                        : 'Nenhum cliente da sua carteira foi encontrado.'}
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
