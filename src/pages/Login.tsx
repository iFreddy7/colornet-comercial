import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'

type ModoLogin = 'login' | 'recuperar' | 'primeiro'

export function Login({ mensagemInicial = '' }: { mensagemInicial?: string }) {
  const [modo, setModo] = useState<ModoLogin>('login')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState(mensagemInicial)
  const [carregando, setCarregando] = useState(false)

  function trocarModo(novoModo: ModoLogin) {
    setModo(novoModo)
    setErro('')
    setMensagem('')
    setSenha('')
  }

  async function entrar(event: FormEvent) {
    event.preventDefault()
    setErro('')
    setMensagem('')
    setCarregando(true)

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha,
    })

    if (error) {
      setErro(
        error.message === 'Invalid login credentials'
          ? 'E-mail ou senha inválidos.'
          : error.message
      )
    }

    setCarregando(false)
  }

  async function enviarAcesso(event: FormEvent) {
    event.preventDefault()
    setErro('')
    setMensagem('')

    const emailLimpo = email.trim()

    if (!emailLimpo) {
      setErro('Informe seu e-mail.')
      return
    }

    setCarregando(true)

    const redirectTo = `${window.location.origin}${window.location.pathname}`

    const { error } = await supabase.auth.resetPasswordForEmail(emailLimpo, {
      redirectTo,
    })

    setCarregando(false)

    if (error) {
      setErro(error.message)
      return
    }

    // Não revelamos se o e-mail existe ou não.
    setMensagem(
      modo === 'primeiro'
        ? 'Se seu usuário já estiver cadastrado, você receberá um e-mail para criar sua primeira senha.'
        : 'Se esse e-mail estiver cadastrado, você receberá um link para definir uma nova senha.'
    )
  }

  const recuperacao = modo !== 'login'

  return (
    <div className="login-page">
      <div className="login-decoration decoration-one" />
      <div className="login-decoration decoration-two" />

      <form
        className="login-card login-card-expanded"
        onSubmit={recuperacao ? enviarAcesso : entrar}
      >
        <div className="login-brand">
          <div className="brand-mark large">C</div>
          <div>
            <h1>ColorNet</h1>
            <p>Portal Comercial</p>
          </div>
        </div>

        <div className="login-heading">
          <h2>
            {modo === 'login'
              ? 'Bem-vindo'
              : modo === 'primeiro'
              ? 'Primeiro acesso'
              : 'Redefinir senha'}
          </h2>
          <p>
            {modo === 'login'
              ? 'Entre com seu acesso para continuar.'
              : modo === 'primeiro'
              ? 'Informe o e-mail cadastrado pela administração. Enviaremos um link para você criar sua senha.'
              : 'Informe seu e-mail. Enviaremos um link seguro para você criar uma nova senha.'}
          </p>
        </div>

        <label>
          E-mail
          <input
            type="email"
            placeholder="voce@colornet.com.br"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>

        {!recuperacao && (
          <label>
            Senha
            <input
              type="password"
              placeholder="••••••••"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
        )}

        {erro && <div className="alert error">{erro}</div>}
        {mensagem && <div className="alert success">{mensagem}</div>}

        <button className="primary-button" disabled={carregando}>
          {carregando
            ? recuperacao
              ? 'Enviando...'
              : 'Entrando...'
            : modo === 'login'
            ? 'Entrar'
            : modo === 'primeiro'
            ? 'Enviar acesso inicial'
            : 'Enviar link de redefinição'}
        </button>

        {modo === 'login' ? (
          <div className="login-help-actions">
            <button
              type="button"
              className="login-link-button"
              onClick={() => trocarModo('recuperar')}
            >
              Esqueci minha senha
            </button>

            <span className="login-help-separator">•</span>

            <button
              type="button"
              className="login-link-button"
              onClick={() => trocarModo('primeiro')}
            >
              Primeiro acesso
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="login-back-button"
            onClick={() => trocarModo('login')}
          >
            ← Voltar para o login
          </button>
        )}

        <div className="login-security-note">
          <strong>Seu acesso é individual.</strong>
          <span>
            A redefinição de senha é feita por link enviado ao e-mail cadastrado.
          </span>
        </div>

        <p className="login-note">ColorNet Comercial • acesso seguro</p>
      </form>
    </div>
  )
}
