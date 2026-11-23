import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Bound to loopback on a fixed port. Open http://localhost:5178: YouTube blocks
// licensed music in embeds on IP origins. 127.0.0.1 serves Spotify's login redirect,
// which forwards back to localhost (see src/sources/spotifyAuth.ts).
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
})
