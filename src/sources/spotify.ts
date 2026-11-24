import type { Capabilities, DiscInfo, Source, SourceCallbacks, TrackInfo } from '../engine/types'
import { clamp, loadScript } from '../engine/util'
import { spotifyLogout, spotifyToken } from './spotifyAuth'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    Spotify?: any
    onSpotifyWebPlaybackSDKReady?: () => void
    onSpotifyIframeApiReady?: (api: any) => void
  }
}

export interface SpotifyRef {
  type: 'track' | 'album' | 'playlist'
  id: string
}

export function parseSpotify(url: string): SpotifyRef | null {
  const clean = url.trim()
  const uri = clean.match(/^spotify:(track|album|playlist):([A-Za-z0-9]+)/)
  if (uri) return { type: uri[1] as SpotifyRef['type'], id: uri[2] }
  try {
    const u = new URL(clean)
    if (u.hostname !== 'open.spotify.com' && u.hostname !== 'play.spotify.com') return null
    const m = u.pathname.match(/\/(track|album|playlist)\/([A-Za-z0-9]+)/)
    return m ? { type: m[1] as SpotifyRef['type'], id: m[2] } : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Full control: Web Playback SDK (Premium) + Web API for track lists  */
/* ------------------------------------------------------------------ */

let sdkReady: Promise<void> | null = null
function spotifySdk() {
  if (!sdkReady) {
    sdkReady = new Promise((resolve) => {
      if (window.Spotify) return resolve()
      window.onSpotifyWebPlaybackSDKReady = () => resolve()
      void loadScript('https://sdk.scdn.co/spotify-player.js')
    })
  }
  return sdkReady
}

async function api(path: string, init: RequestInit = {}) {
  const token = await spotifyToken()
  if (!token) throw new Error('spotify_login_required')
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (res.status === 401) {
    spotifyLogout()
    throw new Error('spotify_expired')
  }
  if (res.status === 403) {
    // keep Spotify's reason (e.g. a Premium or user-allowlist requirement) for the message
    const body = await res.json().catch(() => null)
    throw new Error('spotify_forbidden', { cause: body?.error?.message ?? res.statusText })
  }
  if (res.status === 404) throw new Error('spotify_not_found')
  if (!res.ok) throw new Error(`spotify ${res.status}`)
  return res.status === 204 ? null : res.json().catch(() => null)
}

export interface SpTrack extends TrackInfo {
  uri: string
}

export async function resolveTracks(ref: SpotifyRef): Promise<{ title: string; artwork?: string; tracks: SpTrack[] }> {
  const toTrack = (t: any): SpTrack | null => {
    if (!t?.uri || t.is_local) return null
    if (t.type !== undefined && t.type !== 'track') return null
    const artist = Array.isArray(t.artists) && t.artists[0]?.name ? String(t.artists[0].name) : ''
    const name = String(t.name ?? '').trim()
    if (!name) return null
    return {
      uri: t.uri,
      title: artist ? `${name} — ${artist}` : name,
      duration: (t.duration_ms ?? 0) / 1000,
    }
  }

  if (ref.type === 'track') {
    const t = await api(`/tracks/${ref.id}`)
    const parsed = toTrack(t)
    if (!parsed) throw new Error('empty')
    return { title: t.name, artwork: t.album?.images?.[0]?.url, tracks: [parsed] }
  }
  if (ref.type === 'album') {
    const a = await api(`/albums/${ref.id}`)
    const tracks: SpTrack[] = (a.tracks?.items ?? []).map(toTrack).filter(Boolean)
    let next: string | null = a.tracks?.next
    while (next && tracks.length < 500) {
      const page = await api(next.replace('https://api.spotify.com/v1', ''))
      tracks.push(...(page.items ?? []).map(toTrack).filter(Boolean))
      next = page.next
    }
    if (!tracks.length) throw new Error('empty')
    return { title: a.name, artwork: a.images?.[0]?.url, tracks }
  }
  const meta = await api(`/playlists/${ref.id}?fields=name,images`)
  const tracks: SpTrack[] = []
  // Standard Web API uses /tracks (limit=100); fall back to /items if migrated
  let loaded = false
  let lastErr: unknown = null
  for (const ep of ['tracks', 'items']) {
    try {
      const first = await api(`/playlists/${ref.id}/${ep}?limit=100`)
      const take = (p: any) =>
        tracks.push(...(p.items ?? []).map((it: any) => toTrack(it?.track ?? it?.item)).filter(Boolean))
      take(first)
      let next: string | null = first.next
      while (next && tracks.length < 500) {
        const page = await api(next.replace('https://api.spotify.com/v1', ''))
        take(page)
        next = page.next
      }
      loaded = true
      break
    } catch (e) {
      lastErr = e
      // dev-mode apps are refused the older /tracks endpoint; only give up on an expired session
      if (e instanceof Error && e.message === 'spotify_expired') throw e
    }
  }
  if (!loaded && lastErr) throw lastErr
  if (!tracks.length) throw new Error('empty')
  return { title: meta.name || 'Spotify playlist', artwork: meta.images?.[0]?.url, tracks }
}

export class SpotifySdkSource implements Source {
  readonly kind = 'spotify' as const
  readonly caps: Capabilities = {
    varispeed: false,
    volume: true,
    meter: false,
    record: false,
    beatDetect: false,
    persistCues: true,
  }
  private player: any
  private deviceId = ''
  private tracks: SpTrack[] = []
  private current = 0
  /** not yet sent to Spotify: the track/position the deck is parked on */
  private armed: { track: number; at: number } | null = null
  private state: { pos: number; at: number; paused: boolean; dur: number; uri: string } = {
    pos: 0,
    at: 0,
    paused: true,
    dur: 0,
    uri: '',
  }
  private nearEnd = false
  private volume = 0.8

  constructor(
    private ref: SpotifyRef,
    private cb: SourceCallbacks,
    /** compilations pass their tracks in, already resolved */
    private given?: SpTrack[],
  ) {}

  async load(): Promise<DiscInfo> {
    const info = this.given ? { title: 'Spotify', artwork: undefined, tracks: this.given } : await resolveTracks(this.ref)
    this.tracks = info.tracks
    if (!this.tracks.length) throw new Error('empty')
    await spotifySdk()
    this.player = new window.Spotify.Player({
      name: 'te-cd-player BC-1',
      getOAuthToken: (done: (t: string) => void) => void spotifyToken().then((t) => t && done(t)),
      volume: this.volume,
    })
    const p = this.player
    p.addListener('account_error', () => this.cb.onError('premium'))
    p.addListener('authentication_error', () => this.cb.onError('login'))
    p.addListener('playback_error', () => this.cb.onError('sp err'))
    p.addListener('player_state_changed', (s: any) => this.onState(s))
    this.deviceId = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('sp timeout')), 15000)
      p.addListener('ready', ({ device_id }: { device_id: string }) => {
        clearTimeout(t)
        resolve(device_id)
      })
      p.addListener('initialization_error', ({ message }: { message: string }) => reject(new Error(message)))
      void p.connect()
    })
    this.armed = { track: 0, at: 0 }
    return {
      id: `sp:${this.ref.type}:${this.ref.id}`,
      kind: 'spotify',
      title: info.title,
      artwork: info.artwork,
      tracks: this.tracks.map(({ title, duration }) => ({ title, duration })),
    }
  }

  private onState(s: any) {
    if (!s) return
    const uri = s.track_window?.current_track?.uri ?? ''
    const wasPlaying = !this.state.paused
    this.state = { pos: s.position / 1000, at: performance.now(), paused: s.paused, dur: s.duration / 1000, uri }
    if (!s.paused) this.nearEnd = this.state.dur > 0 && this.state.pos > this.state.dur - 3
    // a single-uri play ends by pausing at 0 (and the track moves to previous_tracks)
    const ended =
      s.paused && wasPlaying && (s.position === 0 || this.nearEnd) && (this.nearEnd || s.track_window?.previous_tracks?.length)
    if (ended) {
      this.nearEnd = false
      this.cb.onEnded()
      return
    }
    this.cb.onPlayState(!s.paused)
  }

  private send(track: number, at: number) {
    const uri = this.tracks[track]?.uri
    if (!uri) return
    this.current = track
    this.armed = null
    this.nearEnd = false
    this.state = { ...this.state, pos: at, at: performance.now(), paused: false }
    void api(`/me/player/play?device_id=${this.deviceId}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [uri], position_ms: Math.round(at * 1000) }),
    }).catch(() => this.cb.onError('sp err'))
  }

  async cue(track: number, at: number, autoplay: boolean) {
    if (autoplay) {
      this.player?.activateElement?.()
      this.send(track, at)
    } else {
      if (!this.state.paused) this.player?.pause()
      this.current = track
      this.armed = { track, at }
      this.state = { ...this.state, pos: at, at: performance.now(), paused: true }
    }
  }

  play() {
    this.player?.activateElement?.()
    if (this.armed) this.send(this.armed.track, this.armed.at)
    else void this.player?.resume()
  }
  pause() {
    void this.player?.pause()
  }
  seek(s: number) {
    if (this.armed) this.armed.at = Math.max(0, s)
    else void this.player?.seek(Math.round(Math.max(0, s) * 1000))
    this.state = { ...this.state, pos: Math.max(0, s), at: performance.now() }
  }
  position() {
    if (this.armed) return this.armed.at
    const { pos, at, paused } = this.state
    return paused ? pos : pos + (performance.now() - at) / 1000
  }
  duration() {
    return this.state.dur || this.tracks[this.current]?.duration || 0
  }
  setVolume(v: number) {
    this.volume = clamp(v, 0, 1)
    void this.player?.setVolume(Math.max(0.0001, this.volume))
  }
  setRate() {
    return 1
  }
  destroy() {
    try {
      this.player?.disconnect()
    } catch {
      /* noop */
    }
  }
}

/* ------------------------------------------------------------------ */
/* No client ID: the public embed. Full tracks if signed in to Spotify */
/* in this browser, 30 s previews otherwise. One "track" per disc.     */
/* ------------------------------------------------------------------ */

let embedApi: Promise<any> | null = null
function spotifyEmbedApi(): Promise<any> {
  if (!embedApi) {
    embedApi = new Promise((resolve) => {
      window.onSpotifyIframeApiReady = (api) => resolve(api)
      void loadScript('https://open.spotify.com/embed/iframe-api/v1')
    })
  }
  return embedApi
}

export class SpotifyEmbedSource implements Source {
  readonly kind = 'spotify' as const
  readonly caps: Capabilities = {
    varispeed: false,
    volume: false,
    meter: false,
    record: false,
    beatDetect: false,
    persistCues: true,
  }
  private ctl: any
  private host: HTMLDivElement
  private pos = 0
  private posAt = 0
  private paused = true
  private dur = 0

  constructor(
    private ref: SpotifyRef,
    mount: HTMLElement,
    private cb: SourceCallbacks,
  ) {
    this.host = document.createElement('div')
    mount.appendChild(this.host)
  }

  async load(): Promise<DiscInfo> {
    const IFrameAPI = await spotifyEmbedApi()
    const uri = `spotify:${this.ref.type}:${this.ref.id}`
    this.ctl = await new Promise((resolve) =>
      IFrameAPI.createController(this.host, { uri, width: '100%', height: '100%' }, resolve),
    )
    let lastPos = 0
    this.ctl.addListener('playback_update', (e: any) => {
      const d = e.data
      this.pos = d.position / 1000
      this.posAt = performance.now()
      this.dur = d.duration / 1000
      const wasPaused = this.paused
      this.paused = d.isPaused
      if (this.dur) this.cb.onTrackMeta(0, { duration: this.dur })
      const ended = d.isPaused && this.dur > 0 && (lastPos > this.dur - 1.5 || (d.position === 0 && lastPos > 1))
      lastPos = this.pos
      if (ended && !wasPaused) this.cb.onEnded()
      else if (wasPaused !== d.isPaused) this.cb.onPlayState(!d.isPaused)
    })
    let title = 'Spotify'
    let artwork: string | undefined
    try {
      const o = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/${this.ref.type}/${this.ref.id}`)
      if (o.ok) {
        const j = await o.json()
        title = j.title ?? title
        artwork = j.thumbnail_url
      }
    } catch {
      /* title stays generic */
    }
    return {
      id: `sp:${this.ref.type}:${this.ref.id}`,
      kind: 'spotify',
      title,
      artwork,
      tracks: [{ title, duration: 0 }],
    }
  }

  async cue(_track: number, at: number, autoplay: boolean) {
    this.ctl?.seek(at)
    this.pos = at
    if (autoplay) this.play()
  }
  play() {
    if (this.paused) this.ctl?.resume()
    if (this.pos === 0 && this.paused) this.ctl?.play()
  }
  pause() {
    this.ctl?.pause()
  }
  seek(s: number) {
    this.ctl?.seek(Math.max(0, s))
    this.pos = Math.max(0, s)
    this.posAt = performance.now()
  }
  position() {
    return this.paused ? this.pos : this.pos + (performance.now() - this.posAt) / 1000
  }
  duration() {
    return this.dur
  }
  setVolume() {}
  setRate() {
    return 1
  }
  destroy() {
    try {
      this.ctl?.destroy()
    } catch {
      /* noop */
    }
    this.host.remove()
  }
}
