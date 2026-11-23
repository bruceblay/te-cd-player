/*
 * The sidekick's six effects. Each one sits in a channel's FX slot (or in the
 * master chain in serial mode) and is driven by two controls:
 *   stick: the mod stick, -1..1, springs back to 0
 *   pad:   the force pad, 0..1
 * An effect is only heard while modulated (or locked / sequenced); at rest it
 * passes the signal through untouched, like the hardware.
 */
import { loadSidekickWorklets } from './sidekickWorklet'

export type FxType = 'filter' | 'delay' | 'tape' | 'loop' | 'tremolo' | 'siren'
export const FX_TYPES: FxType[] = ['filter', 'delay', 'tape', 'loop', 'tremolo', 'siren']

export interface Fx {
  readonly input: AudioNode
  readonly output: AudioNode
  update(stick: number, pad: number, bpm: number): void
}

const T = 0.03 // parameter smoothing, seconds

/** stick -1..1 picks one step from a list of note values; centre is the middle one */
function pick<T>(list: T[], stick: number): T {
  const i = Math.round(((stick + 1) / 2) * (list.length - 1))
  return list[Math.max(0, Math.min(list.length - 1, i))]
}
/** note value (1/4 = quarter) to seconds */
const noteSecs = (v: number, bpm: number) => (v * 4 * 60) / bpm

class Filter implements Fx {
  readonly input: GainNode
  readonly output: GainNode
  private hp: BiquadFilterNode
  private lp: BiquadFilterNode
  private noise: GainNode
  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 10, Q: 0.7 })
    this.lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 22000, Q: 0.7 })
    this.input.connect(this.hp).connect(this.lp).connect(this.output)
    // the pad adds resonance and a little noise so the sweep is audible on its own
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true })
    this.noise = new GainNode(ctx, { gain: 0 })
    src.connect(this.noise).connect(this.hp)
    src.start()
  }
  update(stick: number, pad: number) {
    const t = this.ctx.currentTime
    const q = 0.7 + pad * 17
    // stick left: low-pass closing to 200 Hz; right: high-pass opening to 5 kHz
    const lpf = stick < -0.02 ? 22000 * Math.pow(200 / 22000, -stick) : 22000
    const hpf = stick > 0.02 ? 10 * Math.pow(5000 / 10, stick) : 10
    this.lp.frequency.setTargetAtTime(lpf, t, T)
    this.hp.frequency.setTargetAtTime(hpf, t, T)
    this.lp.Q.setTargetAtTime(stick < -0.02 ? q : 0.7, t, T)
    this.hp.Q.setTargetAtTime(stick > 0.02 ? q : 0.7, t, T)
    this.noise.gain.setTargetAtTime(pad * 0.035, t, T)
  }
}

class Delay implements Fx {
  readonly input: GainNode
  readonly output: GainNode
  private send: GainNode
  private delay: DelayNode
  private static NOTES = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2]
  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.send = new GainNode(ctx, { gain: 0 })
    this.delay = new DelayNode(ctx, { maxDelayTime: 10, delayTime: 0.5 })
    const fb = new GainNode(ctx, { gain: 0.45 })
    const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 6000 })
    this.input.connect(this.output) // dry always
    this.input.connect(this.send).connect(this.delay)
    this.delay.connect(tone).connect(fb).connect(this.delay)
    tone.connect(this.output)
  }
  update(stick: number, pad: number, bpm: number) {
    const t = this.ctx.currentTime
    // the pad sets the amount; the stick picks 1/32 .. 2/1 (centre: 1/4)
    this.send.gain.setTargetAtTime(pad, t, T)
    this.delay.delayTime.setTargetAtTime(Math.min(10, noteSecs(pick(Delay.NOTES, stick), bpm)), t, 0.05)
  }
}

class Tremolo implements Fx {
  readonly input: GainNode
  readonly output: GainNode
  private depth: GainNode
  private lfo: OscillatorNode
  private vca: GainNode
  private static NOTES = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1]
  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    const vca = new GainNode(ctx, { gain: 1 })
    this.input.connect(vca).connect(this.output)
    this.lfo = new OscillatorNode(ctx, { type: 'square', frequency: 2 })
    const smooth = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 40 })
    this.depth = new GainNode(ctx, { gain: 0 })
    this.lfo.connect(smooth).connect(this.depth).connect(vca.gain)
    this.lfo.start()
    this.vca = vca
  }
  update(stick: number, pad: number, bpm: number) {
    const t = this.ctx.currentTime
    // beat-locked chop: depth from the pad, length from the stick
    this.vca.gain.setTargetAtTime(1 - pad / 2, t, T)
    this.depth.gain.setTargetAtTime(pad / 2, t, T)
    this.lfo.frequency.setTargetAtTime(1 / noteSecs(pick(Tremolo.NOTES, stick), bpm), t, T)
  }
}

class Siren implements Fx {
  readonly input: GainNode
  readonly output: GainNode
  private osc: OscillatorNode
  private env: GainNode
  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.input.connect(this.output)
    // a dub siren: square wave with a wobbling pitch, gated by the pad
    this.osc = new OscillatorNode(ctx, { type: 'square', frequency: 440 })
    const wob = new OscillatorNode(ctx, { type: 'triangle', frequency: 3.2 })
    const wobDepth = new GainNode(ctx, { gain: 160 })
    wob.connect(wobDepth).connect(this.osc.detune)
    const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2400 })
    this.env = new GainNode(ctx, { gain: 0 })
    this.osc.connect(tone).connect(this.env).connect(this.output)
    this.osc.start()
    wob.start()
  }
  update(stick: number, pad: number) {
    const t = this.ctx.currentTime
    const base = 150 * Math.pow(2, 3 * ((stick + 1) / 2)) // 150 .. 1200 Hz
    this.osc.frequency.setTargetAtTime(base * (1 + pad * 1.2), t, 0.06)
    this.env.gain.setTargetAtTime(pad > 0.02 ? 0.22 * Math.sqrt(pad) : 0, t, pad > 0.02 ? 0.01 : 0.15)
  }
}

class Tape implements Fx {
  readonly input: GainNode
  readonly output: GainNode
  private node: AudioWorkletNode | null = null
  constructor(ctx: AudioContext) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.input.connect(this.output)
    void loadSidekickWorklets(ctx).then(() => {
      this.node = new AudioWorkletNode(ctx, 'sk-tape', { outputChannelCount: [2] })
      this.input.disconnect()
      this.input.connect(this.node).connect(this.output)
    })
  }
  update(stick: number, pad: number) {
    this.node?.port.postMessage({ stick, pad })
  }
}

class Loop implements Fx {
  readonly input: GainNode
  readonly output: GainNode
  private node: AudioWorkletNode | null = null
  private last = ''
  private static NOTES = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2]
  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.input.connect(this.output)
    void loadSidekickWorklets(ctx).then(() => {
      this.node = new AudioWorkletNode(ctx, 'sk-loop', { outputChannelCount: [2] })
      this.input.disconnect()
      this.input.connect(this.node).connect(this.output)
    })
  }
  update(stick: number, pad: number, bpm: number) {
    // the pad engages a loop of the last N beats; the stick sets N (and changes it while looping)
    const engage = pad > 0.05
    const len = noteSecs(pick(Loop.NOTES, stick), bpm) * this.ctx.sampleRate
    const key = `${engage}:${Math.round(len)}`
    if (key === this.last) return
    this.last = key
    this.node?.port.postMessage({ engage, len })
  }
}

/** one FX slot: holds all six effects and routes through the selected one */
export class FxSlot {
  readonly input: GainNode
  readonly output: GainNode
  private fx: Record<FxType, Fx>
  private current: FxType = 'filter'
  constructor(ctx: AudioContext) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.fx = {
      filter: new Filter(ctx),
      delay: new Delay(ctx),
      tape: new Tape(ctx),
      loop: new Loop(ctx),
      tremolo: new Tremolo(ctx),
      siren: new Siren(ctx),
    }
    for (const f of Object.values(this.fx)) f.output.connect(this.output)
    this.input.connect(this.fx.filter.input)
  }
  get type() {
    return this.current
  }
  select(t: FxType) {
    if (t === this.current) return
    this.fx[this.current].update(0, 0, 120)
    this.input.disconnect()
    this.input.connect(this.fx[t].input)
    this.current = t
  }
  update(stick: number, pad: number, bpm: number) {
    this.fx[this.current].update(stick, pad, bpm)
  }
}
