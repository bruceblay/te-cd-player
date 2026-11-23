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
