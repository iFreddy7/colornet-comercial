import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const InstallContext = createContext({ installed: false, install: () => {} })

export function PwaProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  const [offline, setOffline] = useState(!navigator.onLine)
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  const [showUpdate, setShowUpdate] = useState(true)
  const [message, setMessage] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const prompt = useRef<InstallEvent | null>(null)
  const applying = useRef(false)

  useEffect(() => {
    let active = true
    let registration: ServiceWorkerRegistration | undefined
    const updateState = () => setOffline(!navigator.onLine)
    const beforeInstall = (event: Event) => { event.preventDefault(); prompt.current = event as InstallEvent }
    const onInstalled = () => { setInstalled(true); prompt.current = null; dialog.current?.close() }
    const display = window.matchMedia('(display-mode: standalone)')
    const onDisplay = () => setInstalled(display.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
    const onController = () => { if (applying.current) window.location.reload() }
    const onUpdate = () => {
      const worker = registration?.installing
      worker?.addEventListener('statechange', () => {
        if (active && worker.state === 'installed' && navigator.serviceWorker.controller) {
          setWaiting(registration?.waiting || worker); setShowUpdate(true)
        }
      })
    }
    window.addEventListener('online', updateState)
    window.addEventListener('offline', updateState)
    window.addEventListener('beforeinstallprompt', beforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    display.addEventListener('change', onDisplay)
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.addEventListener('controllerchange', onController)
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(reg => {
        if (!active) return
        registration = reg
        if (reg.waiting) setWaiting(reg.waiting)
        reg.addEventListener('updatefound', onUpdate)
      }).catch(() => { /* A failed optional offline page must never block login. */ })
    }
    return () => {
      active = false
      window.removeEventListener('online', updateState)
      window.removeEventListener('offline', updateState)
      window.removeEventListener('beforeinstallprompt', beforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      display.removeEventListener('change', onDisplay)
      registration?.removeEventListener('updatefound', onUpdate)
      navigator.serviceWorker?.removeEventListener('controllerchange', onController)
    }
  }, [])

  async function install() {
    const event = prompt.current
    setMessage('')
    if (!event) { dialog.current?.showModal(); return }
    prompt.current = null
    try { await event.prompt(); await event.userChoice }
    catch { setMessage('Abra o menu do navegador e escolha a opção de instalação.'); dialog.current?.showModal() }
  }
  function update() {
    if (!waiting || !window.confirm('Conclua ou salve o formulário antes de continuar. Atualizar o aplicativo agora?')) return
    applying.current = true
    waiting.postMessage({ type: 'ACTIVATE_UPDATE' })
  }
  return <InstallContext.Provider value={{ installed, install }}>
    {children}
    {(offline || (waiting && showUpdate)) && <div className="pwa-status" role="status">
      {offline ? <span>Sem conexão. Mantenha esta tela aberta e reconecte-se antes de enviar.</span> : <>
        <span>Uma nova versão está disponível. Atualize após concluir seu trabalho.</span>
        <button type="button" onClick={update}>Atualizar</button>
        <button type="button" onClick={() => setShowUpdate(false)}>Depois</button>
      </>}
    </div>}
    <dialog className="pwa-dialog" ref={dialog} aria-labelledby="pwa-title">
      <h2 id="pwa-title">ColorNet no seu celular</h2>
      <p>Tenha o portal na tela inicial, com os mesmos dados e permissões do seu acesso.</p>
      {message && <p role="status">{message}</p>}
      <ol><li><strong>Android:</strong> abra este endereço no Chrome. No menu ⋮, escolha “Instalar app” ou “Adicionar à tela inicial”.</li>
        <li><strong>iPhone:</strong> abra no Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”. Ative “Abrir como App”, se aparecer.</li></ol>
      <p>O portal precisa de internet. Para manter seu acesso no aplicativo, marque “Lembrar de mim” ao entrar nele.</p>
      <form method="dialog"><button className="primary-button" autoFocus>Entendi</button></form>
    </dialog>
  </InstallContext.Provider>
}

export function InstallPwaButton({ onBeforeInstall }: { onBeforeInstall?: () => void } = {}) {
  const { installed, install } = useContext(InstallContext)
  if (installed) return null
  return <button type="button" className="pwa-install-button" onClick={() => { onBeforeInstall?.(); install() }}>Instalar aplicativo</button>
}
