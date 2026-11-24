import type { DeckState } from '../engine/deck'

type Disc = NonNullable<DeckState['disc']>

const LIGHT_DISC = new Set(['#c9cbd0', '#ece6d6'])

/**
 * The printed face of a burned disc on a canvas: solid colour with its title and
 * track list in small capitals (the 2D view draws the same layout as SVG). With
 * `hub`, the clear polycarbonate hub and its stacking ring are drawn too.
 */
export function drawDiscPrint(disc: Disc, S: number, hub: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  const cx = S / 2
  const cy = S / 2
  const R = S / 2

  if (hub) {
    // Clear polycarbonate inner hub (real 15 mm CD hole = 12.4% of radius..29.6%)
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.296, 0, Math.PI * 2)
    ctx.arc(cx, cy, R * 0.124, 0, Math.PI * 2, true)
    ctx.fillStyle = 'rgba(220, 224, 232, 0.32)'
    ctx.fill('evenodd')
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.21, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = (3.5 * S) / 1024
    ctx.stroke()
    ctx.restore()
  }

  const color = disc.color ?? '#22468c'
  const ink = LIGHT_DISC.has(color) ? '#1c1c1e' : '#f8f8f6'
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.996, 0, Math.PI * 2)
  ctx.arc(cx, cy, R * 0.296, 0, Math.PI * 2, true)
  ctx.fillStyle = color
  ctx.fill('evenodd')

  const u = S / 100
  const tracks = disc.tracks
  const slots = [22.2, 25.8, 29.4, 33, 69.4, 73, 76.6, 80.2, 83.8]
  const fits = tracks.length <= slots.length ? tracks.length : slots.length - 1
  const w = Math.max(2, String(tracks.length).length)
  const titleX = (w > 2 ? 26 : 24) * u
  const clip = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t)
  const time = (d: number) => (d > 0 ? `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}` : '')

  ctx.fillStyle = ink
  ctx.font = `600 ${3.4 * u}px "Manrope", "Helvetica Neue", sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText(clip(disc.title.toUpperCase(), 23), 19 * u, 17.8 * u)

  ctx.font = `600 ${2.75 * u}px "Manrope", "Helvetica Neue", sans-serif`
  for (let i = 0; i < fits; i++) {
    const t = tracks[i]
    const y = slots[i] * u
    const dur = time(t.duration)
    ctx.textAlign = 'left'
    ctx.fillText(String(i + 1).padStart(w, '0'), 19 * u, y)
    ctx.fillText(clip(t.title.toUpperCase(), dur ? 22 : 26), titleX, y)
    if (dur) {
      ctx.textAlign = 'right'
      ctx.fillText(dur, 81 * u, y)
    }
  }
  if (tracks.length > fits) {
    ctx.textAlign = 'left'
    ctx.fillText(`+ ${tracks.length - fits} MORE`, 19 * u, slots[slots.length - 1] * u)
  }
  ctx.restore()
  return c
}

/**
 * Smear a disc image around its centre, the way a spinning disc's print blurs
 * into arcs: each pixel averages the source along its own circle over `deg`
 * degrees. Alpha-weighted so the clear hub and the rim stay clean.
 */
export function spinBlur(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const S = src.width
  const from = src.getContext('2d')!.getImageData(0, 0, S, S).data
  const out = document.createElement('canvas')
  out.width = S
  out.height = S
  const octx = out.getContext('2d')!
  const img = octx.createImageData(S, S)
  const to = img.data
  const c = (S - 1) / 2
  const span = (deg * Math.PI) / 180
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - c
      const dy = y - c
      const r = Math.hypot(dx, dy)
      if (r > c + 1) continue
      const a0 = Math.atan2(dy, dx) - span / 2
      // about one sample per pixel of arc, so small radii stay cheap
      const n = Math.max(1, Math.min(64, Math.ceil(r * span)))
      let sr = 0
      let sg = 0
      let sb = 0
      let sa = 0
      for (let k = 0; k < n; k++) {
        const a = a0 + (span * (k + 0.5)) / n
        const sx = Math.round(c + r * Math.cos(a))
        const sy = Math.round(c + r * Math.sin(a))
        if (sx < 0 || sy < 0 || sx >= S || sy >= S) continue
        const i = (sy * S + sx) * 4
        const al = from[i + 3]
        sr += from[i] * al
        sg += from[i + 1] * al
        sb += from[i + 2] * al
        sa += al
      }
      const o = (y * S + x) * 4
      if (sa > 0) {
        to[o] = sr / sa
        to[o + 1] = sg / sa
        to[o + 2] = sb / sa
        to[o + 3] = sa / n
      }
    }
  }
  octx.putImageData(img, 0, 0)
  return out
}

/** how far the print smears while spinning, in degrees */
export const SPIN_BLUR_DEG = 32
