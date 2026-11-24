import { useId, useLayoutEffect, useRef } from 'react'

export type End = 'a' | 'b'
export interface CableProps {
  /** jack id each end is plugged into, or null when the plug is out */
  a: string | null
  b: string | null
  /** accent collar colour matching the 3D TE patch plugs */
  accent?: string
  /** which jacks each end may plug into */
  accepts: Record<End, string[]>
  onChange(end: End, jack: string | null): void
}

type V = { x: number; y: number }

export function Cable({ a, b, accent = '#ff5a1f', accepts, onChange }: CableProps) {
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

    const jackPos = (jackId: string) => {
      const el = host.querySelector<HTMLElement>(`[data-jack="${jackId}"]`)
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

      // Natural sweeping arc out of each rear socket — allowed to arch freely
      // off the top of the viewport rather than flattening against the top edge.
      const span = B.x - A.x
      const lift = 22 * U + Math.min(140 * U, Math.abs(span) * 0.24)
      const topY = Math.min(A.y, B.y) - lift
      const c1x = A.x + span * 0.08
      const c2x = B.x - span * 0.08
      const d = `M ${A.x} ${A.y} C ${c1x} ${topY}, ${c2x} ${topY}, ${B.x} ${B.y}`

      // Layered cylindrical shading: [castShadow, ambientShadow, baseShade, litBody, weave, specHighlight]
      const widths = [3.6, 3.1, 3.05, 2.35, 2.35, 0.95].map((x) => x * U)
      const shifts: [number, number][] = [
        [2.2 * U, 5.2 * U],
        [0.7 * U, 1.8 * U],
        [0, 0],
        [-0.22 * U, -0.32 * U],
        [-0.22 * U, -0.32 * U],
        [-0.5 * U, -0.68 * U],
      ]
      paths.current.forEach((el, i) => {
        el.setAttribute('d', d)
        el.setAttribute('stroke-width', String(widths[i]))
        const [sx, sy] = shifts[i]
        if (sx || sy) el.setAttribute('transform', `translate(${sx} ${sy})`)
        else el.removeAttribute('transform')
        if (i === 4) el.setAttribute('stroke-dasharray', `${1.4 * U} ${1.6 * U}`)
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
      let best: string | null = null
      let bestD = 13 * U
      for (const jackId of props.current.accepts[end]) {
        const j = jackPos(jackId)
        if (!j) continue
        const dist = Math.hypot(j.x - at.x, j.y - 13 * U - at.y)
        if (dist < bestD) {
          bestD = dist
          best = jackId
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
        <filter id={id + '-blur'} x="-30%" y="-60%" width="160%" height="220%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
        <filter id={id + '-soft'} x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="0.85" />
        </filter>
        <linearGradient id={id + '-boot'} x1="0" x2="1">
          <stop offset="0" stopColor="#b9b8b3" />
          <stop offset="0.34" stopColor="#dfded9" />
          <stop offset="0.72" stopColor="#c5c4bf" />
          <stop offset="1" stopColor="#9e9d98" />
        </linearGradient>
        <linearGradient id={id + '-barrel'} x1="0" x2="1">
          <stop offset="0" stopColor="#c7c6c1" />
          <stop offset="0.28" stopColor="#f5f4f0" />
          <stop offset="0.62" stopColor="#e3e2dd" />
          <stop offset="1" stopColor="#abaaa5" />
        </linearGradient>
        <linearGradient id={id + '-metal'} x1="0" x2="1">
          <stop offset="0" stopColor="#85878b" />
          <stop offset="0.35" stopColor="#eceef1" />
          <stop offset="0.72" stopColor="#aeb0b5" />
          <stop offset="1" stopColor="#6c6e72" />
        </linearGradient>
      </defs>
      {/* soft cast shadow, tight AO shadow, cylindrical shaded cord, subtle weave, soft highlight */}
      <path ref={(el) => void (el && (paths.current[0] = el))} className="cable-shadow" filter={`url(#${id}-blur)`} />
      <path ref={(el) => void (el && (paths.current[1] = el))} className="cable-ao" filter={`url(#${id}-soft)`} />
      <path ref={(el) => void (el && (paths.current[2] = el))} className="cable-base" />
      <path ref={(el) => void (el && (paths.current[3] = el))} className="cable-body" />
      <path ref={(el) => void (el && (paths.current[4] = el))} className="cable-weave" />
      <path ref={(el) => void (el && (paths.current[5] = el))} className="cable-shine" />
      {(['a', 'b'] as End[]).map((end) => (
        // slim TE machined 3.5mm plug pointing down (+y) from cord tail at 0,0 into jack at +13
        <g key={end} ref={(el) => void (plugs.current[end] = el)} className="plug">
          {/* tapered strain relief boot with subtle grip grooves */}
          <path d="M-1.55 -1.4 L1.55 -1.4 L2.1 2.9 L-2.1 2.9 Z" fill={`url(#${id}-boot)`} />
          <rect x="-1.75" y="0.2" width="3.5" height="0.45" fill="rgb(0 0 0 / 0.14)" />
          <rect x="-1.9" y="1.4" width="3.8" height="0.45" fill="rgb(0 0 0 / 0.14)" />
          {/* slim matte off-white barrel */}
          <rect x="-2.65" y="2.6" width="5.3" height="9.4" rx="1.15" fill={`url(#${id}-barrel)`} />
          {/* subtle recessed accent collar ring */}
          <rect x="-2.65" y="9.1" width="5.3" height="1.15" fill={accent} opacity="0.92" />
          {/* machined metallic collar flush against jack */}
          <rect x="-2.0" y="11.9" width="4.0" height="1.35" rx="0.3" fill={`url(#${id}-metal)`} />
          {/* 3.5mm TRS tip (hidden when inserted) */}
          <rect x="-1.25" y="13.2" width="2.5" height="4.8" rx="0.4" className="plug-tip" fill={`url(#${id}-metal)`} />
          <rect className="plug-tip" x="-1.25" y="14.6" width="2.5" height="0.45" fill="#2c2d30" />
          <rect className="plug-tip" x="-1.25" y="16.1" width="2.5" height="0.45" fill="#2c2d30" />
          {/* generous invisible grab area */}
          <rect x="-7" y="-4" width="14" height="22" fill="transparent" />
        </g>
      ))}
    </svg>
  )
}
