import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export interface StudioRoomRig {
  group: THREE.Group
  dispose: () => void
}

function createTracker() {
  const geos: THREE.BufferGeometry[] = []
  const mats: THREE.Material[] = []
  const texs: THREE.Texture[] = []
  return {
    geo<T extends THREE.BufferGeometry>(g: T): T {
      geos.push(g)
      return g
    },
    mat<T extends THREE.Material>(m: T): T {
      mats.push(m)
      return m
    },
    tex<T extends THREE.Texture>(t: T): T {
      texs.push(t)
      return t
    },
    dispose() {
      geos.forEach((g) => g.dispose())
      mats.forEach((m) => m.dispose())
      texs.forEach((t) => t.dispose())
    },
  }
}

/* ============================================================
   PROCEDURAL STUDIO TEXTURES (plaster, floorboards, sky, art)
   ============================================================ */

function makePlasterWallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 512
  const ctx = c.getContext('2d')!

  // Warm muted gallery limewash plaster (calm warm taupe-sand so gear pops cleanly)
  const g = ctx.createLinearGradient(0, 0, 512, 512)
  g.addColorStop(0, '#c8bfb2')
  g.addColorStop(0.5, '#b6ac9e')
  g.addColorStop(1, '#9d9386')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 512, 512)

  // Soft limewash brush clouds
  let seed = 73819
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let i = 0; i < 160; i++) {
    const x = rand() * 512
    const y = rand() * 512
    const r = 28 + rand() * 88
    const rad = ctx.createRadialGradient(x, y, 2, x, y, r)
    const light = rand() > 0.48
    rad.addColorStop(0, light ? 'rgba(244, 236, 224, 0.055)' : 'rgba(66, 56, 46, 0.055)')
    rad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = rad
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  // Fine mineral grain
  for (let i = 0; i < 4000; i++) {
    const x = rand() * 512
    const y = rand() * 512
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,250,242,0.04)' : 'rgba(42,35,28,0.045)'
    ctx.fillRect(x, y, 1.5, 1.5)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}

function makeFloorPlankTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 512
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#5f4b39'
  ctx.fillRect(0, 0, 512, 512)

  let seed = 19453
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }

  const planks = 8
  const ph = 512 / planks
  for (let p = 0; p < planks; p++) {
    const y0 = p * ph
    const tone = (rand() - 0.5) * 18
    ctx.fillStyle = `rgb(${Math.round(104 + tone)}, ${Math.round(83 + tone * 0.8)}, ${Math.round(64 + tone * 0.6)})`
    ctx.fillRect(0, y0, 512, ph - 1.5)

    // Subtle wood grain streaks
    for (let s = 0; s < 22; s++) {
      const sy = y0 + rand() * (ph - 3)
      ctx.fillStyle = rand() > 0.5 ? 'rgba(255,235,210,0.04)' : 'rgba(28,18,10,0.07)'
      ctx.fillRect(0, sy, 512, 1 + rand() * 1.8)
    }
    // Plank seam
    ctx.fillStyle = 'rgba(22,15,9,0.52)'
    ctx.fillRect(0, y0 + ph - 1.5, 512, 1.5)
    // Staggered cross butt joint
    const jx = ((p * 173 + 90) % 440) + 36
    ctx.fillRect(jx, y0, 1.5, ph)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(4, 4)
  tex.anisotropy = 8
  return tex
}

function makeWindowSkyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 512
  const ctx = c.getContext('2d')!

  // Soft warm late-afternoon golden-hour studio daylight sky
  const sky = ctx.createLinearGradient(0, 0, 0, 512)
  sky.addColorStop(0, '#c8d6e2')
  sky.addColorStop(0.45, '#e8dfd2')
  sky.addColorStop(0.82, '#f5e2c6')
  sky.addColorStop(1, '#e6ceb0')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, 512, 512)

  // Soft sunlit glow from upper-left
  const sun = ctx.createRadialGradient(135, 165, 18, 135, 165, 290)
  sun.addColorStop(0, 'rgba(255, 250, 238, 0.85)')
  sun.addColorStop(0.45, 'rgba(255, 241, 214, 0.35)')
  sun.addColorStop(1, 'rgba(255, 241, 214, 0)')
  ctx.fillStyle = sun
  ctx.fillRect(0, 0, 512, 512)

  // Soft out-of-focus sunlit outdoor tree foliage bokeh along lower-left & right edges
  const clusters: [number, number, number, string][] = [
    [60, 445, 95, 'rgba(84, 102, 74, 0.42)'],
    [140, 470, 82, 'rgba(98, 114, 82, 0.36)'],
    [420, 435, 110, 'rgba(76, 94, 68, 0.38)'],
    [340, 480, 90, 'rgba(92, 108, 78, 0.32)'],
    [475, 290, 95, 'rgba(88, 106, 76, 0.28)'],
    [40, 320, 72, 'rgba(104, 120, 88, 0.25)'],
  ]
  for (const [x, y, r, col] of clusters) {
    const fg = ctx.createRadialGradient(x, y, r * 0.15, x, y, r)
    fg.addColorStop(0, col)
    fg.addColorStop(1, 'rgba(84, 102, 74, 0)')
    ctx.fillStyle = fg
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Crisp Bauhaus / Dieter Rams / Teenage Engineering minimalist exhibition poster texture. */
function makePosterTexture(variant: 'circle' | 'wave'): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 640
  const ctx = c.getContext('2d')!

  // Warm archival cotton paper mat
  ctx.fillStyle = '#ece6db'
  ctx.fillRect(0, 0, 512, 640)

  // Inner print area
  ctx.fillStyle = '#e5ded0'
  ctx.fillRect(42, 42, 428, 556)

  if (variant === 'circle') {
    // Minimalist Swiss modernist geometry (TE orange sun + deep charcoal vinyl arc + crisp grid lines)
    ctx.fillStyle = '#d95428'
    ctx.beginPath()
    ctx.arc(256, 258, 122, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#252422'
    ctx.beginPath()
    ctx.arc(256, 368, 86, Math.PI, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = 'rgba(37, 36, 34, 0.28)'
    ctx.lineWidth = 2
    for (let y = 110; y <= 520; y += 46) {
      ctx.beginPath()
      ctx.moveTo(64, y)
      ctx.lineTo(448, y)
      ctx.stroke()
    }

    ctx.fillStyle = '#262523'
    ctx.font = '600 22px "Helvetica Neue", Helvetica, Arial, sans-serif'
    ctx.fillText('TONE STUDY 01', 64, 548)
    ctx.font = '400 15px "Helvetica Neue", Helvetica, Arial, sans-serif'
    ctx.fillStyle = '#6b655c'
    ctx.fillText('STOCKHOLM · 44.1 KHZ', 64, 574)
  } else {
    // Minimalist Braun / oscilloscope harmonic waveform print
    ctx.fillStyle = '#242321'
    ctx.fillRect(62, 68, 388, 360)

    ctx.strokeStyle = '#ece6db'
    ctx.lineWidth = 3
    for (let row = 0; row < 7; row++) {
      const cy = 118 + row * 44
      ctx.beginPath()
      for (let x = 86; x <= 426; x += 4) {
        const t = (x - 86) / 340
        const env = Math.sin(t * Math.PI)
        const y = cy + Math.sin(t * Math.PI * (2 + row * 0.65) + row) * 14 * env
        if (x === 86) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    ctx.fillStyle = '#ff5a1f'
    ctx.beginPath()
    ctx.arc(410, 488, 22, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#262523'
    ctx.font = '600 21px "Helvetica Neue", Helvetica, Arial, sans-serif'
    ctx.fillText('ANALOGUE FIELD', 64, 494)
    ctx.font = '400 15px "Helvetica Neue", Helvetica, Arial, sans-serif'
    ctx.fillStyle = '#6b655c'
    ctx.fillText('SIDE A / SIDE B', 64, 520)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/* ============================================================
   1. FLOOR PLANT (Sculpted Fiddle-Leaf / Rubber Fig in Planter)
   ============================================================ */

function makeBroadLeafGeometry(): THREE.BufferGeometry {
  const segL = 10
  const segW = 6
  const positions: number[] = []
  const indices: number[] = []

  for (let il = 0; il <= segL; il++) {
    const t = il / segL
    const halfW = Math.sin(Math.pow(t, 0.68) * Math.PI) * 3.8 * (0.85 + 0.25 * Math.sin(t * Math.PI))
    const droop = -Math.pow(t, 2.1) * 2.4 + Math.sin(t * Math.PI) * 0.9
    const z = t * 11.5
    for (let iw = 0; iw <= segW; iw++) {
      const s = (iw / segW) * 2 - 1
      const x = s * halfW
      // Slight central midrib V-cup
      const cup = Math.abs(s) * 0.65 * Math.sin(t * Math.PI)
      positions.push(x, droop + cup, z)
    }
  }
  const row = segW + 1
  for (let il = 0; il < segL; il++) {
    for (let iw = 0; iw < segW; iw++) {
      const a = il * row + iw
      const b = a + 1
      const c = a + row
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

function buildFloorPlant(t: ReturnType<typeof createTracker>): THREE.Group {
  const g = new THREE.Group()

  // Mid-century wooden 4-legged plant stand raising the planter into sunlit window view
  const woodMat = t.mat(new THREE.MeshStandardMaterial({ color: 0x6b513a, roughness: 0.72 }))
  const legGeo = t.geo(new THREE.CylinderGeometry(0.65, 0.48, 36, 12))
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    const leg = new THREE.Mesh(legGeo, woodMat)
    leg.position.set(Math.cos(a) * 9.5, 18, Math.sin(a) * 9.5)
    g.add(leg)
  }
  const crossGeo = t.geo(new THREE.BoxGeometry(19.5, 1.2, 1.2))
  const c1 = new THREE.Mesh(crossGeo, woodMat)
  c1.position.y = 22
  g.add(c1)
  const c2 = new THREE.Mesh(crossGeo, woodMat)
  c2.position.y = 22
  c2.rotation.y = Math.PI / 2
  g.add(c2)

  // Matte off-white sculptural ceramic cylinder planter
  const potMat = t.mat(new THREE.MeshStandardMaterial({ color: 0xddd6c9, roughness: 0.8, metalness: 0.0 }))
  const pot = new THREE.Mesh(t.geo(new THREE.CylinderGeometry(10.2, 9.4, 21, 32)), potMat)
  pot.position.y = 33
  pot.castShadow = true
  pot.receiveShadow = true
  g.add(pot)

  const soil = new THREE.Mesh(
    t.geo(new THREE.CircleGeometry(9.6, 24)).rotateX(-Math.PI / 2),
    t.mat(new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.96 })),
  )
  soil.position.y = 43.2
  g.add(soil)

  // Branching woody stems + lush dark-emerald broad leaves rising into view beside the window
  const stemMat = t.mat(new THREE.MeshStandardMaterial({ color: 0x4b3c2d, roughness: 0.85 }))
  const leafGeo = t.geo(makeBroadLeafGeometry())
  const leafMatA = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0x3b593c,
      roughness: 0.44,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
  )
  const leafMatB = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0x4d7049,
      roughness: 0.46,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
  )

  const stems: { x: number; z: number; h: number; tiltX: number; tiltZ: number }[] = [
    { x: 0, z: 0, h: 52, tiltX: 0.05, tiltZ: 0.08 },
    { x: -2.5, z: 1.5, h: 42, tiltX: 0.14, tiltZ: 0.16 },
    { x: 2.8, z: -1.2, h: 46, tiltX: -0.08, tiltZ: -0.14 },
  ]

  stems.forEach((st, si) => {
    const sg = new THREE.Group()
    sg.position.set(st.x, 42.5, st.z)
    sg.rotation.set(st.tiltX, 0, st.tiltZ)

    const trunk = new THREE.Mesh(t.geo(new THREE.CylinderGeometry(0.45, 0.85, st.h, 10)), stemMat)
    trunk.position.y = st.h * 0.5
    sg.add(trunk)

    const leafCount = 9
    for (let i = 0; i < leafCount; i++) {
      const f = i / (leafCount - 1)
      const y = st.h * (0.38 + f * 0.62)
      const angle = i * 2.39996 + si * 2.1
      const scale = 0.82 + (1 - Math.abs(f - 0.55)) * 0.48

      const leaf = new THREE.Mesh(leafGeo, i % 2 === 0 ? leafMatA : leafMatB)
      leaf.position.set(0, y, 0)
      leaf.rotation.order = 'YXZ'
      leaf.rotation.y = angle
      leaf.rotation.x = -0.35 - f * 0.35
      leaf.scale.setScalar(scale)
      leaf.castShadow = true
      sg.add(leaf)
    }
    g.add(sg)
  })

  return g
}

/* ============================================================
   3. MID-CENTURY WALNUT BOOKSHELF + VINYL RECORDS + SHELF PLANT
   ============================================================ */

function buildBookshelf(t: ReturnType<typeof createTracker>): THREE.Group {
  const g = new THREE.Group()

  const shelfW = 54
  const shelfD = 18
  const shelfH = 114 // from floor y=0 up to y=114 (world y=-70..+44)
  const thick = 1.6

  const walnutMat = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0x5d4633,
      roughness: 0.72,
      metalness: 0.02,
      envMapIntensity: 0.25,
    }),
  )
  const backMat = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0x3b2d22,
      roughness: 0.88,
    }),
  )

  // Side uprights
  const sideGeo = t.geo(new THREE.BoxGeometry(thick, shelfH, shelfD))
  for (const sx of [-shelfW * 0.5 + thick * 0.5, shelfW * 0.5 - thick * 0.5]) {
    const upright = new THREE.Mesh(sideGeo, walnutMat)
    upright.position.set(sx, shelfH * 0.5, 0)
    upright.castShadow = true
    upright.receiveShadow = true
    g.add(upright)
  }

  // Thin walnut back panel
  const back = new THREE.Mesh(t.geo(new THREE.BoxGeometry(shelfW - 1, shelfH - 2, 0.7)), backMat)
  back.position.set(0, shelfH * 0.5, -shelfD * 0.5 + 0.4)
  g.add(back)

  // 5 horizontal shelves (in world Y: -66, -34, -2, +19, +43)
  const shelfYs = [4, 36, 68, 89, 113]
  const boardGeo = t.geo(new THREE.BoxGeometry(shelfW - thick * 2, thick, shelfD))
  for (const sy of shelfYs) {
    const board = new THREE.Mesh(boardGeo, walnutMat)
    board.position.set(0, sy, 0)
    board.castShadow = true
    board.receiveShadow = true
    g.add(board)
  }

  // Muted archival palette for vinyl LP spines & design books
  const palette = [
    0xd8d1c4, 0xc85c38, 0x2f4b6e, 0x586b52, 0xc99c4e,
    0x333230, 0xb8a38c, 0x7d4239, 0x4b5c69, 0xe2dbce,
  ]
  const spineMats = palette.map((hex) =>
    t.mat(new THREE.MeshStandardMaterial({ color: hex, roughness: 0.78, metalness: 0.02 })),
  )

  let seed = 88421
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }

  // Shelf y=68 (world y=-2, right at desk-horizon height!): Row of 12" vinyl LPs (~31.5 units tall? Scaled cleanly to 18.5 tall)
  const lpGeo = t.geo(new THREE.BoxGeometry(0.62, 17.8, 15.6))
  let lx = -shelfW * 0.5 + 3.2
  for (let i = 0; i < 28; i++) {
    const lp = new THREE.Mesh(lpGeo, spineMats[Math.floor(rand() * spineMats.length)])
    const lean = i > 24 ? (i - 24) * 0.06 : (rand() - 0.5) * 0.03
    lp.position.set(lx, 68 + thick * 0.5 + 8.9, -0.3 + (rand() - 0.5) * 0.6)
    lp.rotation.z = -lean
    g.add(lp)
    lx += 0.76 + rand() * 0.14
  }
  // Vertical walnut LP divider
  const div = new THREE.Mesh(t.geo(new THREE.BoxGeometry(1.1, 19.2, shelfD - 1.5)), walnutMat)
  div.position.set(2, 68 + 10.4, 0)
  g.add(div)

  // Right side of y=68 shelf: horizontal stack of coffee-table art/synth books + matte terracotta vessel
  const stackBooks = [
    { w: 12.5, h: 1.8, d: 10.2, c: 0 },
    { w: 11.4, h: 1.5, d: 9.6, c: 5 },
    { w: 10.2, h: 1.3, d: 8.8, c: 1 },
  ]
  let stackY = 68 + thick * 0.5
  stackBooks.forEach((bk, bi) => {
    const m = new THREE.Mesh(t.geo(new THREE.BoxGeometry(bk.w, bk.h, bk.d)), spineMats[bk.c])
    m.position.set(14.5, stackY + bk.h * 0.5, 0.5)
    m.rotation.y = (bi - 1) * 0.08
    g.add(m)
    stackY += bk.h
  })

  // Shelf y=89 (world y=+19, clearly visible in `low` view!): Standing design books + ceramic vase + trailing shelf plant!
  let bx = -shelfW * 0.5 + 3.6
  for (let i = 0; i < 14; i++) {
    const bw = 1.2 + rand() * 1.1
    const bh = 12.5 + rand() * 4.8
    const bd = 10.5 + rand() * 2.5
    const book = new THREE.Mesh(t.geo(new THREE.BoxGeometry(bw, bh, bd)), spineMats[Math.floor(rand() * spineMats.length)])
    book.position.set(bx + bw * 0.5, 89 + thick * 0.5 + bh * 0.5, -1.2 + rand() * 1.2)
    g.add(book)
    bx += bw + 0.16
  }

  // Sculptural ceramic studio vase at center-right of y=89 shelf
  const vaseProfile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(2.6, 0),
    new THREE.Vector2(3.8, 3.6),
    new THREE.Vector2(3.1, 8.2),
    new THREE.Vector2(1.9, 10.8),
    new THREE.Vector2(2.15, 11.4),
  ]
  const vase = new THREE.Mesh(
    t.geo(new THREE.LatheGeometry(vaseProfile, 24)),
    t.mat(new THREE.MeshStandardMaterial({ color: 0xe3dbd0, roughness: 0.78 })),
  )
  vase.position.set(8.5, 89 + thick * 0.5, 0.5)
  g.add(vase)

  // Small terracotta pot with lush trailing pothos leaves spilling gracefully over shelf edge
  const miniPot = new THREE.Mesh(
    t.geo(new THREE.CylinderGeometry(3.4, 2.7, 5.4, 20)),
    t.mat(new THREE.MeshStandardMaterial({ color: 0xb86f4c, roughness: 0.86 })),
  )
  miniPot.position.set(18.5, 89 + thick * 0.5 + 2.7, 1.5)
  g.add(miniPot)

  const leafMat = t.mat(new THREE.MeshStandardMaterial({ color: 0x456b43, roughness: 0.48, side: THREE.DoubleSide }))
  const miniLeafGeo = t.geo(makeBroadLeafGeometry())
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    const trail = i < 6 ? i * 1.9 : 0
    const lf = new THREE.Mesh(miniLeafGeo, leafMat)
    lf.position.set(
      18.5 + Math.cos(a) * (1.8 + (i < 6 ? 1.4 : 0)),
      89 + thick * 0.5 + 5.6 - trail * 1.15,
      1.5 + Math.sin(a) * 1.8 + (i < 6 ? 2.6 + trail * 0.32 : 0),
    )
    lf.rotation.order = 'YXZ'
    lf.rotation.set(i < 6 ? 0.65 : 0.18, i < 6 ? (rand() - 0.5) * 0.9 : a, (rand() - 0.5) * 0.35)
    lf.scale.setScalar(0.24 + rand() * 0.08)
    g.add(lf)
  }

  return g
}

/* ============================================================
   4. FULL WARM MID-CENTURY MUSIC STUDIO ROOM BUILDER
   ============================================================ */

export function buildStudioRoom(): StudioRoomRig {
  const t = createTracker()
  const group = new THREE.Group()
  group.name = 'studio-room-env'

  const FLOOR_Y = -70
  const CEIL_Y = 128
  const BACK_Z = -56
  const FRONT_Z = 150
  const SIDE_X = 132
  const WALL_H = CEIL_Y - FLOOR_Y
  const ROOM_W = SIDE_X * 2
  const ROOM_D = FRONT_Z - BACK_Z

  // 1. Warm limewash gallery plaster walls
  const plasterTex = t.tex(makePlasterWallTexture())
  const wallMat = t.mat(
    new THREE.MeshStandardMaterial({
      map: plasterTex,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.14,
    }),
  )
  const backWall = new THREE.Mesh(t.geo(new THREE.PlaneGeometry(ROOM_W, WALL_H)), wallMat)
  backWall.position.set(0, (FLOOR_Y + CEIL_Y) * 0.5, BACK_Z)
  backWall.receiveShadow = true
  group.add(backWall)

  const leftWall = new THREE.Mesh(t.geo(new THREE.PlaneGeometry(ROOM_D, WALL_H)), wallMat)
  leftWall.rotation.y = Math.PI / 2
  leftWall.position.set(-SIDE_X, (FLOOR_Y + CEIL_Y) * 0.5, (BACK_Z + FRONT_Z) * 0.5)
  group.add(leftWall)

  const rightWall = new THREE.Mesh(t.geo(new THREE.PlaneGeometry(ROOM_D, WALL_H)), wallMat)
  rightWall.rotation.y = -Math.PI / 2
  rightWall.position.set(SIDE_X, (FLOOR_Y + CEIL_Y) * 0.5, (BACK_Z + FRONT_Z) * 0.5)
  group.add(rightWall)

  const frontWall = new THREE.Mesh(t.geo(new THREE.PlaneGeometry(ROOM_W, WALL_H)), wallMat)
  frontWall.rotation.y = Math.PI
  frontWall.position.set(0, (FLOOR_Y + CEIL_Y) * 0.5, FRONT_Z)
  group.add(frontWall)

  // Soft matte ceiling
  const ceil = new THREE.Mesh(
    t.geo(new THREE.PlaneGeometry(ROOM_W, ROOM_D)).rotateX(Math.PI / 2),
    t.mat(new THREE.MeshStandardMaterial({ color: 0xd5cec2, roughness: 0.95 })),
  )
  ceil.position.set(0, CEIL_Y, (BACK_Z + FRONT_Z) * 0.5)
  group.add(ceil)

  // 2. Wide-plank oak floorboards + woven warm charcoal-oat floor rug + wooden baseboards
  const floorTex = t.tex(makeFloorPlankTexture())
  const floor = new THREE.Mesh(
    t.geo(new THREE.PlaneGeometry(ROOM_W, ROOM_D)).rotateX(-Math.PI / 2),
    t.mat(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.84, metalness: 0.0, envMapIntensity: 0.16 })),
  )
  floor.position.set(0, FLOOR_Y, (BACK_Z + FRONT_Z) * 0.5)
  floor.receiveShadow = true
  group.add(floor)

  const rug = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(168, 0.8, 114, 2, 0.25)),
    t.mat(new THREE.MeshStandardMaterial({ color: 0x453e38, roughness: 0.96 })),
  )
  rug.position.set(0, FLOOR_Y + 0.4, 4)
  group.add(rug)

  const trimMat = t.mat(new THREE.MeshStandardMaterial({ color: 0x523f2f, roughness: 0.78 }))
  const baseboard = new THREE.Mesh(t.geo(new THREE.BoxGeometry(ROOM_W, 8.5, 1.4)), trimMat)
  baseboard.position.set(0, FLOOR_Y + 4.25, BACK_Z + 0.7)
  group.add(baseboard)

  // 3. Large Sunlit Mid-Century Studio Window on Back-Left Wall (x: -60..-14, y: 2..64)
  const winW = 46
  const winH = 62
  const winCX = -37
  const winCY = 33
  const skyTex = t.tex(makeWindowSkyTexture())
  const skyPane = new THREE.Mesh(
    t.geo(new THREE.PlaneGeometry(winW - 2.4, winH - 2.4)),
    t.mat(
      new THREE.MeshBasicMaterial({
        map: skyTex,
      }),
    ),
  )
  skyPane.position.set(winCX, winCY, BACK_Z + 0.45)
  group.add(skyPane)

  // Matte warm-black architectural steel window frame & 2×3 loft mullions
  const frameMat = t.mat(new THREE.MeshStandardMaterial({ color: 0x222120, roughness: 0.52, metalness: 0.35 }))
  const frameD = 2.6
  const addFrameBar = (w: number, h: number, x: number, y: number, d = frameD) => {
    const bar = new THREE.Mesh(t.geo(new THREE.BoxGeometry(w, h, d)), frameMat)
    bar.position.set(x, y, BACK_Z + d * 0.5)
    group.add(bar)
  }
  // Outer casing
  addFrameBar(winW + 1.4, 2.2, winCX, winCY + winH * 0.5)
  addFrameBar(winW + 1.4, 2.2, winCX, winCY - winH * 0.5)
  addFrameBar(2.2, winH, winCX - winW * 0.5, winCY)
  addFrameBar(2.2, winH, winCX + winW * 0.5, winCY)
  // Interior loft grid mullions (1 vertical center, 2 horizontal)
  addFrameBar(1.15, winH - 2, winCX, winCY, 1.7)
  addFrameBar(winW - 2, 1.15, winCX, winCY + winH * 0.16, 1.7)
  addFrameBar(winW - 2, 1.15, winCX, winCY - winH * 0.18, 1.7)

  // Warm walnut projecting windowsill ledge
  const sill = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(winW + 5.5, 2.0, 6.2, 2, 0.2)),
    t.mat(new THREE.MeshStandardMaterial({ color: 0x624a36, roughness: 0.72 })),
  )
  sill.position.set(winCX, winCY - winH * 0.5 - 1.2, BACK_Z + 3.0)
  group.add(sill)

  // 4. Vertical Walnut Acoustic Slat Wall Panel (right behind the center of the desk!)
  const slatPanelW = 34
  const slatPanelH = 88
  const slatCX = 8
  const slatCY = 18
  const feltBack = new THREE.Mesh(
    t.geo(new THREE.BoxGeometry(slatPanelW, slatPanelH, 0.7)),
    t.mat(new THREE.MeshStandardMaterial({ color: 0x22201f, roughness: 0.96 })),
  )
  feltBack.position.set(slatCX, slatCY, BACK_Z + 0.35)
  group.add(feltBack)

  const slatMat = t.mat(new THREE.MeshStandardMaterial({ color: 0x71553d, roughness: 0.74, metalness: 0.02 }))
  const slatCount = 13
  const slatW = 1.65
  const slatPitch = slatPanelW / slatCount
  const slatGeo = t.geo(new THREE.BoxGeometry(slatW, slatPanelH, 1.25))
  for (let i = 0; i < slatCount; i++) {
    const slat = new THREE.Mesh(slatGeo, slatMat)
    slat.position.set(slatCX - slatPanelW * 0.5 + (i + 0.5) * slatPitch, slatCY, BACK_Z + 1.1)
    group.add(slat)
  }

  // 5. Two Minimalist Framed Wall Prints (Bauhaus / TE tone study on the slats + waveform above bookshelf)
  const addFramedArt = (variant: 'circle' | 'wave', x: number, y: number, w: number, h: number, zOff: number) => {
    const fg = new THREE.Group()
    fg.position.set(x, y, BACK_Z + zOff)

    const outerFrame = new THREE.Mesh(t.geo(new THREE.BoxGeometry(w + 1.8, h + 1.8, 1.5)), frameMat)
    outerFrame.castShadow = true
    fg.add(outerFrame)

    const artTex = t.tex(makePosterTexture(variant))
    const print = new THREE.Mesh(
      t.geo(new THREE.PlaneGeometry(w, h)),
      t.mat(new THREE.MeshStandardMaterial({ map: artTex, roughness: 0.76, metalness: 0.0 })),
    )
    print.position.z = 0.78
    fg.add(print)
    group.add(fg)
  }
  addFramedArt('circle', slatCX, 17.5, 18.5, 23, 2.2)
  addFramedArt('wave', 58, 66, 17, 21.5, 1.0)

  // 6. Mid-Century Walnut Bookshelf + Vinyl Collection on Back-Right Wall
  const bookshelf = buildBookshelf(t)
  bookshelf.position.set(57, FLOOR_Y, BACK_Z + 10.5)
  group.add(bookshelf)

  // 7. Tall Sunlit Potted Floor Plant in Back-Left Corner beside the Window
  const plant = buildFloorPlant(t)
  plant.position.set(-72, FLOOR_Y, BACK_Z + 17)
  group.add(plant)

  // 8. Warm Ambient Room Daylight & Accent Sconce Lighting (gives depth without overpowering the desk gear)
  const windowGlow = new THREE.PointLight(0xfff0d4, 180, 190, 1.5)
  windowGlow.position.set(winCX + 4, 24, BACK_Z + 18)
  group.add(windowGlow)

  const shelfWarm = new THREE.PointLight(0xffcb8c, 90, 150, 1.6)
  shelfWarm.position.set(55, 30, BACK_Z + 26)
  group.add(shelfWarm)

  return {
    group,
    dispose() {
      t.dispose()
    },
  }
}
