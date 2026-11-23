// Authorization-code-with-PKCE flow. No backend needed: the client ID is public.
const CLIENT_ID = (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim()
const STORE = 'bc1.spotify.token'
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ')

// Spotify only accepts loopback IPs (not "localhost") as redirect URIs, but YouTube
// refuses to play licensed music in embeds on an IP origin. So in dev the app runs on
// localhost and Spotify sends the login back to 127.0.0.1, which forwards it home.
const redirectUri = () =>
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? `http://127.0.0.1:${location.port}/`
    : `${location.origin}/`
const isLocalOrigin = (o: string) => /^http:\/\/localhost:\d+$/.test(o)

interface Stored {
  access: string
  refresh?: string
  exp: number
}

export const spotifyConfigured = () => !!CLIENT_ID

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export async function beginSpotifyLogin(pendingUrl: string) {
  if (!CLIENT_ID) throw new Error('VITE_SPOTIFY_CLIENT_ID not set')
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)).buffer)
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  sessionStorage.setItem('bc1.spotify.verifier', verifier)
  sessionStorage.setItem('bc1.spotify.pending', pendingUrl)
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
    state: location.origin,
  })
  location.assign(`https://accounts.spotify.com/authorize?${q}`)
}

function save(j: { access_token: string; refresh_token?: string; expires_in: number }, prevRefresh?: string) {
  const s: Stored = {
    access: j.access_token,
    refresh: j.refresh_token ?? prevRefresh,
    exp: Date.now() + (j.expires_in - 60) * 1000,
  }
  localStorage.setItem(STORE, JSON.stringify(s))
  return s
}

/** call once on boot; returns the disc URL the user was loading when we left for the login page */
export async function completeSpotifyLogin(): Promise<string | null> {
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const err = params.get('error')
  if (!code && !err) return null
  const home = params.get('state') ?? ''
  if (home !== location.origin && isLocalOrigin(home)) {
    // landed on the 127.0.0.1 redirect: hand the code to the localhost app, which holds the verifier
    location.replace(`${home}/${location.search}`)
    return null
  }
  history.replaceState(null, '', location.pathname)
  const pending = sessionStorage.getItem('bc1.spotify.pending')
  sessionStorage.removeItem('bc1.spotify.pending')
  const verifier = sessionStorage.getItem('bc1.spotify.verifier')
  if (!code || !verifier || !CLIENT_ID) return null
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  })
  if (!res.ok) return null
  save(await res.json())
  return pending
}

export async function spotifyToken(): Promise<string | null> {
  const raw = localStorage.getItem(STORE)
  if (!raw || !CLIENT_ID) return null
  const s = JSON.parse(raw) as Stored
  if (Date.now() < s.exp) return s.access
  if (!s.refresh) return null
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: s.refresh }),
  })
  if (!res.ok) {
    localStorage.removeItem(STORE)
    return null
  }
  return save(await res.json(), s.refresh).access
}

export function spotifyLogout() {
  localStorage.removeItem(STORE)
}
