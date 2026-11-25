import { buildBookshelf } from './buildBookshelf'
import * as THREE from 'three'
import boredomsPrint from '../assets/room/seripop-boredoms-2005.jpg'
import gardenPhoto from '../assets/room/garden-photo.jpg'
import mineralPlaster from '../assets/room/mineral-plaster.webp'
import acousticOak from '../assets/room/acoustic-oak.webp'
import forestCollage from '../assets/room/forest-collage.webp'
import windowView from '../assets/room/autumn-park-window.jpg'
import woodGrain from '../assets/knobs-wood.jpg'
import rugWeave from '../assets/surfaces/rug.jpg'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export interface StudioRoomRig {
  group: THREE.Group
  /** the light switch by the door: clicking it turns the room to night and back */
  lightSwitch: THREE.Object3D
  /** 0 = day, 1 = after hours: moonlit window and the desk lamp on */
  setNight: (level: number) => void
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

  // Framed gig poster, photo print and waveform print.
  const addFramedArt = (variant: 'boredoms' | 'garden' | 'wave', x: number, y: number, w: number, h: number, zOff: number) => {
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

    const artTex =
      variant === 'boredoms' ? surfaceTexture(boredomsPrint) : variant === 'garden' ? surfaceTexture(gardenPhoto) : t.tex(makeWavePrint())
    const paper = t.geo(new THREE.PlaneGeometry(w,h))
    const print = new THREE.Mesh(
      paper,
      t.mat(new THREE.MeshStandardMaterial({ map: artTex, roughness: 0.76, metalness: 0.0 })),
    )
    print.position.z = 0.25
    fg.add(print)
    group.add(fg)
    return fg
  }
  // the gig poster hangs straight on the wall, behind the middle of the desk
  addFramedArt('boredoms', 8, 26, 30, 45, 1.0)
  addFramedArt('wave', 68, 111, 17, 21.5, 1.0)
  // the black-and-white garden photo: a small print just above table height, centred on an oak panel
  // of the left wall, clear of the corner plant, where the low camera sees it when orbited left
  const photo = addFramedArt('garden', 0, 12, 24, 24 * 1400 / 950, 0)
  photo.rotation.y = Math.PI / 2
  photo.position.set(-SIDE_X + 0.35 + panelDepth + 0.8, 12, FRONT_Z - 3.5 * bayWidth)

  // A way out: a panelled door in the middle of the bare wall behind the desk camera, with warm
  // light from a hallway showing under it. Built facing +Z, then turned to face into the room.
  {
    const DOOR_W = 85, DOOR_H = 205, DOOR_D = 4
    const door = new THREE.Group()
    door.name = 'studio-door'
    const paint = t.mat(new THREE.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.62 }))
    const casingMat = t.mat(new THREE.MeshStandardMaterial({ color: 0xdcd5c8, roughness: 0.6 }))
    const brass = t.mat(new THREE.MeshStandardMaterial({ color: 0xb8975e, metalness: 0.75, roughness: 0.32 }))
    const part = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, r = 0.25) => {
      const m = new THREE.Mesh(t.geo(new RoundedBoxGeometry(w, h, d, 2, r)), mat)
      m.position.set(x, y, z)
      m.castShadow = m.receiveShadow = true
      door.add(m)
      return m
    }
    // slab, then stiles and rails standing proud of it so the panels read as recessed
    part(DOOR_W, DOOR_H, DOOR_D, 0, DOOR_H / 2, 0, paint, 0.3)
    const proud = 0.7
    const face = DOOR_D / 2 + proud / 2
    for (const sx of [-1, 1]) part(12, DOOR_H, proud, sx * (DOOR_W / 2 - 6), DOOR_H / 2, face, paint, 0.2)
    part(DOOR_W - 24, 12, proud, 0, DOOR_H - 6, face, paint, 0.2)
    part(DOOR_W - 24, 16, proud, 0, 104, face, paint, 0.2)
    part(DOOR_W - 24, 22, proud, 0, 11, face, paint, 0.2)
    part(DOOR_W - 24, 3, proud * 0.6, 0, 50, face - proud * 0.2, paint, 0.15)
    // casing round the opening
    const casing = 7
    for (const sx of [-1, 1]) part(casing, DOOR_H + casing, 1.8, sx * (DOOR_W / 2 + casing / 2), (DOOR_H + casing) / 2, -0.6, casingMat, 0.3)
    part(DOOR_W + casing * 2, casing, 1.8, 0, DOOR_H + casing / 2, -0.6, casingMat, 0.3)
    // brass lever on the latch side, toward the front of the room
    const lx = DOOR_W / 2 - 7.5
    part(3.2, 15, 0.6, lx, 100, DOOR_D / 2 + 0.3, brass, 0.25)
    const rose = new THREE.Mesh(t.geo(new THREE.CylinderGeometry(1.25, 1.35, 2.2, 20)), brass)
    rose.rotation.x = Math.PI / 2
    rose.position.set(lx, 104, DOOR_D / 2 + 1.4)
    door.add(rose)
    const lever = new THREE.Mesh(t.geo(new THREE.CapsuleGeometry(0.75, 10, 6, 14)), brass)
    lever.rotation.z = Math.PI / 2
    lever.position.set(lx - 5.2, 104, DOOR_D / 2 + 2.4)
    lever.castShadow = true
    door.add(lever)
    // hallway light under the door
    const glow = new THREE.Mesh(
      t.geo(new THREE.PlaneGeometry(DOOR_W - 4, 0.9)),
      t.mat(new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.75 })),
    )
    glow.position.set(0, 0.45, DOOR_D / 2 + 0.05)
    door.add(glow)
    door.rotation.y = Math.PI
    door.position.set(0, FLOOR_Y, FRONT_Z - 2.6)
    group.add(door)
  }

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

  // ---- Light switch ---------------------------------------------------------------------
  // A rocker plate by the latch side of the door, low enough to see when the camera turns round.
  const lightSwitch = new THREE.Group()
  lightSwitch.name = 'light-switch'
  const plateMat = t.mat(new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.45 }))
  const plate = new THREE.Mesh(t.geo(new RoundedBoxGeometry(7.2, 11.6, 0.6, 3, 0.35)), plateMat)
  plate.castShadow = true
  const rocker = new THREE.Mesh(t.geo(new RoundedBoxGeometry(2.4, 4.4, 1.3, 3, 0.4)), plateMat)
  rocker.position.z = 0.6
  lightSwitch.add(plate, rocker)
  for (const sy of [-1, 1]) {
    const screw = new THREE.Mesh(t.geo(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 12)), t.mat(new THREE.MeshStandardMaterial({ color: 0xbfb9ad, metalness: 0.6, roughness: 0.4 })))
    screw.rotation.x = Math.PI / 2
    screw.position.set(0, sy * 4.4, 0.35)
    lightSwitch.add(screw)
  }
  // a generous invisible hit area: the plate is small from across the room
  const hitPad = new THREE.Mesh(
    t.geo(new THREE.PlaneGeometry(18, 24)),
    t.mat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })),
  )
  hitPad.position.z = 0.4
  lightSwitch.add(hitPad)
  lightSwitch.traverse((o) => (o.userData.lightSwitch = true))
  lightSwitch.rotation.y = Math.PI
  // 64 cm off the floor: the middle of the strip of wall a turned-round camera sees over the table
  lightSwitch.position.set(-62, -6, FRONT_Z - 0.35)
  group.add(lightSwitch)

  // ---- After hours: the switch turns the room to night --------------------------------
  // A small locator light in the switch glows once the room is dark
  const locator = new THREE.Mesh(
    t.geo(new THREE.CircleGeometry(0.32, 14)),
    t.mat(new THREE.MeshBasicMaterial({ color: 0xffa24a, transparent: true, opacity: 0 })),
  )
  locator.position.set(0, -2.9, 0.33)
  lightSwitch.add(locator)

  // Moon behind the window glass: a soft glow and a disc, only at night
  const glowCanvas = document.createElement('canvas')
  glowCanvas.width = glowCanvas.height = 128
  {
    const g = glowCanvas.getContext('2d')!
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(235,240,255,1)')
    grad.addColorStop(0.18, 'rgba(225,232,255,0.85)')
    grad.addColorStop(0.24, 'rgba(170,190,240,0.25)')
    grad.addColorStop(1, 'rgba(120,140,210,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
  }
  const moonMat = t.mat(
    new THREE.MeshBasicMaterial({
      map: t.tex(new THREE.CanvasTexture(glowCanvas)),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  )
  const moon = new THREE.Mesh(t.geo(new THREE.PlaneGeometry(34, 34)), moonMat)
  moon.position.set(winCX + 20, winCY + 28, BACK_Z - 17.5)
  moon.visible = false
  group.add(moon)
  const daylightColor = windowGlow.color.clone()
  const moonlightColor = new THREE.Color(0x7b8fd0)
  const skyDay = new THREE.Color(0xffffff)
  const skyNight = new THREE.Color(0x26345e)

  // Desk lamp: an architect-style lamp at the back left of the table, aimed at the gear
  const lamp = new THREE.Group()
  lamp.name = 'desk-lamp'
  const lampMetal = t.mat(new THREE.MeshStandardMaterial({ color: 0x2b2b2c, metalness: 0.55, roughness: 0.42 }))
  const lampBase = new THREE.Mesh(t.geo(new THREE.CylinderGeometry(6.5, 7, 1.6, 40)), lampMetal)
  lampBase.position.y = 0.8
  const rod = (from: THREE.Vector3, to: THREE.Vector3, r = 0.55) => {
    const len = from.distanceTo(to)
    const m = new THREE.Mesh(t.geo(new THREE.CylinderGeometry(r, r, len, 14)), lampMetal)
    m.position.copy(from).lerp(to, 0.5)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
    m.castShadow = true
    lamp.add(m)
  }
  const joint = (p: THREE.Vector3, r = 1.1) => {
    const j = new THREE.Mesh(t.geo(new THREE.SphereGeometry(r, 16, 12)), lampMetal)
    j.position.copy(p)
    lamp.add(j)
  }
  const foot = new THREE.Vector3(0, 1.6, 0)
  const elbow = new THREE.Vector3(6, 33, 0)
  const head = new THREE.Vector3(27, 37, 0)
  rod(foot, elbow)
  rod(elbow, head)
  joint(foot, 1.3)
  joint(elbow)
  joint(head, 1)
  // shade: a dark cone opening down and forward, warm inside, with a bulb
  const shadeGroup = new THREE.Group()
  shadeGroup.position.copy(head)
  shadeGroup.rotation.z = -2.2
  const shade = new THREE.Mesh(t.geo(new THREE.CylinderGeometry(2.4, 6.4, 10, 32, 1, true)), lampMetal)
  shade.position.y = 4
  const shadeInnerMat = t.mat(new THREE.MeshStandardMaterial({ color: 0xf4efe4, emissive: 0xffc27a, emissiveIntensity: 0, side: THREE.BackSide, roughness: 0.8 }))
  const shadeInner = new THREE.Mesh(t.geo(new THREE.CylinderGeometry(2.3, 6.25, 9.8, 32, 1, true)), shadeInnerMat)
  shadeInner.position.y = 4
  const bulbMat = t.mat(new THREE.MeshStandardMaterial({ color: 0xfff6e8, emissive: 0xffd9a0, emissiveIntensity: 0 }))
  const bulb = new THREE.Mesh(t.geo(new THREE.SphereGeometry(1.9, 20, 14)), bulbMat)
  bulb.position.y = 5.5
  shade.castShadow = true
  shadeGroup.add(shade, shadeInner, bulb)
  lamp.add(lampBase, shadeGroup)
  lampBase.castShadow = lampBase.receiveShadow = true
  lamp.position.set(-46, 0, -24)
  // turn the arm toward the gear
  lamp.rotation.y = -Math.atan2(26, 40)
  group.add(lamp)
  // its light: a warm cone onto the desk, plus a little spill around the lamp
  const lampLight = new THREE.SpotLight(0xffc98c, 0, 220, 0.78, 0.65, 1.2)
  lamp.updateMatrixWorld(true)
  lampLight.position.copy(bulb.getWorldPosition(new THREE.Vector3()))
  lampLight.target.position.set(-4, 0, 4)
  group.add(lampLight, lampLight.target)
  const lampSpill = new THREE.PointLight(0xffb873, 0, 90, 1.6)
  lampSpill.position.copy(lampLight.position)
  group.add(lampSpill)

  const setNight = (level: number) => {
    // the outside goes to moonlit blue, the daylight through the window to faint moonlight
    ;(skyPane.material as THREE.MeshBasicMaterial).color.copy(skyDay).lerp(skyNight, level)
    windowGlow.color.copy(daylightColor).lerp(moonlightColor, level)
    windowGlow.intensity = daylight * (1 - 0.82 * level)
    moonMat.opacity = level
    moon.visible = level > 0.01
    // the lamp comes on
    lampLight.intensity = level * 3000
    lampSpill.intensity = level * 170
    shadeInnerMat.emissiveIntensity = level * 1.6
    bulbMat.emissiveIntensity = level * 4
    ;(locator.material as THREE.MeshBasicMaterial).opacity = level
    rocker.rotation.x = level > 0.5 ? -0.22 : 0.22
  }
  const daylight = windowGlow.intensity
  setNight(0)

  return {
    group,
    lightSwitch,
    setNight,
    dispose() {
      t.dispose()
    },
  }
}
