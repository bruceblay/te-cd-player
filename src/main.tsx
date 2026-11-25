import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { bootProgress } from './ui/boot'
import './analytics'

// the code has arrived: the loading screen now waits on images and textures
bootProgress(0.48)

// YouTube won't play licensed music in embeds served from an IP address, so the
// dev app lives on localhost. 127.0.0.1 is only kept for Spotify's login redirect.
const q = new URLSearchParams(location.search)
if (location.hostname === '127.0.0.1' && !q.has('code') && !q.has('error')) {
  location.replace(`http://localhost:${location.port}${location.pathname}${location.hash}`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
