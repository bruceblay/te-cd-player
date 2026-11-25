import type { Deck } from '../engine/deck'

const SIZE = 64
const HALF = SIZE / 2
const FRAME_MS = 70 // ~14 fps — smooth in Chrome/Firefox without thrashing favicon decoding
const BASE_OMEGA = (Math.PI * 2) / 1.15 // readable, silky clockwise spin at 100% varispeed
const DISC_ORANGE = '#ff5a1f'

/** Draw a crisp 64×64 TE-orange compact disc (with real transparent center hole) at `angle` radians. */
function drawDiscFrame(ctx: CanvasRenderingContext2D, angle: number, spinning: boolean) {
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.save()
  ctx.translate(HALF, HALF)

  const outerR = 30
  const clampR = 11.5
  const holeR = 5.4

  // 1. Clip to disc silhouette
  ctx.beginPath()
  ctx.arc(0, 0, outerR, 0, Math.PI * 2)
  ctx.clip()

  // 2. Signature Teenage Engineering orange disc finish
  ctx.fillStyle = DISC_ORANGE
  ctx.fillRect(-HALF, -HALF, SIZE, SIZE)

  // 3. Rotating glossy reflection wedges + high-contrast white printed arcs so spin reads clearly at 16px
  ctx.save()
  ctx.rotate(angle)

  const wedge = (start: number, span: number, fill: string) => {
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, outerR, start, start + span)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
  }

  wedge(-0.55, 0.72, 'rgba(255,255,255,0.3)')
  wedge(Math.PI - 0.55, 0.72, 'rgba(255,255,255,0.22)')
  wedge(0.55, 0.45, 'rgba(0,0,0,0.12)')
  wedge(Math.PI + 0.55, 0.45, 'rgba(0,0,0,0.1)')

  // Printed white label arcs & balance dot
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineCap = 'round'
  ctx.lineWidth = 3.4
  ctx.beginPath()
  ctx.arc(0, 0, 21.5, -1.35, -0.35)
  ctx.stroke()

  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.arc(0, 0, 16.5, -1.2, -0.55)
  ctx.stroke()

  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.arc(Math.cos(1.65) * 20.5, Math.sin(1.65) * 20.5, 2.4, 0, Math.PI * 2)
  ctx.fill()

  if (spinning) {
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(0, 0, 24.8, 0, Math.PI * 1.15)
    ctx.stroke()
  }

  ctx.restore()

  // 4. Outer rim contrast border
  ctx.beginPath()
  ctx.arc(0, 0, outerR - 0.9, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'
  ctx.lineWidth = 1.8
  ctx.stroke()

  // 5. Center dark clamping hub ring
  ctx.beginPath()
  ctx.arc(0, 0, clampR, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(24,25,28,0.86)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(0, 0, clampR - 1.2, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.42)'
  ctx.lineWidth = 1.4
  ctx.stroke()

  // 6. Punch real transparent center spindle hole
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(0, 0, holeR, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

/**
 * Animates the browser tab favicon as a spinning TE-orange CD whenever any deck is playing,
 * tracking live varispeed with smooth motor spin-up and coast-down.
 */
export function bindSpinningFavicon(decks: readonly Deck[]): () => void {
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}

  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = 'image/png'

  let angle = 0
  let omega = 0
  let timer = 0
  let lastTick = 0

  const activeInfo = () => {
    for (const d of decks) {
      const s = d.getState()
      if (s.power === 'on' && s.transport === 'playing' && s.disc) {
        return { playing: true, vari: s.vari }
      }
    }
    return { playing: false, vari: 100 }
  }

  const paint = (spinning: boolean) => {
    drawDiscFrame(ctx, angle, spinning)
    link!.href = canvas.toDataURL('image/png')
  }

  const stopTimer = () => {
    if (timer) {
      window.clearInterval(timer)
      timer = 0
    }
  }

  const step = () => {
    const now = performance.now()
    const dt = lastTick ? Math.min(0.2, (now - lastTick) / 1000) : FRAME_MS / 1000
    lastTick = now

    const { playing, vari } = activeInfo()
    const targetOmega = playing && !reduced ? BASE_OMEGA * (vari / 100) : 0
    const accel = playing ? 7.5 : 4.5
    omega += (targetOmega - omega) * Math.min(1, dt * accel)

    if (Math.abs(omega) > 0.04) {
      angle = (angle + omega * dt) % (Math.PI * 2)
      paint(true)
    } else {
      omega = 0
      paint(false)
      stopTimer()
    }
  }

  const sync = () => {
    const { playing } = activeInfo()
    if (playing && !reduced && !timer) {
      lastTick = performance.now()
      step()
      timer = window.setInterval(step, FRAME_MS)
    }
  }

  const unsubs = decks.map((d) => d.subscribe(sync))
  paint(false)
  sync()

  return () => {
    stopTimer()
    unsubs.forEach((u) => u())
  }
}
