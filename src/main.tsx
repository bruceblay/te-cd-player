import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { bootProgress } from './ui/boot'
import './analytics'

// the code has arrived: the loading screen now waits on images and textures
bootProgress(0.48)

// YouTube won't play licensed music in embeds served from an IP address, so the
// dev app lives on localhost.
if (location.hostname === '127.0.0.1') {
  location.replace(`http://localhost:${location.port}${location.pathname}${location.hash}`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
