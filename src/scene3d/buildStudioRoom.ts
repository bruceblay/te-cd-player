import { buildBookshelf } from './buildBookshelf'
import * as THREE from 'three'
import boredomsPrint from '../assets/room/boredoms-kozik-1993.jpg'
import mineralPlaster from '../assets/room/mineral-plaster.webp'
import acousticOak from '../assets/room/acoustic-oak.webp'
import forestCollage from '../assets/room/forest-collage.webp'
import windowView from '../assets/room/autumn-park-window.jpg'
import woodGrain from '../assets/knobs-wood.jpg'
import rugWeave from '../assets/surfaces/rug.jpg'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export interface StudioRoomRig {
  group: THREE.Group
  dispose: () => void
}

function createTracker() {
  const geos: THREE.BufferGeometry[] = []
  const mats: THREE.Material[] = []
  const texs: THREE.Texture[] = []
  const instances: THREE.InstancedMesh[] = []
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
    instances,
    dispose() {
      instances.forEach(mesh => mesh.dispose())
      geos.forEach((g) => g.dispose())
      mats.forEach((m) => m.dispose())
      texs.forEach((t) => t.dispose())
    },
  }
}

/* ============================================================
   PROCEDURAL STUDIO TEXTURES (plaster, floorboards, sky, art)
   ============================================================ */

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

function makeWavePrint(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 640
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ece6db'
  ctx.fillRect(0, 0, 512, 640)
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

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/* ============================================================
   1. FLOOR PLANT (Sculpted Fiddle-Leaf / Rubber Fig in Planter)
   ============================================================ */

function makeBroadLeafGeometry(): THREE.BufferGeometry {
  const segL = 20
  const segW = 12
  const positions: number[] = []
  const indices: number[] = []
  const colors: number[] = []

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
      const edge = Math.abs(s)
      positions.push(x, droop + cup + edge*edge*Math.sin(t*17+s*2)*.27, z)
      const rib = Math.exp(-Math.abs(s)*24)
      const veins = Math.pow(Math.max(0, Math.cos((t-edge*.17)*Math.PI*16)), 10)
      colors.push(.73 + .24*rib + .045*veins, .81 + .17*rib + .045*veins, .62 + .21*rib)
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
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
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
    const a = (i / 4) * Math.PI * 2
    const leg = new THREE.Mesh(legGeo, woodMat)
    leg.position.set(Math.cos(a) * 10.9, 18, Math.sin(a) * 10.9)
    g.add(leg)
  }
  const crossGeo = t.geo(new THREE.BoxGeometry(22, 1.2, 1.2))
  const c1 = new THREE.Mesh(crossGeo, woodMat)
  c1.position.y = 22
  g.add(c1)
  const halfRail = t.geo(new THREE.BoxGeometry(1.2, 1.2, 10.4))
  for (const z of [-5.8, 5.8]) {
    const rail = new THREE.Mesh(halfRail, woodMat)
    rail.position.set(0, 22, z)
    g.add(rail)
  }

  // Matte off-white sculptural ceramic cylinder planter
  const potMat = t.mat(new THREE.MeshStandardMaterial({ color: 0xddd6c9, roughness: 0.8, metalness: 0.0 }))
  const pot = new THREE.Mesh(t.geo(new THREE.LatheGeometry([[0,0],[8.8,0],[9.35,.45],[10.2,20.2],[10.15,20.8],[9.9,21],[9.45,21],[9.3,20.55],[9.15,18.1],[0,18.1]].map(([x,y]) => new THREE.Vector2(x,y)), 56)), potMat)
  pot.position.y = 22.6
  pot.castShadow = true
  pot.receiveShadow = true
  g.add(pot)

  const soil = new THREE.Mesh(
    t.geo(new THREE.CircleGeometry(9.23, 48)).rotateX(-Math.PI / 2),
    t.mat(new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.96 })),
  )
  soil.position.y = 41.9
  g.add(soil)

  // Branching woody stems + lush dark-emerald broad leaves rising into view beside the window
  const stemMat = t.mat(new THREE.MeshStandardMaterial({ color: 0x4b3c2d, roughness: 0.85 }))
  const leafGeo = t.geo(makeBroadLeafGeometry())
  const leafMatA = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0x547c47, vertexColors: true,
      roughness: 0.44,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
  )
  const leafMatB = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0x638451, vertexColors: true,
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

  const petioleGeo = t.geo(new THREE.CylinderGeometry(.14, .23, 1, 8))
  stems.forEach((st, si) => {
    const sg = new THREE.Group()
    sg.position.set(st.x, 41.6, st.z)
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
      const offset = new THREE.Vector3(Math.sin(angle)*2.8, 1.4, Math.cos(angle)*2.8)
      const petiole = new THREE.Mesh(petioleGeo, stemMat)
      petiole.scale.y = offset.length()
      petiole.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), offset.clone().normalize())
      petiole.position.copy(offset).multiplyScalar(.5).y += y
      sg.add(petiole)
      leaf.position.copy(offset).y += y
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
   4. FULL WARM MID-CENTURY MUSIC STUDIO ROOM BUILDER
   ============================================================ */

export function buildStudioRoom(): StudioRoomRig {
  const t = createTracker()
  const group = new THREE.Group()
  group.name = 'studio-room-env'

  const FLOOR_Y = -70
  const CEIL_Y = 178
  const BACK_Z = -87
  const FRONT_Z = 150
  const SIDE_X = 132
  const WALL_H = CEIL_Y - FLOOR_Y
  const ROOM_W = SIDE_X * 2
  const ROOM_D = FRONT_Z - BACK_Z

  // 1. Warm limewash gallery plaster walls
  const loader = new THREE.TextureLoader()
  const plasterTex = surfaceTexture(mineralPlaster)
  const wallMat = t.mat(
    new THREE.MeshStandardMaterial({
      map: plasterTex,
      bumpMap: plasterTex,
      bumpScale: .06,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.14,
    }),
  )
  const winW = 77, winH = 96, winCX = -55, winCY = 49
  const x0 = winCX-winW/2, x1 = winCX+winW/2
  const y0 = winCY-winH/2, y1 = winCY+winH/2
  // Solid reveals around a real opening; the outdoor view sits behind the wall.
  function wallSection(l: number, r: number, b: number, top: number) {
    const geometry = t.geo(new THREE.BoxGeometry(r-l, top-b, 5))
    const { position, normal, uv } = geometry.attributes
    for (let i = 0; i < position.count; i++) {
      if (normal.getZ(i) > .99) {
        uv.setXY(i, (position.getX(i)+(l+r)/2+SIDE_X)/ROOM_W, (position.getY(i)+(b+top)/2-FLOOR_Y)/WALL_H)
      }
    }
    const piece = new THREE.Mesh(geometry, wallMat)
    piece.position.set((l+r)/2,(b+top)/2,BACK_Z-2.5)
    piece.receiveShadow = true
    group.add(piece)
  }
  wallSection(-SIDE_X,x0,FLOOR_Y,CEIL_Y)
  wallSection(x1,SIDE_X,FLOOR_Y,CEIL_Y)
  wallSection(x0,x1,FLOOR_Y,y0)
  wallSection(x0,x1,y1,CEIL_Y)
  function surfaceTexture(url: string) {
    const tex = t.tex(loader.load(url))
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    return tex
  }
  const grain = surfaceTexture(woodGrain)

  const leftWall = new THREE.Mesh(t.geo(new THREE.PlaneGeometry(ROOM_D, WALL_H)), wallMat)
  leftWall.rotation.y = Math.PI / 2
  leftWall.position.set(-SIDE_X, (FLOOR_Y + CEIL_Y) * 0.5, (BACK_Z + FRONT_Z) * 0.5)
  group.add(leftWall)
  leftWall.receiveShadow = true

  // Five oak acoustic panels meet across narrow, recessed joints. Their top
  // edges stay exposed so the depth of the lining reads from an oblique view.
  const panelHeight = 150
  const panelDepth = 1.8
  const panelCount = 5
  const bayWidth = ROOM_D / panelCount
  const reveal = .45
  const oak = t.mat(new THREE.MeshStandardMaterial({
    map: surfaceTexture(acousticOak), roughness: .76,
  }))
  const jointMat = t.mat(new THREE.MeshStandardMaterial({ color: 0x584635, roughness: .95 }))
  const lining = new THREE.Mesh(t.geo(new THREE.BoxGeometry(.35, panelHeight, ROOM_D)), jointMat)
  lining.position.set(-SIDE_X + .175, FLOOR_Y + panelHeight / 2, leftWall.position.z)
  group.add(lining)
  for (let i = 0; i < panelCount; i++) {
    const geometry = t.geo(new RoundedBoxGeometry(bayWidth - reveal, panelHeight, panelDepth, 2, .1))
    const { position, uv } = geometry.attributes
    for (let v = 0; v < uv.count; v++) {
      uv.setXY(v, (i + .5 + position.getX(v) / bayWidth) / panelCount, .5 + position.getY(v) / panelHeight)
    }
    const panel = new THREE.Mesh(geometry, oak)
    panel.rotation.y = leftWall.rotation.y
    panel.position.set(-SIDE_X + .35 + panelDepth/2, lining.position.y, FRONT_Z - (i + .5)*bayWidth)
    panel.receiveShadow = true
    group.add(panel)
  }

  const sagePlaster = t.mat(wallMat.clone())
  sagePlaster.color.set(0xcbd2bc)
  const rightWall = new THREE.Mesh(t.geo(new THREE.PlaneGeometry(ROOM_D, WALL_H)), sagePlaster)
  rightWall.receiveShadow = true
  rightWall.rotation.y = -Math.PI / 2
  rightWall.position.set(SIDE_X, (FLOOR_Y + CEIL_Y) * 0.5, (BACK_Z + FRONT_Z) * 0.5)
  group.add(rightWall)

  const collage = new THREE.Mesh(
    t.geo(new THREE.PlaneGeometry(60, 90)),
    t.mat(new THREE.MeshStandardMaterial({ map: surfaceTexture(forestCollage), roughness: .94 })),
  )
  collage.name = 'forest-collage-poster'
  collage.rotation.y = -Math.PI / 2
  collage.position.set(SIDE_X - .18, FLOOR_Y + 114.52, BACK_Z + 70)
  group.add(collage)

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
    t.geo(new RoundedBoxGeometry(156, 0.45, 95, 2, 0.25)),
    t.mat(new THREE.MeshStandardMaterial({ color: 0xb3a396, map: surfaceTexture(rugWeave), roughness: 0.96 })),
  )
  rug.position.set(0, FLOOR_Y + 0.225, 4)
  group.add(rug)

  const trimMat = t.mat(new THREE.MeshStandardMaterial({ color: 0x523f2f, roughness: 0.78 }))
  const baseboard = new THREE.Mesh(t.geo(new THREE.BoxGeometry(ROOM_W, 8.5, 1.4)), trimMat)
  baseboard.position.set(0, FLOOR_Y + 4.25, BACK_Z + 0.7)
  group.add(baseboard)
  const sideTrim = t.geo(new THREE.BoxGeometry(1.4, 8.5, ROOM_D - 1.4))
  for (const x of [-SIDE_X + .35 + panelDepth + .7, SIDE_X - .7]) {
    const trim = new THREE.Mesh(sideTrim, trimMat)
    trim.position.set(x, baseboard.position.y, leftWall.position.z + .7)
    group.add(trim)
  }

  // Recess the outdoor view behind the steel casement.
  const skyTex = surfaceTexture(windowView)
  const skyPane = new THREE.Mesh(
    t.geo(new THREE.PlaneGeometry(winW + 78, winH + 78)),
    t.mat(
      new THREE.MeshBasicMaterial({
        map: skyTex,
      }),
    ),
  )
  skyPane.position.set(winCX, winCY, BACK_Z - 18)
  group.add(skyPane)

  // Matte warm-black architectural steel window frame & 2×3 loft mullions
  const frameMat = t.mat(new THREE.MeshStandardMaterial({ color: 0x222120, roughness: 0.52, metalness: 0.35 }))
  const frameD = 2.6
  const addFrameBar = (w: number, h: number, x: number, y: number, d = frameD) => {
    const bar = new THREE.Mesh(t.geo(new THREE.BoxGeometry(w, h, d)), frameMat)
    bar.position.set(x, y, BACK_Z - 1.6 + d * 0.5)
    group.add(bar)
  }
  for (const x of [x0+1, x1-1]) addFrameBar(2,winH,x,winCY)
  for (const y of [y0+1, y1-1]) addFrameBar(winW-4,2,winCX,y)
  addFrameBar(1.1,winH-4,winCX,winCY,1.7)
  const paneW = (winW-5.1)/2
  for (const x of [winCX-(paneW+1.1)/2,winCX+(paneW+1.1)/2]) {
    for (const y of [winCY-winH/6,winCY+winH/6]) addFrameBar(paneW,.95,x,y,1.7)
  }
  // Warm walnut projecting windowsill ledge
  const sill = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(winW + 5.5, 2.0, 6.2, 2, 0.2)),
    t.mat(new THREE.MeshStandardMaterial({ color: 0xc59f7e, map: grain, roughness: 0.72 })),
  )
  sill.position.set(winCX, y0 - 1, BACK_Z + 3.0)
  group.add(sill)

  // Framed gig poster and waveform print.
  const addFramedArt = (variant: 'boredoms' | 'wave', x: number, y: number, w: number, h: number, zOff: number) => {
    const fg = new THREE.Group()
    fg.position.set(x, y, BACK_Z + zOff)

    const sideRail = t.geo(new THREE.BoxGeometry(.9, h+1.8, 1.5))
    const endRail = t.geo(new THREE.BoxGeometry(w, .9, 1.5))
    for (const sign of [-1, 1]) {
      const side = new THREE.Mesh(sideRail, frameMat)
      const end = new THREE.Mesh(endRail, frameMat)
      side.position.x = sign * (w+.9)/2
      end.position.y = sign * (h+.9)/2
      side.castShadow = end.castShadow = true
      fg.add(side, end)
    }

    const isGigPrint = variant === 'boredoms'
    const artTex = isGigPrint ? surfaceTexture(boredomsPrint) : t.tex(makeWavePrint())
    const paper = t.geo(new THREE.PlaneGeometry(w,h))
    // Sample the four paper corners in the archive photograph, excluding its tabletop.
    if (isGigPrint) {
      paper.setAttribute('uv', new THREE.Float32BufferAttribute([
        .029,.958, .975,.944, .039,.037, .96,.031,
      ],2))
    }
    const print = new THREE.Mesh(
      paper,
      t.mat(new THREE.MeshStandardMaterial({ map: artTex, roughness: 0.76, metalness: 0.0 })),
    )
    print.position.z = 0.25
    fg.add(print)
    group.add(fg)
  }
  // the gig poster hangs straight on the wall, behind the middle of the desk
  addFramedArt('boredoms', 8, 24, 30, 30*57.2/44.5, 1.0)
  addFramedArt('wave', 68, 111, 17, 21.5, 1.0)

  // 6. Handbuilt OSB bookcase and cassette rack on Back-Right Wall
  const bookshelf = buildBookshelf(t, surfaceTexture)
  // 14.1 cm to the rear face, plus the 1.4 cm baseboard.
  bookshelf.position.set(68, FLOOR_Y, BACK_Z + 15.5)
  group.add(bookshelf)

  // 7. Tall Sunlit Potted Floor Plant in Back-Left Corner beside the Window
  const plant = buildFloorPlant(t)
  plant.position.set(-81, FLOOR_Y, BACK_Z + 29)
  group.add(plant)

  // Soft daylight from the window.
  const windowGlow = new THREE.PointLight(0xfff0d4, 180, 190, 1.5)
  windowGlow.position.set(winCX + 4, 24, BACK_Z + 18)
  group.add(windowGlow)

  return {
    group,
    dispose() {
      t.dispose()
    },
  }
}
