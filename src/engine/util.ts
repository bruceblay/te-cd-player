const scripts = new Map<string, Promise<void>>()

export function loadScript(src: string): Promise<void> {
  let p = scripts.get(src)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        scripts.delete(src)
        reject(new Error(`failed to load ${src}`))
      }
      document.head.appendChild(s)
    })
    scripts.set(src, p)
  }
  return p
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 8000, everyMs = 100): Promise<T> {
  const end = performance.now() + timeoutMs
  for (;;) {
    const v = fn()
    if (v) return v
    if (performance.now() > end) throw new Error('timed out')
    await sleep(everyMs)
  }
}

let ctx: AudioContext | null = null
/** one shared context at the CD rate so ripping writes 44.1 kHz files */
export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ sampleRate: 44100 })
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** equal for publishing purposes: identical, or number tuples (meters) equal to within a hair */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-4
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v) => typeof v === 'number')) {
    return a.every((v, i) => Math.abs(v - (b[i] as number)) < 1e-4)
  }
  return false
}
