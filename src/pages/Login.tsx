import { FormEvent, useState } from 'react'
import { loginPersistence, supabase } from '../lib/supabase'
import { AuthLayout } from '../components/AuthLayout'
import { authErrorMessage, recoveryRedirect } from '../lib/passwordRecovery'

type ModoLogin = 'login' | 'recuperar' | 'primeiro'

export function Login({ mensagemInicial = '', recuperar = false }: { mensagemInicial?: string; recuperar?: boolean }) {
  const [modo, setModo] = useState<ModoLogin>(recuperar ? 'recuperar' : 'login')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [lembrar, setLembrar] = useState(loginPersistence.getRememberMe)
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

    try {
      loginPersistence.setRememberMe(lembrar)
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha,
      })
      if (error) setErro(error.message === 'Invalid login credentials'
        ? 'E-mail ou senha inválidos.' : error.message)
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível entrar. Tente novamente.')
    } finally { setCarregando(false) }
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

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(emailLimpo, {
        redirectTo: recoveryRedirect(window.location.href),
      })
      if (error) { setErro(authErrorMessage(error)); return }
      // Never reveal whether this account exists.
      setMensagem('Se esse e-mail estiver cadastrado neste ambiente, você receberá um link para definir sua senha. Use somente o e-mail mais recente e não compartilhe o link.')
    } catch {
      setErro('Não foi possível enviar o link. Verifique sua conexão e tente novamente.')
    } finally { setCarregando(false) }
  }

  const recuperacao = modo !== 'login'

  return (
    <AuthLayout>
      <form
        className="login-card login-card-expanded"
        onSubmit={recuperacao ? enviarAcesso : entrar}
      >
        <span className="eyebrow">SEU ESPAÇO COLORNET</span>
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

        {!recuperacao && (
          <div className="login-remember">
            <label>
              <input type="checkbox" checked={lembrar} disabled={carregando}
                onChange={(event) => setLembrar(event.target.checked)}
                aria-describedby="remember-help" />
              <span>Lembrar de mim neste dispositivo</span>
            </label>
            <p id="remember-help">Use apenas em um dispositivo de confiança.</p>
          </div>
        )}

        {erro && <div className="alert error" role="alert">{erro}</div>}
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

      </form>
    </AuthLayout>
  )
}
