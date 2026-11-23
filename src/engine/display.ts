import type { DeckState } from './deck'

export interface Readout {
  /** 12 characters: TRACK INDEX MIN SEC, three digits each */
  main: string
  /** per-character blink flags */
  blink: boolean[]
  /** per-character decimal points */
  dots: boolean[]
  line: string
  vari: string
}

const p3 = (n: number) => String(Math.max(0, Math.floor(n)) % 1000).padStart(3, '0')
const blank12 = ' '.repeat(12)

export function readout(s: DeckState): Readout {
  const none = { blink: Array(12).fill(false), dots: Array(12).fill(false) }
  if (s.power !== 'on') return { main: blank12, ...none, line: '   ', vari: '   ' }

  const line = p3(s.level)
  const vari = s.caps && !s.caps.varispeed ? '---' : p3(s.caps ? s.vari : s.varispeed)
  const out = (text: string, extra: Partial<Readout> = {}): Readout => {
    // a '.' lights the previous cell's decimal point instead of taking a cell
    let chars = ''
    const dots: boolean[] = []
    for (const ch of text) {
      if (ch === '.' && chars.length) dots[chars.length - 1] = true
      else chars += ch
    }
    return {
      main: chars.padEnd(12, ' ').slice(0, 12),
      ...none,
      dots: Array.from({ length: 12 }, (_, i) => !!dots[i]),
      line,
      vari,
      ...extra,
    }
  }

  if (s.message) return out(s.message)
  if (s.loading) return out('load')
  if (!s.disc) return out('no disc')

  const folder = s.disc.tracks[s.track]?.folder ?? 1
  if (s.entry) {
    const e = s.entry
    const field = (v: string, fallback: string) => (v ? v.padStart(3, '0') : fallback)
    const main =
      field(e.track, p3(s.track + 1)) + p3(folder) + field(e.min, '000') + field(e.sec, '000')
    const at = { track: 0, min: 6, sec: 9 }[e.field]
    const blink = Array(12)
      .fill(false)
      .map((_, i) => i >= at && i < at + 3)
    return out(main, { blink })
  }

  const t = Math.max(0, s.position)
  const main = p3(s.track + 1) + p3(folder) + p3(t / 60) + p3(t % 60)
  const dots = Array(12).fill(false)
  if (s.sync.on && s.sync.beat) dots[11] = true
  if (s.recording) dots[2] = true
  // paused: time blinks, like most CD decks
  const blink = Array(12)
    .fill(false)
    .map((_, i) => s.transport === 'paused' && i >= 6)
  return out(main, { dots, blink })
}
