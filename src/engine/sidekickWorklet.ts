/*
 * Sample-level processors for the two sidekick effects that need memory of
 * the live signal: TAPE (scrub the recent past forwards and backwards) and
 * LOOP (repeat the last N beats). Both pass audio straight through when idle.
 */
const SOURCE = `
const fade = (n, len, f) => Math.min(1, n / f, (len - n) / f)

class Tape extends AudioWorkletProcessor {
  constructor() {
    super()
    this.size = Math.floor(sampleRate * 8)
    this.buf = [new Float32Array(this.size), new Float32Array(this.size)]
    this.w = 0
    this.lag = 0          // samples behind live
    this.rate = 1
    this.stick = 0
    this.pad = 0
    this.t = 0
    this.xf = 0           // crossfade back to live after a scrub
    this.port.onmessage = (e) => { this.stick = e.data.stick; this.pad = e.data.pad }
  }
  read(ch, pos) {
    const b = this.buf[ch], n = this.size
    const i = Math.floor(pos), f = pos - i
    const a = b[((i % n) + n) % n], c = b[(((i + 1) % n) + n) % n]
    return a + (c - a) * f
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0]
    const L = inp[0] || new Float32Array(128), R = inp[1] || L
    const engaged = Math.abs(this.stick) > 0.04
    // stick left: slow, stop, then rewind (to -3x); right: fast-forward towards live (to 2x)
    let target = 1
    if (engaged) target = this.stick < 0 ? 1 + this.stick * 4 : 1 + this.stick
    for (let i = 0; i < L.length; i++) {
      this.buf[0][this.w] = L[i]
      this.buf[1][this.w] = R[i]
      this.rate += (target - this.rate) * 0.002
      // wow (slow) and flutter (fast) from the pad
      const wf = this.pad * (0.6 * Math.sin(2 * Math.PI * 0.7 * this.t) + 0.4 * Math.sin(2 * Math.PI * 6.5 * this.t)) * 0.012
      this.t += 1 / sampleRate
      const r = this.rate + wf
      this.lag += 1 - r
      if (this.lag < 0) { this.lag = 0; if (this.rate > 1) this.rate = 1 }
      if (this.lag > this.size - 256) this.lag = this.size - 256
      if (!engaged && this.lag > 0 && this.pad < 0.01 && this.xf === 0) this.xf = 1
      let l, rr
      if (this.xf > 0) {
        // 20 ms fade from the scrubbed head back to live
        const g = this.xf
        l = this.read(0, this.w - this.lag) * g + L[i] * (1 - g)
        rr = this.read(1, this.w - this.lag) * g + R[i] * (1 - g)
        this.xf -= 1 / (sampleRate * 0.02)
        if (this.xf <= 0) { this.xf = 0; this.lag = 0; this.rate = 1 }
      } else if (this.lag === 0 && this.pad < 0.01) {
        l = L[i]; rr = R[i]
      } else {
        l = this.read(0, this.w - this.lag); rr = this.read(1, this.w - this.lag)
      }
      out[0][i] = l
      if (out[1]) out[1][i] = rr
      this.w = (this.w + 1) % this.size
    }
    return true
  }
}
registerProcessor('sk-tape', Tape)

class Loop extends AudioWorkletProcessor {
  constructor() {
    super()
    this.size = Math.floor(sampleRate * 16)
    this.buf = [new Float32Array(this.size), new Float32Array(this.size)]
    this.w = 0
    this.on = false
    this.start = 0
    this.len = sampleRate / 2
    this.pos = 0
    this.mix = 0          // 0 live .. 1 loop, ramped to avoid clicks
    this.port.onmessage = (e) => {
      const { engage, len } = e.data
      if (len) { this.len = Math.max(256, Math.min(this.size - 256, Math.floor(len))); if (this.pos >= this.len) this.pos %= this.len }
      if (engage && !this.on) { this.start = this.w - this.len; this.pos = 0 }
      this.on = engage
    }
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0]
    const L = inp[0] || new Float32Array(128), R = inp[1] || L
    const n = this.size, f = sampleRate * 0.004
    for (let i = 0; i < L.length; i++) {
      if (!this.on || this.mix < 1) { this.buf[0][this.w] = L[i]; this.buf[1][this.w] = R[i] }
      this.mix += ((this.on ? 1 : 0) - this.mix) * 0.01
      let l = L[i], r = R[i]
      if (this.mix > 0.0005) {
        const k = (((this.start + this.pos) % n) + n) % n
        const g = fade(this.pos, this.len, f)
        l = l * (1 - this.mix) + this.buf[0][k] * g * this.mix
        r = r * (1 - this.mix) + this.buf[1][k] * g * this.mix
        this.pos = (this.pos + 1) % this.len
      }
      out[0][i] = l
      if (out[1]) out[1][i] = r
      this.w = (this.w + 1) % n
    }
    return true
  }
}
registerProcessor('sk-loop', Loop)
`

let loaded: Promise<void> | null = null
export function loadSidekickWorklets(ctx: AudioContext) {
  if (!loaded) {
    const url = URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' }))
    loaded = ctx.audioWorklet.addModule(url)
  }
  return loaded
}
