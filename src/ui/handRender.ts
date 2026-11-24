export const HAND_STYLES = [
  { id: 'wireframe', label: 'wireframe' },
  { id: 'man', label: 'man' },
  { id: 'woman', label: 'woman' },
  { id: 'simpson', label: 'simpson' },
  { id: 'goblin', label: 'goblin' },
] as const

export type HandStyle = (typeof HAND_STYLES)[number]['id']

export interface Pt {
  x: number
  y: number
  z?: number
}

export interface RenderedHand {
  pts: Pt[] // 21 screen-space landmarks
  cursor: Pt
  pinched: boolean
  pinchStrength: number // 0..1
}

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

const FINGERS: number[][] = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
]

// Reusable offscreen buffer for unified silhouettes + source-atop clipping
let scratch: HTMLCanvasElement | null = null

function getScratch(main: HTMLCanvasElement) {
  if (!scratch) scratch = document.createElement('canvas')
  if (scratch.width !== main.width || scratch.height !== main.height) {
    scratch.width = main.width
    scratch.height = main.height
  }
  const sctx = scratch.getContext('2d')!
  const t = main.getContext('2d')!.getTransform()
  sctx.setTransform(1, 0, 0, 1, 0, 0)
  sctx.clearRect(0, 0, scratch.width, scratch.height)
  sctx.setTransform(t)
  sctx.globalCompositeOperation = 'source-over'
  sctx.globalAlpha = 1
  return { canvas: scratch, ctx: sctx }
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const bary = (a: Pt, b: Pt, c: Pt, wa: number, wb: number, wc: number): Pt => ({
  x: a.x * wa + b.x * wb + c.x * wc,
  y: a.y * wa + b.y * wb + c.y * wc,
})

/** Measure realistic finger radius from knuckle spacing + palm length so fingers sit snugly side-by-side. */
function handMetrics(pts: Pt[]) {
  const palmSize = Math.max(44, dist(pts[0], pts[9]))
  const knuckleSpacing = (dist(pts[5], pts[9]) + dist(pts[9], pts[13]) + dist(pts[13], pts[17])) / 3
  const baseR = Math.max(palmSize * 0.12, Math.min(palmSize * 0.165, knuckleSpacing * 0.49))
  return { palmSize, baseR }
}

/** Pull a fingertip circle center back slightly so the rounded cap ends ON the landmark instead of sticking past it. */
function pullBackTip(dip: Pt, tip: Pt, amount: number): Pt {
  const d = dist(dip, tip)
  if (d < 1) return tip
  const pull = Math.min(amount, d * 0.45)
  return {
    x: tip.x - ((tip.x - dip.x) / d) * pull,
    y: tip.y - ((tip.y - dip.y) / d) * pull,
  }
}

/** Smooth tapered capsule between two points. */
function capsule(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, r1: number, r2: number) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 0.5) {
    ctx.beginPath()
    ctx.arc(a.x, a.y, Math.max(r1, r2), 0, Math.PI * 2)
    ctx.fill()
    return
  }
  const ang = Math.atan2(dy, dx)
  const perp = ang + Math.PI / 2
  ctx.beginPath()
  ctx.arc(a.x, a.y, r1, perp, perp + Math.PI)
  ctx.arc(b.x, b.y, r2, perp + Math.PI, perp)
  ctx.closePath()
  ctx.fill()
}

/** Fill a solid triangle with optional rounded edge expansion. */
function fillTri(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, c: Pt, expand = 0) {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(c.x, c.y)
  ctx.closePath()
  ctx.fill()
  if (expand > 0) {
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = expand * 2
    ctx.stroke()
  }
}

/** Draw a smooth curved finger spline through 4 joints with realistic fingertip cap placement. */
function smoothFinger(ctx: CanvasRenderingContext2D, chain: Pt[], radii: [number, number, number, number], pad = 0, tipPull = 0.55) {
  const [p0, p1, p2, rawTip] = chain
  const p3 = pullBackTip(p2, rawTip, radii[3] * tipPull)
  const m1 = lerpPt(p1, p2, 0.5)
  const segs: { p: Pt; r: number }[] = []
  const sampleQuad = (a: Pt, ctrl: Pt, b: Pt, ra: number, rb: number, steps: number, skipFirst: boolean) => {
    for (let i = skipFirst ? 1 : 0; i <= steps; i++) {
      const t = i / steps
      const mt = 1 - t
      segs.push({
        p: {
          x: mt * mt * a.x + 2 * mt * t * ctrl.x + t * t * b.x,
          y: mt * mt * a.y + 2 * mt * t * ctrl.y + t * t * b.y,
        },
        r: ra + (rb - ra) * t + pad,
      })
    }
  }
  sampleQuad(p0, p1, m1, radii[0], (radii[1] + radii[2]) * 0.5, 5, false)
  sampleQuad(m1, p2, p3, (radii[1] + radii[2]) * 0.5, radii[3], 5, true)
  for (let i = 0; i < segs.length - 1; i++) {
    capsule(ctx, segs[i].p, segs[i + 1].p, segs[i].r, segs[i + 1].r)
  }
}

/**
 * Gap-free, naturally rounded palm with clean wrist heel (no severed arm stump).
 * Every metacarpal wedge is explicitly filled so no void can ever appear at any tilt/curl.
 */
function paintSolidPalm(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  _palmSize: number,
  baseR: number,
  expand: number,
  knucklePairs: [Pt, Pt][],
) {
  const w = pts[0]
  const thumbCmc = pts[1]
  const thumbMcp = pts[2]
  const idx = pts[5]
  const pky = pts[17]

  const edgePad = baseR * 0.96 + expand
  // Lift the wrist heel slightly inward so the bottom of the palm stays smooth with no protruding bulb
  const wristL = lerpPt(w, thumbCmc, 0.42)
  const wristR = lerpPt(w, pky, 0.24)
  const heel = lerpPt(wristL, wristR, 0.5)

  for (const [a, b] of knucklePairs) {
    fillTri(ctx, heel, a, b, edgePad)
  }
  // Smooth rounded lower heel connecting thumb side to pinky side
  fillTri(ctx, wristL, idx, wristR, edgePad)
  fillTri(ctx, wristR, idx, pky, edgePad)
  // Thumb thenar muscle mound & fleshy palm bridge
  fillTri(ctx, wristL, thumbCmc, idx, edgePad)
  fillTri(ctx, thumbCmc, thumbMcp, idx, edgePad * 0.85)
  const palmCenter = bary(heel, idx, pky, 0.34, 0.34, 0.32)
  capsule(ctx, thumbCmc, palmCenter, baseR * 1.12 + expand, baseR * 1.35 + expand)
  capsule(ctx, wristL, wristR, baseR * 1.15 + expand, baseR * 1.1 + expand)
  capsule(ctx, thumbMcp, lerpPt(idx, palmCenter, 0.45), baseR * 0.92 + expand, baseR * 1.0 + expand)
}

function drawReticle(ctx: CanvasRenderingContext2D, cursor: Pt, pinched: boolean, strength: number) {
  ctx.save()
  const r = pinched ? 6.5 : 10.5 - strength * 3
  ctx.beginPath()
  ctx.arc(cursor.x, cursor.y, r, 0, Math.PI * 2)
  ctx.strokeStyle = pinched ? '#ff5a1f' : 'rgb(255 90 31 / 0.7)'
  ctx.lineWidth = pinched ? 2.2 : 1.4
  ctx.stroke()

  if (pinched) {
    ctx.beginPath()
    ctx.arc(cursor.x, cursor.y, 15, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgb(255 90 31 / 0.26)'
    ctx.lineWidth = 1.4
    ctx.stroke()
  }

  ctx.beginPath()
  ctx.arc(cursor.x, cursor.y, pinched ? 3 : 2, 0, Math.PI * 2)
  ctx.fillStyle = '#ff5a1f'
  ctx.fill()
  ctx.restore()
}

/* ---------------- 1. Wireframe (TE technical style) ---------------- */

function drawWireframe(ctx: CanvasRenderingContext2D, hand: RenderedHand) {
  const { pts, pinched } = hand
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ctx.strokeStyle = 'rgb(35 35 33 / 0.18)'
  ctx.lineWidth = 3.5
  ctx.beginPath()
  for (const [a, b] of BONES) {
    ctx.moveTo(pts[a].x, pts[a].y + 2)
    ctx.lineTo(pts[b].x, pts[b].y + 2)
  }
  ctx.stroke()

  ctx.strokeStyle = pinched ? '#ff5a1f' : '#2b2b29'
  ctx.lineWidth = 1.75
  ctx.beginPath()
  for (const [a, b] of BONES) {
    ctx.moveTo(pts[a].x, pts[a].y)
    ctx.lineTo(pts[b].x, pts[b].y)
  }
  ctx.stroke()

  ctx.setLineDash([3, 3])
  ctx.strokeStyle = pinched ? '#ff5a1f' : 'rgb(255 90 31 / 0.5)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(pts[4].x, pts[4].y)
  ctx.lineTo(pts[8].x, pts[8].y)
  ctx.stroke()
  ctx.setLineDash([])

  pts.forEach((p, i) => {
    const isPinchTip = i === 4 || i === 8
    const isTip = isPinchTip || i === 12 || i === 16 || i === 20
    const r = i === 0 ? 4.4 : isTip ? 3.5 : 2.5
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fillStyle = isPinchTip ? '#ff5a1f' : '#efeee9'
    ctx.fill()
    ctx.lineWidth = 1.4
    ctx.strokeStyle = pinched && isPinchTip ? '#ff5a1f' : '#232321'
    ctx.stroke()
  })
  ctx.restore()
}

/* ---------------- 2 & 3. Human Hands (Man / Woman — clean illustrated style) ---------------- */

function drawHumanHand(mainCtx: CanvasRenderingContext2D, hand: RenderedHand, variant: 'man' | 'woman') {
  const { pts } = hand
  const { palmSize, baseR } = handMetrics(pts)
  const isMan = variant === 'man'
  const rUnit = baseR * (isMan ? 1.04 : 0.9)
  const inkW = Math.max(1.4, palmSize * 0.015)

  const { canvas: off, ctx } = getScratch(mainCtx.canvas)

  const scales = isMan ? [1.14, 0.98, 1.02, 0.95, 0.84] : [1.08, 0.96, 1.0, 0.93, 0.8]

  const paintShape = (pad: number, fill: string) => {
    ctx.fillStyle = fill
    ctx.strokeStyle = fill
    paintSolidPalm(ctx, pts, palmSize, rUnit, pad, [
      [pts[5], pts[9]],
      [pts[9], pts[13]],
      [pts[13], pts[17]],
    ])
    FINGERS.forEach((idxs, fi) => {
      const s = scales[fi] * rUnit
      const chain = idxs.map((k) => pts[k])
      const tipRatio = isMan ? 0.84 : 0.76
      smoothFinger(ctx, chain, [s * 1.02, s * 0.96, s * 0.9, s * tipRatio], pad, 0.65)
    })
  }

  // Pass 1: clean solid base hand silhouette
  paintShape(0, isMan ? '#d49f7a' : '#efc6aa')

  // Pass 2: soft directional 3D lighting & nails clipped strictly inside silhouette
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'

  const minX = Math.min(...pts.map((p) => p.x)) - palmSize * 0.35
  const maxX = Math.max(...pts.map((p) => p.x)) + palmSize * 0.35
  const minY = Math.min(...pts.map((p) => p.y)) - palmSize * 0.35
  const maxY = Math.max(...pts.map((p) => p.y)) + palmSize * 0.35
  const light = ctx.createLinearGradient(minX, minY, maxX, maxY)
  if (isMan) {
    light.addColorStop(0, '#e6b896')
    light.addColorStop(0.55, '#d19b76')
    light.addColorStop(1, '#b17854')
  } else {
    light.addColorStop(0, '#fbe2d0')
    light.addColorStop(0.55, '#ecc1a4')
    light.addColorStop(1, '#cf9a7c')
  }
  ctx.fillStyle = light
  ctx.fillRect(minX - 40, minY - 40, maxX - minX + 80, maxY - minY + 80)

  // Clean nails oriented along the last phalanx (omitted when finger points straight at camera)
  FINGERS.forEach((idxs, fi) => {
    const dip = pts[idxs[2]]
    const tip = pullBackTip(dip, pts[idxs[3]], scales[fi] * rUnit * 0.55)
    const seg = dist(dip, tip)
    const fw = scales[fi] * rUnit
    if (seg < fw * 0.45) return
    const ang = Math.atan2(tip.y - dip.y, tip.x - dip.x)
    const nailLen = Math.min(seg * 0.72, fw * (isMan ? 0.76 : 0.92))
    const nailHalfW = fw * (isMan ? 0.48 : 0.38)
    ctx.save()
    ctx.translate(tip.x + Math.cos(ang) * (fw * (isMan ? 0.08 : 0.14)), tip.y + Math.sin(ang) * (fw * (isMan ? 0.08 : 0.14)))
    ctx.rotate(ang)
    ctx.beginPath()
    if (isMan) {
      ctx.roundRect(-nailLen * 0.55, -nailHalfW, nailLen, nailHalfW * 2, nailHalfW * 0.5)
      ctx.fillStyle = '#efd7c6'
      ctx.fill()
      ctx.strokeStyle = 'rgb(140 92 66 / 0.25)'
      ctx.lineWidth = 0.8
      ctx.stroke()
    } else {
      ctx.ellipse(-nailLen * 0.04, 0, nailLen * 0.6, nailHalfW, 0, 0, Math.PI * 2)
      ctx.fillStyle = '#e24c28'
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(-nailLen * 0.1, -nailHalfW * 0.24, nailLen * 0.28, nailHalfW * 0.15, 0, 0, Math.PI * 2)
      ctx.fillStyle = 'rgb(255 255 255 / 0.38)'
      ctx.fill()
    }
    ctx.restore()
  })

  ctx.restore()

  // Pass 3: crisp subtle warm contour outline behind the shaded fill
  ctx.save()
  ctx.globalCompositeOperation = 'destination-over'
  paintShape(inkW, isMan ? '#8b5739' : '#b27a5c')
  ctx.restore()

  mainCtx.save()
  mainCtx.setTransform(1, 0, 0, 1, 0, 0)
  mainCtx.shadowColor = 'rgb(26 20 14 / 0.28)'
  mainCtx.shadowBlur = palmSize * 0.22
  mainCtx.shadowOffsetX = 4
  mainCtx.shadowOffsetY = 9
  mainCtx.drawImage(off, 0, 0)
  mainCtx.restore()
}

/* ---------------- 4. Simpson (plump, rounded 4-fingered cartoon hand) ---------------- */

function drawSimpsonHand(mainCtx: CanvasRenderingContext2D, hand: RenderedHand) {
  const { pts } = hand
  const { palmSize, baseR } = handMetrics(pts)
  const inkW = Math.max(2.6, palmSize * 0.034)
  // Chunky Matt Groening sausage fingers (only 3 upper fingers across the same palm width!)
  const rUnit = baseR * 1.24

  // Authentic 4-finger skeleton: thumb, index, blended middle+ring, pinky
  const midChain: Pt[] = [9, 10, 11, 12].map((m, i) => lerpPt(pts[m], pts[13 + i], 0.5))
  const chains: Pt[][] = [
    [pts[1], pts[2], pts[3], pts[4]],
    [pts[5], pts[6], pts[7], pts[8]],
    midChain,
    [pts[17], pts[18], pts[19], pts[20]],
  ]
  const fingerScale = [1.08, 1.0, 1.04, 0.94]

  const { canvas: off, ctx } = getScratch(mainCtx.canvas)

  const paintSilhouette = (pad: number, fill: string) => {
    ctx.fillStyle = fill
    ctx.strokeStyle = fill
    paintSolidPalm(ctx, pts, palmSize, rUnit * 0.92, pad, [
      [pts[5], midChain[0]],
      [midChain[0], pts[17]],
    ])
    // Plump circular cartoon palm cushion
    const center = bary(pts[0], pts[5], pts[17], 0.36, 0.32, 0.32)
    ctx.beginPath()
    ctx.arc(center.x, center.y, palmSize * 0.33 + pad, 0, Math.PI * 2)
    ctx.fill()

    // Chunky, round, slightly stubbier rubber-hose cartoon fingers
    chains.forEach((chain, fi) => {
      const s = rUnit * fingerScale[fi]
      smoothFinger(ctx, chain, [s * 1.02, s * 0.98, s * 0.95, s * 0.92], pad, 0.85)
    })
  }

  // Pass 1: iconic Simpson yellow fill
  paintSilhouette(0, '#fed90f')

  // Pass 2: soft cel shading + cartoon finger-web ink ticks clipped inside yellow
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'

  const minX = Math.min(...pts.map((p) => p.x)) - palmSize * 0.35
  const maxX = Math.max(...pts.map((p) => p.x)) + palmSize * 0.35
  const minY = Math.min(...pts.map((p) => p.y)) - palmSize * 0.35
  const maxY = Math.max(...pts.map((p) => p.y)) + palmSize * 0.35
  const cel = ctx.createLinearGradient(minX, minY, maxX, maxY)
  cel.addColorStop(0, 'rgb(255 245 135 / 0.35)')
  cel.addColorStop(0.6, 'rgb(254 217 15 / 0)')
  cel.addColorStop(1, 'rgb(204 156 0 / 0.22)')
  ctx.fillStyle = cel
  ctx.fillRect(minX - 40, minY - 40, maxX - minX + 80, maxY - minY + 80)
  ctx.restore()

  // Pass 3: bold uniform black cartoon ink outline behind yellow fill
  ctx.save()
  ctx.globalCompositeOperation = 'destination-over'
  paintSilhouette(inkW, '#171715')
  ctx.restore()

  mainCtx.save()
  mainCtx.setTransform(1, 0, 0, 1, 0, 0)
  mainCtx.shadowColor = 'rgb(24 20 12 / 0.28)'
  mainCtx.shadowBlur = palmSize * 0.22
  mainCtx.shadowOffsetX = 4
  mainCtx.shadowOffsetY = 9
  mainCtx.drawImage(off, 0, 0)
  mainCtx.restore()
}

/* ---------------- 5. Goblin (gnarly green monster hand with clipped warts & claws) ---------------- */

function drawGoblinHand(mainCtx: CanvasRenderingContext2D, hand: RenderedHand) {
  const { pts } = hand
  const { palmSize, baseR } = handMetrics(pts)
  const rUnit = baseR * 0.94
  const inkW = Math.max(2, palmSize * 0.025)
  const fingerScale = [1.1, 0.98, 1.03, 0.95, 0.82]

  const { canvas: off, ctx } = getScratch(mainCtx.canvas)

  const paintBody = (pad: number, fill: string) => {
    ctx.fillStyle = fill
    ctx.strokeStyle = fill
    paintSolidPalm(ctx, pts, palmSize, rUnit, pad, [
      [pts[5], pts[9]],
      [pts[9], pts[13]],
      [pts[13], pts[17]],
    ])
    FINGERS.forEach((idxs, fi) => {
      const s = rUnit * fingerScale[fi]
      const chain = idxs.map((k) => pts[k])
      smoothFinger(ctx, chain, [s * 1.0, s * 0.92, s * 0.82, s * 0.72], pad, 0.55)
      // Knobby goblin knuckles at MCP & PIP
      for (const k of [idxs[0], idxs[1]]) {
        ctx.beginPath()
        ctx.arc(pts[k].x, pts[k].y, s * 1.12 + pad, 0, Math.PI * 2)
        ctx.fill()
      }
    })
  }

  // Pass 1: solid goblin body
  paintBody(0, '#4b8631')

  // Pass 2: source-atop clipped mottling, warts, and knuckle wrinkles — warts can NEVER float off the hand!
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'

  const minX = Math.min(...pts.map((p) => p.x)) - palmSize * 0.35
  const maxX = Math.max(...pts.map((p) => p.x)) + palmSize * 0.35
  const minY = Math.min(...pts.map((p) => p.y)) - palmSize * 0.35
  const maxY = Math.max(...pts.map((p) => p.y)) + palmSize * 0.35
  const grad = ctx.createLinearGradient(minX, minY, maxX, maxY)
  grad.addColorStop(0, '#74b54d')
  grad.addColorStop(0.5, '#4c8832')
  grad.addColorStop(1, '#29531c')
  ctx.fillStyle = grad
  ctx.fillRect(minX - 40, minY - 40, maxX - minX + 80, maxY - minY + 80)

  // Barycentric palm warts (strictly inside palm triangles AND clipped by source-atop!)
  const warts: { p: Pt; r: number }[] = [
    { p: bary(pts[0], pts[5], pts[9], 0.45, 0.3, 0.25), r: rUnit * 0.32 },
    { p: bary(pts[0], pts[9], pts[17], 0.38, 0.34, 0.28), r: rUnit * 0.38 },
    { p: bary(pts[0], pts[1], pts[5], 0.42, 0.33, 0.25), r: rUnit * 0.28 },
  ]
  for (const w of warts) {
    ctx.beginPath()
    ctx.arc(w.p.x, w.p.y, w.r, 0, Math.PI * 2)
    ctx.fillStyle = '#2b531b'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(w.p.x - w.r * 0.25, w.p.y - w.r * 0.25, w.r * 0.35, 0, Math.PI * 2)
    ctx.fillStyle = 'rgb(148 206 102 / 0.45)'
    ctx.fill()
  }

  // Dark knuckle wrinkles
  ctx.strokeStyle = 'rgb(20 42 12 / 0.5)'
  ctx.lineWidth = Math.max(1.2, palmSize * 0.014)
  ctx.lineCap = 'round'
  for (const idxs of FINGERS) {
    const prev = pts[idxs[0]]
    const kn = pts[idxs[1]]
    if (dist(prev, kn) < rUnit * 0.5) continue
    const ang = Math.atan2(kn.y - prev.y, kn.x - prev.x) + Math.PI / 2
    const half = rUnit * 0.5
    ctx.beginPath()
    ctx.moveTo(kn.x - Math.cos(ang) * half, kn.y - Math.sin(ang) * half)
    ctx.lineTo(kn.x + Math.cos(ang) * half, kn.y + Math.sin(ang) * half)
    ctx.stroke()
  }
  ctx.restore()

  // Pass 3: dark mossy outline + curved ivory bone claws tucked cleanly behind the shaded body
  ctx.save()
  ctx.globalCompositeOperation = 'destination-over'
  paintBody(inkW, '#1b3312')

  const clawScale = [1.08, 1.0, 1.08, 0.98, 0.88]
  FINGERS.forEach((idxs, fi) => {
    const dip = pts[idxs[2]]
    const rawTip = pts[idxs[3]]
    const tip = pullBackTip(dip, rawTip, rUnit * fingerScale[fi] * 0.15)
    const dx = rawTip.x - dip.x
    const dy = rawTip.y - dip.y
    const len = Math.hypot(dx, dy)
    if (len < rUnit * 0.35) return
    const ux = dx / len
    const uy = dy / len
    const px = -uy
    const py = ux
    const sc = clawScale[fi]
    const clawLen = Math.max(rUnit * 0.95, Math.min(len * 1.15, palmSize * 0.28 * sc))
    const halfBase = rUnit * 0.54 * sc
    const hookX = tip.x + ux * clawLen + px * clawLen * 0.24
    const hookY = tip.y + uy * clawLen + py * clawLen * 0.24
    const cpx = tip.x + ux * clawLen * 0.55 - px * clawLen * 0.1
    const cpy = tip.y + uy * clawLen * 0.55 - py * clawLen * 0.1

    ctx.beginPath()
    ctx.moveTo(tip.x + px * halfBase, tip.y + py * halfBase)
    ctx.quadraticCurveTo(cpx + px * halfBase * 0.55, cpy + py * halfBase * 0.55, hookX, hookY)
    ctx.quadraticCurveTo(cpx - px * halfBase * 0.4, cpy - py * halfBase * 0.4, tip.x - px * halfBase, tip.y - py * halfBase)
    ctx.closePath()
    const cg = ctx.createLinearGradient(tip.x, tip.y, hookX, hookY)
    cg.addColorStop(0, '#cfc7a1')
    cg.addColorStop(0.6, '#f1ebd1')
    cg.addColorStop(1, '#716040')
    ctx.fillStyle = cg
    ctx.fill()
    ctx.strokeStyle = '#1b2e13'
    ctx.lineWidth = 2.4
    ctx.stroke()
  })
  ctx.restore()

  mainCtx.save()
  mainCtx.setTransform(1, 0, 0, 1, 0, 0)
  mainCtx.shadowColor = 'rgb(14 26 10 / 0.36)'
  mainCtx.shadowBlur = palmSize * 0.22
  mainCtx.shadowOffsetX = 5
  mainCtx.shadowOffsetY = 10
  mainCtx.drawImage(off, 0, 0)
  mainCtx.restore()
}

export function renderHands(ctx: CanvasRenderingContext2D, hands: RenderedHand[], style: HandStyle) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  for (const hand of hands) {
    if (style === 'wireframe') drawWireframe(ctx, hand)
    else if (style === 'man') drawHumanHand(ctx, hand, 'man')
    else if (style === 'woman') drawHumanHand(ctx, hand, 'woman')
    else if (style === 'simpson') drawSimpsonHand(ctx, hand)
    else drawGoblinHand(ctx, hand)
    drawReticle(ctx, hand.cursor, hand.pinched, hand.pinchStrength)
  }
}
