import { useEffect, useRef, useState } from 'react'
import capoImg from '../assets/props/capo.png'
import d20Img from '../assets/props/d20.png'
import dieImg from '../assets/props/die.png'
import keycapImg from '../assets/props/keycap.png'
import pencilImg from '../assets/props/pencil.png'
import succulentImg from '../assets/props/succulent.png'
import type { Deck } from '../engine/deck'
import { Dice3D, type Dice3DHandle } from './Dice3D'

// Real-world width of the BC-1 top plate: 370 diagram units, where 246 units = 120 mm CD.
const BC1_WIDTH_MM = (370 / 246) * 120 // ~180.5 mm

export const PROP_CATALOG = [
  { id: 'succulent', label: 'succulent', image: succulentImg, mm: 60, aspect: 1, kind: 'static' as const },
  { id: 'die', label: 'red die', image: dieImg, mm: 16, aspect: 1, kind: 'd6' as const },
  { id: 'd20', label: 'd20', image: d20Img, mm: 21, aspect: 1, kind: 'd20' as const },
  { id: 'pencil', label: 'pencil', image: pencilImg, mm: 165, aspect: 0.075, kind: 'static' as const },
  { id: 'keycap', label: 'esc keycap', image: keycapImg, mm: 18, aspect: 1, kind: 'static' as const },
  { id: 'capo', label: 'guitar capo', image: capoImg, mm: 84, aspect: 0.85, kind: 'static' as const },
] as const

export type PropId = (typeof PROP_CATALOG)[number]['id']

export interface PlacedProp {
  id: PropId
  /** viewport percentage 0..100 */
  x: number
  y: number
  /** degrees */
  rot: number
  /** rolled face for dice (1..6 or 1..20) */
  face?: number
}

const PROP_MAP = new Map<PropId, (typeof PROP_CATALOG)[number]>(PROP_CATALOG.map((p) => [p.id, p]))
const PROPS_KEY = 'bc1.props'
const PROPS_ON_KEY = 'bc1.propsOn'
const DEFAULT_IDS: PropId[] = ['succulent', 'die', 'pencil', 'keycap']

const isDie = (id: PropId) => id === 'die' || id === 'd20'

const rollFace = (id: PropId, avoid?: number): number | undefined => {
  const max = id === 'die' ? 6 : id === 'd20' ? 20 : 0
  if (!max) return undefined
  let v = 1 + Math.floor(Math.random() * max)
  if (avoid !== undefined && v === avoid) v = (v % max) + 1
  return v
}

/** Current screen pixels per real-world millimeter, derived from the live BC-1 deck width. */
function measurePxPerMm(): number {
  const deck = document.querySelector<HTMLElement>('.device-wrap')
  const w = deck?.getBoundingClientRect().width ?? 0
  if (w > 40) return Math.min(2.35, w / BC1_WIDTH_MM)
  return 1.75
}

export function readPropsEnabled(): boolean {
  try {
    return localStorage.getItem(PROPS_ON_KEY) !== '0'
  } catch {
    return true
  }
}

export function savePropsEnabled(on: boolean) {
  try {
    localStorage.setItem(PROPS_ON_KEY, on ? '1' : '0')
  } catch {
    /* private mode */
  }
}

export function readSavedProps(): PlacedProp[] | null {
  try {
    const raw = localStorage.getItem(PROPS_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const seen = new Set<PropId>()
    const out: PlacedProp[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const { id, x, y, rot, face } = item as Record<string, unknown>
      if (typeof id !== 'string' || !PROP_MAP.has(id as PropId) || seen.has(id as PropId)) continue
      seen.add(id as PropId)
      const pid = id as PropId
      const maxFace = pid === 'die' ? 6 : pid === 'd20' ? 20 : 0
      const validFace =
        maxFace > 0
          ? typeof face === 'number' && Number.isInteger(face) && face >= 1 && face <= maxFace
            ? face
            : rollFace(pid)
          : undefined
      out.push({
        id: pid,
        x: typeof x === 'number' && Number.isFinite(x) ? Math.max(2, Math.min(98, x)) : 50,
        y: typeof y === 'number' && Number.isFinite(y) ? Math.max(3, Math.min(97, y)) : 50,
        rot: typeof rot === 'number' && Number.isFinite(rot) ? rot : 0,
        ...(validFace !== undefined ? { face: validFace } : {}),
      })
    }
    return out
  } catch {
    return null
  }
}

export function saveProps(props: PlacedProp[]) {
  try {
    localStorage.setItem(PROPS_KEY, JSON.stringify(props))
  } catch {
    /* private mode */
  }
}

/** Measure the live gear rect (including cable clearance above it) so props never spawn on top of hardware. */
function gearBounds() {
  const el = document.querySelector<HTMLElement>('.rig, .solo')
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return null
  const topPad = el.classList.contains('rig') ? 22 : 14
  return {
    left: r.left - 12,
    right: r.right + 12,
    top: r.top - topPad,
    bottom: r.bottom + 12,
  }
}

/** Pick a random spot strictly outside the gear bounding box and clear of other props & the hamburger menu.
 *  When `near` is given, prefers the closest valid spot so items get gently nudged aside rather than teleporting. */
function randomSafeSpot(id: PropId, existing: PlacedProp[], near?: { x: number; y: number; rot: number; face?: number }): PlacedProp {
  const def = PROP_MAP.get(id)!
  const vw = Math.max(320, window.innerWidth)
  const vh = Math.max(320, window.innerHeight)
  const ppm = measurePxPerMm()
  const sizePx = def.mm * ppm
  const gear = gearBounds()
  const halfW = sizePx * 0.5
  const halfH = Math.max(12, sizePx * def.aspect * 0.5)
  const rad = Math.min(sizePx * 0.5, Math.hypot(halfW, halfH))
  // Keep small items fully inside the viewport; allow large props to tuck naturally toward the frame edge if margins are tight
  const minEdgeX = Math.min(28, halfW * 0.5)
  const minEdgeY = Math.min(28, halfH * 0.5)
  const face = near ? near.face : rollFace(id)

  const overlapsExisting = (px: number, py: number) =>
    existing.some((p) => {
      const odef = PROP_MAP.get(p.id)
      const ox = (p.x / 100) * vw
      const oy = (p.y / 100) * vh
      const oSize = odef ? odef.mm * ppm : 40
      const minDist = Math.min(oSize * 0.42, 68) + Math.min(rad, 68) + 10
      return Math.hypot(px - ox, py - oy) < minDist
    })

  const hitsMenu = (px: number, py: number) => px > vw - 76 && py < 72

  const hitsGear = (px: number, py: number, rotDeg: number) => {
    if (!gear) return false
    const a = (rotDeg * Math.PI) / 180
    const rx = Math.abs(Math.cos(a)) * halfW + Math.abs(Math.sin(a)) * halfH
    const ry = Math.abs(Math.sin(a)) * halfW + Math.abs(Math.cos(a)) * halfH
    return px + rx > gear.left && px - rx < gear.right && py + ry > gear.top && py - ry < gear.bottom
  }

  // Build candidate free bands around the gear: top, bottom, left, right (with preferred orientation for elongated items)
  type Band = { x0: number; x1: number; y0: number; y1: number; vertical: boolean; area: number }
  const bands: Band[] = []
  const addBand = (x0: number, x1: number, y0: number, y1: number, vertical: boolean) => {
    if (x1 > x0 + 4 && y1 > y0 + 4) {
      bands.push({ x0, x1, y0, y1, vertical, area: (x1 - x0) * (y1 - y0) })
    }
  }
  if (gear) {
    // Horizontal bands (top / bottom): orient long items roughly horizontal
    const topMax = gear.top - halfH - 4
    if (topMax > minEdgeY) addBand(minEdgeX, vw - minEdgeX, minEdgeY, topMax, false)
    const botMin = gear.bottom + halfH + 4
    if (vh - minEdgeY > botMin) addBand(minEdgeX, vw - minEdgeX, botMin, vh - minEdgeY, false)
    // Vertical bands (left / right): orient long items (like the pencil) roughly vertical so they fit cleanly beside solo decks!
    const sideHalf = def.aspect < 0.3 ? halfH : halfW
    const leftMax = gear.left - sideHalf - 4
    if (leftMax > minEdgeX) addBand(minEdgeX, leftMax, minEdgeY, vh - minEdgeY, def.aspect < 0.3)
    const rightMin = gear.right + sideHalf + 4
    if (vw - minEdgeX > rightMin) addBand(rightMin, vw - minEdgeX, minEdgeY, vh - minEdgeY, def.aspect < 0.3)
  }
  const totalArea = bands.reduce((s, b) => s + b.area, 0)

  const nearPx = near ? (near.x / 100) * vw : 0
  const nearPy = near ? (near.y / 100) * vh : 0

  let best: { x: number; y: number; rot: number; score: number } | null = null
  const attempts = near ? 150 : 120

  for (let attempt = 0; attempt < attempts; attempt++) {
    let px: number
    let py: number
    let rot: number
    if (bands.length && totalArea > 0 && attempt < attempts - 24) {
      let pick = Math.random() * totalArea
      let b = bands[bands.length - 1]
      for (const cand of bands) {
        pick -= cand.area
        if (pick <= 0) {
          b = cand
          break
        }
      }
      px = b.x0 + Math.random() * (b.x1 - b.x0)
      py = b.y0 + Math.random() * (b.y1 - b.y0)
      if (b.vertical) {
        rot = (Math.random() > 0.5 ? 90 : -90) + Math.round((Math.random() - 0.5) * 18)
      } else if (def.aspect < 0.3) {
        rot = Math.round((Math.random() - 0.5) * 26)
      } else {
        rot = near ? near.rot + Math.round((Math.random() - 0.5) * 18) : Math.round((Math.random() - 0.5) * 76)
      }
    } else {
      // Fallback: tuck closely along the outer viewport edges where the gear doesn't reach
      const edge = attempt % 4
      if (edge === 0) {
        px = minEdgeX + Math.random() * Math.max(1, vw - minEdgeX * 2)
        py = Math.max(6, (gear?.top ?? 40) - halfH - 4)
        rot = Math.round((Math.random() - 0.5) * 24)
      } else if (edge === 1) {
        px = minEdgeX + Math.random() * Math.max(1, vw - minEdgeX * 2)
        py = Math.min(vh - 6, (gear?.bottom ?? vh - 40) + halfH + 4)
        rot = Math.round((Math.random() - 0.5) * 24)
      } else if (edge === 2) {
        px = Math.max(6, (gear?.left ?? 40) - (def.aspect < 0.3 ? halfH : halfW) - 4)
        py = minEdgeY + Math.random() * Math.max(1, vh - minEdgeY * 2)
        rot = def.aspect < 0.3 ? 90 + Math.round((Math.random() - 0.5) * 16) : Math.round((Math.random() - 0.5) * 60)
      } else {
        px = Math.min(vw - 6, (gear?.right ?? vw - 40) + (def.aspect < 0.3 ? halfH : halfW) + 4)
        py = minEdgeY + Math.random() * Math.max(1, vh - minEdgeY * 2)
        rot = def.aspect < 0.3 ? -90 + Math.round((Math.random() - 0.5) * 16) : Math.round((Math.random() - 0.5) * 60)
      }
    }
    const inGear = hitsGear(px, py, rot)
    const inMenu = hitsMenu(px, py)
    const inProp = overlapsExisting(px, py)
    const offscreen = px < 0 || px > vw || py < 0 || py > vh
    if (!inGear && !inMenu && !inProp && !offscreen && !near) {
      return { id, x: (px / vw) * 100, y: (py / vh) * 100, rot, ...(face !== undefined ? { face } : {}) }
    }
    const distPenalty = near ? Math.hypot(px - nearPx, py - nearPy) / Math.max(vw, vh) : 0
    const score = (inGear ? 100 : 0) + (offscreen ? 80 : 0) + (inMenu ? 50 : 0) + (inProp ? 20 : 0) + distPenalty
    if (!best || score < best.score) best = { x: Math.max(1, Math.min(99, (px / vw) * 100)), y: Math.max(1, Math.min(99, (py / vh) * 100)), rot, score }
  }

  return best
    ? { id, x: best.x, y: best.y, rot: best.rot, ...(face !== undefined ? { face } : {}) }
    : { id, x: 8, y: 12, rot: 0, ...(face !== undefined ? { face } : {}) }
}

/** Check whether a placed prop currently intersects the live gear bounds. */
function propOverlapsGear(p: PlacedProp, gear: NonNullable<ReturnType<typeof gearBounds>>, ppm: number, vw: number, vh: number) {
  const def = PROP_MAP.get(p.id)
  if (!def) return false
  const sizePx = def.mm * ppm
  const halfW = sizePx * 0.52
  const halfH = Math.max(14, sizePx * def.aspect * 0.52)
  const a = (p.rot * Math.PI) / 180
  const rx = Math.abs(Math.cos(a)) * halfW + Math.abs(Math.sin(a)) * halfH
  const ry = Math.abs(Math.sin(a)) * halfW + Math.abs(Math.cos(a)) * halfH
  const px = (p.x / 100) * vw
  const py = (p.y / 100) * vh
  return px + rx > gear.left && px - rx < gear.right && py + ry > gear.top && py - ry < gear.bottom
}

/** Move any props that would be covered by the gear after a layout switch to the nearest free desk spot. */
export function clearGearOverlap(props: PlacedProp[]): PlacedProp[] {
  const gear = gearBounds()
  if (!gear || !props.length) return props
  const vw = Math.max(320, window.innerWidth)
  const vh = Math.max(320, window.innerHeight)
  const ppm = measurePxPerMm()

  const keep: PlacedProp[] = []
  const blocked = new Set<PropId>()
  for (const p of props) {
    if (propOverlapsGear(p, gear, ppm, vw, vh)) blocked.add(p.id)
    else keep.push(p)
  }
  if (!blocked.size) return props

  const placed = keep.slice()
  const moved = new Map<PropId, PlacedProp>()
  for (const p of props) {
    if (!blocked.has(p.id)) continue
    const next = randomSafeSpot(p.id, placed, { x: p.x, y: p.y, rot: p.rot, face: p.face })
    placed.push(next)
    moved.set(p.id, next)
  }
  return props.map((p) => moved.get(p.id) ?? p)
}

export function createInitialProps(): PlacedProp[] {
  const placed: PlacedProp[] = []
  for (const id of DEFAULT_IDS) placed.push(randomSafeSpot(id, placed))
  return placed
}

export function spawnProp(id: PropId, existing: PlacedProp[]): PlacedProp {
  return randomSafeSpot(id, existing)
}

export function scatterProps(props: PlacedProp[]): PlacedProp[] {
  const placed: PlacedProp[] = []
  for (const p of props) placed.push(randomSafeSpot(p.id, placed))
  return placed
}

/* ---------------- Component ---------------- */

export function DeskProps({
  items,
  decks,
  onChange,
}: {
  items: PlacedProp[]
  decks: readonly Deck[]
  onChange: (updater: (current: PlacedProp[]) => PlacedProp[]) => void
}) {
  const [activeId, setActiveId] = useState<PropId | null>(null)
  const [mode, setMode] = useState<'drag' | 'rotate' | null>(null)
  const [pxPerMm, setPxPerMm] = useState(measurePxPerMm)
  const drag = useRef<{
    id: PropId
    startX: number
    startY: number
    origX: number
    origY: number
    curX: number
    curY: number
    moved: boolean
  } | null>(null)
  const rotateRef = useRef<{
    id: PropId
    cx: number
    cy: number
    startAng: number
    origRot: number
    curRot: number
  } | null>(null)
  const wrapRefs = useRef<Partial<Record<PropId, HTMLDivElement | null>>>({})
  const rotRefs = useRef<Partial<Record<PropId, HTMLDivElement | null>>>({})
  const visualRefs = useRef<Partial<Record<PropId, HTMLDivElement | null>>>({})
  const diceRefs = useRef<Partial<Record<PropId, Dice3DHandle | null>>>({})

  const liveRef = useRef<PlacedProp[]>(items)
  liveRef.current = items
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Keep real-world mm scale synced with the BC-1 deck size across resizes and 1/2-deck switches
  useEffect(() => {
    const update = () => setPxPerMm(measurePxPerMm())
    update()
    const ro = new ResizeObserver(update)
    const deck = document.querySelector<HTMLElement>('.device-wrap')
    if (deck) ro.observe(deck)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  // Easter egg: items resting on a spinning CD orbit & rotate rigidly with the disc at live varispeed!
  useEffect(() => {
    let raf = 0
    let last = 0
    let dirty = false

    const flush = () => {
      if (!dirty) return
      dirty = false
      const snapshot = liveRef.current.map((p) => ({ ...p }))
      onChangeRef.current(() => snapshot)
    }

    const tick = (now: number) => {
      raf = 0
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
      last = now

      const spinners: { cx: number; cy: number; r: number; dDeg: number }[] = []
      decks.forEach((deck, i) => {
        const s = deck.getState()
        if (s.power !== 'on' || s.transport !== 'playing' || !s.disc) return
        const discEl = document.querySelector<HTMLElement>(`[data-deck="${i}"] .disc-hit`)
        if (!discEl) return
        const rect = discEl.getBoundingClientRect()
        if (!rect.width) return
        const dDeg = (360 / 0.32) * (s.vari / 100) * dt
        spinners.push({
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
          r: rect.width / 2,
          dDeg,
        })
      })

      if (!spinners.length) {
        last = 0
        flush()
        return
      }

      const vw = window.innerWidth
      const vh = window.innerHeight
      if (dt > 0 && vw > 0 && vh > 0) {
        const next = liveRef.current
        for (let idx = 0; idx < next.length; idx++) {
          const prop = next[idx]
          if (drag.current?.id === prop.id || rotateRef.current?.id === prop.id) continue
          const px = (prop.x / 100) * vw
          const py = (prop.y / 100) * vh
          for (const sp of spinners) {
            const dx = px - sp.cx
            const dy = py - sp.cy
            if (Math.hypot(dx, dy) <= sp.r * 0.96) {
              const rad = (sp.dDeg * Math.PI) / 180
              const cos = Math.cos(rad)
              const sin = Math.sin(rad)
              const nx = sp.cx + dx * cos - dy * sin
              const ny = sp.cy + dx * sin + dy * cos
              prop.x = Math.max(2, Math.min(98, (nx / vw) * 100))
              prop.y = Math.max(3, Math.min(97, (ny / vh) * 100))
              prop.rot += sp.dDeg
              const wrap = wrapRefs.current[prop.id]
              if (wrap) {
                wrap.style.left = `${prop.x}%`
                wrap.style.top = `${prop.y}%`
              }
              if (isDie(prop.id)) {
                diceRefs.current[prop.id]?.setDeskRot(prop.rot)
              } else {
                const rotEl = rotRefs.current[prop.id]
                if (rotEl) rotEl.style.transform = `rotate(${prop.rot}deg)`
              }
              dirty = true
              break
            }
          }
        }
      }

      raf = requestAnimationFrame(tick)
    }

    const wake = () => {
      const anySpinning = decks.some((d) => {
        const s = d.getState()
        return s.power === 'on' && s.transport === 'playing' && !!s.disc
      })
      if (anySpinning) {
        if (!raf) {
          last = 0
          raf = requestAnimationFrame(tick)
        }
      } else {
        if (raf) {
          cancelAnimationFrame(raf)
          raf = 0
        }
        last = 0
        flush()
      }
    }

    const unsubs = decks.map((d) => d.subscribe(wake))
    wake()
    return () => {
      unsubs.forEach((u) => u())
      if (raf) cancelAnimationFrame(raf)
      flush()
    }
  }, [decks])

  const bringToFront = (id: PropId) => {
    onChange((cur) => {
      const idx = cur.findIndex((p) => p.id === id)
      if (idx < 0 || idx === cur.length - 1) return cur
      const next = cur.slice()
      const [item] = next.splice(idx, 1)
      next.push(item)
      return next
    })
  }

  const remove = (id: PropId) => {
    onChange((cur) => cur.filter((p) => p.id !== id))
  }

  /** Trigger a real Three.js 3D tumble + gravity bounce roll with a slight lateral desk skid. */
  const rollDie = (prop: PlacedProp, onDrop: boolean) => {
    const finalFace = rollFace(prop.id, prop.face) ?? 1
    const dir = Math.random() > 0.5 ? 1 : -1
    const rotDelta = onDrop
      ? dir * (22 + Math.round(Math.random() * 58))
      : dir * (35 + Math.round(Math.random() * 145))

    // Slight natural lateral skid across the desk as it bounces (smaller on drop)
    const skidDist = onDrop ? 4 + Math.random() * 8 : 10 + Math.random() * 18
    const skidAng = Math.random() * Math.PI * 2
    const dxPct = (Math.cos(skidAng) * skidDist / Math.max(320, window.innerWidth)) * 100
    const dyPct = (Math.sin(skidAng) * skidDist / Math.max(320, window.innerHeight)) * 100
    const nextX = Math.max(3, Math.min(97, prop.x + dxPct))
    const nextY = Math.max(4, Math.min(96, prop.y + dyPct))

    const wrap = wrapRefs.current[prop.id]
    if (wrap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const startDx = ((prop.x - nextX) / 100) * window.innerWidth
      const startDy = ((prop.y - nextY) / 100) * window.innerHeight
      wrap.animate(
        [
          { transform: `translate(calc(-50% + ${startDx}px), calc(-50% + ${startDy}px))` },
          { transform: 'translate(-50%, -50%)' },
        ],
        { duration: onDrop ? 560 : 820, easing: 'cubic-bezier(0.16, 0.84, 0.3, 1)' },
      )
    }

    onChangeRef.current((cur) =>
      cur.map((p) => (p.id === prop.id ? { ...p, x: nextX, y: nextY, face: finalFace, rot: p.rot + rotDelta } : p)),
    )
    diceRefs.current[prop.id]?.roll(finalFace, onDrop)
  }

  /** Subtle realistic rotation + settle nudge whenever any physical item is placed down. */
  const settleItem = (prop: PlacedProp) => {
    if (isDie(prop.id)) {
      rollDie(prop, true)
      return
    }
    const nudge = Math.round((Math.random() - 0.5) * 16)
    if (nudge !== 0) {
      onChangeRef.current((cur) => cur.map((p) => (p.id === prop.id ? { ...p, rot: p.rot + nudge } : p)))
    }
    const el = visualRefs.current[prop.id]
    if (el && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.animate([{ transform: 'scale(1.04)' }, { transform: 'scale(1)' }], {
        duration: 160,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      })
    }
  }

  // Window-level pointer listeners for active drag & rotate so moving fast or across
  // gear controls (or DOM z-order changes) can never drop pointer capture or catch.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (d) {
        if (!(e.buttons & 1)) {
          finishDrag()
          return
        }
        const dx = e.clientX - d.startX
        const dy = e.clientY - d.startY
        if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true
        if (!d.moved) return
        const nx = Math.max(2, Math.min(98, d.origX + (dx / window.innerWidth) * 100))
        const ny = Math.max(3, Math.min(97, d.origY + (dy / window.innerHeight) * 100))
        d.curX = nx
        d.curY = ny
        const wrap = wrapRefs.current[d.id]
        if (wrap) {
          wrap.style.left = `${nx}%`
          wrap.style.top = `${ny}%`
        }
        const live = liveRef.current.find((p) => p.id === d.id)
        if (live) {
          live.x = nx
          live.y = ny
        }
        return
      }

      const r = rotateRef.current
      if (r) {
        if (!(e.buttons & 1)) {
          finishRotate()
          return
        }
        const ang = (Math.atan2(e.clientY - r.cy, e.clientX - r.cx) * 180) / Math.PI
        const nextRot = Math.round(r.origRot + (ang - r.startAng))
        r.curRot = nextRot
        if (isDie(r.id)) {
          diceRefs.current[r.id]?.setDeskRot(nextRot)
        } else {
          const rotEl = rotRefs.current[r.id]
          if (rotEl) rotEl.style.transform = `rotate(${nextRot}deg)`
        }
        const live = liveRef.current.find((p) => p.id === r.id)
        if (live) live.rot = nextRot
      }
    }

    const finishDrag = () => {
      const d = drag.current
      if (!d) return
      drag.current = null
      setActiveId(null)
      setMode(null)
      const curItem = liveRef.current.find((p) => p.id === d.id)
      if (!curItem) return
      const committed: PlacedProp = { ...curItem, x: d.curX, y: d.curY }
      if (!d.moved) {
        if (isDie(d.id)) rollDie(committed, false)
        return
      }
      onChangeRef.current((cur) => cur.map((p) => (p.id === d.id ? { ...p, x: d.curX, y: d.curY } : p)))
      settleItem(committed)
    }

    const finishRotate = () => {
      const r = rotateRef.current
      if (!r) return
      rotateRef.current = null
      setActiveId(null)
      setMode(null)
      onChangeRef.current((cur) => cur.map((p) => (p.id === r.id ? { ...p, rot: r.curRot } : p)))
    }

    const onUp = () => {
      if (drag.current) finishDrag()
      if (rotateRef.current) finishRotate()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  return (
    <div className={`desk-props ${activeId ? 'dragging' : ''}`} aria-label="desk items">
      {items.map((prop) => {
        const def = PROP_MAP.get(prop.id)
        if (!def) return null
        const grabbing = activeId === prop.id && mode === 'drag'
        const rotating = activeId === prop.id && mode === 'rotate'
        const threeD = isDie(prop.id)
        const width = Math.round(def.mm * pxPerMm)
        const height = threeD ? width : undefined
        return (
          <div
            key={prop.id}
            ref={(el) => {
              wrapRefs.current[prop.id] = el
            }}
            className={`desk-prop ${threeD ? 'is-3d' : ''} ${grabbing ? 'grabbing' : ''} ${rotating ? 'rotating' : ''}`}
            style={{
              left: `${prop.x}%`,
              top: `${prop.y}%`,
              width,
              height,
            }}
            title={`${def.label}${prop.face ? ` (${prop.face})` : ''} — drag to move · drag ↻ or scroll to rotate${threeD ? ' · click to roll' : ''}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              if ((e.target as Element).closest('.desk-prop-btn')) return
              e.preventDefault()
              e.stopPropagation()
              bringToFront(prop.id)
              setActiveId(prop.id)
              setMode('drag')
              drag.current = {
                id: prop.id,
                startX: e.clientX,
                startY: e.clientY,
                origX: prop.x,
                origY: prop.y,
                curX: prop.x,
                curY: prop.y,
                moved: false,
              }
            }}
            onWheel={(e) => {
              e.preventDefault()
              const step = e.deltaY > 0 ? 12 : -12
              onChange((cur) => cur.map((p) => (p.id === prop.id ? { ...p, rot: p.rot + step } : p)))
            }}
          >
            {threeD ? (
              <Dice3D
                ref={(el) => {
                  diceRefs.current[prop.id] = el
                }}
                kind={def.kind === 'd20' ? 'd20' : 'd6'}
                face={prop.face ?? (def.kind === 'd20' ? 20 : 5)}
                rot={prop.rot}
                size={width}
                grabbing={grabbing}
              />
            ) : (
              <div
                ref={(el) => {
                  rotRefs.current[prop.id] = el
                }}
                className="desk-prop-rot"
                style={{ transform: `rotate(${prop.rot}deg)` }}
              >
                <div
                  ref={(el) => {
                    visualRefs.current[prop.id] = el
                  }}
                  className="desk-prop-visual"
                >
                  <img src={def.image} alt={def.label} draggable={false} />
                </div>
              </div>
            )}
            <button
              type="button"
              className="desk-prop-btn desk-prop-rotate"
              aria-label={`rotate ${def.label}`}
              title="drag to rotate"
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                e.stopPropagation()
                bringToFront(prop.id)
                const wrap = wrapRefs.current[prop.id]
                if (!wrap) return
                const r = wrap.getBoundingClientRect()
                const cx = r.left + r.width / 2
                const cy = r.top + r.height / 2
                const startAng = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI
                rotateRef.current = { id: prop.id, cx, cy, startAng, origRot: prop.rot, curRot: prop.rot }
                setActiveId(prop.id)
                setMode('rotate')
              }}
            >
              ↻
            </button>
            <button
              type="button"
              className="desk-prop-btn desk-prop-remove"
              aria-label={`remove ${def.label}`}
              title={`remove ${def.label}`}
              onClick={(e) => {
                e.stopPropagation()
                remove(prop.id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
