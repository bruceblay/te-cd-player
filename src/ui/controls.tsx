import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

/**
 * Everything on the faceplate is placed in the units of teenage engineering's
 * own top-view diagram of the BC-1 (plate = 370 x 511), times U px.
 */
export const U = 2
export const u = (n: number) => n * U
export const pos = (x: number, y: number, w?: number, h?: number): CSSProperties => ({
  left: u(x),
  top: u(y),
  width: w === undefined ? undefined : u(w),
  height: h === undefined ? undefined : u(h),
})

export function Key({
  x,
  y,
  w,
  h,
  className = '',
  onDown,
  onUp,
  title,
  children,
}: {
  x: number
  y: number
  w: number
  h: number
  className?: string
  onDown?: () => void
  onUp?: () => void
  title: string
  children?: ReactNode
}) {
  const [down, setDown] = useState(false)
  const end = () => {
    if (!down) return
    setDown(false)
    onUp?.()
  }
  return (
    <span className={`key-well ${className}`} style={pos(x, y, w, h)}>
      <button
        type="button"
        className={`key ${down ? 'down' : ''}`}
        aria-label={title}
        title={title}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDown(true)
          onDown?.()
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !down) {
            e.preventDefault()
            e.stopPropagation()
            setDown(true)
            onDown?.()
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            end()
          }
        }}
      >
        {children}
      </button>
    </span>
  )
}

export function Led({ x, y, color, on, blink }: { x: number; y: number; color: string; on: boolean; blink?: boolean }) {
  return (
    <span
      className={`led ${on ? 'on' : ''} ${blink ? 'blink' : ''}`}
      style={{ ...pos(x, y), ['--led' as string]: color }}
      aria-hidden
    />
  )
}

/** shaft knob seen from above: turns only while you hold the mouse button and drag up/down */
export function Knob({
  x,
  y,
  size,
  cap,
  className = '',
  value,
  min,
  max,
  onChange,
  onReset,
  onTap,
  label,
}: {
  x: number
  y: number
  size: number
  /** cap diameter in plate units */
  cap: number
  className?: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  onReset?: () => void
  /** a click without turning (the sidekick's gain knobs push) */
  onTap?: () => void
  label: string
}) {
  const drag = useRef<{ y: number; v: number; moved: boolean } | null>(null)
  const frac = (value - min) / (max - min)
  const angle = -140 + frac * 280
  const inset = u((size - cap) / 2)
  return (
    <div
      className={`knob ${className}`}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      style={pos(x, y, size, size)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { y: e.clientY, v: value, moved: false }
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        // a release we missed (outside the window, lost capture) must not leave it turning
        if (!(e.buttons & 1)) {
          drag.current = null
          return
        }
        // knobs that can be clicked get a small dead zone so a click doesn't nudge them
        if (!onTap || Math.abs(drag.current.y - e.clientY) > 3) drag.current.moved = true
        if (!drag.current.moved) return
        const k = e.shiftKey ? 0.1 : 0.5
        onChange(Math.min(max, Math.max(min, drag.current.v + (drag.current.y - e.clientY) * k * ((max - min) / 100))))
      }}
      onPointerUp={() => {
        if (drag.current && !drag.current.moved) onTap?.()
        drag.current = null
      }}
      onPointerCancel={() => (drag.current = null)}
      onLostPointerCapture={() => (drag.current = null)}
      onDoubleClick={onReset}
    >
      <div className="knob-shadow" style={{ inset }} />
      {/* the cap and its lit/shaded sides stay put; only the indicator turns */}
      <div className="knob-cap" style={{ inset }} />
      <div className="knob-dial" style={{ inset, transform: `rotate(${angle}deg)` }}>
        <span className="knob-mark" />
      </div>
    </div>
  )
}

/** spring-loaded stick in a slot: drag sideways; distance sets 2x / 4x / 8x */
export function Jog({ x, y, w, h, value, onChange }: { x: number; y: number; w: number; h: number; value: number; onChange: (v: number) => void }) {
  const start = useRef<number | null>(null)
  const travel = u((w - h) / 2)
  // the stick barely moves; the pointer gets a longer throw than the cap
  const throwPx = 60
  return (
    <div className="jog" style={pos(x, y, w, h)}>
      <div
        className="jog-cap"
        role="slider"
        tabIndex={0}
        aria-label="jog"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={value}
        style={{ width: u(h - 3), height: u(h - 3), left: `calc(50% - ${u((h - 3) / 2)}px)`, top: u(1.5), transform: `translateX(${value * travel}px)` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          start.current = e.clientX
        }}
        onPointerMove={(e) => {
          if (start.current == null) return
          onChange(Math.max(-1, Math.min(1, (e.clientX - start.current) / throwPx)))
        }}
        onPointerUp={() => {
          start.current = null
          onChange(0)
        }}
        onPointerCancel={() => {
          start.current = null
          onChange(0)
        }}
      />
    </div>
  )
}

/** 2 x 9 bar meter, standing upright: L left column, R right column */
export function VU({ x, y, w, h, levels }: { x: number; y: number; w: number; h: number; levels: [number, number] }) {
  return (
    <div className="vu window" style={pos(x, y, w, h)} role="img" aria-label="VU meter">
      {levels.map((l, col) => (
        <div className="vu-col" key={col}>
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className={l * 9 > 8 - i + 0.15 ? 'on' : ''} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function Print({
  x,
  y,
  w,
  children,
  className = '',
  rule,
}: {
  x: number
  y: number
  w?: number
  children: ReactNode
  className?: string
  /** underline, as on the display labels */
  rule?: boolean
}) {
  return (
    <span className={`print ${rule ? 'rule' : ''} ${className}`} style={pos(x, y, w)}>
      {children}
    </span>
  )
}
