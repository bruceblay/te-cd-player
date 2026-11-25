/*
 * What the hand cursor can snap to: the page's controls, plus anything a view
 * registers (the 3D studio projects its scene controls to screen rectangles).
 * Snapping pulls the cursor to the nearest point inside the nearest control,
 * so small keys snap to their middle and big ones (faders, discs) aren't
 * disturbed once the cursor is on them.
 */
export interface HandTarget {
  left: number
  top: number
  right: number
  bottom: number
}

type Provider = () => HandTarget[]
const providers = new Set<Provider>()

/** A view adds its own targets (returns a function that removes them). */
export function addHandTargets(provider: Provider): () => void {
  providers.add(provider)
  return () => providers.delete(provider)
}

const DOM_TARGETS = [
  'button:not(:disabled)',
  'a[href]',
  'input:not([type="hidden"]):not(:disabled)',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="slider"]',
  '[role="radio"]',
  '[role="switch"]',
  '.knob',
  '.disc-hit',
  '.desk-prop',
].join(',')

function domTargets(): HandTarget[] {
  const out: HandTarget[] = []
  const vw = window.innerWidth
  const vh = window.innerHeight
  // inside an open modal only its own controls count, as for a mouse
  const modal = document.querySelector<HTMLDialogElement>('dialog[open]')
  const root: ParentNode = modal ?? document
  for (const el of root.querySelectorAll<HTMLElement>(DOM_TARGETS)) {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue
    if (el.closest('[aria-hidden="true"], [inert]')) continue
    out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
  }
  return out
}

let cache: HandTarget[] = []
let cacheAt = 0

/** All snap targets, refreshed at most every 120 ms (layout reads are not free). */
export function handTargets(now: number): HandTarget[] {
  if (now - cacheAt > 120) {
    cacheAt = now
    cache = domTargets()
    for (const p of providers) cache.push(...p())
  }
  return cache
}

/**
 * Snap a cursor to the nearest target within `reach` px. Returns the snapped
 * point and the target, or null when nothing is close enough.
 */
export function snapToTarget(x: number, y: number, now: number, reach = 30): { x: number; y: number; target: HandTarget } | null {
  let best: { x: number; y: number; target: HandTarget; d: number } | null = null
  for (const t of handTargets(now)) {
    // nearest point inside the target, kept a few px in from its edge
    const inset = Math.min(4, (t.right - t.left) / 2, (t.bottom - t.top) / 2)
    const nx = Math.max(t.left + inset, Math.min(t.right - inset, x))
    const ny = Math.max(t.top + inset, Math.min(t.bottom - inset, y))
    const d = Math.hypot(nx - x, ny - y)
    if (d > reach) continue
    // prefer the smaller of two overlapping targets (a key on a panel)
    const area = (t.right - t.left) * (t.bottom - t.top)
    const score = d + Math.min(12, Math.sqrt(area) / 20)
    if (!best || score < best.d) best = { x: nx, y: ny, target: t, d: score }
  }
  return best && { x: best.x, y: best.y, target: best.target }
}
