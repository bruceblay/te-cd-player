/*
 * A burned disc: an ordered list of tracks that may each come from a different
 * place (YouTube, SoundCloud, Spotify, local files). `resolve*` turns what the
 * user adds into tracks; `CompilationSource` plays the list by handing each
 * track to the right underlying player and switching players between tracks.
 */
import { isPlayableFile, LocalSource } from '../sources/local'
import { isSoundCloud, SoundCloudSource } from '../sources/soundcloud'
import { parseSpotify, resolveTracks, SpotifyEmbedSource, SpotifySdkSource, type SpTrack } from '../sources/spotify'
import { spotifyConfigured, spotifyToken } from '../sources/spotifyAuth'
import { parseYouTube, YouTubeSource } from '../sources/youtube'
import type { Capabilities, DiscInfo, Source, SourceCallbacks, SourceKind } from './types'

export type Item =
  | { kind: 'youtube'; key: string; id: string; title: string; duration?: number }
  | { kind: 'soundcloud'; key: string; url: string; index: number; title: string; duration?: number }
  | { kind: 'spotify'; key: string; uri: string; title: string; duration?: number; embed?: boolean }
  | { kind: 'local'; key: string; file: File; title: string; duration?: number }

export interface Compilation {
  savedId?: string
  title: string
  color: string
  items: Item[]
}

export const DISC_COLORS = ['#22468c', '#ff5a1f', '#1d1d1f', '#c9cbd0', '#ece6d6']

let seq = 0
const key = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`
const noop: SourceCallbacks = { onEnded() {}, onPlayState() {}, onTrackMeta() {}, onDiscMeta() {}, onError() {} }

async function oembed(url: string) {
  try {
    const r = await fetch(url)
    return r.ok ? ((await r.json()) as { title?: string }) : null
  } catch {
    return null
  }
}

/** a pasted link becomes one or more tracks; `title` names what was added */
export async function resolveLink(url: string, mount: HTMLElement): Promise<{ title: string; items: Item[] }> {
  const yt = parseYouTube(url)
  if (yt) {
    if (yt.list) {
      // read the playlist's video ids through a throwaway player
      const src = new YouTubeSource(yt, mount, noop)
      try {
        await src.load()
        const ids = src.videoIds
        const titles = await Promise.all(
          ids.map((id) => oembed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`)),
        )
        const pl = await oembed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/playlist?list=${yt.list}`)}`)
        return {
          title: pl?.title ?? 'YouTube playlist',
          items: ids.map((id, i) => ({ kind: 'youtube', key: key(), id, title: titles[i]?.title ?? id })),
        }
      } finally {
        src.destroy()
      }
    }
    const o = await oembed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${yt.video}`)}`)
    const title = o?.title ?? 'YouTube'
    return { title, items: [{ kind: 'youtube', key: key(), id: yt.video!, title }] }
  }
  if (isSoundCloud(url)) {
    const src = new SoundCloudSource(url, mount, noop)
    try {
      const disc = await src.load()
      const o = disc.tracks.length > 1 ? await oembed(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`) : null
      return {
        title: o?.title ?? disc.title,
        items: disc.tracks.map((t, i) => ({ kind: 'soundcloud', key: key(), url, index: i, title: t.title, duration: t.duration || undefined })),
      }
    } finally {
      src.destroy()
    }
  }
  const sp = parseSpotify(url)
  if (sp) {
    if (spotifyConfigured()) {
      if (!(await spotifyToken())) {
        throw new Error('spotify_login_required')
      }
      const info = await resolveTracks(sp)
      return {
        title: info.title,
        items: info.tracks.map((t) => ({ kind: 'spotify', key: key(), uri: t.uri, title: t.title, duration: t.duration })),
      }
    }
    // Full playlist / album import needs Spotify OAuth; single tracks can still play via public embed
    if (sp.type === 'playlist' || sp.type === 'album') {
      throw new Error('spotify_setup_required')
    }
    const o = await oembed(`https://open.spotify.com/oembed?url=https://open.spotify.com/${sp.type}/${sp.id}`)
    const title = o?.title ?? 'Spotify'
    return { title, items: [{ kind: 'spotify', key: key(), uri: `spotify:${sp.type}:${sp.id}`, title, embed: true }] }
  }
  throw new Error('unsupported')
}

export function resolveFiles(files: File[]): { title: string; items: Item[] } {
  const audio = files
    .filter(isPlayableFile)
    .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true }))
  const folder = audio[0]?.webkitRelativePath.split('/')[0]
  return {
    title: folder || (audio.length === 1 ? audio[0].name.replace(/\.[^.]+$/, '') : `${audio.length} files`),
    items: audio.map((f) => ({ kind: 'local', key: key(), file: f, title: f.name.replace(/\.[^.]+$/, '') })),
  }
}

const IDLE_CAPS: Capabilities = { varispeed: false, volume: true, meter: false, record: false, beatDetect: false, persistCues: true }

/** where each track lives: which underlying player, and its index there */
interface Slot {
  child: string
  index: number
}

export class CompilationSource implements Source {
  private slots: Slot[] = []
  private plans = new Map<string, () => Source>()
  private children = new Map<string, Promise<Source>>()
  private loaded = new Map<string, Source>()
  private active: Source | null = null
  private volume = 0.79
  private rate = 1

  constructor(
    private comp: Compilation,
    mount: HTMLElement,
    cb: SourceCallbacks,
    bus: AudioNode,
  ) {
    const yt: string[] = []
    const sp: SpTrack[] = []
    const local: File[] = []
    comp.items.forEach((it, i) => {
      if (it.kind === 'youtube') this.slots[i] = { child: 'yt', index: yt.push(it.id) - 1 }
      else if (it.kind === 'soundcloud') this.slots[i] = { child: `sc:${it.url}`, index: it.index }
      else if (it.kind === 'local') this.slots[i] = { child: 'local', index: local.push(it.file) - 1 }
      else if (it.embed) this.slots[i] = { child: `spe:${i}`, index: 0 }
      else this.slots[i] = { child: 'sp', index: sp.push({ uri: it.uri, title: it.title, duration: it.duration ?? 0 }) - 1 }
    })
    const wrap = (child: string): SourceCallbacks => ({
      onEnded: () => this.isActive(child) && cb.onEnded(),
      onPlayState: (p) => this.isActive(child) && cb.onPlayState(p),
      onTrackMeta: (ci, meta) => {
        const i = this.slots.findIndex((s) => s.child === child && s.index === ci)
        if (i >= 0) cb.onTrackMeta(i, meta)
      },
      onDiscMeta: () => {},
      onError: (m) => this.isActive(child) && cb.onError(m),
    })
    for (const s of new Set(this.slots.map((x) => x.child))) {
      if (s === 'yt') this.plans.set(s, () => new YouTubeSource({ ids: yt }, mount, wrap(s)))
      else if (s === 'local') this.plans.set(s, () => new LocalSource(local, wrap(s), bus, true))
      else if (s === 'sp') this.plans.set(s, () => new SpotifySdkSource({ type: 'track', id: '' }, wrap(s), sp))
      else if (s.startsWith('sc:')) this.plans.set(s, () => new SoundCloudSource(s.slice(3), mount, wrap(s)))
      else {
        const it = comp.items[Number(s.slice(4))] as Extract<Item, { kind: 'spotify' }>
        const [, type, id] = it.uri.split(':')
        this.plans.set(s, () => new SpotifyEmbedSource({ type: type as 'track', id }, mount, wrap(s)))
      }
    }
  }

  private isActive(child: string) {
    return this.active !== null && this.loaded.get(child) === this.active
  }
  private ensure(child: string): Promise<Source> {
    let p = this.children.get(child)
    if (!p) {
      p = (async () => {
        const src = this.plans.get(child)!()
        await src.load()
        src.setVolume(this.volume)
        this.loaded.set(child, src)
        return src
      })()
      this.children.set(child, p)
    }
    return p
  }

  get kind(): SourceKind {
    return this.active?.kind ?? (this.comp.items[0]?.kind as SourceKind) ?? 'local'
  }
  get caps(): Capabilities {
    const c = this.active?.caps ?? IDLE_CAPS
    // Saved discs retain local files and track keys across sessions.
    return { ...c, persistCues: !!this.comp.savedId || !this.comp.items.some((i) => i.kind === 'local') }
  }

  async load(): Promise<DiscInfo> {
    if (!this.comp.items.length) throw new Error('empty')
    const first = this.slots[0]
    this.active = await this.ensure(first.child)
    await this.active.cue(first.index, 0, false)
    const duration = this.active.duration()
    if (duration > 0) this.comp.items[0].duration = duration
    return {
      id: this.comp.savedId ? JSON.stringify([this.comp.savedId, ...this.comp.items.map(i => i.key)]) : `mix:${this.comp.items.map((i) => (i.kind === 'youtube' ? i.id : i.kind === 'soundcloud' ? `${i.url}#${i.index}` : i.kind === 'spotify' ? i.uri : i.file.name)).join('|')}`.slice(0, 400),
      kind: 'mix',
      title: this.comp.title,
      color: this.comp.color,
      tracks: this.comp.items.map((i) => ({ title: i.title, duration: i.duration ?? 0, source: i.kind })),
    }
  }

  async cue(track: number, at: number, autoplay: boolean) {
    const slot = this.slots[track]
    if (!slot) return
    const next = await this.ensure(slot.child)
    if (next !== this.active) {
      this.active?.pause()
      this.active = next
      next.setVolume(this.volume)
      if (next.caps.varispeed) next.setRate(this.rate)
    }
    await next.cue(slot.index, at, autoplay)
  }
  play() {
    this.active?.play()
  }
  pause() {
    this.active?.pause()
  }
  seek(s: number) {
    this.active?.seek(s)
  }
  position() {
    return this.active?.position() ?? 0
  }
  duration() {
    return this.active?.duration() ?? 0
  }
  setVolume(v: number) {
    this.volume = v
    for (const s of this.loaded.values()) s.setVolume(v)
  }
  setRate(r: number) {
    this.rate = r
    return this.active?.caps.varispeed ? this.active.setRate(r) : 1
  }
  /** real meters only while a local track is playing (the deck animates the rest) */
  get levels() {
    return this.active?.levels?.bind(this.active)
  }
  get startRecording() {
    return this.active?.startRecording?.bind(this.active)
  }
  get stopRecording() {
    return this.active?.stopRecording?.bind(this.active)
  }
  async detectBpm(track: number) {
    const slot = this.slots[track]
    if (!slot) return null
    const src = await this.ensure(slot.child)
    return src.detectBpm ? src.detectBpm(slot.index) : null
  }
  destroy() {
    for (const s of this.loaded.values()) s.destroy()
    this.loaded.clear()
    this.children.clear()
    this.active = null
  }
}
