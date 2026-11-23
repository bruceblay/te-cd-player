import { audioContext } from './util'

/** Tempo estimate from an onset-strength envelope + autocorrelation. */
export async function detectBpm(file: Blob): Promise<{ bpm: number; confidence: number } | null> {
  const ctx = audioContext()
  let buf: AudioBuffer
  try {
    buf = await ctx.decodeAudioData(await file.arrayBuffer())
  } catch {
    return null
  }
  const sr = buf.sampleRate
  // analyse up to 60 s from the 20 s mark (skip intros)
  const start = Math.min(Math.floor(20 * sr), Math.max(0, buf.length - 60 * sr))
  const len = Math.min(buf.length - start, 60 * sr)
  if (len < 8 * sr) return null
  const L = buf.getChannelData(0)
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L
  const hop = 512
  const frames = Math.floor(len / hop)
  const env = new Float32Array(frames)
  let lp = 0
  let prev = 0
  for (let f = 0; f < frames; f++) {
    let e = 0
    const o = start + f * hop
    for (let i = 0; i < hop; i++) {
      // gentle low-pass so kicks and bass dominate
      lp += 0.15 * ((L[o + i] + R[o + i]) * 0.5 - lp)
      e += lp * lp
    }
    const le = Math.log1p(e * 100)
    env[f] = Math.max(0, le - prev)
    prev = le
  }
  const fps = sr / hop
  const minLag = Math.floor((fps * 60) / 200)
  const maxLag = Math.ceil((fps * 60) / 60)
  const ac = new Float32Array(maxLag + 1)
  let mean = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0
    for (let i = 0; i + lag < frames; i++) s += env[i] * env[i + lag]
    ac[lag] = s / (frames - lag)
    mean += ac[lag]
  }
  mean /= maxLag - minLag + 1
  // favour the common 80-160 range a little
  const score = (lag: number) => {
    const b = (60 * fps) / lag
    return ac[lag] * (b >= 80 && b <= 160 ? 1.1 : 1)
  }
  let best = minLag
  for (let lag = minLag; lag <= maxLag; lag++) if (score(lag) > score(best)) best = lag
  // parabolic interpolation around the peak for sub-frame lag resolution
  let lag = best
  if (best > minLag && best < maxLag) {
    const a = ac[best - 1],
      b = ac[best],
      c = ac[best + 1]
    const den = a - 2 * b + c
    if (den !== 0) lag = best + (0.5 * (a - c)) / den
  }
  let bpm = (60 * fps) / lag
  while (bpm < 80) bpm *= 2
  while (bpm > 165) bpm /= 2
  let variance = 0
  for (let lag = minLag; lag <= maxLag; lag++) variance += (ac[lag] - mean) ** 2
  const sd = Math.sqrt(variance / (maxLag - minLag + 1)) || 1
  const confidence = Math.round(Math.max(0, Math.min(99, ((ac[best] - mean) / sd) * 20)))
  return { bpm: Math.round(bpm * 10) / 10, confidence }
}

/** 16-bit stereo PCM WAV */
export function encodeWav(chunks: [Float32Array, Float32Array][], sampleRate: number): Blob {
  const n = chunks.reduce((a, c) => a + c[0].length, 0)
  const buf = new ArrayBuffer(44 + n * 4)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + n * 4, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 2, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 4, true)
  v.setUint16(32, 4, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, n * 4, true)
  let o = 44
  for (const [l, r] of chunks) {
    for (let i = 0; i < l.length; i++) {
      v.setInt16(o, Math.max(-1, Math.min(1, l[i])) * 0x7fff, true)
      v.setInt16(o + 2, Math.max(-1, Math.min(1, r[i])) * 0x7fff, true)
      o += 4
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}

const TAP_WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.port.onmessage = (e) => { this.on = e.data } }
  process(inputs) {
    const i = inputs[0]
    if (this.on && i && i.length) this.port.postMessage([i[0].slice(0), (i[1] || i[0]).slice(0)])
    return true
  }
}
registerProcessor('bc1-tap', Tap)
`
let tapModule: Promise<void> | null = null
export function loadTapWorklet(ctx: AudioContext) {
  if (!tapModule) {
    const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'text/javascript' }))
    tapModule = ctx.audioWorklet.addModule(url)
  }
  return tapModule
}
