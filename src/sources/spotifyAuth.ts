// Authorization-code-with-PKCE flow. No backend needed: the client ID is public
// and configured once by the app owner via VITE_SPOTIFY_CLIENT_ID in .env.local.
const CLIENT_ID = (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim() || ''
const STORE = 'bc1.spotify.token'
const VERIFIER_KEY = 'bc1.spotify.verifier'
const PENDING_STATE_KEY = 'bc1.spotify.pendingState'

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
export const spotifyRedirectUri = () =>
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? `http://127.0.0.1:${location.port}/`
    : `${location.origin}/`

const isLocalOrigin = (o: string) => /^http:\/\/localhost:\d+$/.test(o)

interface StoredToken {
  access: string
  refresh?: string
  exp: number
}

export interface SpotifyProfile {
  name: string
  premium: boolean
}

/** Serializable snapshot of an in-progress disc draft preserved across Spotify OAuth redirect. */
export interface PendingSpotifyState {
  deckIndex: number
  pendingUrl?: string
  draft?: {
    savedId?: string
    title: string
    color: string
    items: (
      | { kind: 'youtube'; key: string; id: string; title: string; duration?: number }
      | { kind: 'soundcloud'; key: string; url: string; index: number; title: string; duration?: number }
      | { kind: 'spotify'; key: string; uri: string; title: string; duration?: number; embed?: boolean }
    )[]
  }
}

export interface SpotifyLoginResult {
  handled: boolean
  ok: boolean
  error?: string
  pending?: PendingSpotifyState
}

export const spotifyConfigured = () => !!CLIENT_ID

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export async function beginSpotifyLogin(pending?: PendingSpotifyState) {
  if (!CLIENT_ID) throw new Error('spotify_setup_required')
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)).buffer)
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  if (pending) {
    sessionStorage.setItem(PENDING_STATE_KEY, JSON.stringify(pending))
  } else {
    sessionStorage.removeItem(PENDING_STATE_KEY)
  }
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: spotifyRedirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
    state: location.origin,
  })
  location.assign(`https://accounts.spotify.com/authorize?${q}`)
}

function saveToken(j: { access_token: string; refresh_token?: string; expires_in: number }, prevRefresh?: string) {
  const s: StoredToken = {
    access: j.access_token,
    refresh: j.refresh_token ?? prevRefresh,
    exp: Date.now() + (j.expires_in - 60) * 1000,
  }
  localStorage.setItem(STORE, JSON.stringify(s))
  return s
}

/** Call once on boot to finish PKCE OAuth redirect and recover any pending disc draft / playlist URL. */
export async function completeSpotifyLogin(): Promise<SpotifyLoginResult> {
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const err = params.get('error')
  if (!code && !err) return { handled: false, ok: false }

  const home = params.get('state') ?? ''
  if (home !== location.origin && isLocalOrigin(home)) {
    // Landed on the 127.0.0.1 redirect: forward code to the localhost app, which holds the PKCE verifier
    location.replace(`${home}/${location.search}`)
    return { handled: true, ok: false }
  }

  history.replaceState(null, '', location.pathname)

  let pending: PendingSpotifyState | undefined
  try {
    const rawPending = sessionStorage.getItem(PENDING_STATE_KEY)
    if (rawPending) pending = JSON.parse(rawPending) as PendingSpotifyState
  } catch {
    /* ignore malformed pending state */
  }
  sessionStorage.removeItem(PENDING_STATE_KEY)

  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)

  if (err) {
    return {
      handled: true,
      ok: false,
      error: err === 'access_denied' ? 'Spotify sign-in cancelled' : `Spotify sign-in failed (${err})`,
      pending,
    }
  }

  if (!code || !verifier || !CLIENT_ID) {
    return { handled: true, ok: false, error: 'Spotify sign-in session expired — try again', pending }
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: spotifyRedirectUri(),
      code_verifier: verifier,
    }),
  })
  if (!res.ok) {
    return {
      handled: true,
      ok: false,
      error: 'Spotify sign-in failed — check redirect URI',
      pending,
    }
  }

  saveToken(await res.json())
  return { handled: true, ok: true, pending }
}

export async function spotifyToken(): Promise<string | null> {
  const raw = localStorage.getItem(STORE)
  if (!raw || !CLIENT_ID) return null
  let s: StoredToken
  try {
    s = JSON.parse(raw) as StoredToken
  } catch {
    localStorage.removeItem(STORE)
    return null
  }
  if (Date.now() < s.exp) return s.access
  if (!s.refresh) {
    localStorage.removeItem(STORE)
    return null
  }
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: s.refresh }),
  })
  if (!res.ok) {
    localStorage.removeItem(STORE)
    return null
  }
  return saveToken(await res.json(), s.refresh).access
}

export async function fetchSpotifyProfile(): Promise<SpotifyProfile | null> {
  const token = await spotifyToken()
  if (!token) return null
  try {
    const res = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      localStorage.removeItem(STORE)
      return null
    }
    if (!res.ok) return null
    const j = (await res.json()) as { display_name?: string; id?: string; product?: string }
    return {
      name: j.display_name || j.id || 'Spotify user',
      premium: j.product === 'premium',
    }
  } catch {
    return null
  }
}

export function spotifyLogout() {
  localStorage.removeItem(STORE)
}
