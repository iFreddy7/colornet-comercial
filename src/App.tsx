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
import { NovaCotacao } from './pages/NovaCotacao'
import { Pedidos } from './pages/Pedidos'
import { Cotacoes } from './pages/Cotacoes'
import { Admin } from './pages/Admin'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [usuario, setUsuario] = useState<UsuarioApp | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [tela, setTela] = useState<Tela>('inicio')
  const [refreshPedidos, setRefreshPedidos] = useState(0)
  const [refreshCotacoes, setRefreshCotacoes] = useState(0)
  const [pedidoDuplicarId, setPedidoDuplicarId] = useState<string | null>(null)
  const [recuperandoSenha, setRecuperandoSenha] = useState(window.location.hash.includes('type=recovery') || new URLSearchParams(window.location.search).get('type') === 'recovery')
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
    else setUsuario(data as UsuarioApp)
    setCarregando(false)
  }

  async function sair() { await supabase.auth.signOut() }
  function pedidoCriado() { setRefreshPedidos((v) => v + 1) }
  function cotacaoCriada() { setRefreshCotacoes((v) => v + 1) }
  function duplicarPedido(id: string) { setPedidoDuplicarId(id); setTela('novo-pedido') }
  function senhaConcluida() { setRecuperandoSenha(false); setSession(null); setUsuario(null); setMensagemLogin('Senha criada com sucesso. Agora entre com sua nova senha.'); window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`) }

  if (carregando) return <div className="fullscreen-center"><Loading texto="Iniciando ColorNet..." /></div>
  if (recuperandoSenha) return <NovaSenha onConcluido={senhaConcluida} />
  if (!session) return <Login mensagemInicial={mensagemLogin} />
  if (!usuario) return <div className="fullscreen-center error-screen"><div className="alert error">{erro || 'Perfil não encontrado.'}</div><button className="primary-button" onClick={sair}>Voltar ao login</button></div>

  return <Layout usuario={usuario} tela={tela} setTela={setTela} onSair={sair}>
    {tela === 'inicio' && <Home key={`home-${refreshPedidos}-${refreshCotacoes}`} usuario={usuario} />}
    {tela === 'novo-pedido' && <NovoPedido usuario={usuario} onPedidoCriado={pedidoCriado} pedidoDuplicarId={pedidoDuplicarId} onDuplicacaoCarregada={() => setPedidoDuplicarId(null)} />}
    {tela === 'pedidos' && <Pedidos key={`pedidos-${refreshPedidos}`} usuario={usuario} onDuplicar={duplicarPedido} />}
    {tela === 'nova-cotacao' && <NovaCotacao key={`nova-cotacao-${refreshCotacoes}`} usuario={usuario} onCotacaoCriada={cotacaoCriada} />}
    {tela === 'cotacoes' && <Cotacoes key={`cotacoes-${refreshCotacoes}`} usuario={usuario} />}
    {tela === 'produtos' && <Produtos usuario={usuario} />}
    {tela === 'clientes' && <Clientes usuario={usuario} />}
    {tela === 'admin' && usuario.perfil === 'ADMIN' && <Admin usuario={usuario} />}
  </Layout>
}

export default App
