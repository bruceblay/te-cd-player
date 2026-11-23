import { CompilationSource, DISC_COLORS, resolveFiles, resolveLink, type Compilation } from './compilation'
import { Midi, type MidiCommand } from './midi'
import type { Capabilities, DiscInfo, Source, SourceCallbacks } from './types'
import { audioContext, clamp } from './util'

export type Transport = 'stopped' | 'playing' | 'paused'
export type Repeat = 'off' | 'one' | 'all'
export type Bt = 'off' | 'scanning' | 'connecting' | 'connected' | 'broadcast'
export type Power = 'off' | 'on' | 'sleep'
export interface Cue {
  track: number
  at: number
}
export interface Entry {
  field: 'track' | 'min' | 'sec'
  track: string
  min: string
  sec: string
}

export interface DeckState {
  power: Power
  loading: boolean
  disc: DiscInfo | null
  caps: Capabilities | null
  track: number
  transport: Transport
  position: number
  duration: number
  repeat: Repeat
  varispeed: number
  /** speed actually playing, % (YouTube snaps to 5 % steps) */
  vari: number
  level: number
  cues: (Cue | null)[]
  entry: Entry | null
  message: string | null
  enterHeld: boolean
  bt: Bt
  btPaired: boolean
  sync: { on: boolean; bpm: number | null; confidence: number | null; beat: boolean }
  recording: boolean
  vu: [number, number]
  batteryCheck: boolean
  battery: number
  charging: boolean
  jog: number
  midi: { connected: boolean; inputs: number; outputs: number }
  error: string | null
}

const AUTO_OFF_MS = 5 * 60 * 1000
const HOLD_MS = 700
const CUE_STORE = 'bc1.cues'
const CUE_DISCS = 40

const initial: DeckState = {
  power: 'off',
  loading: false,
  disc: null,
  caps: null,
  track: 0,
  transport: 'stopped',
  position: 0,
  duration: 0,
  repeat: 'off',
  varispeed: 100,
  vari: 100,
  level: 79,
  cues: [null, null, null],
  entry: null,
  message: null,
  enterHeld: false,
  bt: 'off',
  btPaired: false,
  sync: { on: false, bpm: null, confidence: null, beat: false },
  recording: false,
  vu: [0, 0],
  batteryCheck: false,
  battery: 0.82,
  charging: false,
  jog: 0,
  midi: { connected: false, inputs: 0, outputs: 0 },
  error: null,
}

function readCueStore(): { id: string; cues: (Cue | null)[]; t: number }[] {
  try {
    return JSON.parse(localStorage.getItem(CUE_STORE) ?? '[]')
  } catch {
    return []
  }
}

/**
 * One BC-1. Owns the source, the transport state machine and every front-panel
 * behaviour. UI calls the press/turn methods; React reads `getState()`.
 * Self-contained so a second deck (and a mixer) can be added later.
 */
export class Deck {
  private s: DeckState = { ...initial }
  private listeners = new Set<() => void>()
  private source: Source | null = null
  /** the streaming players live off-screen; the disc face is printed */
  private hiddenMount: HTMLElement | null = null
  /** what's burned on the current disc, for editing it */
  private comp: Compilation | null = null
  private rateTimer: number | undefined
  private gen = 0
  private timer: number | undefined
  private lastTick = performance.now()
  private lastActive = Date.now()
  private msgUntil = 0
  /** ignore source play/pause echoes right after we commanded a change */
  private quietUntil = 0
  private holdTimers = new Map<string, number>()
  private held = new Set<string>()
  private btTimers: number[] = []
  private taps: number[] = []
  private clockTimer: number | undefined
  private nextClock = 0
  private clockCount = 0
  private jogAccum = 0
  private lastJogSeek = 0
  private vuSim: [number, number] = [0, 0]
  private midi = new Midi((c) => this.midiCommand(c))
  /**
   * Local audio leaves the deck here. It feeds the speakers until a mixer
   * takes it over (see Mixer.attach). Streams never reach it: their audio
   * stays inside their own players.
   */
  readonly bus: GainNode
  /** mixer fader/gain for streams, which can only be turned down via their player volume */
  private mixGain = 1

  constructor() {
    const ctx = audioContext()
    this.bus = ctx.createGain()
    this.bus.connect(ctx.destination)
    this.timer = window.setInterval(() => this.tick(), 50)
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (t: string, f: () => void) => void }> }
    void nav.getBattery?.().then((b) => {
      const upd = () => this.set({ battery: b.level, charging: b.charging })
      upd()
      b.addEventListener('levelchange', upd)
      b.addEventListener('chargingchange', upd)
    })
  }

  /* ---------------- store plumbing ---------------- */

  getState = () => this.s
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private set(patch: Partial<DeckState>) {
    this.s = { ...this.s, ...patch }
    this.listeners.forEach((l) => l())
  }
  setMount(hidden: HTMLElement | null) {
    this.hiddenMount = hidden
  }
  get compilation() {
    return this.comp
  }
  dispose() {
    clearInterval(this.timer)
    this.stopClock()
    this.source?.destroy()
    this.midi.disconnect()
  }

  private flash(text: string, ms = 1400) {
    this.msgUntil = performance.now() + ms
    this.set({ message: text })
  }
  private get on() {
    return this.s.power === 'on'
  }
  private touch() {
    this.lastActive = Date.now()
  }
  private quiet(ms = 1500) {
    this.quietUntil = performance.now() + ms
  }

  /* ---------------- power ---------------- */

  powerSwitch(on: boolean) {
    this.touch()
    if (on) {
      this.set({ power: 'on', batteryCheck: false })
      this.flash(this.s.disc ? 'ep bc-1' : 'no disc', 1200)
    } else {
      if (this.s.recording) void this.finishRecording()
      this.source?.pause()
      this.stopClock()
      this.clearBtTimers()
      this.set({
        power: 'off',
        transport: this.s.transport === 'playing' ? 'paused' : this.s.transport,
        entry: null,
        bt: 'off',
        sync: { ...this.s.sync, on: false },
        message: null,
      })
    }
  }

  /* ---------------- loading ---------------- */

  /** load a burned disc, or a single link / some files as a disc of their own */
  async loadDisc(input: string | File[] | Compilation) {
    if (!this.on) this.powerSwitch(true)
    const my = ++this.gen
    const cb: SourceCallbacks = {
      onEnded: () => my === this.gen && this.onEnded(),
      onPlayState: (p) => my === this.gen && this.onSourcePlayState(p),
      onTrackMeta: (i, meta) => {
        if (my !== this.gen || !this.s.disc) return
        const tracks = this.s.disc.tracks.slice()
        if (!tracks[i]) return
        tracks[i] = {
          ...tracks[i],
          ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== '')),
        }
        this.set({ disc: { ...this.s.disc, tracks } })
        // keep the burn list in step, so editing the disc shows what was learned while playing
        const it = this.comp?.items[i]
        if (it) {
          if (meta.title) it.title = meta.title
          if (meta.duration) it.duration = meta.duration
        }
      },
      onDiscMeta: (meta) => my === this.gen && this.s.disc && this.set({ disc: { ...this.s.disc, ...meta } }),
      onError: (m) => {
        if (my !== this.gen) return
        // e.g. the owner blocks embedding: the player never starts, so don't sit on "playing"
        if (this.s.transport === 'playing') {
          this.clockStop()
          this.set({ transport: 'stopped' })
        }
        this.set({ error: m })
        this.flash(m, 4000)
      },
    }

    if (!this.hiddenMount) throw new Error('no mount')
    let comp: Compilation
    if (Array.isArray(input)) comp = { ...resolveFiles(input), color: DISC_COLORS[0] }
    else if (typeof input === 'string') {
      this.set({ loading: true, message: 'load' })
      this.msgUntil = Infinity
      try {
        comp = { ...(await resolveLink(input.trim(), this.hiddenMount)), color: DISC_COLORS[0] }
      } catch (e) {
        this.set({ loading: false })
        return this.flash(e instanceof Error && e.message === 'login' ? 'login' : 'bad disc', 2500)
      }
      if (my !== this.gen) return
    } else comp = input
    const src: Source = new CompilationSource(comp, this.hiddenMount, cb, this.bus)

    this.eject(false)
    this.source = src
    this.comp = comp
    this.set({ loading: true, error: null, message: 'load' })
    this.msgUntil = Infinity
    try {
      const disc = await src.load()
      if (my !== this.gen) return src.destroy()
      const stored = src.caps.persistCues ? readCueStore().find((d) => d.id === disc.id) : undefined
      this.set({
        loading: false,
        disc,
        caps: src.caps,
        track: 0,
        position: 0,
        duration: disc.tracks[0]?.duration ?? 0,
        transport: 'stopped',
        cues: stored?.cues ?? [null, null, null],
        entry: null,
      })
      this.applyVolume()
      this.applyRate(true)
      this.flash(`${String(disc.tracks.length).padStart(3, '0')} trk`, 1500)
      if (this.s.sync.on) void this.detectTempo()
    } catch (e) {
      if (my !== this.gen) return
      src.destroy()
      this.source = null
      const msg = e instanceof Error && e.message === 'login' ? 'login' : this.s.error ?? 'disc err'
      this.set({ loading: false, disc: null, caps: null })
      this.flash(msg, 3000)
    }
  }

  /** open the lid: stops and removes the disc */
  eject(bumpGen = true) {
    if (bumpGen) this.gen++
    if (this.s.recording) void this.finishRecording()
    this.source?.destroy()
    this.source = null
    this.comp = null
    this.stopClock()
    this.set({
      disc: null,
      caps: null,
      transport: 'stopped',
      track: 0,
      position: 0,
      duration: 0,
      cues: [null, null, null],
      entry: null,
      loading: false,
    })
    if (bumpGen && this.on) this.flash('no disc', 1500)
  }

  /* ---------------- transport ---------------- */

  private go(track: number, at: number, play: boolean) {
    if (!this.source || !this.s.disc) return
    this.quiet()
    const changed = track !== this.s.track
    this.set({
      track,
      position: at,
      duration: this.s.disc.tracks[track]?.duration ?? 0,
      transport: play ? 'playing' : this.s.transport === 'playing' ? 'paused' : this.s.transport,
    })
    const src = this.source
    void src.cue(track, at, play).then(() => {
      // a burned disc can switch players between tracks: what this one can do may differ
      if (src !== this.source || track !== this.s.track) return
      this.set({ caps: src.caps })
      this.applyVolume()
      if (changed && this.s.sync.on && src.caps.beatDetect) void this.detectTempo()
      this.applyRate(true)
    })
    if (play) this.clockStart()
  }

  pressPlay() {
    this.touch()
    if (this.s.power === 'off') return this.batteryCheck()
    if (this.s.power === 'sleep') return this.powerSwitch(true)
    if (this.s.enterHeld) {
      return this.s.sync.on ? this.tap() : this.syncStart()
    }
    if (!this.source || !this.s.disc) return this.flash('no disc')
    this.quiet()
    if (this.s.transport === 'playing') {
      this.source.pause()
      this.set({ transport: 'paused' })
      this.clockStop()
    } else {
      this.source.play()
      this.set({ transport: 'playing', entry: null })
      this.clockStart()
    }
  }

  pressStop() {
    this.touch()
    if (!this.on) return
    if (this.s.enterHeld) {
      if (!this.s.sync.on) return
      const last = this.taps[this.taps.length - 1] ?? 0
      return performance.now() - last < 1500 ? this.tap() : this.syncStop()
    }
    if (this.s.recording) return void this.finishRecording()
    if (!this.source || !this.s.disc) return
    this.set({ entry: null })
    this.clockStop()
    if (this.s.transport === 'stopped') {
      this.go(0, 0, false)
    } else {
      this.quiet()
      this.source.pause()
      this.go(this.s.track, 0, false)
      this.set({ transport: 'stopped' })
    }
  }

  pressNext() {
    this.touch()
    if (!this.on) return
    if (this.s.enterHeld) {
      const order: Repeat[] = ['off', 'one', 'all']
      const repeat = order[(order.indexOf(this.s.repeat) + 1) % 3]
      this.set({ repeat })
      return this.flash({ off: 'rep off', one: 'rep 1', all: 'rep all' }[repeat])
    }
    if (!this.s.disc) return
    const n = this.s.disc.tracks.length
    const t = this.s.track + 1 < n ? this.s.track + 1 : this.s.repeat === 'all' ? 0 : -1
    if (t < 0) return this.flash('end', 800)
    this.go(t, 0, this.s.transport === 'playing')
  }

  pressPrev() {
    this.touch()
    if (!this.on) return
    if (this.s.enterHeld) {
      return void this.startRecording()
    }
    if (!this.s.disc) return
    if (this.s.position > 3 && this.s.transport !== 'stopped') return this.go(this.s.track, 0, this.s.transport === 'playing')
    const n = this.s.disc.tracks.length
    const t = this.s.track > 0 ? this.s.track - 1 : this.s.repeat === 'all' ? n - 1 : 0
    this.go(t, 0, this.s.transport === 'playing')
  }

  private onEnded() {
    if (!this.s.disc) return
    const n = this.s.disc.tracks.length
    if (this.s.repeat === 'one') return this.go(this.s.track, 0, true)
    if (this.s.track + 1 < n) return this.go(this.s.track + 1, 0, true)
    if (this.s.repeat === 'all') return this.go(0, 0, true)
    this.clockStop()
    this.set({ transport: 'stopped' })
    this.go(0, 0, false)
    this.set({ transport: 'stopped' })
  }

  private onSourcePlayState(playing: boolean) {
    if (performance.now() < this.quietUntil) return
    if (playing && this.s.transport !== 'playing') {
      if (!this.on) return this.source?.pause()
      this.set({ transport: 'playing' })
      this.clockStart()
    } else if (!playing && this.s.transport === 'playing') {
      this.set({ transport: 'paused' })
      this.clockStop()
    }
  }

  /** jog stick deflection -1..1; scrubs at 2x / 4x / 8x */
  setJog(d: number) {
    this.touch()
    this.set({ jog: clamp(d, -1, 1) })
    if (d === 0) this.jogAccum = 0
  }

  setVarispeed(pct: number) {
    this.touch()
    // 0.1 % resolution so a slow turn glides instead of stepping
    const v = Math.round(clamp(pct, 50, 150) * 10) / 10
    this.set({ varispeed: v })
    if (!this.on) return
    if (this.source && !this.source.caps.varispeed) return this.flash('no vari', 900)
    this.applyRate(false)
    this.retimeClock()
  }

  /**
   * Local audio: true varispeed (pitch follows speed), applied every step.
   * YouTube: its player time-stretches in 5 % steps and re-buffers on each
   * change, so snap and only send once the knob settles.
   */
  private applyRate(now: boolean) {
    const src = this.source
    if (!src?.caps.varispeed) return this.set({ vari: 100 })
    const v = this.s.varispeed
    if (src.kind !== 'youtube') {
      src.setRate(v / 100)
      return this.set({ vari: v })
    }
    const snapped = Math.round(v / 5) * 5
    this.set({ vari: snapped })
    clearTimeout(this.rateTimer)
    const send = () => src === this.source && src.setRate(snapped / 100)
    if (now) send()
    else this.rateTimer = window.setTimeout(send, 220)
  }

  setLevel(v: number) {
    this.touch()
    const level = Math.round(clamp(v, 0, 100))
    this.set({ level })
    this.applyVolume()
  }
  private applyVolume() {
    const src = this.source
    if (!src) return
    src.setVolume((this.s.level / 100) * (src.kind === 'local' ? 1 : this.mixGain))
  }

  /** set by the mixer: 0..1, applied to streams through their player volume */
  setMixGain(g: number) {
    this.mixGain = clamp(g, 0, 1)
    this.applyVolume()
  }

  get sourceKind() {
    return this.source?.kind ?? null
  }

  /** tempo of the current track (local files only) */
  trackBpm() {
    return this.source?.detectBpm?.(this.s.track) ?? Promise.resolve(null)
  }


  /* ---------------- numpad / enter ---------------- */

  pressDigit(d: number) {
    this.touch()
    if (!this.on || !this.s.disc) return
    const e: Entry = this.s.entry ?? { field: 'track', track: '', min: '', sec: '' }
    const v = (e[e.field] + d).slice(-3)
    this.set({ entry: { ...e, [e.field]: v } })
  }

  pressTime() {
    this.touch()
    if (!this.on || !this.s.disc) return
    const e = this.s.entry
    if (!e) return this.set({ entry: { field: 'track', track: '', min: '', sec: '' } })
    const next = { track: 'min', min: 'sec', sec: 'track' } as const
    this.set({ entry: { ...e, field: next[e.field] } })
  }

  pressCancel() {
    this.touch()
    if (!this.on) return
    if (this.s.entry) this.set({ entry: null })
  }

  enterDown() {
    this.touch()
    this.set({ enterHeld: true })
    if (!this.on) return
    const e = this.s.entry
    if (e && this.s.disc) {
      const t = e.track ? parseInt(e.track, 10) : this.s.track + 1
      const at = (parseInt(e.min || '0', 10) || 0) * 60 + (parseInt(e.sec || '0', 10) || 0)
      this.set({ entry: null })
      if (t < 1 || t > this.s.disc.tracks.length) return this.flash('no trk')
      this.go(t - 1, at, true)
    } else if (this.s.sync.on) {
      this.showTempo()
    }
  }

  enterUp() {
    this.set({ enterHeld: false })
  }

  /* ---------------- cue markers ---------------- */

  cueDown(i: number) {
    this.touch()
    if (!this.on || !this.s.disc) return
    const key = `cue${i}`
    this.held.add(key)
    if (!this.s.cues[i]) {
      if (this.s.transport !== 'playing') return this.flash('play 1st', 900)
      this.held.delete(key)
      return this.storeCue(i, { track: this.s.track, at: this.s.position })
    }
    this.holdTimers.set(
      key,
      window.setTimeout(() => {
        this.held.delete(key)
        this.storeCue(i, null)
        this.flash(`cue ${i + 1} clr`, 900)
      }, HOLD_MS),
    )
  }

  cueUp(i: number) {
    const key = `cue${i}`
    clearTimeout(this.holdTimers.get(key))
    if (!this.held.has(key)) return
    this.held.delete(key)
    const c = this.s.cues[i]
    if (c && this.on) this.go(c.track, c.at, this.s.transport === 'playing')
  }

  private storeCue(i: number, c: Cue | null) {
    const cues = this.s.cues.slice()
    cues[i] = c
    this.set({ cues })
    if (c) this.flash(`cue ${i + 1}`, 700)
    const disc = this.s.disc
    if (!disc || !this.s.caps?.persistCues) return
    const list = readCueStore().filter((d) => d.id !== disc.id)
    // markers are remembered for the last 40 discs
    if (cues.some(Boolean)) list.unshift({ id: disc.id, cues, t: Date.now() })
    localStorage.setItem(CUE_STORE, JSON.stringify(list.slice(0, CUE_DISCS)))
  }

  /* ---------------- bluetooth (simulated radio) ---------------- */

  btDown() {
    this.touch()
    if (!this.on) return
    if (this.s.enterHeld) {
      this.clearBtTimers()
      this.set({ bt: 'broadcast' })
      return this.flash('bcast', 1500)
    }
    this.held.add('bt')
    this.holdTimers.set(
      'bt',
      window.setTimeout(() => {
        this.held.delete('bt')
        this.btScan()
      }, HOLD_MS),
    )
  }

  btUp() {
    clearTimeout(this.holdTimers.get('bt'))
    if (!this.held.has('bt') || !this.on) return
    this.held.delete('bt')
    const bt = this.s.bt
    if (bt === 'connected' || bt === 'broadcast' || bt === 'scanning' || bt === 'connecting') {
      this.clearBtTimers()
      this.set({ bt: 'off' })
      this.flash('bt off', 900)
    } else if (this.s.btPaired) {
      this.set({ bt: 'connecting' })
      this.btTimers.push(window.setTimeout(() => this.btConnected(), 1200))
    } else {
      this.flash('hold bt', 1000)
    }
  }

  private btScan() {
    this.clearBtTimers()
    this.set({ bt: 'scanning' })
    this.flash('bt scan', 1500)
    this.btTimers.push(
      window.setTimeout(() => {
        this.set({ bt: 'connecting' })
        this.btTimers.push(window.setTimeout(() => this.btConnected(), 1400))
      }, 2600),
    )
  }
  private btConnected() {
    this.set({ bt: 'connected', btPaired: true })
    this.flash('bt conn', 1200)
  }
  private clearBtTimers() {
    this.btTimers.forEach(clearTimeout)
    this.btTimers = []
  }

  /* ---------------- sync / tempo ---------------- */

  private syncStart() {
    this.set({ sync: { on: true, bpm: null, confidence: null, beat: false } })
    this.taps = []
    if (this.s.caps?.beatDetect) void this.detectTempo()
    else this.flash('tap tempo', 1500)
    if (this.s.transport === 'playing') this.clockStart()
  }
  private syncStop() {
    this.stopClock()
    this.set({ sync: { on: false, bpm: null, confidence: null, beat: false } })
    this.flash('sync off', 900)
  }
  private async detectTempo() {
    const src = this.source
    if (!src?.detectBpm) return
    this.flash('bpm ...', 4000)
    const r = await src.detectBpm(this.s.track)
    if (src !== this.source || !this.s.sync.on) return
    if (!r) return this.flash('no bpm', 1200)
    this.set({ sync: { ...this.s.sync, bpm: r.bpm, confidence: r.confidence } })
    this.showTempo()
    this.retimeClock()
  }
  private tap() {
    const now = performance.now()
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2000) this.taps = []
    this.taps.push(now)
    this.taps = this.taps.slice(-6)
    if (this.taps.length < 2) return this.flash('tap', 600)
    const iv = this.taps.slice(1).map((t, i) => t - this.taps[i])
    const mean = iv.reduce((a, b) => a + b, 0) / iv.length
    const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length)
    const bpm = Math.round((60000 / mean) * 10) / 10
    const confidence = Math.round(clamp(99 - (sd / mean) * 400, 0, 99) * Math.min(1, iv.length / 4))
    this.set({ sync: { ...this.s.sync, bpm, confidence } })
    this.showTempo()
    this.retimeClock()
  }
  private showTempo() {
    const { bpm, confidence } = this.s.sync
    if (bpm == null) return this.flash('tap tempo', 1200)
    // TRACK|INDEX|MIN|SEC groups read as  119.|7  |bp |c74
    const [int, frac] = bpm.toFixed(1).split('.')
    this.flash(`${int.padStart(3, ' ')}.${frac}  bp c${String(confidence ?? 0).padStart(2, '0')}`, 2200)
  }

  /** effective tempo follows varispeed, like the hardware */
  private get clockBpm() {
    const b = this.s.sync.bpm
    return b ? b * (this.s.vari / 100) : 0
  }
  private clockStart() {
    if (!this.s.sync.on || this.clockTimer) return
    this.midi.start()
    this.clockCount = 0
    this.nextClock = performance.now()
    this.clockTimer = window.setInterval(() => this.pumpClock(), 25)
  }
  private clockStop() {
    if (!this.clockTimer) return
    this.stopClock()
    this.midi.stop()
  }
  private stopClock() {
    clearInterval(this.clockTimer)
    this.clockTimer = undefined
    if (this.s.sync.beat) this.set({ sync: { ...this.s.sync, beat: false } })
  }
  private retimeClock() {
    this.nextClock = Math.max(this.nextClock, performance.now())
  }
  private pumpClock() {
    const bpm = this.clockBpm
    if (!bpm) return
    const step = 60000 / bpm / 24 // 24 ppqn; the BC-1's 1/16 pulse = every 6th clock
    const horizon = performance.now() + 60
    while (this.nextClock < horizon) {
      this.midi.clock(this.nextClock)
      const beat = this.clockCount % 24 < 6
      if (beat !== this.s.sync.beat) this.set({ sync: { ...this.s.sync, beat } })
      this.clockCount++
      this.nextClock += step
    }
  }

  /* ---------------- recording ---------------- */

  private async startRecording() {
    if (!this.source || this.s.transport !== 'playing') return this.flash('play 1st')
    if (!this.source.caps.record || !this.source.startRecording) return this.flash('no rec', 1500)
    await this.source.startRecording()
    this.set({ recording: true })
    this.flash('rec', 1000)
  }
  private async finishRecording() {
    const src = this.source
    this.set({ recording: false })
    const blob = await src?.stopRecording?.()
    if (!blob) return this.flash('rec err')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const t = this.s.disc?.tracks[this.s.track]?.title ?? 'track'
    a.download = `BC-1 ${String(this.s.track + 1).padStart(2, '0')} ${t}.wav`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    this.flash('saved', 1200)
  }

  /* ---------------- battery / midi ---------------- */

  private batteryCheck() {
    this.set({ batteryCheck: true })
    setTimeout(() => this.set({ batteryCheck: false }), 3000)
  }

  async toggleMidi() {
    if (this.midi.connected) {
      this.midi.disconnect()
    } else if (!(await this.midi.connect())) {
      this.flash('no midi', 1500)
    }
    this.set({ midi: { connected: this.midi.connected, inputs: this.midi.inputs, outputs: this.midi.outputs } })
    if (this.midi.connected) this.flash('usb midi', 1000)
  }

  private midiCommand(c: MidiCommand) {
    if (c === 'play') {
      if (this.s.transport !== 'playing') this.pressPlay()
    } else if (c === 'stop') this.pressStop()
    else if (c === 'next') this.pressNext()
    else this.pressPrev()
  }

  /* ---------------- tick ---------------- */

  private tick() {
    const now = performance.now()
    const dt = Math.min(0.25, (now - this.lastTick) / 1000)
    this.lastTick = now
    const patch: Partial<DeckState> = {}

    if (this.s.message && now > this.msgUntil) patch.message = null

    if (this.source && this.s.disc) {
      // jog scrub
      if (this.s.jog !== 0 && this.on) {
        const a = Math.abs(this.s.jog)
        const speed = a < 0.4 ? 2 : a < 0.75 ? 4 : 8
        const playing = this.s.transport === 'playing'
        this.jogAccum += Math.sign(this.s.jog) * (speed - (playing && this.s.jog > 0 ? 1 : 0) + (playing && this.s.jog < 0 ? 1 : 0)) * dt
        // embeds choke on rapid seeks; local audio can take them every tick
        const every = this.source.kind === 'local' ? 0 : 200
        if (now - this.lastJogSeek >= every && this.jogAccum !== 0) {
          const target = clamp(this.source.position() + this.jogAccum, 0, Math.max(0, this.source.duration() - 0.5))
          this.source.seek(target)
          this.jogAccum = 0
          this.lastJogSeek = now
          patch.position = target
        }
      }
      if (patch.position === undefined) patch.position = this.source.position()
      const d = this.source.duration()
      if (d) patch.duration = d
    }

    // VU meters
    if (this.on && this.s.transport === 'playing') {
      if (this.source?.levels) {
        const [l, r] = this.source.levels()
        const bars = (p: number) => clamp((20 * Math.log10(p + 1e-6) + 36) / 36, 0, 1)
        // instant attack, ~300 ms release
        const fall = (v: number, t: number) => (t > v ? t : Math.max(t, v * 0.82))
        patch.vu = [fall(this.s.vu[0], bars(l)), fall(this.s.vu[1], bars(r))]
      } else {
        // streams can't be measured from the page; animate a plausible meter
        const g = this.s.level / 100
        const pulse = this.s.sync.beat ? 0.12 : 0
        this.vuSim = this.vuSim.map((v) => {
          const target = g * (0.55 + Math.random() * 0.35) + pulse
          return v + (target - v) * (target > v ? 0.6 : 0.15)
        }) as [number, number]
        patch.vu = this.vuSim
      }
    } else if (this.s.vu[0] || this.s.vu[1]) {
      patch.vu = [this.s.vu[0] * 0.7, this.s.vu[1] * 0.7].map((v) => (v < 0.02 ? 0 : v)) as [number, number]
    }

    // auto power-off after 5 minutes without playback
    if (this.s.transport === 'playing') this.touch()
    else if (this.s.power === 'on' && Date.now() - this.lastActive > AUTO_OFF_MS) {
      patch.power = 'sleep'
      patch.message = null
      this.clearBtTimers()
      patch.bt = 'off'
    }

    this.set(patch)
  }
}
