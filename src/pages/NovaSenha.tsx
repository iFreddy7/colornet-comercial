import { FormEvent, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { APP_ENV_LABEL, IS_PRODUCTION } from '../lib/env'
import { authErrorMessage, INVALID_RECOVERY } from '../lib/passwordRecovery'
import { cleanRecoveryUrl, clearRecovery, recoveryLink, recoveryMarker, rememberRecovery } from '../lib/recoveryContext'
import { createRecoveryResolver } from '../lib/recoverySession'

const resolveRecovery = createRecoveryResolver(supabase.auth, recoveryLink, recoveryMarker()?.userId)

export function NovaSenha({ onConcluido, onSolicitarNovo }: { onConcluido: () => void; onSolicitarNovo: () => void }) {
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [estado, setEstado] = useState<'validando' | 'confirmar' | 'pronto' | 'invalido'>(recoveryLink.tokenHash && !recoveryLink.error ? 'confirmar' : 'validando')
  const [userId, setUserId] = useState('')
  const ocupado = useRef(false)

  useEffect(() => {
    let mounted = true
    cleanRecoveryUrl()
    if (estado === 'validando') {
      void resolveRecovery().then(result => {
        if (!mounted) return
        if (result.error || !result.userId) {
          clearRecovery(); setErro(result.error || INVALID_RECOVERY); setEstado('invalido')
        } else {
          rememberRecovery(result.userId); setUserId(result.userId); setEstado('pronto')
        }
      })
    }
    return () => { mounted = false }
  }, [estado])

  async function salvar(event: FormEvent) {
    event.preventDefault()
    if (ocupado.current || estado !== 'pronto') return
    setErro('')

    if (senha.length < 8) {
      setErro('A nova senha precisa ter pelo menos 8 caracteres.')
      return
    }

    if (senha !== confirmacao) {
      setErro('As senhas não coincidem.')
      return
    }

    ocupado.current = true
    setCarregando(true)
    try {
      const { data, error: sessionError } = await supabase.auth.getUser()
      if (sessionError || data.user?.id !== userId) {
        clearRecovery(); setEstado('invalido'); setErro(INVALID_RECOVERY); return
      }
      const { error } = await supabase.auth.updateUser({ password: senha })
      if (error) { setErro(authErrorMessage(error)); return }
      // Only this browser's recovery session; do not sign out other devices here.
      await supabase.auth.signOut({ scope: 'local' })
      clearRecovery()
      setSenha(''); setConfirmacao('')
      onConcluido()
    } catch {
      setErro('Não foi possível concluir. Verifique sua conexão e tente novamente.')
    } finally { ocupado.current = false; setCarregando(false) }
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

        {estado === 'validando' && <p role="status">Validando seu link de acesso...</p>}
        {estado === 'confirmar' && <>
          <p>Confirme abaixo para validar o link e criar sua senha. O link só será utilizado após esta confirmação.</p>
          <button type="button" className="primary-button" onClick={() => setEstado('validando')}>Continuar recuperação</button>
        </>}
        {estado === 'pronto' && <>
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

        <button className="primary-button" disabled={carregando}>
          {carregando ? 'Salvando...' : 'Salvar nova senha'}
        </button>

        <p className="login-note">
          Após salvar, entre novamente usando a nova senha.
        </p>
        </>}
        {erro && <div className="alert error" role="alert">{erro}</div>}
        {estado !== 'validando' && <button type="button" className="login-back-button" disabled={carregando} onClick={onSolicitarNovo}>Solicitar novo link</button>}
      </form>
    </div>
  )
}
