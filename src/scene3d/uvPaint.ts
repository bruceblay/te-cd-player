import * as THREE from 'three'

/*
 * Ultraviolet-reactive paint for the studio walls: designs that are invisible
 * under the room lights and glow under the black light. Each surface is a
 * transparent canvas drawn once, with neon strokes over a wide soft glow.
 */

const NEON = ['#ff2bd6', '#39ff14', '#00e5ff', '#f6ff00', '#ff7a00', '#b14bff']

type Hole = { x: number; y: number; w: number; h: number } // canvas pixels, left unpainted

function seeded(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/** stroke a path twice: a wide soft glow, then the bright paint line */
function glowStroke(g: CanvasRenderingContext2D, color: string, width: number, path: () => void) {
  g.save()
  g.strokeStyle = color
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.shadowColor = color
  g.shadowBlur = width * 3.5
  g.globalAlpha = 0.55
  g.lineWidth = width * 2.2
  g.beginPath()
  path()
  g.stroke()
  g.globalAlpha = 1
  g.shadowBlur = width * 1.2
  g.lineWidth = width
  g.beginPath()
  path()
  g.stroke()
  g.restore()
}

function dots(g: CanvasRenderingContext2D, rnd: () => number, W: number, H: number, n: number) {
  for (let i = 0; i < n; i++) {
    const c = NEON[Math.floor(rnd() * NEON.length)]
    const r = 1.5 + rnd() * 4
    const x = rnd() * W
    const y = rnd() * H
    g.save()
    g.fillStyle = c
    g.shadowColor = c
    g.shadowBlur = 14
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
}

function spiral(g: CanvasRenderingContext2D, cx: number, cy: number, turns: number, maxR: number, color: string, width: number) {
  glowStroke(g, color, width, () => {
    for (let a = 0; a <= turns * Math.PI * 2; a += 0.08) {
      const r = (a / (turns * Math.PI * 2)) * maxR
      const x = cx + Math.cos(a) * r
      const y = cy + Math.sin(a) * r
      if (a === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
  })
}

function wave(g: CanvasRenderingContext2D, y0: number, W: number, amp: number, freq: number, phase: number, color: string, width: number) {
  glowStroke(g, color, width, () => {
    for (let x = -20; x <= W + 20; x += 8) {
      const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 2.3 + phase * 1.7) * amp * 0.35
      if (x === -20) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
  })
}

function mushroom(g: CanvasRenderingContext2D, cx: number, base: number, s: number, cap: string, stem: string) {
  glowStroke(g, stem, 4, () => {
    g.moveTo(cx - s * 0.18, base)
    g.quadraticCurveTo(cx - s * 0.24, base - s * 0.5, cx - s * 0.14, base - s * 0.8)
    g.moveTo(cx + s * 0.18, base)
    g.quadraticCurveTo(cx + s * 0.24, base - s * 0.5, cx + s * 0.14, base - s * 0.8)
  })
  glowStroke(g, cap, 5, () => {
    g.moveTo(cx - s * 0.62, base - s * 0.78)
    g.quadraticCurveTo(cx, base - s * 1.55, cx + s * 0.62, base - s * 0.78)
    g.closePath()
  })
  for (const [dx, dy, r] of [[-0.25, -1.0, 0.08], [0.15, -1.12, 0.07], [0.35, -0.9, 0.05]]) {
    glowStroke(g, stem, 3, () => g.arc(cx + dx * s, base + dy * s, r * s, 0, Math.PI * 2))
  }
}

function sunburst(g: CanvasRenderingContext2D, cx: number, cy: number, r0: number, r1: number, rays: number, rnd: () => number) {
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2
    const c = NEON[i % NEON.length]
    const wob = 0.06 * (rnd() - 0.5)
    glowStroke(g, c, 4, () => {
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
      g.lineTo(cx + Math.cos(a + wob) * r1, cy + Math.sin(a + wob) * r1)
    })
  }
}

function canvasFor(wCm: number, hCm: number): [HTMLCanvasElement, CanvasRenderingContext2D, number] {
  const scale = 1024 / Math.max(wCm, hCm)
  const c = document.createElement('canvas')
  c.width = Math.round(wCm * scale)
  c.height = Math.round(hCm * scale)
  return [c, c.getContext('2d')!, scale]
}

function clearHoles(g: CanvasRenderingContext2D, holes: Hole[]) {
  for (const h of holes) g.clearRect(h.x, h.y, h.w, h.h)
}

export type UvSurface = 'back' | 'left' | 'right' | 'front' | 'ceiling'

/**
 * Draw the UV paint for one surface. Sizes are in cm; holes (cm, from the
 * surface's top-left as seen from inside the room) stay unpainted.
 */
export function uvPaintTexture(surface: UvSurface, wCm: number, hCm: number, holesCm: Hole[] = []): THREE.CanvasTexture {
  const [c, g, k] = canvasFor(wCm, hCm)
  const W = c.width
  const H = c.height
  const rnd = seeded({ back: 11, left: 23, right: 37, front: 41, ceiling: 53 }[surface])

  if (surface === 'back') {
    for (let i = 0; i < 7; i++) wave(g, H * (0.18 + i * 0.1), W, 18 + i * 4, 0.012 + i * 0.002, i * 1.3, NEON[i % NEON.length], 5)
    spiral(g, W * 0.82, H * 0.2, 4, H * 0.14, '#ff2bd6', 4)
    spiral(g, W * 0.12, H * 0.78, 3.5, H * 0.12, '#00e5ff', 4)
    dots(g, rnd, W, H, 70)
  } else if (surface === 'left') {
    for (let i = 0; i < 5; i++) {
      const y = H * (0.12 + i * 0.08)
      glowStroke(g, NEON[(i + 2) % NEON.length], 5, () => {
        for (let x = 0, up = true; x <= W + 40; x += 40, up = !up) {
          if (x === 0) g.moveTo(x, y)
          else g.lineTo(x, y + (up ? -22 : 22))
        }
      })
    }
    dots(g, rnd, W, H, 50)
  } else if (surface === 'right') {
    mushroom(g, W * 0.22, H * 0.92, 150, '#ff2bd6', '#39ff14')
    mushroom(g, W * 0.42, H * 0.94, 95, '#f6ff00', '#00e5ff')
    mushroom(g, W * 0.85, H * 0.93, 120, '#b14bff', '#ff7a00')
    spiral(g, W * 0.6, H * 0.22, 5, H * 0.16, '#39ff14', 4)
    for (let i = 0; i < 4; i++) wave(g, H * (0.45 + i * 0.05), W, 10, 0.03, i * 2, NEON[(i + 1) % NEON.length], 3.5)
    dots(g, rnd, W, H, 60)
  } else if (surface === 'front') {
    // rays round the door, so the way out is the brightest thing in the room
    const door = holesCm[0]
    const cx = door ? (door.x + door.w / 2) * k : W / 2
    const cy = door ? (door.y + door.h * 0.45) * k : H / 2
    sunburst(g, cx, cy, door ? Math.max(door.w, door.h) * k * 0.62 : 120, Math.max(W, H) * 0.62, 36, rnd)
    dots(g, rnd, W, H, 60)
  } else {
    // ceiling: stars and constellation lines
    const stars: [number, number][] = []
    for (let i = 0; i < 26; i++) stars.push([rnd() * W, rnd() * H])
    for (let i = 0; i < stars.length - 1; i += 2) {
      const [a, b] = [stars[i], stars[i + 1]]
      glowStroke(g, '#00e5ff', 2, () => {
        g.moveTo(a[0], a[1])
        g.lineTo(b[0], b[1])
      })
    }
    dots(g, rnd, W, H, 160)
    spiral(g, W * 0.5, H * 0.5, 6, Math.min(W, H) * 0.3, '#b14bff', 3)
  }

  clearHoles(g, holesCm.map((h) => ({ x: h.x * k, y: h.y * k, w: h.w * k, h: h.h * k })))
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** A paint layer: invisible until its opacity is raised; adds light, ignores fog and tone mapping. */
export function uvPaintMaterial(map: THREE.Texture) {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
}
