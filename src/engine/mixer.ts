/*
 * EP-136 K.O.-sidekick: a two-channel mixer with EQ, compressor, pan, two FX
 * slots, cue bus, tempo per channel and an FX automation sequencer.
 *
 * Only audio the page owns can be processed, so EQ / compressor / pan / FX work
 * on local files. A streaming deck (YouTube, SoundCloud, Spotify) still follows
 * its fader, gain cut and the main volume through the player's own volume.
 */
import type { Deck } from './deck'
import { FX_TYPES, FxSlot, type FxType } from './sidekickFx'
import { audioContext, clamp } from './util'

export type EqStyle = 'dj' | 'studio' | 'param'
export type CompType = 'glue' | 'punch' | 'limit'
export type Screen = 'main' | 'channel' | 'comp' | 'tempo' | 'fx' | 'settings' | 'level'
export type Input = 'local' | 'stream' | null
type Ch = 0 | 1
/** where a cable from a deck is plugged in: a channel, the aux input, or nowhere */
export type Jack = Ch | 'aux' | null

export interface ChannelState {
  /** trim, dB */
  gain: number
  pan: number
  /** -1..1 per band; meaning depends on the EQ style */
  eq: { high: number; mid: number; low: number }
  comp: number
  compType: CompType
  fader: number
  cue: boolean
  fx: FxType
  bpm: number
  tracking: boolean
  meter: [number, number]
}

export interface MixerState {
  power: boolean
  ch: [ChannelState, ChannelState]
  inputs: [Input, Input]
  master: number
  phones: number
  mainCue: boolean
  serial: boolean
  eqStyle: EqStyle
  tempoSource: 'own' | 'ch1' | 'ch2'
  cueOut: string
  cueOutputs: { id: string; label: string }[]
  screen: Screen
  screenCh: Ch
  focus: Ch | 'both'
  stick: number
  pad: number
  locked: boolean
  seq: 'idle' | 'armed' | 'rec' | 'play'
  selectHeld: boolean
  fxHeld: [boolean, boolean]
  settingsIndex: number
  message: string | null
  masterMeter: [number, number]
}

export const SETTINGS = ['EQ', 'TEMPO', 'CUE OUT'] as const
const COMP_TYPES: CompType[] = ['glue', 'punch', 'limit']
const EQ_STYLES: EqStyle[] = ['dj', 'studio', 'param']

const dbToLin = (db: number) => Math.pow(10, db / 20)

const channel = (): ChannelState => ({
  gain: 0,
  pan: 0,
  eq: { high: 0, mid: 0, low: 0 },
  comp: 0,
  compType: 'glue',
  fader: 0.8,
  cue: false,
  fx: 'filter',
  bpm: 120,
  tracking: false,
  meter: [0, 0],
})

/** the audio for one channel strip */
class Strip {
  readonly input: GainNode
  private studio: { low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; out: GainNode }
  private iso: { low: GainNode; mid: GainNode; high: GainNode; out: GainNode }
  readonly comp: DynamicsCompressorNode
  private makeup: GainNode
  readonly panner: StereoPannerNode
  readonly fx: FxSlot
  readonly fader: GainNode
  readonly cueSend: GainNode
  private splitter: ChannelSplitterNode
  private meters: [AnalyserNode, AnalyserNode]
  private buf = new Float32Array(512)

  constructor(private ctx: AudioContext) {
    this.input = new GainNode(ctx)
    const eqSum = new GainNode(ctx)

    // studio / parametric: shelf, bell, shelf
    const low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 120 })
    const mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1000, Q: 0.8 })
    const high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 8000 })
    const sOut = new GainNode(ctx, { gain: 0 })
    this.input.connect(low).connect(mid).connect(high).connect(sOut).connect(eqSum)
    this.studio = { low, mid, high, out: sOut }

    // DJ: a three-band isolator (Linkwitz-Riley style crossovers) so each band can be killed
    const lr = (type: BiquadFilterType, f: number) => {
      const a = new BiquadFilterNode(ctx, { type, frequency: f, Q: Math.SQRT1_2 })
      const b = new BiquadFilterNode(ctx, { type, frequency: f, Q: Math.SQRT1_2 })
      a.connect(b)
      return [a, b] as const
    }
    const iOut = new GainNode(ctx, { gain: 1 })
    const [l1, l2] = lr('lowpass', 250)
    const [h1, h2] = lr('highpass', 2500)
    const [m1, m2] = lr('highpass', 250)
    const [m3, m4] = lr('lowpass', 2500)
    m2.connect(m3)
    const lg = new GainNode(ctx)
    const mg = new GainNode(ctx)
    const hg = new GainNode(ctx)
    this.input.connect(l1)
    l2.connect(lg).connect(iOut)
    this.input.connect(m1)
    m4.connect(mg).connect(iOut)
    this.input.connect(h1)
    h2.connect(hg).connect(iOut)
    iOut.connect(eqSum)
    this.iso = { low: lg, mid: mg, high: hg, out: iOut }

    this.comp = new DynamicsCompressorNode(ctx, { threshold: 0, ratio: 1 })
    this.makeup = new GainNode(ctx)
    this.panner = new StereoPannerNode(ctx)
    eqSum.connect(this.comp).connect(this.makeup).connect(this.panner)

    this.fx = new FxSlot(ctx)
    this.fader = new GainNode(ctx)
    // cue taps before the FX and the fader, as on the hardware
    this.cueSend = new GainNode(ctx, { gain: 0 })

    this.splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 })
    this.meters = [new AnalyserNode(ctx, { fftSize: 512 }), new AnalyserNode(ctx, { fftSize: 512 })]
    this.fader.connect(this.splitter)
    this.splitter.connect(this.meters[0], 0)
    this.splitter.connect(this.meters[1], 1)
  }

  setEq(style: EqStyle, eq: ChannelState['eq']) {
    const t = this.ctx.currentTime
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.02)
    set(this.studio.out.gain, style === 'dj' ? 0 : 1)
    set(this.iso.out.gain, style === 'dj' ? 1 : 0)
    if (style === 'dj') {
      // full left kills the band, full right is +6 dB
      const g = (v: number) => (v < 0 ? (1 + v) ** 2 : 1 + v)
      set(this.iso.low.gain, g(eq.low))
      set(this.iso.mid.gain, g(eq.mid))
      set(this.iso.high.gain, g(eq.high))
    } else {
      const range = style === 'studio' ? 12 : 15
      this.studio.low.frequency.value = style === 'studio' ? 120 : 80
      this.studio.mid.Q.value = style === 'studio' ? 0.8 : 2.2
      this.studio.mid.frequency.value = style === 'studio' ? 1000 : 1500
      this.studio.high.frequency.value = style === 'studio' ? 8000 : 10000
      set(this.studio.low.gain, eq.low * range)
      set(this.studio.mid.gain, eq.mid * range)
      set(this.studio.high.gain, eq.high * range)
    }
  }

  setComp(amount: number, type: CompType) {
    const t = this.ctx.currentTime
    const shape = { glue: { r: 2, k: 12, a: 0.03, rel: 0.3 }, punch: { r: 4, k: 6, a: 0.01, rel: 0.15 }, limit: { r: 20, k: 0, a: 0.002, rel: 0.1 } }[type]
    const threshold = -amount * 36
    const ratio = amount === 0 ? 1 : shape.r
    this.comp.threshold.setTargetAtTime(threshold, t, 0.02)
    this.comp.ratio.setTargetAtTime(ratio, t, 0.02)
    this.comp.knee.value = shape.k
    this.comp.attack.value = shape.a
    this.comp.release.value = shape.rel
    // rough make-up so turning the compressor up doesn't just turn the channel down
    this.makeup.gain.setTargetAtTime(dbToLin(-threshold * (1 - 1 / ratio) * 0.5), t, 0.05)
  }

  levels(): [number, number] {
    const peak = (a: AnalyserNode) => {
      a.getFloatTimeDomainData(this.buf)
      let m = 0
      for (let i = 0; i < this.buf.length; i++) m = Math.max(m, Math.abs(this.buf[i]))
      return m
    }
    return [peak(this.meters[0]), peak(this.meters[1])]
  }
}

interface Sample {
  t: number
  stick: number
  pad: number
}

export class Mixer {
  private s: MixerState
  private listeners = new Set<() => void>()
  private ctx = audioContext()
  private strips: [Strip, Strip]
  private masterSum: GainNode
  private masterGain: GainNode
  private mainCueSend: GainNode
  private cueBus: GainNode
  private phonesGain: GainNode
  private cueDest: MediaStreamAudioDestinationNode
  private cueEl: HTMLAudioElement | null = null
  private masterMeters: [AnalyserNode, AnalyserNode]
  private meterSplit: ChannelSplitterNode
  private mbuf = new Float32Array(512)
  private timer: number | undefined
  private msgUntil = 0
  private decks: [Deck | null, Deck | null] = [null, null]
  private auxDeck: Deck | null = null
  private auxIn: GainNode
  private known = new Set<Deck>()
  private lastTrack: [number, number] = [-1, -1]
  private mods: [{ stick: number; pad: number }, { stick: number; pad: number }] = [
    { stick: 0, pad: 0 },
    { stick: 0, pad: 0 },
  ]
  private lockReleased = false
  private recording: Sample[] = []
  private recStart = 0
  private recTargets: Ch[] = []
  private loopLen = 0
  private playStart = 0
  private taps: [number[], number[]] = [[], []]
  private cueHeld: [boolean, boolean] = [false, false]
  private cueCombo = false
  private holdTimers: number[] = []
  private fxReturn: Pick<MixerState, 'screen' | 'screenCh'> = { screen: 'main', screenCh: 0 }
  private stickZone = 0
  private padDown = false

  constructor() {
    const ctx = this.ctx
    this.s = {
      power: true,
      ch: [channel(), channel()],
      inputs: [null, null],
      master: 0.8,
      phones: 0.7,
      mainCue: false,
      serial: false,
      eqStyle: 'dj',
      tempoSource: 'own',
      cueOut: '',
      cueOutputs: [],
      screen: 'main',
      screenCh: 0,
      focus: 0,
      stick: 0,
      pad: 0,
      locked: false,
      seq: 'idle',
      selectHeld: false,
      fxHeld: [false, false],
      settingsIndex: 0,
      message: null,
      masterMeter: [0, 0],
    }
    this.strips = [new Strip(ctx), new Strip(ctx)]
    this.masterSum = new GainNode(ctx)
    this.masterGain = new GainNode(ctx)
    this.mainCueSend = new GainNode(ctx, { gain: 0 })
    this.cueBus = new GainNode(ctx)
    this.phonesGain = new GainNode(ctx)
    this.cueDest = new MediaStreamAudioDestinationNode(ctx)
    this.cueBus.connect(this.phonesGain).connect(this.cueDest)
    this.auxIn = new GainNode(ctx)
    this.masterMeters = [new AnalyserNode(ctx, { fftSize: 512 }), new AnalyserNode(ctx, { fftSize: 512 })]
    this.meterSplit = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 })
    this.masterGain.connect(ctx.destination)
    this.masterGain.connect(this.meterSplit)
    this.meterSplit.connect(this.masterMeters[0], 0)
    this.meterSplit.connect(this.masterMeters[1], 1)
    this.masterGain.connect(this.mainCueSend).connect(this.cueBus)
    for (const st of this.strips) {
      st.panner.connect(st.cueSend).connect(this.cueBus)
      st.fader.connect(this.masterSum)
    }
    // aux has no channel strip: straight into the main mix
    this.auxIn.connect(this.masterSum)
    this.route()
    this.applyAll()
    this.timer = window.setInterval(() => this.tick(), 30)
  }

  /* ---------------- store ---------------- */

  getState = () => this.s
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private set(patch: Partial<MixerState>) {
    this.s = { ...this.s, ...patch }
    this.listeners.forEach((l) => l())
  }
  private setCh(c: Ch, patch: Partial<ChannelState>) {
    const ch = this.s.ch.slice() as [ChannelState, ChannelState]
    ch[c] = { ...ch[c], ...patch }
    this.set({ ch })
  }
  private flash(text: string, ms = 1100) {
    this.msgUntil = performance.now() + ms
    this.set({ message: text })
  }

  /* ---------------- wiring ---------------- */

  private running() {
    if (this.timer !== undefined) return
    this.masterGain.disconnect()
    this.masterGain.connect(this.ctx.destination)
    this.masterGain.connect(this.meterSplit)
    this.masterGain.connect(this.mainCueSend)
    this.timer = window.setInterval(() => this.tick(), 30)
    if (this.s.cueOut) void this.cueEl?.play()
  }

  /**
   * Patch a deck's cable: into channel 1 or 2, the aux input (no channel strip),
   * or nowhere, in which case the deck is silent, like a pulled cable.
   */
  plug(deck: Deck, jack: Jack) {
    this.running()
    this.known.add(deck)
    this.decks = this.decks.map((d) => (d === deck ? null : d)) as [Deck | null, Deck | null]
    if (this.auxDeck === deck) this.auxDeck = null
    deck.bus.disconnect()
    if (jack === 'aux') {
      this.auxDeck = deck
      deck.bus.connect(this.auxIn)
    } else if (jack !== null) {
      this.decks[jack] = deck
      deck.bus.connect(this.strips[jack].input)
    }
    this.applyStreamGain()
  }
  /** take the mixer away: every deck gets its speakers back */
  detach() {
    for (const d of this.known) {
      d.bus.disconnect()
      d.bus.connect(this.ctx.destination)
      d.setMixGain(1)
    }
    this.known.clear()
    this.decks = [null, null]
    this.auxDeck = null
    clearInterval(this.timer)
    this.timer = undefined
    this.masterGain.disconnect()
    this.cueEl?.pause()
  }

  /** normal: each channel through its own FX; serial: the main mix through FX 1 then FX 2 */
  private route() {
    const [a, b] = this.strips
    for (const st of this.strips) {
      st.panner.disconnect()
      st.panner.connect(st.cueSend)
      st.fx.output.disconnect()
    }
    this.masterSum.disconnect()
    if (this.s.serial) {
      a.panner.connect(a.fader)
      b.panner.connect(b.fader)
      this.masterSum.connect(a.fx.input)
      a.fx.output.connect(b.fx.input)
      b.fx.output.connect(this.masterGain)
    } else {
      for (const st of this.strips) {
        st.panner.connect(st.fx.input)
        st.fx.output.connect(st.fader)
      }
      this.masterSum.connect(this.masterGain)
    }
  }

  private applyAll() {
    this.s.ch.forEach((_, i) => this.applyCh(i as Ch))
    this.applyMaster()
  }
  private applyCh(c: Ch) {
    const st = this.strips[c]
    const ch = this.s.ch[c]
    const t = this.ctx.currentTime
    st.input.gain.setTargetAtTime(dbToLin(ch.gain), t, 0.02)
    st.setEq(this.s.eqStyle, ch.eq)
    st.setComp(ch.comp, ch.compType)
    st.panner.pan.setTargetAtTime(ch.pan, t, 0.02)
    st.fader.gain.setTargetAtTime(ch.fader * ch.fader, t, 0.02)
    st.cueSend.gain.setTargetAtTime(ch.cue ? 1 : 0, t, 0.01)
    st.fx.select(ch.fx)
    this.applyStreamGain()
  }
  private applyMaster() {
    const t = this.ctx.currentTime
    this.masterGain.gain.setTargetAtTime(this.s.power ? this.s.master * this.s.master : 0, t, 0.02)
    this.mainCueSend.gain.setTargetAtTime(this.s.mainCue ? 1 : 0, t, 0.01)
    this.phonesGain.gain.setTargetAtTime(this.s.phones * this.s.phones, t, 0.02)
    this.applyStreamGain()
  }
  /** a streaming deck can only follow the volume path: fader x gain cut x main */
  private applyStreamGain() {
    const main = this.s.power ? this.s.master * this.s.master : 0
    for (const d of this.known) {
      const i = this.decks.indexOf(d)
      if (i >= 0) {
        const ch = this.s.ch[i]
        d.setMixGain(ch.fader * ch.fader * Math.min(1, dbToLin(ch.gain)) * main)
      } else d.setMixGain(d === this.auxDeck ? main : 0) // unplugged: silent
    }
  }

  /* ---------------- panel: power, master ---------------- */

  setPower(on: boolean) {
    this.set({ power: on })
    this.applyMaster()
  }
  setMaster(v: number) {
    this.set({ master: clamp(v, 0, 1) })
    this.applyMaster()
  }
  setPhones(v: number) {
    this.set({ phones: clamp(v, 0, 1) })
    this.applyMaster()
  }

  /* ---------------- channel strip ---------------- */

  /** what the gain knob is turning right now (its screen decides) */
  gainKnob(c: Ch): { value: number; min: number; max: number; set: (v: number) => void } {
    const s = this.s
    const ch = s.ch[c]
    if (s.screen === 'comp' && s.screenCh === c) {
      if (s.selectHeld)
        return {
          value: COMP_TYPES.indexOf(ch.compType) + 0.5,
          min: 0,
          max: 2.99,
          set: (v) => this.setComp(c, ch.comp, COMP_TYPES[Math.floor(v)]),
        }
      return { value: ch.comp, min: 0, max: 1, set: (v) => this.setComp(c, v, ch.compType) }
    }
    if (s.screen === 'channel' && s.screenCh === c && s.selectHeld)
      return { value: ch.pan, min: -1, max: 1, set: (v) => this.setPan(c, v) }
    return { value: ch.gain, min: -24, max: 24, set: (v) => this.setGain(c, v) }
  }
  setGain(c: Ch, db: number) {
    this.setCh(c, { gain: Math.round(clamp(db, -24, 24) * 10) / 10 })
    this.applyCh(c)
    if (this.s.selectHeld && this.s.screen === 'main') this.flash(`GAIN ${this.fmtDb(this.s.ch[c].gain)}`, 900)
  }
  setPan(c: Ch, v: number) {
    this.setCh(c, { pan: Math.round(clamp(v, -1, 1) * 50) / 50 })
    this.applyCh(c)
  }
  setComp(c: Ch, amount: number, type: CompType) {
    this.setCh(c, { comp: clamp(amount, 0, 1), compType: type })
    this.applyCh(c)
    this.localOnly(c)
  }
  /** click on the gain knob: compressor; with select held: gain and pan */
  gainTap(c: Ch) {
    const screen: Screen = this.s.selectHeld ? 'channel' : 'comp'
    const same = this.s.screen === screen && this.s.screenCh === c
    this.set({ screen: same ? 'main' : screen, screenCh: c })
  }
  setEq(c: Ch, band: 'high' | 'mid' | 'low', v: number) {
    this.setCh(c, { eq: { ...this.s.ch[c].eq, [band]: clamp(v, -1, 1) } })
    this.applyCh(c)
    this.localOnly(c)
  }
  setFader(c: Ch, v: number) {
    this.setCh(c, { fader: clamp(v, 0, 1) })
    this.applyCh(c)
    if (this.s.selectHeld) this.set({ screen: 'level', screenCh: c })
  }

  cueDown(c: Ch) {
    if (this.s.selectHeld) return this.set({ screen: this.s.screen === 'tempo' ? 'main' : 'tempo' })
    if (this.s.screen === 'tempo') {
      this.tap(c)
      // holding cue on the tempo screen toggles tempo tracking for that channel
      this.holdTimers[c] = window.setTimeout(() => this.toggleTracking(c), 700)
      return
    }
    this.cueHeld[c] = true
    if (this.cueHeld[0] && this.cueHeld[1]) {
      this.cueCombo = true
      const mainCue = !this.s.mainCue
      this.set({ mainCue })
      this.applyMaster()
      this.flash(mainCue ? 'MAIN CUE' : 'MAIN CUE OFF')
    }
  }
  cueUp(c: Ch) {
    clearTimeout(this.holdTimers[c])
    if (!this.cueHeld[c]) return
    this.cueHeld[c] = false
    if (this.cueCombo) {
      if (!this.cueHeld[0] && !this.cueHeld[1]) this.cueCombo = false
      return
    }
    this.setCh(c, { cue: !this.s.ch[c].cue })
    this.applyCh(c)
    if (this.s.ch[c].cue && this.s.inputs[c] === 'stream') this.flash('LOCAL ONLY')
    if (this.s.ch[c].cue && !this.s.cueOut) this.flash('NO CUE OUT', 1300)
  }

  /* ---------------- tempo ---------------- */

  private tap(c: Ch) {
    const now = performance.now()
    const taps = this.taps[c]
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0
    taps.push(now)
    if (taps.length > 5) taps.shift()
    if (taps.length < 2) return
    const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1)
    this.setCh(c, { bpm: Math.round(clamp(60000 / iv, 50, 220) * 10) / 10, tracking: false })
  }
  private toggleTracking(c: Ch) {
    const tracking = !this.s.ch[c].tracking
    this.setCh(c, { tracking })
    if (tracking) {
      if (this.s.inputs[c] !== 'local') {
        this.setCh(c, { tracking: false })
        return this.flash('LOCAL ONLY')
      }
      void this.detect(c)
    }
  }
  private async detect(c: Ch) {
    const d = this.decks[c]
    if (!d) return
    this.lastTrack[c] = d.getState().track
    const r = await d.trackBpm()
    if (r && this.s.ch[c].tracking) this.setCh(c, { bpm: r.bpm })
  }
  private bpmFor(c: Ch) {
    const src = this.s.tempoSource
    const ch = src === 'own' ? c : src === 'ch1' ? 0 : 1
    return this.s.ch[ch].bpm
  }

  /* ---------------- FX ---------------- */

  fxDown(c: Ch) {
    const fxHeld = this.s.fxHeld.slice() as [boolean, boolean]
    fxHeld[c] = true
    this.set({ fxHeld })
    if (fxHeld[0] && fxHeld[1]) {
      if (this.s.selectHeld) {
        const serial = !this.s.serial
        this.set({ serial, screen: 'main' })
        this.route()
        return this.flash(serial ? 'SERIAL FX' : 'PARALLEL FX')
      }
      return this.set({ focus: 'both', screen: 'main' })
    }
    this.stickZone = 0
    if (this.s.screen === 'fx' && this.s.screenCh === c) {
      this.set(this.fxReturn)
      return
    }
    if (this.s.screen !== 'fx') this.fxReturn = { screen: this.s.screen, screenCh: this.s.screenCh }
    this.set({ focus: c, screen: 'fx', screenCh: c })
  }
  fxUp(c: Ch) {
    const fxHeld = this.s.fxHeld.slice() as [boolean, boolean]
    fxHeld[c] = false
    this.set({ fxHeld })
  }

  /** the mod stick: -1..1, springs back to 0 */
  setStick(v: number) {
    const stick = clamp(v, -1, 1)
    const prev = this.s.stick
    this.set({ stick })
    // stepping through a list: settings, or the selected channel’s FX menu
    const zone = stick > 0.5 ? 1 : stick < -0.5 ? -1 : 0
    const stepped = zone !== 0 && zone !== this.stickZone
    this.stickZone = zone
    if (this.s.screen === 'settings') {
      if (stepped) this.set({ settingsIndex: (this.s.settingsIndex + zone + SETTINGS.length) % SETTINGS.length })
      return
    }
    if (this.s.screen === 'fx') {
      if (!stepped) return
      const c = this.s.screenCh
      const i = FX_TYPES.indexOf(this.s.ch[c].fx)
      this.setCh(c, { fx: FX_TYPES[(i + zone + FX_TYPES.length) % FX_TYPES.length] })
      this.applyCh(c)
      return
    }
    this.modInput(stick, this.s.pad, stick !== prev)
  }
  /** the force pad: 0..1 */
  setPad(p: number) {
    const pad = clamp(p, 0, 1)
    const prev = this.s.pad
    this.set({ pad })
    const down = pad > 0.3
    const pressed = down && !this.padDown
    this.padDown = down
    if (this.s.screen === 'settings') {
      if (pressed) this.changeSetting()
      return
    }
    this.modInput(this.s.stick, pad, pad !== prev)
  }

  private targets(): Ch[] {
    return this.s.focus === 'both' ? [0, 1] : [this.s.focus]
  }
  private modInput(stick: number, pad: number, moved: boolean) {
    const active = Math.abs(stick) > 0.02 || pad > 0.01
    // moving the stick or pad ends sequence playback
    if (this.s.seq === 'play' && moved && active) this.set({ seq: 'idle' })
    if (this.s.locked) {
      if (!active) this.lockReleased = true
      else if (this.lockReleased && moved) {
        this.set({ locked: false })
        this.lockReleased = false
      } else return
    }
    for (const c of this.targets()) this.mods[c] = { stick, pad }
    if (active) for (const c of this.targets()) this.localOnly(c, true)
    if (this.s.seq === 'armed' && active && moved) {
      this.recording = []
      this.recStart = performance.now()
      this.recTargets = this.targets()
      this.set({ seq: 'rec' })
    }
    if (this.s.seq === 'rec') this.recording.push({ t: performance.now() - this.recStart, stick, pad })
  }

  selectDown() {
    this.set({ selectHeld: true })
    const { stick, pad } = this.s
    if (Math.abs(stick) > 0.02 || pad > 0.01) {
      // press select while modulating: hold the effect where it is
      this.lockReleased = false
      this.set({ locked: true })
      return this.flash('LOCK')
    }
    if (this.s.screen === 'settings') return this.changeSetting()
    if (this.s.seq === 'idle' || this.s.seq === 'play') this.set({ seq: 'armed' })
  }
  selectUp() {
    this.set({ selectHeld: false })
    if (this.s.screen === 'level') this.set({ screen: 'main' })
    if (this.s.seq === 'rec' && this.recording.length > 1) {
      // loop length: what was recorded, rounded to whole beats (1..8)
      const beat = 60000 / this.bpmFor(this.recTargets[0])
      const dur = performance.now() - this.recStart
      this.loopLen = clamp(Math.round(dur / beat), 1, 8) * beat
      this.playStart = performance.now()
      this.set({ seq: 'play' })
      this.flash('FX SEQ', 800)
    } else if (this.s.seq === 'armed' || this.s.seq === 'rec') this.set({ seq: 'idle' })
  }

  /* ---------------- system settings ---------------- */

  systemPress() {
    const open = this.s.screen !== 'settings'
    this.set({ screen: open ? 'settings' : 'main' })
    if (open) void this.listCueOutputs()
  }
  private changeSetting() {
    const item = SETTINGS[this.s.settingsIndex]
    if (item === 'EQ') {
      const eqStyle = EQ_STYLES[(EQ_STYLES.indexOf(this.s.eqStyle) + 1) % EQ_STYLES.length]
      this.set({ eqStyle })
      this.applyAll()
    } else if (item === 'TEMPO') {
      const order = ['own', 'ch1', 'ch2'] as const
      this.set({ tempoSource: order[(order.indexOf(this.s.tempoSource) + 1) % 3] })
    } else {
      const opts = ['', ...this.s.cueOutputs.map((o) => o.id)]
      if (this.s.cueOutputs.length === 0) return void this.unlockOutputs()
      const next = opts[(opts.indexOf(this.s.cueOut) + 1) % opts.length]
      void this.setCueOut(next)
    }
  }
  private async listCueOutputs() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const outs = all
        .filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d) => ({ id: d.deviceId, label: d.label || 'output' }))
      this.set({ cueOutputs: outs })
    } catch {
      this.set({ cueOutputs: [] })
    }
  }
  /** browsers only name output devices after a microphone permission; ask once, from settings */
  private async unlockOutputs() {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true })
      st.getTracks().forEach((t) => t.stop())
    } catch {
      return this.flash('NO ACCESS')
    }
    await this.listCueOutputs()
    if (!this.s.cueOutputs.length) this.flash('NO OUTPUTS')
  }
  private async setCueOut(id: string) {
    this.set({ cueOut: id })
    if (!id) {
      this.cueEl?.pause()
      return
    }
    if (!this.cueEl) {
      this.cueEl = new Audio()
      this.cueEl.srcObject = this.cueDest.stream
    }
    const el = this.cueEl as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
    try {
      await el.setSinkId?.(id)
      await el.play()
    } catch {
      this.flash('CUE OUT ERR')
    }
  }

  /* ---------------- helpers ---------------- */

  private localOnly(c: Ch, fxOnly = false) {
    if (this.s.inputs[c] !== 'stream') return
    if (fxOnly && this.s.ch[c].fx === 'siren') return
    if (!this.s.message) this.flash('LOCAL ONLY', 900)
  }
  fmtDb(db: number) {
    return `${db > 0 ? '+' : ''}${db.toFixed(1)}`
  }

  /* ---------------- tick ---------------- */

  private tick() {
    const now = performance.now()
    const patch: Partial<MixerState> = {}
    if (this.s.message && now > this.msgUntil) patch.message = null

    // what is plugged into each channel
    const inputs = this.decks.map((d) => {
      if (!d?.getState().disc) return null
      return d.sourceKind === 'local' ? 'local' : 'stream'
    }) as [Input, Input]
    if (inputs[0] !== this.s.inputs[0] || inputs[1] !== this.s.inputs[1]) patch.inputs = inputs

    // tempo tracking follows track changes
    this.decks.forEach((d, i) => {
      if (d && this.s.ch[i].tracking && d.getState().track !== this.lastTrack[i]) void this.detect(i as Ch)
    })

    // FX sequencer playback
    if (this.s.seq === 'play' && this.recording.length) {
      const t = (now - this.playStart) % this.loopLen
      let smp = this.recording[0]
      for (const r of this.recording) {
        if (r.t > t) break
        smp = r
      }
      // past the end of what was played: rest
      if (t > this.recording[this.recording.length - 1].t + 60) smp = { t, stick: 0, pad: 0 }
      for (const c of this.recTargets) this.mods[c] = { stick: smp.stick, pad: smp.pad }
    } else if (!this.s.locked) {
      for (const c of [0, 1] as Ch[]) if (!this.targets().includes(c)) this.mods[c] = { stick: 0, pad: 0 }
    }
    this.strips.forEach((st, i) => st.fx.update(this.mods[i].stick, this.mods[i].pad, this.bpmFor(i as Ch)))

    // meters: real for local audio; a streaming deck borrows its own (animated) VU
    const ch = this.s.ch.map((c, i) => {
      let lv: [number, number]
      if (inputs[i] === 'stream') {
        const vu = this.decks[i]!.getState().vu
        lv = [vu[0] * c.fader, vu[1] * c.fader]
      } else {
        const [l, r] = this.strips[i].levels()
        const bar = (p: number) => clamp((20 * Math.log10(p + 1e-6) + 36) / 36, 0, 1)
        lv = [bar(l), bar(r)]
      }
      const fall = (v: number, t: number) => (t > v ? t : Math.max(t, v * 0.85))
      return { ...c, meter: [fall(c.meter[0], lv[0]), fall(c.meter[1], lv[1])] as [number, number] }
    }) as [ChannelState, ChannelState]
    patch.ch = ch
    const peak = (a: AnalyserNode) => {
      a.getFloatTimeDomainData(this.mbuf)
      let m = 0
      for (let i = 0; i < this.mbuf.length; i++) m = Math.max(m, Math.abs(this.mbuf[i]))
      return clamp((20 * Math.log10(m + 1e-6) + 36) / 36, 0, 1)
    }
    // Always meter the actual master bus (local files, AUX, FX and master gain).
    // Only add a visual estimate for audio that lives inside an external player.
    const mm: [number, number] = [peak(this.masterMeters[0]), peak(this.masterMeters[1])]
    const streamMeters = ch.filter((_, i) => inputs[i] === 'stream').map(c => c.meter)
    if (this.auxDeck && this.auxDeck.sourceKind !== 'local') streamMeters.push(this.auxDeck.getState().vu)
    if (this.s.power) {
      for (const levels of streamMeters) {
        mm[0] = Math.max(mm[0], levels[0] * this.s.master)
        mm[1] = Math.max(mm[1], levels[1] * this.s.master)
      }
    }
    patch.masterMeter = [Math.max(mm[0], this.s.masterMeter[0] * 0.85), Math.max(mm[1], this.s.masterMeter[1] * 0.85)]
    this.set(patch)
  }
}
