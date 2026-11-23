import { useId, useLayoutEffect, useRef } from 'react'

export type End = 'a' | 'b'
export interface CableProps {
  /** jack id each end is plugged into, or null when the plug is out */
  a: string | null
  b: string | null
  /** which jacks each end may plug into */
  accepts: Record<End, string[]>
  onChange(end: End, jack: string | null): void
}

type V = { x: number; y: number }

export function Cable({ a, b, accepts, onChange }: CableProps) {
  const id = useId()
  const svg = useRef<SVGSVGElement>(null)
  const paths = useRef<SVGPathElement[]>([])
  const plugs = useRef<Record<End, SVGGElement | null>>({ a: null, b: null })
  const st = useRef({
    tails: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
    loose: { a: null as V | null, b: null as V | null },
    drag: null as null | { end: End; dx: number; dy: number },
    jacks: { a, b },
  })
  st.current.jacks = { a, b }
  const props = useRef({ accepts, onChange })
  props.current = { accepts, onChange }

  const redraw = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    let raf = 0

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
      const h = host.getBoundingClientRect()
      if (!h.width || !U) return
      const tail = (end: End): V => {
        const jack = s.jacks[end]
        const j = jack && jackPos(jack)
        if (j) return { x: j.x, y: j.y - 13 * U }
        const home = jackPos(props.current.accepts[end][0])
        const p = s.loose[end] ?? { x: home?.x ?? h.width / 2, y: 24 * U }
        return {
          x: Math.max(7 * U, Math.min(h.width - 7 * U, p.x)),
          y: Math.max(8 * U - h.top, Math.min(h.height - 19 * U, p.y)),
        }
      }
      const A = tail('a')
      const B = tail('b')
      s.tails = { a: A, b: B }
      // Vertical tangents keep the strain relief aligned with each socket.
      // Longer runs bend higher, with clearance inside the rig's top gutter.
      const lift = Math.min(46 * U, 12 * U + Math.abs(B.x - A.x) * 0.10)
      const top = Math.max(5 * U - h.top, Math.min(A.y, B.y) - lift)
      const d = `M ${A.x} ${A.y} C ${A.x} ${top}, ${B.x} ${top}, ${B.x} ${B.y}`
      const w = [4.4, 3.2, 1].map((x) => x * U)
      paths.current.forEach((el, i) => {
        el.setAttribute('d', d)
        el.setAttribute('stroke-width', String(w[i]))
      })
      for (const end of ['a', 'b'] as const) {
        const p = s.tails[end]
        plugs.current[end]?.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${U})`)
        plugs.current[end]?.classList.toggle('inserted', !!s.jacks[end])
      }
    }
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(frame)
    }
    redraw.current = schedule
    const ro = new ResizeObserver(schedule)
    ro.observe(host)
    window.addEventListener('resize', schedule)
    frame()

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
      const tail = s.tails[end]
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
      frame()
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
      let bestD = 13 * U
      for (const id of props.current.accepts[end]) {
        const j = jackPos(id)
        if (!j) continue
        const dist = Math.hypot(j.x - at.x, j.y - 13 * U - at.y)
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
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(raf)
      for (const [el, h] of handlers) {
        el.removeEventListener('pointerdown', h as EventListener)
        el.removeEventListener('pointermove', move as EventListener)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
      }
    }
  }, [])

  useLayoutEffect(() => redraw.current(), [a, b])

  return (
    <svg className="cable" ref={svg} aria-hidden>
      <defs>
        <linearGradient id={id + '-body'} x1="0" x2="1">
          <stop offset="0" stopColor="#bdbdb9" />
          <stop offset="0.35" stopColor="#f3f3f0" />
          <stop offset="1" stopColor="#a9a9a5" />
        </linearGradient>
        <linearGradient id={id + '-metal'} x1="0" x2="1">
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
          <rect x="-3.2" y="2.5" width="6.4" height="11" rx="1.4" fill={`url(#${id}-body)`} stroke="#8a8a86" strokeWidth="0.3" />
          <rect x="-3.2" y="10.5" width="6.4" height="1" fill="#9a9a96" />
          <rect x="-1.6" y="13.5" width="3.2" height="4.5" className="plug-tip" fill={`url(#${id}-metal)`} />
          <rect className="plug-tip" x="-1.6" y="15.2" width="3.2" height="0.5" fill="#55575b" />
          {/* generous invisible grab area */}
          <rect x="-7" y="-4" width="14" height="22" fill="transparent" />
        </g>
      ))}
    </svg>
  )
}
