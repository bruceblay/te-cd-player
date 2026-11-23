import { useEffect, useRef } from 'react'

/*
 * A patch cable between two jacks, simulated as a Verlet rope (points joined by
 * fixed-length links, solved a few times a frame) and drawn as a shaded SVG
 * cable with a 3.5 mm plug at each end. Either plug can be pulled out, dragged,
 * and dropped on a compatible jack (it snaps) or anywhere else (it lies there).
 *
 * Jacks are any element with data-jack="id" inside the container; the cable
 * reads their positions every frame, so it follows layout and resizing.
 */

export type End = 'a' | 'b'
export interface CableProps {
  /** jack id each end is plugged into, or null when the plug is out */
  a: string | null
  b: string | null
  /** which jacks each end may plug into */
  accepts: Record<End, string[]>
  onChange(end: End, jack: string | null): void
}

const N = 30 // rope points
const ITER = 14

type V = { x: number; y: number }

export function Cable({ a, b, accepts, onChange }: CableProps) {
  const svg = useRef<SVGSVGElement>(null)
  const paths = useRef<SVGPathElement[]>([])
  const plugs = useRef<Record<End, SVGGElement | null>>({ a: null, b: null })
  const st = useRef({
    pts: [] as V[],
    old: [] as V[],
    loose: { a: null as V | null, b: null as V | null },
    drag: null as null | { end: End; dx: number; dy: number },
    jacks: { a, b },
  })
  st.current.jacks = { a, b }
  const props = useRef({ accepts, onChange })
  props.current = { accepts, onChange }

  useEffect(() => {
    let raf = 0
    let settled = 0
    const host = svg.current!.parentElement!

    const jackPos = (id: string) => {
      const el = host.querySelector<HTMLElement>(`[data-jack="${id}"]`)
      if (!el) return null
      const r = el.getBoundingClientRect()
      const h = host.getBoundingClientRect()
      return { x: r.left + r.width / 2 - h.left, y: r.top - h.top }
    }
    // one plate unit of the BC-1, in px: sizes the plug and cable with the layout
    const unit = () => {
      const d = host.querySelector<HTMLElement>('.device-wrap')
      return d ? d.getBoundingClientRect().width / 370 : 1.5
    }

    const frame = () => {
      const s = st.current
      const U = unit()
      const plugLen = 18 * U
      // where each end of the rope is held: the tail of its plug
      const endPos = (end: End): { p: V; dir: V } | null => {
        const id = s.jacks[end]
        if (id) {
          const j = jackPos(id)
          if (j) return { p: { x: j.x, y: j.y - plugLen }, dir: { x: 0, y: -1 } }
        }
        const l = s.loose[end]
        return l ? { p: l, dir: { x: 0, y: 0 } } : null
      }
      const A = endPos('a')
      const B = endPos('b')
      // wait until both jacks have been laid out
      if (!A || !B || (A.p.x === 0 && A.p.y === 0) || (B.p.x === 0 && B.p.y === 0)) {
        raf = requestAnimationFrame(frame)
        return
      }
      settled++
      if (s.pts.length !== N) {
        s.pts = Array.from({ length: N }, (_, i) => ({ x: A.p.x + ((B.p.x - A.p.x) * i) / (N - 1), y: A.p.y + ((B.p.y - A.p.y) * i) / (N - 1) - 10 }))
        s.old = s.pts.map((p) => ({ ...p }))
      }
      // a little slack over the straight distance; the cable lifts and arcs above the units
      const span = Math.hypot(B.p.x - A.p.x, B.p.y - A.p.y)
      const seg = Math.max(160 * U, span * 1.05) / (N - 1)
      const g = -0.25 * U
      for (let i = 0; i < N; i++) {
        const p = s.pts[i]
        const o = s.old[i]
        const vx = (p.x - o.x) * 0.92
        const vy = (p.y - o.y) * 0.92
        o.x = p.x
        o.y = p.y
        p.x += vx
        p.y += vy + g
      }
      const pin = () => {
        s.pts[0] = { ...A.p }
        s.pts[N - 1] = { ...B.p }
        // a plugged cable leaves its plug straight out of the jack
        if (A.dir.y) s.pts[1] = { x: A.p.x, y: A.p.y - seg }
        if (B.dir.y) s.pts[N - 2] = { x: B.p.x, y: B.p.y - seg }
      }
      for (let k = 0; k < ITER; k++) {
        pin()
        for (let i = 0; i < N - 1; i++) {
          const p = s.pts[i]
          const q = s.pts[i + 1]
          const dx = q.x - p.x
          const dy = q.y - p.y
          const d = Math.hypot(dx, dy) || 0.0001
          const f = (d - seg) / d / 2
          p.x += dx * f
          p.y += dy * f
          q.x -= dx * f
          q.y -= dy * f
        }
      }
      pin()
      // never past the window's edges: the cable mustn't create scrollbars
      const h = host.getBoundingClientRect()
      for (const p of s.pts) {
        p.x = Math.min(window.innerWidth - h.left - 4, Math.max(4 - h.left, p.x))
        p.y = Math.max(4 - h.top, p.y)
      }
      svg.current!.style.visibility = settled > 20 ? 'visible' : 'hidden'

      // draw: smooth path through the rope, then the plugs along each end's direction
      const pts = s.pts
      let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
      for (let i = 1; i < N - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2
        const my = (pts[i].y + pts[i + 1].y) / 2
        d += ` Q${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`
      }
      d += ` L${pts[N - 1].x.toFixed(1)} ${pts[N - 1].y.toFixed(1)}`
      const w = [4.4, 3.2, 1].map((x) => x * U)
      paths.current.forEach((el, i) => {
        el.setAttribute('d', d)
        el.setAttribute('stroke-width', String(w[i]))
      })
      const place = (end: End, tail: V, next: V) => {
        const el = plugs.current[end]
        if (!el) return
        // the plug points away from the cable: into its jack, or along the cable when loose
        const ang = (Math.atan2(tail.y - next.y, tail.x - next.x) * 180) / Math.PI - 90
        el.setAttribute('transform', `translate(${tail.x} ${tail.y}) rotate(${ang}) scale(${U})`)
      }
      place('a', pts[0], pts[2])
      place('b', pts[N - 1], pts[N - 3])
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    // ---- dragging a plug ----
    const toLocal = (e: PointerEvent) => {
      const h = host.getBoundingClientRect()
      return { x: e.clientX - h.left, y: e.clientY - h.top }
    }
    const down = (end: End) => (e: PointerEvent) => {
      e.preventDefault()
      try {
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      } catch {
        /* synthetic or already-released pointer */
      }
      const s = st.current
      const tail = end === 'a' ? s.pts[0] : s.pts[N - 1]
      const m = toLocal(e)
      s.drag = { end, dx: tail.x - m.x, dy: tail.y - m.y }
      s.loose[end] = { ...tail }
      // pulling the plug disconnects it straight away
      if (s.jacks[end]) props.current.onChange(end, null)
      s.jacks[end] = null
    }
    const move = (e: PointerEvent) => {
      const s = st.current
      if (!s.drag) return
      const m = toLocal(e)
      s.loose[s.drag.end] = { x: m.x + s.drag.dx, y: m.y + s.drag.dy }
    }
    const up = () => {
      const s = st.current
      if (!s.drag) return
      const end = s.drag.end
      s.drag = null
      const at = s.loose[end]!
      const U = unit()
      // the tip of the plug is plugLen past the tail; snap if it lands near a free jack
      let best: string | null = null
      let bestD = 26 * U
      for (const id of props.current.accepts[end]) {
        const j = jackPos(id)
        if (!j) continue
        const dist = Math.hypot(j.x - at.x, j.y - 18 * U - at.y)
        if (dist < bestD) {
          bestD = dist
          best = id
        }
      }
      if (best) {
        s.jacks[end] = best
        s.loose[end] = null
        props.current.onChange(end, best)
      }
    }
    const handlers: [Element, (e: PointerEvent) => void][] = []
    for (const end of ['a', 'b'] as End[]) {
      const el = plugs.current[end]
      if (!el) continue
      const h = down(end)
      el.addEventListener('pointerdown', h as EventListener)
      handlers.push([el, h])
      el.addEventListener('pointermove', move as EventListener)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    }
    return () => {
      cancelAnimationFrame(raf)
      for (const [el, h] of handlers) {
        el.removeEventListener('pointerdown', h as EventListener)
        el.removeEventListener('pointermove', move as EventListener)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
      }
    }
  }, [])

  return (
    <svg className="cable" ref={svg} aria-hidden>
      <defs>
        <linearGradient id="plug-body" x1="0" x2="1">
          <stop offset="0" stopColor="#bdbdb9" />
          <stop offset="0.35" stopColor="#f3f3f0" />
          <stop offset="1" stopColor="#a9a9a5" />
        </linearGradient>
        <linearGradient id="plug-metal" x1="0" x2="1">
          <stop offset="0" stopColor="#8d8f93" />
          <stop offset="0.4" stopColor="#e8e9ec" />
          <stop offset="1" stopColor="#7a7c80" />
        </linearGradient>
      </defs>
      {/* outline, body, highlight */}
      <path ref={(el) => void (el && (paths.current[0] = el))} className="cable-edge" />
      <path ref={(el) => void (el && (paths.current[1] = el))} className="cable-body" />
      <path ref={(el) => void (el && (paths.current[2] = el))} className="cable-shine" />
      {(['a', 'b'] as End[]).map((end) => (
        // drawn pointing down (+y) from the cable at 0,0; the tip enters the jack
        <g key={end} ref={(el) => void (plugs.current[end] = el)} className="plug">
          <rect x="-2" y="-2" width="4" height="5" rx="1" fill="#cfcfcc" stroke="#8a8a86" strokeWidth="0.3" />
          <rect x="-3.2" y="2.5" width="6.4" height="11" rx="1.4" fill="url(#plug-body)" stroke="#8a8a86" strokeWidth="0.3" />
          <rect x="-3.2" y="10.5" width="6.4" height="1" fill="#9a9a96" />
          <rect x="-1.6" y="13.5" width="3.2" height="4.5" fill="url(#plug-metal)" />
          <rect x="-1.6" y="15.2" width="3.2" height="0.5" fill="#55575b" />
          {/* generous invisible grab area */}
          <rect x="-7" y="-4" width="14" height="22" fill="transparent" />
        </g>
      ))}
    </svg>
  )
}
