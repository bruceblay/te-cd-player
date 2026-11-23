import type { Capabilities, DiscInfo, Source, SourceCallbacks } from '../engine/types'
import { clamp, loadScript } from '../engine/util'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    SC?: any
  }
}

export function isSoundCloud(url: string) {
  try {
    const h = new URL(url).hostname
    return /(^|\.)soundcloud\.com$|^on\.soundcloud\.com$|^snd\.sc$/.test(h)
  } catch {
    return false
  }
}

export class SoundCloudSource implements Source {
  readonly kind = 'soundcloud' as const
  readonly caps: Capabilities = {
    varispeed: false,
    volume: true,
    meter: false,
    record: false,
    beatDetect: false,
    persistCues: true,
  }
  private iframe: HTMLIFrameElement
  private widget: any
  private current = 0
  private count = 1
  private pos = 0
  private posAt = 0
  private playing = false
  private dur = 0
  /** set while we skip so the widget's own auto-advance and skip-autoplay don't leak through */
  private holdPause = false

  constructor(
    private url: string,
    mount: HTMLElement,
    private cb: SourceCallbacks,
  ) {
    this.iframe = document.createElement('iframe')
    this.iframe.allow = 'autoplay'
    this.iframe.title = 'SoundCloud'
    const params = new URLSearchParams({
      url,
      auto_play: 'false',
      visual: 'true',
      hide_related: 'true',
      show_comments: 'false',
      show_reposts: 'false',
      show_teaser: 'false',
      buying: 'false',
      sharing: 'false',
      download: 'false',
    })
    this.iframe.src = `https://w.soundcloud.com/player/?${params}`
    mount.appendChild(this.iframe)
  }

  async load(): Promise<DiscInfo> {
    await loadScript('https://w.soundcloud.com/player/api.js')
    const SC = window.SC
    const w = (this.widget = SC.Widget(this.iframe))
    const E = SC.Widget.Events
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('sc timeout')), 15000)
      w.bind(E.READY, () => {
        clearTimeout(t)
        resolve()
      })
      w.bind(E.ERROR, () => this.cb.onError('sc err'))
    })
    w.bind(E.PLAY_PROGRESS, (e: any) => {
      this.pos = e.currentPosition / 1000
      this.posAt = performance.now()
    })
    w.bind(E.PLAY, () => {
      if (this.holdPause) {
        w.pause()
        return
      }
      this.playing = true
      this.posAt = performance.now()
      w.getCurrentSoundIndex((i: number) => {
        if (typeof i === 'number' && i !== this.current && !this.holdPause) this.current = i
      })
      w.getDuration((d: number) => {
        this.dur = d / 1000
        this.cb.onTrackMeta(this.current, { duration: this.dur })
      })
      this.cb.onPlayState(true)
    })
    w.bind(E.PAUSE, () => {
      this.playing = false
      if (!this.holdPause) this.cb.onPlayState(false)
    })
    w.bind(E.FINISH, () => {
      this.playing = false
      this.cb.onEnded()
    })

    const sounds: any[] = await new Promise((r) => w.getSounds((s: any[]) => r(s ?? [])))
    const single: any = await new Promise((r) => w.getCurrentSound((s: any) => r(s)))
    const list = sounds.length ? sounds : single ? [single] : []
    this.count = Math.max(1, list.length)
    const first = list[0] ?? {}
    const art = (first.artwork_url || first.user?.avatar_url || '') as string
    return {
      id: `sc:${this.url.replace(/[?#].*$/, '')}`,
      kind: 'soundcloud',
      title: list.length > 1 ? 'SoundCloud set' : first.title || 'SoundCloud',
      artwork: art ? art.replace('-large', '-t500x500') : undefined,
      tracks: list.map((s, i) => ({
        title: s.title || `track ${i + 1}`,
        duration: s.duration ? s.duration / 1000 : 0,
        artwork: s.artwork_url ? String(s.artwork_url).replace('-large', '-t500x500') : undefined,
      })),
    }
  }

  async cue(track: number, at: number, autoplay: boolean) {
    const w = this.widget
    if (!w || track < 0 || track >= this.count) return
    if (track !== this.current || !this.playing) {
      // skip() always starts playback, so hold it paused unless we want it to play
      this.holdPause = !autoplay
      this.current = track
      w.skip(track)
      await new Promise((r) => setTimeout(r, 350))
    }
    w.seekTo(at * 1000)
    this.pos = at
    this.posAt = performance.now()
    this.holdPause = false
    if (autoplay) w.play()
    else w.pause()
  }

  play() {
    this.holdPause = false
    this.widget?.play()
  }
  pause() {
    this.widget?.pause()
  }
  seek(s: number) {
    this.widget?.seekTo(Math.max(0, s) * 1000)
    this.pos = Math.max(0, s)
    this.posAt = performance.now()
  }
  position() {
    return this.playing ? this.pos + (performance.now() - this.posAt) / 1000 : this.pos
  }
  duration() {
    return this.dur
  }
  setVolume(v: number) {
    this.widget?.setVolume(Math.round(clamp(v, 0, 1) * 100))
  }
  setRate() {
    return 1
  }
  destroy() {
    try {
      this.widget?.unbind?.(window.SC?.Widget.Events.PLAY_PROGRESS)
    } catch {
      /* noop */
    }
    this.iframe.remove()
  }
}
