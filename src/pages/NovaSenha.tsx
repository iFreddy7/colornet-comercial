import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'
import { APP_ENV_LABEL, IS_PRODUCTION } from '../lib/env'

export function NovaSenha({ onConcluido }: { onConcluido: () => void }) {
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function salvar(event: FormEvent) {
    event.preventDefault()
    setErro('')

    if (senha.length < 8) {
      setErro('A nova senha precisa ter pelo menos 8 caracteres.')
      return
    }

    if (senha !== confirmacao) {
      setErro('As senhas não coincidem.')
      return
    }

    setCarregando(true)

    const { error } = await supabase.auth.updateUser({
      password: senha,
    })

    if (error) {
      setCarregando(false)
      setErro(error.message)
      return
    }

    await supabase.auth.signOut()
    setCarregando(false)
    onConcluido()
  }

  return (
    <div className="login-page">
      <div className="login-decoration decoration-one" />
      <div className="login-decoration decoration-two" />

      <form className="login-card login-card-expanded" onSubmit={salvar}>
        <div className="login-env-line"><span className={IS_PRODUCTION ? 'env-chip prod' : 'env-chip'}>{APP_ENV_LABEL}</span></div>
        <div className="login-brand">
          <div className="brand-mark large">C</div>
          <div>
            <h1>ColorNet</h1>
            <p>Portal Comercial</p>
          </div>
        </div>

        <div className="login-heading">
          <h2>Crie sua nova senha</h2>
          <p>
            Defina uma senha nova para concluir o acesso à sua conta.
          </p>
        </div>

        <label>
          Nova senha
          <input
            type="password"
            placeholder="Mínimo de 8 caracteres"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>

        <label>
          Confirmar nova senha
          <input
            type="password"
            placeholder="Digite novamente"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>

        <div className="password-requirements">
          <span className={senha.length >= 8 ? 'ok' : ''}>
            {senha.length >= 8 ? '✓' : '○'} Pelo menos 8 caracteres
          </span>
          <span className={senha && senha === confirmacao ? 'ok' : ''}>
            {senha && senha === confirmacao ? '✓' : '○'} As duas senhas devem ser iguais
          </span>
        </div>

        {erro && <div className="alert error">{erro}</div>}

        <button className="primary-button" disabled={carregando}>
          {carregando ? 'Salvando...' : 'Salvar nova senha'}
        </button>

        <p className="login-note">
          Após salvar, entre novamente usando a nova senha.
        </p>
      </form>
    </div>
  )
}
