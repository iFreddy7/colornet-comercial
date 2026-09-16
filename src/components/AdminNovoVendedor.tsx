import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function AdminNovoVendedor({ onCriado }: { onCriado: (mensagem: string) => Promise<void> }) {
  const [codigo, setCodigo] = useState('')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const emAndamento = useRef(false)

  async function cadastrar(event: FormEvent) {
    event.preventDefault()
    if (emAndamento.current) return
    setErro('')
    emAndamento.current = true
    setSalvando(true)

    try {
      const { data, error } = await supabase.rpc('admin_cadastrar_vendedor', {
        p_codigo_protheus: codigo.trim(),
        p_nome: nome.trim(),
        p_email: email.trim(),
      })

      if (error) throw error
      const vendedor = data as { nome?: string; codigo_protheus?: string } | null
      await onCriado(`Vendedor ${vendedor?.nome || nome.trim()} (${vendedor?.codigo_protheus || codigo.trim()}) cadastrado e liberado para vínculo de usuários.`)
      setCodigo('')
      setNome('')
      setEmail('')
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível cadastrar o vendedor.')
    } finally {
      emAndamento.current = false
      setSalvando(false)
    }
  }

  return (
    <div className="form-card">
      <div className="section-title">
        <span>＋</span>
        <div>
          <strong>Novo vendedor do Protheus</strong>
          <small>Use quando o vendedor está ativo no ERP, mas ainda não existe no banco do portal.</small>
        </div>
      </div>

      {erro && <div className="alert error" role="alert">{erro}</div>}

      <form onSubmit={cadastrar}>
        <fieldset disabled={salvando} className="admin-fieldset">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="vendedor-codigo">Código Protheus *</label>
              <input id="vendedor-codigo" value={codigo} onChange={e => setCodigo(e.target.value)} required maxLength={40} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="vendedor-nome">Nome *</label>
              <input id="vendedor-nome" value={nome} onChange={e => setNome(e.target.value)} required minLength={2} maxLength={120} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="vendedor-email">E-mail corporativo *</label>
              <input id="vendedor-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} placeholder="nome@colornet.com.br" autoComplete="off" />
            </div>
          </div>
          <p className="field-help">Depois do cadastro, o vendedor aparecerá tanto em “Novo usuário” quanto no vínculo de usuários existentes.</p>
          <button className="primary-button" type="submit">{salvando ? 'Cadastrando...' : 'Cadastrar vendedor'}</button>
        </fieldset>
      </form>
    </div>
  )
}
