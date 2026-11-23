import type { Capabilities, DiscInfo, Source, SourceCallbacks } from '../engine/types'
import { clamp, loadScript, waitFor } from '../engine/util'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiReady: Promise<any> | null = null
function youtubeApi(): Promise<any> {
  if (!apiReady) {
    apiReady = new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve(window.YT)
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        prev?.()
        resolve(window.YT)
      }
      // an extension or network block would otherwise leave the deck on "load" forever
      loadScript('https://www.youtube.com/iframe_api').catch(() => {
        apiReady = null
        reject(new Error('yt blocked'))
      })
    })
  }
  return apiReady
}

export function parseYouTube(url: string): { video?: string; list?: string } | null {
  try {
    const u = new URL(url)
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/.test(u.hostname)) return null
    const list = u.searchParams.get('list') ?? undefined
    let video = u.searchParams.get('v') ?? undefined
    if (u.hostname.endsWith('youtu.be')) video = u.pathname.slice(1) || undefined
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/)
    if (m) video = m[2]
    if (!video && !list) return null
    // Mixes/radio (RD…), uploads-from-history and private lists (LL, WL) can't be embedded
    // as playlists; a link copied while one plays should still load its video
    if (video && list && /^(RD|UL|LL|WL)/.test(list)) return { video }
    return { video, list }
  } catch {
    return null
  }
}

export class YouTubeSource implements Source {
  readonly kind = 'youtube' as const
  readonly caps: Capabilities = {
    varispeed: true,
    volume: true,
    meter: false,
    record: false,
    beatDetect: false,
    persistCues: true,
  }
  private player: any
  private ids: string[] = []
  private current = -1
  private rate = 1
  private host: HTMLDivElement

  constructor(
    private ref: { video?: string; list?: string },
    mount: HTMLElement,
    private cb: SourceCallbacks,
  ) {
    this.host = document.createElement('div')
    mount.appendChild(this.host)
  }

  async load(): Promise<DiscInfo> {
    const YT = await youtubeApi()
    const { video, list } = this.ref
    await new Promise<void>((resolve, reject) => {
      setTimeout(() => reject(new Error('yt timeout')), 15000)
      this.player = new YT.Player(this.host, {
        width: '100%',
        height: '100%',
        // the API rejects an explicit undefined videoId
        ...(list ? {} : { videoId: video }),
        // the video is the disc face: no chrome, no keyboard, no annotations
        playerVars: {
          playsinline: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          cc_load_policy: 0,
          rel: 0,
          modestbranding: 1,
          ...(list ? { listType: 'playlist', list } : {}),
        },
        events: {
          onReady: () => resolve(),
          onError: (e: any) => {
            const msg = { 2: 'bad id', 5: 'html5 err', 100: 'not found', 101: 'no embed', 150: 'no embed' }[
              e.data as number
            ]
            this.cb.onError(msg ?? 'yt err')
            reject(new Error(msg))
          },
          onStateChange: (e: any) => this.onState(e.data),
        },
      })
    })

    if (list) {
      this.ids = await waitFor(() => {
        const l = this.player.getPlaylist?.()
        return l && l.length ? (l as string[]) : null
      }, 10000)
      // drop the native playlist so the deck, not YouTube, decides what comes next
      const start = video ? Math.max(0, this.ids.indexOf(video)) : 0
      this.player.cueVideoById({ videoId: this.ids[start] })
      this.current = start
    } else {
      this.ids = [video!]
      this.current = 0
    }
    const data = this.player.getVideoData?.() ?? {}
    const disc: DiscInfo = {
      id: `yt:${list ?? video}`,
      kind: 'youtube',
      title: list ? 'YouTube playlist' : data.title || 'YouTube',
      artwork: `https://i.ytimg.com/vi/${this.ids[0]}/hqdefault.jpg`,
      tracks: this.ids.map((id, i) => ({
        title: i === this.current && data.title ? data.title : id,
        duration: 0,
        artwork: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      })),
    }
    void this.fetchTitles()
    return disc
  }

  /** the player only knows the current video's title; oEmbed gives the rest */
  private async fetchTitles() {
    let next = 0
    const worker = async () => {
      while (next < this.ids.length) {
        const i = next++
        try {
          const r = await fetch(
            `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${this.ids[i]}`)}`,
          )
          if (r.ok) this.cb.onTrackMeta(i, { title: (await r.json()).title })
        } catch {
          /* keep the id as the title */
        }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
  }

  private onState(s: number) {
    // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    if (s === 0) this.cb.onEnded()
    else if (s === 1) {
      this.cb.onPlayState(true)
      // captions would print across the disc face
      this.player.unloadModule?.('captions')
      this.player.unloadModule?.('cc')
      this.player.setPlaybackRate(this.rate)
      this.cb.onTrackMeta(this.current, { duration: this.player.getDuration() })
    } else if (s === 2) this.cb.onPlayState(false)
  }

  async cue(track: number, at: number, autoplay: boolean) {
    const id = this.ids[track]
    if (!id) return
    if (track === this.current) {
      this.player.seekTo(at, true)
      if (autoplay) this.player.playVideo()
      return
    }
    this.current = track
    if (autoplay) this.player.loadVideoById({ videoId: id, startSeconds: at })
    else this.player.cueVideoById({ videoId: id, startSeconds: at })
  }

  play() {
    this.player?.playVideo()
  }
  pause() {
    this.player?.pauseVideo()
  }
  seek(s: number) {
    this.player?.seekTo(Math.max(0, s), true)
  }
  position() {
    return this.player?.getCurrentTime?.() ?? 0
  }
  duration() {
    return this.player?.getDuration?.() ?? 0
  }
  setVolume(v: number) {
    this.player?.setVolume(Math.round(clamp(v, 0, 1) * 100))
  }
  setRate(r: number) {
    this.rate = r
    this.player?.setPlaybackRate?.(r)
    return this.player?.getPlaybackRate?.() ?? r
  }
  destroy() {
    try {
      this.player?.destroy()
    } catch {
      /* already gone */
    }
    this.host.remove()
  }
}
