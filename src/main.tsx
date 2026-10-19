import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PwaProvider } from './components/Pwa'
import './styles.css'
import './theme.css'
import './portalRefinements.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PwaProvider><App /></PwaProvider>
  </StrictMode>,
)
