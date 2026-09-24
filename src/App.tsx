import { useEffect, useState } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { UsuarioApp } from './types'
import { Loading } from './components/Loading'
import { Layout, type Tela } from './components/Layout'
import { Login } from './pages/Login'
import { NovaSenha } from './pages/NovaSenha'
import { Home } from './pages/Home'
import { Produtos } from './pages/Produtos'
import { Clientes } from './pages/Clientes'
import { NovoPedido } from './pages/NovoPedido'
import { NovaCotacaoV2 } from './pages/NovaCotacaoV2'
import { Pedidos } from './pages/Pedidos'
import { Cotacoes } from './pages/Cotacoes'
import { ConverterCotacao } from './pages/ConverterCotacao'
import { Admin } from './pages/Admin'
import { startsRecovery, cleanRecoveryUrl, clearRecovery } from './lib/recoveryContext'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [usuario, setUsuario] = useState<UsuarioApp | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [tela, setTela] = useState<Tela>('inicio')
  const [refreshPedidos, setRefreshPedidos] = useState(0)
  const [refreshCotacoes, setRefreshCotacoes] = useState(0)
  const [pedidoDuplicarId, setPedidoDuplicarId] = useState<string | null>(null)
  const [cotacaoConverterId, setCotacaoConverterId] = useState<string | null>(null)
  const [pedidoSession, setPedidoSession] = useState(0)
  const [recuperandoSenha, setRecuperandoSenha] = useState(startsRecovery)
  const [solicitarRecuperacao, setSolicitarRecuperacao] = useState(false)
  const [mensagemLogin, setMensagemLogin] = useState('')

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => { if (!mounted) return; setSession(data.session); if (!data.session && !recuperandoSenha) setCarregando(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, nextSession: Session | null) => {
      if (event === 'PASSWORD_RECOVERY') { setRecuperandoSenha(true); setSession(nextSession); setCarregando(false); return }
      setSession(nextSession)
      if (!nextSession) { setUsuario(null); setTela('inicio'); setCarregando(false) }
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => { if (recuperandoSenha) { setCarregando(false); return } if (!session?.user) { setCarregando(false); return } carregarPerfil(session.user.id) }, [session?.user?.id, recuperandoSenha])

  async function carregarPerfil(userId: string) {
    setCarregando(true); setErro('')
    const { data, error } = await supabase.from('usuarios').select('id,nome,email,perfil,vendedor_id,ativo').eq('id', userId).single()
    if (error) { setErro('Login realizado, mas não foi possível carregar public.usuarios: ' + error.message); setUsuario(null) }
    else if (!data.ativo) { setErro('Seu usuário está inativo.'); await supabase.auth.signOut() }
    else {
      // Atualiza a PTAX D-1 antes de montar as telas de pedido/cotação.
      // Falha do BCB não bloqueia o login: o último fechamento válido permanece no banco.
      try {
        const { error: ptaxError } = await supabase.functions.invoke('ptax-atualizar', { body: {} })
        if (ptaxError) console.warn('PTAX não atualizada nesta sessão:', ptaxError.message)
      } catch (ptaxError) {
        console.warn('PTAX não atualizada nesta sessão:', ptaxError)
      }
      setUsuario(data as UsuarioApp)
    }
    setCarregando(false)
  }

  async function sair() { await supabase.auth.signOut() }
  function pedidoCriado() { setRefreshPedidos((v) => v + 1) }
  function cotacaoCriada() { setRefreshCotacoes((v) => v + 1) }
  function navegar(destino: Tela) { setPedidoDuplicarId(null); setCotacaoConverterId(null); setPedidoSession(v => v + 1); setTela(destino) }
  function duplicarPedido(id: string) { setCotacaoConverterId(null); setPedidoDuplicarId(id); setPedidoSession(v => v + 1); setTela('novo-pedido') }
  function converterCotacao(id: string) { setPedidoDuplicarId(null); setCotacaoConverterId(id); setTela('novo-pedido') }
  function senhaConcluida() { clearRecovery(); cleanRecoveryUrl(); setRecuperandoSenha(false); setSession(null); setUsuario(null); setSolicitarRecuperacao(false); setMensagemLogin('Senha criada com sucesso. Agora entre com sua nova senha.') }
  async function solicitarNovoLink() {
    await supabase.auth.signOut({ scope: 'local' })
    clearRecovery(); cleanRecoveryUrl(); setSession(null); setUsuario(null); setMensagemLogin(''); setSolicitarRecuperacao(true); setRecuperandoSenha(false)
  }

  if (carregando) return <div className="fullscreen-center"><Loading texto="Iniciando ColorNet..." /></div>
  if (recuperandoSenha) return <NovaSenha onConcluido={senhaConcluida} onSolicitarNovo={solicitarNovoLink} />
  if (!session) return <Login mensagemInicial={mensagemLogin} recuperar={solicitarRecuperacao} />
  if (!usuario) return <div className="fullscreen-center error-screen"><div className="alert error">{erro || 'Perfil não encontrado.'}</div><button className="primary-button" onClick={sair}>Voltar ao login</button></div>

  return <Layout usuario={usuario} tela={tela} setTela={navegar} onSair={sair}>
    {tela === 'inicio' && <Home key={`home-${refreshPedidos}-${refreshCotacoes}`} usuario={usuario} />}
    {tela === 'novo-pedido' && (cotacaoConverterId
      ? <ConverterCotacao key={`${usuario.id}-${cotacaoConverterId}`} id={cotacaoConverterId} usuario={usuario} onVoltar={() => navegar('cotacoes')} onCriado={() => { pedidoCriado(); cotacaoCriada() }} />
      : <NovoPedido key={`${usuario.id}-${pedidoSession}`} usuario={usuario} onPedidoCriado={pedidoCriado} pedidoDuplicarId={pedidoDuplicarId} onDuplicacaoCarregada={() => setPedidoDuplicarId(null)} />)}
    {tela === 'pedidos' && <Pedidos key={`pedidos-${refreshPedidos}`} usuario={usuario} onDuplicar={duplicarPedido} />}
    {tela === 'nova-cotacao' && <NovaCotacaoV2 key={`nova-cotacao-${usuario.id}-${refreshCotacoes}`} usuario={usuario} onCotacaoCriada={cotacaoCriada} />}
    {tela === 'cotacoes' && <Cotacoes key={`cotacoes-${refreshCotacoes}`} usuario={usuario} onConverter={converterCotacao} />}
    {tela === 'produtos' && <Produtos usuario={usuario} />}
    {tela === 'clientes' && <Clientes usuario={usuario} />}
    {tela === 'admin' && usuario.perfil === 'ADMIN' && <Admin usuario={usuario} />}
  </Layout>
}

export default App
