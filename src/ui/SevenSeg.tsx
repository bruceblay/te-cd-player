import { memo } from 'react'

// segment bits: a b c d e f g
const A = 1,
  B = 2,
  C = 4,
  D = 8,
  E = 16,
  F = 32,
  G = 64

const GLYPHS: Record<string, number> = {
  '0': A | B | C | D | E | F,
  '1': B | C,
  '2': A | B | G | E | D,
  '3': A | B | G | C | D,
  '4': F | G | B | C,
  '5': A | F | G | C | D,
  '6': A | F | G | E | D | C,
  '7': A | B | C,
  '8': 127,
  '9': A | B | C | D | F | G,
  a: A | B | C | E | F | G,
  b: C | D | E | F | G,
  c: D | E | G,
  d: B | C | D | E | G,
  e: A | D | E | F | G,
  f: A | E | F | G,
  g: A | B | C | D | F | G,
  h: C | E | F | G,
  i: E,
  j: B | C | D | E,
  k: B | C | E | F | G,
  l: D | E | F,
  m: A | C | E,
  n: C | E | G,
  o: C | D | E | G,
  p: A | B | E | F | G,
  q: A | B | C | F | G,
  r: E | G,
  s: A | F | G | C | D,
  t: D | E | F | G,
  u: C | D | E,
  v: B | C | D | E | F,
  w: B | D | F,
  x: B | C | E | F | G,
  y: B | C | D | F | G,
  z: A | B | D | E | G,
  '-': G,
  _: D,
  '=': G | D,
  "'": B,
  '"': B | F,
  '[': A | D | E | F,
  ']': A | B | C | D,
  '?': A | B | G | E,
  ' ': 0,
}

const W = 20
const H = 34
const T = 3.4
const P = 3 // padding

function hbar(x1: number, x2: number, y: number) {
  const h = T / 2
  return `${x1},${y} ${x1 + h},${y - h} ${x2 - h},${y - h} ${x2},${y} ${x2 - h},${y + h} ${x1 + h},${y + h}`
}
function vbar(x: number, y1: number, y2: number) {
  const h = T / 2
  return `${x},${y1} ${x + h},${y1 + h} ${x + h},${y2 - h} ${x},${y2} ${x - h},${y2 - h} ${x - h},${y1 + h}`
}
const g = 0.8 // gap between segments
const SEGS = [
  hbar(g, W - g, 0), // a
  vbar(W, g, H / 2 - g), // b
  vbar(W, H / 2 + g, H - g), // c
  hbar(g, W - g, H), // d
  vbar(0, H / 2 + g, H - g), // e
  vbar(0, g, H / 2 - g), // f
  hbar(g, W - g, H / 2), // g
]

const Digit = memo(function Digit({ ch, dot, dim }: { ch: string; dot: boolean; dim: boolean }) {
  const bits = GLYPHS[ch.toLowerCase()] ?? GLYPHS[ch] ?? 0
  return (
    <svg className="seg" viewBox={`${-P} ${-P} ${W + 2 * P + 5} ${H + 2 * P}`} aria-hidden>
      <g transform={`translate(${W / 2} ${H / 2}) skewX(-7) translate(${-W / 2} ${-H / 2})`}>
        {SEGS.map((pts, i) => (
          <polygon key={i} points={pts} className={bits & (1 << i) && !dim ? 'on' : 'off'} />
        ))}
        <circle cx={W + 4.5} cy={H} r={1.9} className={dot && !dim ? 'on' : 'off'} />
      </g>
    </svg>
  )
})

export function SevenSeg({
  text,
  blink,
  dots,
  groups = [],
  label,
}: {
  text: string
  blink?: boolean[]
  dots?: boolean[]
  /** indices after which to insert a gap */
  groups?: number[]
  label?: string
}) {
  const now = Math.floor(performance.now() / 350) % 2 === 0
  return (
    <div className="seg-display" role="img" aria-label={label ? `${label}: ${text.trim()}` : text.trim()}>
      {[...text].map((ch, i) => (
        <span key={i} className={groups.includes(i) ? 'seg-cell gap' : 'seg-cell'}>
          <Digit ch={ch} dot={!!dots?.[i]} dim={!!blink?.[i] && !now} />
        </span>
      ))}
    </div>
  )
}
