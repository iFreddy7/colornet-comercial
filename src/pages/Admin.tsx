import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AdminUsuario, Filial, IntegracaoExecucao, UsuarioApp } from '../types'
import { Loading } from '../components/Loading'
import { AdminNovoUsuario } from '../components/AdminNovoUsuario'
import { AdminNovoVendedor } from '../components/AdminNovoVendedor'
import { AdminExportacao } from '../components/AdminExportacao'
import { dataHoraBrasilia } from '../lib/dataHora'

type Vendedor = { id: string; codigo_protheus: string | null; nome: string; email: string | null; ativo: boolean }

function rel<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

const dataHora = dataHoraBrasilia

export function Admin({ usuario }: { usuario: UsuarioApp }) {
  const [usuarios, setUsuarios] = useState<AdminUsuario[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [filiais, setFiliais] = useState<Filial[]>([])
  const [integracoes, setIntegracoes] = useState<IntegracaoExecucao[]>([])
  const [clientesSemVendedor, setClientesSemVendedor] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [salvandoId, setSalvandoId] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [gerandoLinkId, setGerandoLinkId] = useState<string | null>(null)
  const [linkSenha, setLinkSenha] = useState<{ nome: string; email: string; link: string } | null>(null)

  useEffect(() => { if (usuario.perfil === 'ADMIN' && usuario.ativo) carregar() }, [usuario.id, usuario.perfil, usuario.ativo])

  async function carregar() {
    setCarregando(true)
    setErro('')

    const [u, v, i, c, f] = await Promise.all([
      supabase.from('usuarios').select(`id,nome,email,perfil,vendedor_id,ativo,vendedores(nome,codigo_protheus)`).order('nome'),
      supabase.from('vendedores').select('id,codigo_protheus,nome,email,ativo').order('nome'),
      supabase.from('integracao_execucoes').select('*').order('criado_em', { ascending: false }).limit(30),
      supabase.rpc('admin_clientes_sem_vendedor'),
      supabase.from('filiais').select('id,codigo,nome,uf').order('nome'),
    ])

    const firstError = u.error || v.error || i.error || c.error || f.error
    if (firstError) setErro(firstError.message)

    setUsuarios((u.data ?? []) as AdminUsuario[])
    setVendedores((v.data ?? []) as Vendedor[])
    setFiliais((f.data ?? []) as Filial[])
    setIntegracoes((i.data ?? []) as IntegracaoExecucao[])
    setClientesSemVendedor(Number(c.data ?? 0))
    setCarregando(false)
  }

  function alterarLocal(id: string, patch: Partial<AdminUsuario>) {
    setUsuarios((atuais) => atuais.map((u) => u.id === id ? { ...u, ...patch } : u))
  }

  async function salvarUsuario(alvo: AdminUsuario) {
    setSalvandoId(alvo.id)
    setErro('')
    setMensagem('')

    const { error } = await supabase.rpc('admin_atualizar_usuario', {
      p_usuario_id: alvo.id,
      p_perfil: alvo.perfil,
      p_vendedor_id: alvo.vendedor_id || null,
      p_ativo: alvo.ativo,
    })

    setSalvandoId(null)
    if (error) { setErro(error.message); return }
    setMensagem(`Acesso de ${alvo.nome || alvo.email} atualizado.`)
    await carregar()
  }

  async function gerarLinkSenha(alvo: AdminUsuario) {
    if (!alvo.email) return
    setErro('')
    setMensagem('')
    setLinkSenha(null)
    setGerandoLinkId(alvo.id)

    const { data, error } = await supabase.functions.invoke('admin-gerar-link-senha', {
      body: { usuario_id: alvo.id },
    })

    setGerandoLinkId(null)

    if (error) {
      setErro('Não foi possível gerar o link. Confirme se o usuário existe no Auth da homologação.')
      return
    }

    if (!data?.link) {
      setErro(data?.erro || 'O Supabase não retornou o link de redefinição.')
      return
    }

    setLinkSenha({
      nome: data.nome || alvo.nome || 'Usuário',
      email: data.email || alvo.email,
      link: data.link,
    })
    setMensagem(`Link temporário gerado para ${data.email || alvo.email}.`)
  }

  async function copiarLinkSenha() {
    if (!linkSenha?.link) return
    try {
      await navigator.clipboard.writeText(linkSenha.link)
      setMensagem('Link copiado. Envie somente ao usuário correto.')
    } catch {
      setErro('Não foi possível copiar automaticamente. Selecione o link e copie manualmente.')
    }
  }

  const stats = useMemo(() => ({
    ativos: usuarios.filter((u) => u.ativo).length,
    admins: usuarios.filter((u) => u.ativo && u.perfil === 'ADMIN').length,
    vendedoresSemVinculo: usuarios.filter((u) => u.ativo && u.perfil === 'VENDEDOR' && !u.vendedor_id).length,
  }), [usuarios])

  if (usuario.perfil !== 'ADMIN' || !usuario.ativo) return <div className="alert error">Acesso restrito a ADMIN ativo.</div>
  if (carregando) return <section className="page"><Loading texto="Carregando administração..." /></section>

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO • HOMOLOGAÇÃO</span>
          <h1>Painel ADMIN</h1>
          <p>Cadastro de usuários, vendedores, vínculos, relatórios e acompanhamento das integrações.</p>
        </div>
        <button className="secondary-button" onClick={carregar}>Atualizar</button>
      </div>

      {erro && <div className="alert error">{erro}</div>}
      {mensagem && <div className="alert success">{mensagem}</div>}
      {linkSenha && (
        <div className="form-card password-link-card">
          <div className="section-title">
            <span>🔑</span>
            <div>
              <strong>Link temporário de redefinição</strong>
              <small>{linkSenha.nome} • {linkSenha.email}</small>
            </div>
          </div>
          <div className="password-link-warning">
            Este link permite trocar a senha da conta. Compartilhe somente com o usuário correto e evite deixá-lo salvo em conversas públicas.
          </div>
          <div className="password-link-row">
            <input value={linkSenha.link} readOnly aria-label="Link temporário de redefinição de senha" />
            <button className="primary-button" onClick={copiarLinkSenha}>Copiar link</button>
            <button className="secondary-button" onClick={() => setLinkSenha(null)}>Fechar</button>
          </div>
        </div>
      )}

      <div className="admin-stats">
        <div className="stat-card"><span>Usuários ativos</span><strong>{stats.ativos}</strong></div>
        <div className="stat-card"><span>ADMINs</span><strong>{stats.admins}</strong></div>
        <div className="stat-card"><span>Vendedores sem vínculo</span><strong>{stats.vendedoresSemVinculo}</strong></div>
        <div className="stat-card"><span>Clientes sem vendedor</span><strong>{clientesSemVendedor}</strong></div>
      </div>

      <AdminNovoVendedor onCriado={async (texto) => { setMensagem(texto); await carregar() }} />
      <AdminNovoUsuario vendedores={vendedores} onCriado={async (texto) => { setMensagem(texto); await carregar() }} />
      <AdminExportacao vendedores={vendedores} filiais={filiais} />

      <div className="form-card">
        <div className="section-title"><span>1</span><div><strong>Usuários</strong><small>Perfil, vendedor e ativação sem SQL manual.</small></div></div>
        <div className="table-scroll">
          <table className="admin-users-table">
            <thead><tr><th>Usuário</th><th>Perfil</th><th>Vendedor vinculado</th><th>Ativo</th><th>Ações</th></tr></thead>
            <tbody>
              {usuarios.map((item) => {
                const vend = rel(item.vendedores)
                return (
                  <tr key={item.id}>
                    <td><strong>{item.nome || 'Sem nome'}</strong><small>{item.email || '—'}</small></td>
                    <td>
                      <select value={item.perfil} onChange={(e) => alterarLocal(item.id, { perfil: e.target.value as AdminUsuario['perfil'] })}>
                        <option value="VENDEDOR">VENDEDOR</option><option value="GERENTE">GERENTE</option><option value="ADMIN">ADMIN</option>
                      </select>
                    </td>
                    <td>
                      <select value={item.vendedor_id || ''} onChange={(e) => alterarLocal(item.id, { vendedor_id: e.target.value || null })}>
                        <option value="">Sem vínculo</option>
                        {vendedores.filter(v => v.ativo || v.id === item.vendedor_id).map((v) => <option key={v.id} value={v.id}>{v.nome}{v.codigo_protheus ? ` • ${v.codigo_protheus}` : ''}{v.ativo ? '' : ' (inativo)'}</option>)}
                      </select>
                      {vend && <small>Atual: {vend.nome}</small>}
                    </td>
                    <td><label className="switch-line"><input type="checkbox" checked={item.ativo} onChange={(e) => alterarLocal(item.id, { ativo: e.target.checked })}/><span>{item.ativo ? 'Sim' : 'Não'}</span></label></td>
                    <td><div className="admin-actions"><button className="primary-button compact-button" disabled={salvandoId === item.id} onClick={() => salvarUsuario(item)}>{salvandoId === item.id ? 'Salvando...' : 'Salvar'}</button><button className="secondary-button compact-button" disabled={gerandoLinkId === item.id} onClick={() => gerarLinkSenha(item)}>{gerandoLinkId === item.id ? 'Gerando...' : 'Gerar link de senha'}</button></div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="form-card">
        <div className="section-title"><span>2</span><div><strong>Integrações por e-mail</strong><small>Últimas leituras de estoque, preços e previsão.</small></div></div>
        <div className="integration-legend"><span className="badge neutral">DRY RUN = não altera dados</span><span className="badge success">APLICADO = atualizou os dados</span></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Data</th><th>Tipo</th><th>Arquivo</th><th>Modo</th><th>Status</th><th>Linhas</th><th>Pendências</th></tr></thead>
            <tbody>
              {integracoes.map((item) => <tr key={item.id}><td>{dataHora(item.criado_em)}</td><td><strong>{item.tipo}</strong><small>{item.remetente || '—'}</small></td><td>{item.arquivo || item.assunto || '—'}</td><td>{item.modo}</td><td><span className={item.status.includes('OK') || item.status === 'APLICADO' ? 'badge success' : item.status === 'ERRO' ? 'badge warning' : 'badge neutral'}>{item.status}</span></td><td>{item.linhas_aplicadas}/{item.linhas_total}</td><td>{item.pendencias}</td></tr>)}
              {!integracoes.length && <tr><td colSpan={7} className="empty-cell">Nenhum teste de integração recebido ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
