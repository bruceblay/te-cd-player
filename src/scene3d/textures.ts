import * as THREE from 'three'
import cdMarkUrl from '../assets/compact-disc.svg'
import sidekickLidUrl from '../assets/sidekick-lid-print.svg'
import teMarkUrl from '../assets/te-wordmark.png'
import type { DeckState } from '../engine/deck'
import { readout } from '../engine/display'
import { SETTINGS, type MixerState } from '../engine/mixer'
import { FX_TYPES } from '../engine/sidekickFx'
import { trackImage } from '../ui/boot'
import { drawDiscPrint, spinBlur, SPIN_BLUR_DEG } from '../ui/discArt'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    trackImage(img, src) // counts towards the loading screen
    img.src = src
  })
}

/* ---------------- Shared 7-segment drawing (matches SevenSeg.tsx) ---------------- */

const SEG_MAP: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgecd',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abfgcd',
  '-': 'g',
  ' ': '',
  a: 'abcefg',
  b: 'fgecd',
  c: 'ged',
  d: 'bgecd',
  e: 'afged',
  f: 'afge',
  g: 'afgecd',
  h: 'fgec',
  i: 'c',
  j: 'bcd',
  k: 'fgec',
  l: 'fed',
  m: 'abcef',
  n: 'gec',
  o: 'gecd',
  p: 'abfge',
  q: 'abfgc',
  r: 'ge',
  s: 'afgcd',
  t: 'fged',
  u: 'ecd',
  v: 'fedcb',
  w: 'fedcb',
  x: 'fgebc',
  y: 'fgbcd',
  z: 'abged',
}

function drawSegChar(
  ctx: CanvasRenderingContext2D,
  ch: string,
  x: number,
  y: number,
  w: number,
  h: number,
  dot: boolean,
  on: boolean,
) {
  const active = on ? (SEG_MAP[ch.toLowerCase()] ?? '') : ''
  const t = Math.max(2.2, w * 0.145)
  const pad = t * 0.48
  const mid = y + h * 0.5
  const seg = (id: string, x1: number, y1: number, x2: number, y2: number) => {
    const lit = active.includes(id)
    ctx.strokeStyle = lit ? '#ff3c1f' : '#21100d'
    ctx.lineWidth = t
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  seg('a', x + pad, y + pad, x + w - pad, y + pad)
  seg('b', x + w - pad, y + pad * 1.4, x + w - pad, mid - pad * 0.7)
  seg('c', x + w - pad, mid + pad * 0.7, x + w - pad, y + h - pad * 1.4)
  seg('d', x + pad, y + h - pad, x + w - pad, y + h - pad)
  seg('e', x + pad, mid + pad * 0.7, x + pad, y + h - pad * 1.4)
  seg('f', x + pad, y + pad * 1.4, x + pad, mid - pad * 0.7)
  seg('g', x + pad * 1.2, mid, x + w - pad * 1.2, mid)

  ctx.beginPath()
  ctx.arc(x + w + t * 0.65, y + h - pad, t * 0.52, 0, Math.PI * 2)
  ctx.fillStyle = on && dot ? '#ff3c1f' : '#21100d'
  ctx.fill()
}

/* ---------------- 1. BC-1 Ultra-High-DPI Top Faceplate Texture ---------------- */

const BC1_SCREWS: [number, number][] = [
  [9, 25], [26, 25], [9, 42], [26, 42],
  [345, 25], [362, 25], [345, 42], [362, 42],
  [9, 109], [362, 109],
]

const BC1_MECH_PATH =
  'M90 212 Q87 212 87 209 V143 Q87 141 88.5 139.5 L103.5 124.5 Q105 123 107 123 H159 Q162 123 162 120 V89 Q162 86 165 86 H232 Q234 86 235.5 87.5 L251 103 Q252.5 104.5 252.5 106.5 V145.6 A35 35 0 0 1 237 212 Z'

export function createBc1PlateTexture(): THREE.CanvasTexture {
  // 370 x 511 diagram units * 6 = 2220 x 3066 retina-crisp plate texture
  const S = 6
  const c = document.createElement('canvas')
  c.width = 370 * S
  c.height = 511 * S
  const ctx = c.getContext('2d')!
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 16

  let cdImg: HTMLImageElement | null = null
  let teImg: HTMLImageElement | null = null

  const render = () => {
    ctx.save()
    ctx.setTransform(S, 0, 0, S, 0, 0)

    // Warm bead-blasted anodized aluminum plate matching 2D --plate-surface
    const grad = ctx.createLinearGradient(0, 0, 370, 511)
    grad.addColorStop(0, '#d2d2cd')
    grad.addColorStop(0.55, '#c7c7c2')
    grad.addColorStop(1, '#bdbdb7')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 370, 511)

    // Fine milled finger pockets (matching .hole in styles.css)
    const drawHole = (cx: number, cy: number, r: number) => {
      ctx.save()
      const floor = ctx.createRadialGradient(cx + r * 0.12, cy + r * 0.18, r * 0.05, cx, cy, r)
      floor.addColorStop(0, '#c8c8c3')
      floor.addColorStop(0.76, '#bebeb9')
      floor.addColorStop(1, '#a9a9a3')
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = floor
      ctx.fill()

      // Upper-left inner milled wall shadow
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.clip()
      ctx.beginPath()
      ctx.arc(cx + 1.4, cy + 1.8, r, 0, Math.PI * 2)
      ctx.lineWidth = 3.2
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx - 0.8, cy - 1.0, r, 0, Math.PI * 2)
      ctx.lineWidth = 1.6
      ctx.strokeStyle = 'rgba(255,255,255,0.42)'
      ctx.stroke()
      ctx.restore()

      // Lower-right machined lip highlight
      ctx.beginPath()
      ctx.arc(cx, cy, r + 0.3, Math.PI * 0.08, Math.PI * 0.88)
      ctx.strokeStyle = 'rgba(255,255,255,0.52)'
      ctx.lineWidth = 0.65
      ctx.stroke()
      ctx.restore()
    }
    drawHole(143, 269, 25)
    drawHole(328.5, 84.5, 27.5)

    // Turned recessed aluminum cups beneath VARISPEED & LEVEL knobs (matching .knob in styles.css)
    const drawKnobCup = (cx: number, cy: number, r: number) => {
      ctx.save()
      const cg = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r)
      cg.addColorStop(0, '#babab5')
      cg.addColorStop(0.54, '#acaca7')
      cg.addColorStop(0.76, '#d3d3ce')
      cg.addColorStop(1, '#c3c3be')
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = cg
      ctx.fill()
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.clip()
      ctx.beginPath()
      ctx.arc(cx + 0.9, cy + 1.4, r, 0, Math.PI * 2)
      ctx.lineWidth = 2.4
      ctx.strokeStyle = 'rgba(0,0,0,0.28)'
      ctx.stroke()
      ctx.restore()
      ctx.beginPath()
      ctx.arc(cx, cy, r + 0.25, 0.15, Math.PI - 0.15)
      ctx.strokeStyle = 'rgba(255,255,255,0.62)'
      ctx.lineWidth = 0.6
      ctx.stroke()
      ctx.restore()
    }
    drawKnobCup(270 + 17, 387 + 17, 17)
    drawKnobCup(320 + 17, 387 + 17, 17)

    // 10 recessed bases under the 3D raised LEGO-compatible corner studs (built in geometry in buildBc1.ts)
    for (const [sx, sy] of BC1_SCREWS) {
      ctx.save()
      ctx.translate(sx, sy)
      ctx.beginPath()
      ctx.arc(0, 0, 5.4, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,0,0,0.14)'
      ctx.fill()
      ctx.restore()
    }

    // Exposed laser mechanism cutout (matching PlateArt.tsx)
    ctx.save()
    const mechPath = new Path2D(BC1_MECH_PATH)
    ctx.save()
    ctx.translate(0, 0.8)
    ctx.fillStyle = 'rgba(0,0,0,0.24)'
    ctx.fill(mechPath)
    ctx.restore()

    const mg = ctx.createLinearGradient(87, 86, 190, 212)
    mg.addColorStop(0, '#46474a')
    mg.addColorStop(1, '#343538')
    ctx.fillStyle = mg
    ctx.fill(mechPath)
    ctx.strokeStyle = '#a7a7a2'
    ctx.lineWidth = 0.7
    ctx.stroke(mechPath)

    // Mechanical slots & mounting screws inside laser bay
    ctx.fillStyle = '#151517'
    ctx.fillRect(106, 134, 3.4, 3.4)
    ctx.fillStyle = '#1f2022'
    ctx.fillRect(229, 117, 1.6, 8)
    ctx.fillRect(245, 129, 1.6, 8)
    ctx.fillRect(213, 135, 2.6, 2.6)

    // Real TE wordmark PNG inside bay
    if (teImg) {
      ctx.drawImage(teImg, 165, 150, 35, 13)
    }

    // Blue laser PCB sled + carriage rails + coated lens
    ctx.fillStyle = '#1b1c1f'
    ctx.fillRect(89.5, 171.5, 68, 18)
    const sg = ctx.createLinearGradient(90.5, 0, 156.5, 0)
    sg.addColorStop(0, '#24296a')
    sg.addColorStop(0.55, '#323a8c')
    sg.addColorStop(1, '#1d2257')
    ctx.fillStyle = sg
    ctx.fillRect(90.5, 172.5, 66, 16)

    ctx.fillStyle = '#1d1e21'
    ctx.fillRect(157.5, 169.5, 46, 22)
    ctx.fillStyle = '#5a5d66'
    ctx.fillRect(161, 172, 14, 17)
    ctx.fillStyle = '#4a4d55'
    ctx.fillRect(186, 172, 14, 17)

    ctx.beginPath()
    ctx.arc(180.5, 180.5, 7, 0, Math.PI * 2)
    ctx.fillStyle = '#3a3c43'
    ctx.fill()

    const lg = ctx.createRadialGradient(179.4, 179.1, 0.5, 180.5, 180.5, 4.8)
    lg.addColorStop(0, '#d2d7e8')
    lg.addColorStop(0.32, '#697290')
    lg.addColorStop(0.75, '#2b3042')
    lg.addColorStop(1, '#1b1d24')
    ctx.beginPath()
    ctx.arc(180.5, 180.5, 4.6, 0, Math.PI * 2)
    ctx.fillStyle = lg
    ctx.fill()

    // Laser warning microprint
    ctx.fillStyle = '#b9babc'
    ctx.font = '500 2.55px "Barlow", "Helvetica Neue", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('CLASS 1 LASER: NEVER TOUCH THE LENS', 96, 199.5)
    ctx.fillText('NEVER LOOK DIRECTLY INTO THE LENS', 96, 203.5)
    ctx.beginPath()
    ctx.arc(167.5, 200.6, 1.2, 0, Math.PI * 2)
    ctx.fillStyle = '#d8d8d8'
    ctx.fill()
    ctx.strokeStyle = '#8a8b8e'
    ctx.lineWidth = 0.35
    ctx.beginPath()
    ctx.moveTo(169.5, 200.6)
    ctx.lineTo(178, 200.6)
    ctx.stroke()
    ctx.restore()

    // Index window
    const wg = ctx.createLinearGradient(0, 236, 0, 253)
    wg.addColorStop(0, '#070708')
    wg.addColorStop(1, '#18181a')
    ctx.fillStyle = wg
    ctx.beginPath()
    ctx.roundRect(219, 236, 34, 17, 1)
    ctx.fill()
    ctx.strokeStyle = '#999994'
    ctx.lineWidth = 0.45
    ctx.stroke()

    // Real Compact Disc Digital Audio SVG mark
    if (cdImg) {
      ctx.drawImage(cdImg, 302, 169, 36, 24)
    }

    // Silk-screened TE legends (matching Device.tsx)
    const print = (text: string, x: number, y: number, align: CanvasTextAlign = 'left', ruleW = 0) => {
      ctx.fillStyle = '#333436'
      ctx.font = '500 4.05px "Barlow", "Helvetica Neue", sans-serif'
      ctx.textAlign = align
      ctx.textBaseline = 'top'
      ctx.fillText(text, x, y)
      if (ruleW > 0) {
        ctx.fillStyle = '#333436'
        ctx.fillRect(x, y + 4.9, ruleW, 0.45)
      }
    }

    print('OUTPUT', 22, 4)
    print('BT', 68.5, 4)
    print('SYNC OUT', 104, 4)
    print('DATA', 227, 4)
    print('USB', 280, 4)
    print('POWER', 327, 4)
    print('L', 341, 278.5, 'center')
    print('R', 350, 278.5, 'center')

    const groups: [string, number, number][] = [
      ['TRACK', 118.5, 29.5],
      ['INDEX', 152, 29.5],
      ['MIN', 185.5, 29.5],
      ['SEC', 219, 34],
      ['VARISPEED', 270, 34],
      ['LINE LEVEL', 320, 34],
    ]
    for (const [label, gx, rw] of groups) print(label, gx, 328, 'left', rw)

    const col = [118, 169, 219, 270, 320]
    for (let i = 0; i < 3; i++) print('CUE', col[i] + 11, 375.5)
    print('VARISPEED', col[3] + 17, 375.5, 'center')
    print('LEVEL', col[4] + 17, 375.5, 'center')
    print('JOG', col[0] + 17, 459, 'center')
    print('PHONES', 281, 496, 'center')

    // Flush recessed translucent orange JOG aperture (no black border; milled shadow depth)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(col[0], 438, 34, 17, 1.5)
    const jg = ctx.createLinearGradient(0, 438, 0, 455)
    jg.addColorStop(0, '#6a1b07')
    jg.addColorStop(0.35, '#9d2d0d')
    jg.addColorStop(1, '#c64217')
    ctx.fillStyle = jg
    ctx.fill()
    // Inner recessed shadow along top & left walls
    ctx.save()
    ctx.clip()
    ctx.strokeStyle = 'rgba(0,0,0,0.42)'
    ctx.lineWidth = 2.2
    ctx.strokeRect(col[0] + 0.4, 438.4, 34, 17)
    ctx.restore()
    // Subtle machined lower-right rim catchlight on the aluminum cutout
    ctx.strokeStyle = 'rgba(255,255,255,0.48)'
    ctx.lineWidth = 0.55
    ctx.beginPath()
    ctx.moveTo(col[0] + 1.5, 455.3)
    ctx.lineTo(col[0] + 33.2, 455.3)
    ctx.lineTo(col[0] + 34.3, 454.2)
    ctx.lineTo(col[0] + 34.3, 439.5)
    ctx.stroke()
    ctx.restore()

    ctx.restore()
    tex.needsUpdate = true
  }

  render()
  void Promise.allSettled([loadImage(cdMarkUrl), loadImage(teMarkUrl)]).then(([cdRes, teRes]) => {
    if (cdRes.status === 'fulfilled') cdImg = cdRes.value
    if (teRes.status === 'fulfilled') teImg = teRes.value
    render()
  })
  void document.fonts?.ready.then(render)

  return tex
}

/* ---------------- 1b. BC-1 Detailed Turntable Platter Texture ---------------- */

export function createTurntableTexture(): THREE.CanvasTexture {
  const S = 512
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8

  const render = () => {
    const cx = S / 2
    const cy = S / 2
    const R = S / 2
    ctx.clearRect(0, 0, S, S)

    // Satin dark anodized turntable platter
    const tg = ctx.createRadialGradient(cx * 0.9, cy * 0.85, R * 0.08, cx, cy, R)
    tg.addColorStop(0, '#333438')
    tg.addColorStop(0.75, '#1d1e21')
    tg.addColorStop(1, '#141416')
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.99, 0, Math.PI * 2)
    ctx.fillStyle = tg
    ctx.fill()

    // Outer chamfer ring & groove
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.97, 0, Math.PI * 2)
    ctx.strokeStyle = '#5c5d62'
    ctx.lineWidth = 3.5
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.88, 0, Math.PI * 2)
    ctx.strokeStyle = '#2d2e32'
    ctx.lineWidth = 4
    ctx.stroke()

    // Circular micro-typography along radius 0.72 ("DIGITAL VARISPEED" / "BC-1 · 44.1 KHZ")
    const drawArcText = (str: string, startAngle: number) => {
      ctx.save()
      ctx.fillStyle = '#c8c9cd'
      ctx.font = '600 18px "Barlow", "Helvetica Neue", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const rad = R * 0.73
      const step = 0.072
      for (let i = 0; i < str.length; i++) {
        const a = startAngle + i * step
        ctx.save()
        ctx.translate(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad)
        ctx.rotate(a + Math.PI / 2)
        ctx.fillText(str[i], 0, 0)
        ctx.restore()
      }
      ctx.restore()
    }
    drawArcText('DIGITAL VARISPEED', -Math.PI * 0.46)
    drawArcText('BC-1 · 44.1 KHZ', Math.PI * 0.54)

    // 3 white triangular rotational index ticks (matching PlateArt.tsx)
    for (const deg of [-30, 90, 210]) {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate((deg * Math.PI) / 180)
      ctx.beginPath()
      ctx.moveTo(0, -R * 0.57)
      ctx.lineTo(10, -R * 0.48)
      ctx.lineTo(-10, -R * 0.48)
      ctx.closePath()
      ctx.fillStyle = '#e8e8e6'
      ctx.fill()
      ctx.restore()
    }

    // Inner hub ring + 5 recessed detent holes
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.36, 0, Math.PI * 2)
    ctx.fillStyle = '#1b1c1f'
    ctx.fill()
    ctx.strokeStyle = '#3f4045'
    ctx.lineWidth = 3
    ctx.stroke()

    for (let i = 0; i < 5; i++) {
      const a = (i * 72 * Math.PI) / 180
      ctx.beginPath()
      ctx.arc(cx + Math.sin(a) * R * 0.255, cy - Math.cos(a) * R * 0.255, R * 0.036, 0, Math.PI * 2)
      ctx.fillStyle = '#09090b'
      ctx.fill()
    }

    tex.needsUpdate = true
  }

  render()
  void document.fonts?.ready.then(render)
  return tex
}

/* ---------------- 2. BC-1 Live Seven-Segment + VU Display Updaters ---------------- */

export function createBc1DisplayUpdater() {
  const mainC = document.createElement('canvas')
  mainC.width = 680
  mainC.height = 88
  const mainCtx = mainC.getContext('2d')!
  const mainTex = new THREE.CanvasTexture(mainC)
  mainTex.colorSpace = THREE.SRGBColorSpace
  mainTex.anisotropy = 8

  const variC = document.createElement('canvas')
  variC.width = 176
  variC.height = 88
  const variCtx = variC.getContext('2d')!
  const variTex = new THREE.CanvasTexture(variC)
  variTex.colorSpace = THREE.SRGBColorSpace
  variTex.anisotropy = 8

  const lineC = document.createElement('canvas')
  lineC.width = 176
  lineC.height = 88
  const lineCtx = lineC.getContext('2d')!
  const lineTex = new THREE.CanvasTexture(lineC)
  lineTex.colorSpace = THREE.SRGBColorSpace
  lineTex.anisotropy = 8

  const vuC = document.createElement('canvas')
  vuC.width = 96
  vuC.height = 192
  const vuCtx = vuC.getContext('2d')!
  const vuTex = new THREE.CanvasTexture(vuC)
  vuTex.colorSpace = THREE.SRGBColorSpace
  vuTex.anisotropy = 8

  const drawWindow = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = '#090707'
    ctx.fillRect(0, 0, w, h)
  }

  let blinkPhase = true
  let lastBlink = 0

  let lastShown = ''
  // fonts arriving after the first draw: draw again with them
  void document.fonts?.ready.then(() => (lastShown = ''))
  const update = (s: DeckState, now: number) => {
    if (now - lastBlink > 380) {
      blinkPhase = !blinkPhase
      lastBlink = now
    }
    const r = readout(s)
    const on = s.power === 'on'
    // redraw (and re-upload the textures) only when what the displays show has changed
    const levelsNow: [number, number] = s.batteryCheck ? [s.battery, s.battery] : on ? s.vu : [0, 0]
    const shown = [
      on,
      [...r.main].map((ch, i) => (on && (!r.blink[i] || blinkPhase) ? ch : '_') + (r.dots[i] ? '.' : '')).join(''),
      r.vari,
      r.line,
      // lit VU segments, counted the way they're drawn below
      levelsNow.map((v) => [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => v * 9 > 8 - i + 0.15).length).join(','),
    ].join('|')
    if (shown === lastShown) return
    lastShown = shown

    drawWindow(mainCtx, 680, 88)
    const groupX = [10, 178, 346, 514]
    for (let g = 0; g < 4; g++) {
      for (let d = 0; d < 3; d++) {
        const idx = g * 3 + d
        const ch = r.main[idx] ?? ' '
        const dot = !!r.dots[idx]
        const vis = on && (!r.blink[idx] || blinkPhase)
        drawSegChar(mainCtx, ch, groupX[g] + d * 45, 16, 33, 56, dot, vis)
      }
    }
    mainTex.needsUpdate = true

    drawWindow(variCtx, 176, 88)
    for (let d = 0; d < 3; d++) {
      drawSegChar(variCtx, r.vari[d] ?? ' ', 20 + d * 45, 16, 33, 56, false, on)
    }
    variTex.needsUpdate = true

    drawWindow(lineCtx, 176, 88)
    for (let d = 0; d < 3; d++) {
      drawSegChar(lineCtx, r.line[d] ?? ' ', 20 + d * 45, 16, 33, 56, false, on)
    }
    lineTex.needsUpdate = true

    drawWindow(vuCtx, 96, 192)
    const levels: [number, number] = s.batteryCheck ? [s.battery, s.battery] : on ? s.vu : [0, 0]
    for (let col = 0; col < 2; col++) {
      for (let i = 0; i < 9; i++) {
        const lit = levels[col] * 9 > 8 - i + 0.15
        const isPeak = i < 2
        vuCtx.fillStyle = lit ? (isPeak ? '#ff2a1a' : '#ff551c') : '#211210'
        vuCtx.fillRect(14 + col * 40, 12 + i * 19, 28, 12)
      }
    }
    vuTex.needsUpdate = true
  }

  return {
    mainTex,
    variTex,
    lineTex,
    vuTex,
    update,
    dispose() {
      mainTex.dispose()
      variTex.dispose()
      lineTex.dispose()
      vuTex.dispose()
    },
  }
}

/* ---------------- 3. BC-1 Printed Burned CD Texture ---------------- */

export function createDiscTexture(disc: NonNullable<DeckState['disc']>): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(drawDiscPrint(disc, 1024, true))
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 16
  return tex
}

/** the same print smeared around the centre, faded in over the crisp one while the disc spins */
export function createDiscBlurTexture(disc: NonNullable<DeckState['disc']>): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(spinBlur(drawDiscPrint(disc, 512, true), SPIN_BLUR_DEG))
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/* ---------------- 4. BC-1 High-DPI Keycap Label Texture ---------------- */

export function createKeyLabelTexture(
  label: string,
  bg: string,
  fg: string,
  align: 'top' | 'center' | 'corner' = 'top',
): THREE.CanvasTexture {
  const S = 256
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8

  const render = () => {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, S, S)

    // Subtle molded chamfer highlight along top-left & shade bottom-right
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 6
    ctx.strokeRect(4, 4, S - 8, S - 8)

    ctx.fillStyle = fg
    if (label === 'PREV' || label === 'NEXT') {
      ctx.save()
      ctx.translate(S / 2, 54)
      ctx.scale(3.4, 3.4)
      if (label === 'PREV') {
        ctx.fillRect(-9.5, -6.5, 2.4, 13)
        ctx.beginPath()
        ctx.moveTo(8, -6.5)
        ctx.lineTo(-5.5, 0)
        ctx.lineTo(8, 6.5)
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.fillRect(7.1, -6.5, 2.4, 13)
        ctx.beginPath()
        ctx.moveTo(-8, -6.5)
        ctx.lineTo(5.5, 0)
        ctx.lineTo(-8, 6.5)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
    } else if (align === 'center') {
      ctx.font = '600 108px "Chakra Petch", "Barlow", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, S / 2, S / 2 + 4)
    } else if (align === 'corner') {
      ctx.font = '400 70px "Barlow", "Helvetica Neue", sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(label, 28, 24)
    } else {
      ctx.font = '500 32px "Barlow", "Helvetica Neue", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(label, S / 2, 28)
    }
    tex.needsUpdate = true
  }

  render()
  void document.fonts?.ready.then(render)
  return tex
}

/* ---------------- 5. Sidekick Ultra-High-DPI Faceplate Texture ---------------- */

export function createSidekickPlateTexture(): THREE.CanvasTexture {
  // 202 x 552 units * 6 = 1212 x 3312 ultra-crisp faceplate
  const S = 6
  const c = document.createElement('canvas')
  c.width = 202 * S
  c.height = 552 * S
  const ctx = c.getContext('2d')!
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 16

  const render = () => {
    ctx.save()
    ctx.setTransform(S, 0, 0, S, 0, 0)

    // Main anodized grey body matching .sidekick in styles.css
    const bg = ctx.createLinearGradient(0, 0, 0, 552)
    bg.addColorStop(0, '#b9b9b8')
    bg.addColorStop(0.45, '#a9a9a8')
    bg.addColorStop(1, '#9f9f9e')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, 202, 552)

    // Top edge band (y: 0..19) matching .sk-band in styles.css
    ctx.fillStyle = '#dcdcda'
    ctx.fillRect(0, 0, 37, 19)
    ctx.fillStyle = '#ff5a1f'
    ctx.fillRect(37, 0, 73, 19)
    ctx.fillStyle = '#6b6b6b'
    ctx.fillRect(110, 0, 36, 19)
    ctx.fillStyle = '#dcdcda'
    ctx.fillRect(146, 0, 56, 19)

    // Bottom hairline under top band
    ctx.fillStyle = 'rgba(0,0,0,0.14)'
    ctx.fillRect(0, 18.6, 202, 0.5)

    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.font = '500 6.1px "Manrope", "Helvetica Neue", sans-serif'
    ctx.fillStyle = '#4a4a4a'
    ctx.fillText('OUTPUT', 18.5, 9.8)

    ctx.fillStyle = '#fff6ef'
    ctx.fillText('AUX', 55.5, 9.8)
    ctx.font = '600 3.3px "Manrope", "Helvetica Neue", sans-serif'
    ctx.fillText('CH 1', 79.5, 4.4)
    ctx.fillText('CH 2', 96.5, 4.4)
    ctx.font = '500 6.1px "Manrope", "Helvetica Neue", sans-serif'
    ctx.fillText('INPUT', 88, 11.4)

    ctx.fillStyle = '#ececec'
    ctx.fillText('USB', 128, 9.8)

    // Subtle vertical divider seams across the top band + recessed pill well around the power toggle
    ctx.fillStyle = 'rgba(0,0,0,0.16)'
    ctx.fillRect(36.8, 0, 0.5, 19)
    ctx.fillRect(109.8, 0, 0.5, 19)
    ctx.fillRect(145.8, 0, 0.5, 19)

    // Recessed capsule well painted flush into the top-right power band (matching sidekick-top.jpg)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(162.5, 3.6, 23, 11.8, 5.9)
    const wellGrad = ctx.createLinearGradient(0, 3.6, 0, 15.4)
    wellGrad.addColorStop(0, '#5a1e0a')
    wellGrad.addColorStop(0.5, '#a83310')
    wellGrad.addColorStop(1, '#c94316')
    ctx.fillStyle = wellGrad
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.34)'
    ctx.lineWidth = 0.7
    ctx.stroke()
    ctx.restore()

    // Base grey underneath the physically raised 3D lid plate (y: 19..129)
    // plus soft cast shadow seam right beneath y = 129
    const seam = ctx.createLinearGradient(0, 129, 0, 134)
    seam.addColorStop(0, 'rgba(0,0,0,0.22)')
    seam.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = seam
    ctx.fillRect(0, 129, 202, 5)

    // Channel strip & right-column labels (matching .sidekick .print)
    const label = (t: string, x: number, y: number, align: CanvasTextAlign = 'center') => {
      ctx.fillStyle = '#2f2f2f'
      ctx.font = '500 5.1px "Manrope", "Helvetica Neue", sans-serif'
      ctx.textAlign = align
      ctx.textBaseline = 'top'
      ctx.fillText(t, x, y)
    }

    const cols = [19, 74]
    for (let cIdx = 0; cIdx < 2; cIdx++) {
      const cx = cols[cIdx] + 18.5
      label('GAIN', cx, 138.5)
      label('HIGH', cx, 193.5)
      label('MID', cx, 248.5)
      label('LOW', cx, 303.5)

      // Channel number beside fader
      ctx.fillStyle = '#2f2f2f'
      ctx.font = '200 12px "Manrope", "Helvetica Neue", sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(cIdx === 0 ? 'I' : '2', cols[cIdx] + 4, 399)

      // Horizontal dark hairline center tick across fader track (.sk-fader-tick)
      ctx.fillStyle = '#3a3a3a'
      ctx.fillRect(cx - 16.5, 439.7, 33, 0.6)

      // Rounded recessed vertical fader slot (.sk-fader-slot)
      const slotGrad = ctx.createLinearGradient(cx - 2.5, 0, cx + 2.5, 0)
      slotGrad.addColorStop(0, '#0d0d0e')
      slotGrad.addColorStop(0.5, '#28282a')
      slotGrad.addColorStop(1, '#0d0d0e')
      ctx.fillStyle = slotGrad
      ctx.beginPath()
      ctx.roundRect(cx - 2.5, 400, 5, 80, 2.5)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'
      ctx.lineWidth = 0.45
      ctx.stroke()
    }

    const rx = 147 + 18.5
    label('VOLUME', rx, 303.5)
    label('–  MOD  +', rx, 358.5)
    label('PHONES', rx, 431.5)

    // Flush recessed MOD rocker cavity milled into the grey chassis (no black border, matching sidekick-top.jpg)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(147, 367, 37, 18, 1.4)
    const mg = ctx.createLinearGradient(0, 367, 0, 385)
    mg.addColorStop(0, '#5a1605')
    mg.addColorStop(0.32, '#9a2c0c')
    mg.addColorStop(1, '#c54016')
    ctx.fillStyle = mg
    ctx.fill()
    ctx.save()
    ctx.clip()
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.lineWidth = 2.4
    ctx.strokeRect(147.4, 367.4, 37, 18)
    ctx.restore()
    ctx.strokeStyle = 'rgba(255,255,255,0.36)'
    ctx.lineWidth = 0.55
    ctx.beginPath()
    ctx.moveTo(148.4, 385.3)
    ctx.lineTo(183.2, 385.3)
    ctx.lineTo(184.3, 384.2)
    ctx.lineTo(184.3, 368.4)
    ctx.stroke()
    ctx.restore()

    // Crisp white Force-Pad / MOD bracket line (matching .sk-bracket in styles.css)
    ctx.strokeStyle = 'rgba(255,255,255,0.78)'
    ctx.lineWidth = 0.85
    ctx.beginPath()
    ctx.moveTo(147, 275)
    ctx.lineTo(140, 275)
    ctx.lineTo(140, 374)
    ctx.lineTo(147, 374)
    ctx.stroke()

    ctx.restore()
    tex.needsUpdate = true
  }

  render()
  void document.fonts?.ready.then(render)

  return tex
}

/* ---------------- 5b. Sidekick Raised Top Lid Plate Texture ---------------- */

export function createSidekickLidTexture(): THREE.CanvasTexture {
  // 202 x 110 units * 6 = 1212 x 660 crisp vector lid print
  const S = 6
  const c = document.createElement('canvas')
  c.width = 202 * S
  c.height = 110 * S
  const ctx = c.getContext('2d')!
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 16

  let lidImg: HTMLImageElement | null = null

  const render = () => {
    ctx.save()
    ctx.setTransform(S, 0, 0, S, 0, 0)

    const lg = ctx.createLinearGradient(0, 0, 0, 110)
    lg.addColorStop(0, '#eeede9')
    lg.addColorStop(0.6, '#e5e4e0')
    lg.addColorStop(1, '#dcdbd7')
    ctx.fillStyle = lg
    ctx.fillRect(0, 0, 202, 110)

    if (lidImg) {
      ctx.drawImage(lidImg, 0, 0, 202, 110)
    }

    // 4 flush circular corner screw recesses (relative to lid top y = 19)
    for (const [sx, sy] of [[8.5, 10.5], [193.5, 10.5], [8.5, 100.5], [193.5, 100.5]]) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(sx, sy, 4.5, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'
      ctx.lineWidth = 0.55
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(sx + 0.35, sy + 0.45, 4.1, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'
      ctx.lineWidth = 0.8
      ctx.stroke()
      ctx.restore()
    }

    ctx.restore()
    tex.needsUpdate = true
  }

  render()
  void loadImage(sidekickLidUrl).then((img) => {
    lidImg = img
    render()
  })
  return tex
}

/* ---------------- 6. Sidekick Live Orange Pixel OLED Updater ---------------- */

const FX_SHORT: Record<string, string> = {
  filter: 'FILTER',
  delay: 'DELAY',
  tape: 'TAPE',
  loop: 'LOOP',
  tremolo: 'TREMOLO',
  siren: 'SIREN',
}

export function createSidekickOledUpdater() {
  // 72 x 146 logical LCD pixels * 6 = 432 x 876 crisp retina OLED canvas
  const S = 6
  const c = document.createElement('canvas')
  c.width = 72 * S
  c.height = 146 * S
  const ctx = c.getContext('2d')!
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8

  const bar = (x: number, y: number, w: number, h: number, v: number, vertical = true) => {
    const n = vertical ? Math.floor(h / 3) : Math.floor(w / 3)
    const lit = Math.round(Math.max(0, Math.min(1, v)) * n)
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i < lit ? '#ff6a1f' : '#3a1406'
      if (vertical) ctx.fillRect(x, y + h - (i + 1) * 3 + 1, w, 2)
      else ctx.fillRect(x + i * 3, y, 2, h)
    }
  }

  const tag = (x: number, y: number, w: number, text: string, on: boolean) => {
    if (on) {
      ctx.fillStyle = '#ff6a1f'
      ctx.fillRect(x, y, w, 11)
      ctx.fillStyle = '#0a0605'
    } else {
      ctx.strokeStyle = '#ff6a1f'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 10)
      ctx.fillStyle = '#ff6a1f'
    }
    ctx.font = '600 7.5px "Silkscreen", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(text, x + w / 2, y + 8.3)
  }

  const miniTag = (x: number, y: number, w: number, text: string, state: 'off' | 'armed' | 'on') => {
    if (state === 'on') {
      ctx.fillStyle = '#ff6a1f'
      ctx.fillRect(x, y, w, 10)
      ctx.fillStyle = '#0a0605'
    } else {
      ctx.strokeStyle = state === 'armed' ? '#ff6a1f' : '#4c1d09'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 9)
      ctx.fillStyle = state === 'armed' ? '#ff6a1f' : '#8a3a12'
    }
    ctx.font = '600 5.8px "Silkscreen", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(text, x + w / 2, y + 7.2)
  }

  let lastDrawn: MixerState | null = null
  void document.fonts?.ready.then(() => (lastDrawn = null))
  const update = (s: MixerState) => {
    // the screen depends only on the mixer's state: skip redrawing an unchanged one
    if (s === lastDrawn) return
    lastDrawn = s
    ctx.save()
    ctx.setTransform(S, 0, 0, S, 0, 0)
    ctx.fillStyle = '#0a0605'
    ctx.fillRect(0, 0, 72, 146)

    if (!s.power) {
      ctx.restore()
      tex.needsUpdate = true
      return
    }

    const focusCh = s.focus === 'both' ? 0 : s.focus
    const ch = s.ch[s.screenCh]
    const title = (t: string) => {
      ctx.fillStyle = '#ff6a1f'
      ctx.font = '600 8px "Silkscreen", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(t, 36, 12)
    }

    if (s.screen === 'fx') {
      title(`FX ${s.screenCh + 1}`)
      FX_TYPES.forEach((t, i) => {
        const active = t === ch.fx
        if (active) {
          ctx.fillStyle = '#ff6a1f'
          ctx.fillRect(2, 20 + i * 18, 68, 15)
        }
        ctx.fillStyle = active ? '#0a0605' : '#ff6a1f'
        ctx.font = '600 7.8px "Silkscreen", monospace'
        ctx.textAlign = 'center'
        ctx.fillText(FX_SHORT[t], 36, 30.5 + i * 18)
      })
      ctx.fillStyle = '#8a3a12'
      ctx.font = '600 5.6px "Silkscreen", monospace'
      ctx.fillText('CLICK / MOD', 36, 140)
    } else if (s.screen === 'settings') {
      title('SYSTEM')
      const values = [
        s.eqStyle.toUpperCase(),
        s.tempoSource.toUpperCase(),
        s.cueOut ? (s.cueOutputs.find((o) => o.id === s.cueOut)?.label ?? 'DEV').slice(0, 7).toUpperCase() : s.cueOutputs.length ? 'OFF' : 'ALLOW?',
      ]
      SETTINGS.forEach((item, i) => {
        if (i === s.settingsIndex) {
          ctx.strokeStyle = '#ff6a1f'
          ctx.lineWidth = 1
          ctx.strokeRect(2.5, 24.5 + i * 30, 67, 25)
        }
        ctx.fillStyle = '#ff6a1f'
        ctx.font = '600 7.2px "Silkscreen", monospace'
        ctx.textAlign = 'left'
        ctx.fillText(item, 6, 34 + i * 30)
        ctx.font = '600 10px "Silkscreen", monospace'
        ctx.textAlign = 'right'
        ctx.fillText(values[i], 66, 46 + i * 30)
      })
    } else if (s.screen === 'comp') {
      title(`COMP ${s.screenCh + 1}`)
      ctx.fillStyle = '#ff6a1f'
      ctx.font = '600 21px "Silkscreen", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(String(Math.round(ch.comp * 100)), 36, 58)
      bar(6, 70, 60, 8, ch.comp, false)
      ctx.font = '600 10px "Silkscreen", monospace'
      ctx.fillText(ch.compType.toUpperCase(), 36, 104)
    } else if (s.screen === 'channel') {
      const pan = Math.round(ch.pan * 50)
      title(`CH ${s.screenCh + 1}`)
      ctx.fillStyle = '#ff6a1f'
      ctx.font = '600 7.5px "Silkscreen", monospace'
      ctx.textAlign = 'left'
      ctx.fillText('GAIN', 6, 34)
      ctx.fillText('PAN', 6, 78)
      ctx.font = '600 10.5px "Silkscreen", monospace'
      ctx.textAlign = 'right'
      ctx.fillText((ch.gain > 0 ? '+' : '') + ch.gain.toFixed(1), 66, 52)
      ctx.fillText(pan === 0 ? 'C' : pan < 0 ? `L${-pan}` : `R${pan}`, 66, 96)
      ctx.strokeStyle = '#ff6a1f'
      ctx.strokeRect(6.5, 104.5, 59, 5)
      ctx.fillRect(36 + ch.pan * 28 - 2, 104, 4, 6)
    } else if (s.screen === 'tempo') {
      title('TEMPO')
      s.ch.forEach((cState, i) => {
        ctx.fillStyle = '#ff6a1f'
        ctx.font = '600 7.2px "Silkscreen", monospace'
        ctx.textAlign = 'left'
        ctx.fillText(`CH${i + 1} ${cState.tracking ? 'AUTO' : 'TAP'}`, 6, 38 + i * 40)
        ctx.font = '600 10.5px "Silkscreen", monospace'
        ctx.textAlign = 'right'
        ctx.fillText(cState.bpm.toFixed(1), 66, 58 + i * 40)
      })
    } else if (s.screen === 'level') {
      title(`CH ${s.screenCh + 1}`)
      ctx.fillStyle = '#ff6a1f'
      ctx.font = '600 22px "Silkscreen", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(String(Math.round(ch.fader * 100)), 36, 80)
      ctx.font = '600 8px "Silkscreen", monospace'
      ctx.fillText('LEVEL', 36, 100)
    } else {
      tag(3, 3, 31, 'CUE', s.ch[0].cue)
      tag(38, 3, 31, 'CUE', s.ch[1].cue)
      ctx.fillStyle = '#ff6a1f'
      ctx.font = '600 21px "Silkscreen", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(String(Math.round(s.ch[focusCh].bpm)).padStart(3, '0'), 36, 34)
      bar(8, 40, 4, 57, s.ch[0].meter[0])
      bar(14, 40, 4, 57, s.ch[0].meter[1])
      bar(26, 40, 9, 57, s.masterMeter[0])
      bar(37, 40, 9, 57, s.masterMeter[1])
      bar(54, 40, 4, 57, s.ch[1].meter[0])
      bar(60, 40, 4, 57, s.ch[1].meter[1])

      ctx.fillStyle = '#ff6a1f'
      ctx.beginPath()
      const py = 92 - s.pad * 50
      ctx.moveTo(2, py)
      ctx.lineTo(6, py + 3)
      ctx.lineTo(2, py + 6)
      ctx.closePath()
      ctx.fill()

      const fx = s.ch[focusCh].fx
      const held = s.locked || s.seq === 'play'
      ctx.font = '600 10.5px "Silkscreen", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(
        s.focus === 'both' ? `${FX_SHORT[s.ch[0].fx].slice(0, 3)}+${FX_SHORT[s.ch[1].fx].slice(0, 3)}` : FX_SHORT[fx],
        36,
        111,
      )
      miniTag(3, 117, 23, s.seq === 'rec' ? 'REC' : s.seq === 'play' ? 'SEQ' : 'LOCK', held || s.seq === 'rec' ? 'on' : s.lockArmed ? 'armed' : 'off')
      miniTag(28, 117, 16, '1+2', s.focus === 'both' ? 'on' : 'off')
      miniTag(46, 117, 23, 'SER', s.serial ? 'on' : 'off')
      tag(3, 131, 31, 'FX', s.focus === 0 || s.focus === 'both')
      tag(38, 131, 31, 'FX', s.focus === 1 || s.focus === 'both')
    }

    if (s.message) {
      ctx.fillStyle = '#ff6a1f'
      ctx.fillRect(2, 58, 68, 26)
      ctx.fillStyle = '#0a0605'
      ctx.font = '600 8px "Silkscreen", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(s.message, 36, 74)
    }

    ctx.restore()
    tex.needsUpdate = true
  }

  return {
    tex,
    update,
    dispose() {
      tex.dispose()
    },
  }
}
