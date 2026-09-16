import { useRef, useState, type FormEvent } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Perfil } from '../types'

export type VendedorAdmin = { id: string; nome: string; codigo_protheus: string | null; ativo: boolean }

export function AdminNovoUsuario({ vendedores, onCriado }: { vendedores: VendedorAdmin[]; onCriado: (mensagem: string) => Promise<void> }) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [perfil, setPerfil] = useState<Perfil>('VENDEDOR')
  const [vendedorId, setVendedorId] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const emAndamento = useRef(false)

  async function criar(event: FormEvent) {
    event.preventDefault()
    if (emAndamento.current) return
    setErro('')
    if (senha !== confirmacao) { setErro('As senhas não coincidem.'); return }
    emAndamento.current = true
    setSalvando(true)
    try {
      const { data, error } = await supabase.functions.invoke('admin-criar-usuario', {
        body: { nome: nome.trim(), email: email.trim(), senha, perfil, vendedor_id: vendedorId || null },
      })
      if (error) {
        let mensagem = 'Não foi possível criar o usuário. Confira sua conexão e tente novamente.'
        if (error instanceof FunctionsHttpError) {
          try { const body = await error.context.json(); if (body.erro) mensagem = String(body.erro) } catch { /* mensagem padrão */ }
        }
        throw new Error(mensagem)
      }
      if (!data?.sucesso) throw new Error('O cadastro não foi confirmado. Atualize a lista antes de tentar novamente.')
      setSenha(''); setConfirmacao('')
      await onCriado(`Conta de ${data.nome} criada (${data.email}). O usuário já pode entrar com a senha inicial; nenhum e-mail foi enviado automaticamente.`)
      setNome(''); setEmail(''); setPerfil('VENDEDOR'); setVendedorId('')
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha no cadastro.') }
    finally { emAndamento.current = false; setSalvando(false) }
  }

  return <div className="form-card">
    <div className="section-title"><span>＋</span><div><strong>Novo usuário</strong><small>Crie a conta e defina o acesso ao portal.</small></div></div>
    {erro && <div className="alert error" role="alert">{erro}</div>}
    <form onSubmit={criar}>
      <fieldset disabled={salvando} className="admin-fieldset">
        <div className="form-grid">
          <div className="field"><label htmlFor="novo-nome">Nome *</label><input id="novo-nome" value={nome} onChange={e => setNome(e.target.value)} required minLength={2} maxLength={120} autoComplete="off" /></div>
          <div className="field"><label htmlFor="novo-email">E-mail *</label><input id="novo-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} autoComplete="off" /></div>
          <div className="field"><label htmlFor="novo-perfil">Perfil *</label><select id="novo-perfil" value={perfil} onChange={e => setPerfil(e.target.value as Perfil)}><option value="VENDEDOR">VENDEDOR</option><option value="GERENTE">GERENTE</option><option value="ADMIN">ADMIN</option></select></div>
          <div className="field"><label htmlFor="novo-vendedor">Vendedor vinculado {perfil === 'VENDEDOR' ? '*' : '(opcional)'}</label><select id="novo-vendedor" required={perfil === 'VENDEDOR'} value={vendedorId} onChange={e => setVendedorId(e.target.value)}><option value="">Selecione</option>{vendedores.filter(v => v.ativo).map(v => <option key={v.id} value={v.id}>{v.nome}{v.codigo_protheus ? ` • ${v.codigo_protheus}` : ''}</option>)}</select><small>Esse vínculo determina a carteira de clientes disponível.</small></div>
          <div className="field"><label htmlFor="nova-senha">Senha inicial *</label><input id="nova-senha" type="password" value={senha} onChange={e => setSenha(e.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" /><small>Mínimo de 12 caracteres. Informe a senha ao titular da conta.</small></div>
          <div className="field"><label htmlFor="nova-confirmacao">Confirmar senha *</label><input id="nova-confirmacao" type="password" value={confirmacao} onChange={e => setConfirmacao(e.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" /></div>
        </div>
        <p className="field-help">O usuário pode definir outra senha pela opção “Esqueci minha senha” na tela de login.</p>
        <button className="primary-button" type="submit">{salvando ? 'Criando conta...' : 'Criar usuário'}</button>
      </fieldset>
    </form>
  </div>
}
