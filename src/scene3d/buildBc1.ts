import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Deck, DeckState } from '../engine/deck'
import {
  createContactShadowTexture,
  createKnurlBumpTexture,
  createMicroBeadMaps,
} from './materials'
import {
  createBc1DisplayUpdater,
  createBc1PlateTexture,
  createDiscBlurTexture,
  createDiscTexture,
  createKeyLabelTexture,
  createTurntableTexture,
} from './textures'
import { createRoundedTopPlane, tagControl } from './types'

// BC-1 diagram constants: 370 x 511 units, 120mm CD = 246 units.
// 1 world unit = 10 mm.
const PW = 370
const PH = 511
const UNIT = 12 / 246 // 0.0487804878 world units per diagram unit

export const BC1_W = PW * UNIT // 18.049
export const BC1_D = PH * UNIT // 24.927
export const BC1_H = 1.65 // 16.5 mm machined slab
const FOOT_H = 0.06
const TOP_Y = FOOT_H + BC1_H // 1.71

const CX = 236.5
const CY = 177
const DISC_R = 123 * UNIT // 6.0 world units (120 mm diameter)

const PAD: (number | 'T' | 'C')[][] = [
  [7, 8, 9],
  [4, 5, 6],
  [1, 2, 3],
  ['T', 0, 'C'],
]
const PAD_X = [17, 51, 84]
const PAD_Y = [236, 269, 303, 337]
const COL = [118, 169, 219, 270, 320]

const dx = (x: number) => (x - PW / 2) * UNIT
const dz = (y: number) => (y - PH / 2) * UNIT

const BT_COLOR: Record<DeckState['bt'], { color: number; on: boolean; blink?: boolean }> = {
  off: { color: 0x3a6cff, on: false },
  scanning: { color: 0x3a6cff, on: true, blink: true },
  connecting: { color: 0x3a6cff, on: true },
  connected: { color: 0xf4f4ff, on: true },
  broadcast: { color: 0xff2a1a, on: true },
}

export interface Bc1Rig {
  group: THREE.Group
  outputJackLocal: THREE.Vector3
  update: (s: DeckState, dt: number, now: number) => void
  /** Exact clockwise rotation delta (radians) applied to the CD on the latest update frame. */
  getSpinDelta: () => number
  setPressed: (keyId: string, down: boolean) => void
  dispose: () => void
}

export function buildBc1(deck: Deck, deckIndex: number): Bc1Rig {
  const group = new THREE.Group()
  group.name = `bc1-${deckIndex}`

  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []
  const disposables: { dispose: () => void }[] = []

  const trackGeo = <T extends THREE.BufferGeometry>(g: T) => {
    geometries.push(g)
    return g
  }
  const trackMat = <T extends THREE.Material>(m: T) => {
    materials.push(m)
    return m
  }
  const trackTex = <T extends THREE.Texture>(t: T) => {
    textures.push(t)
    return t
  }

  // Procedural micro-bead-blasted anodized aluminum PBR maps
  const beadMaps = createMicroBeadMaps(5, 7)
  disposables.push(beadMaps)

  /* ---------------- 1. Grounded Contact Shadow & Milled Aluminum Slab ---------------- */

  const aoTex = trackTex(createContactShadowTexture())
  const aoPlane = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(BC1_W * 1.24, BC1_D * 1.18)).rotateX(-Math.PI / 2),
    trackMat(
      new THREE.MeshBasicMaterial({
        map: aoTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.72,
      }),
    ),
  )
  aoPlane.position.set(0.15, 0.004, 0.25)
  group.add(aoPlane)

  // Low dark rubber underside pad for crisp hairline shadow gap
  const foot = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(BC1_W - 0.6, FOOT_H, BC1_D - 0.6, 2, 0.03)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x202022, roughness: 0.92, metalness: 0.05 })),
  )
  foot.position.set(0, FOOT_H / 2, 0)
  foot.castShadow = true
  foot.receiveShadow = true
  group.add(foot)

  // Two-tone BC-1 sandwich enclosure matching docs/references/bc1-angle.jpg:
  // thin dark charcoal bottom casing + bead-blasted anodized aluminum upper slab
  const lowerH = 0.42
  const upperH = BC1_H - lowerH
  const lowerShell = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(BC1_W - 0.04, lowerH + 0.08, BC1_D - 0.04, 3, 0.08)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x222325, roughness: 0.65, metalness: 0.08 })),
  )
  lowerShell.position.set(0, FOOT_H + lowerH / 2, 0)
  lowerShell.castShadow = true
  lowerShell.receiveShadow = true
  group.add(lowerShell)

  const bodyMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xc2c2bd,
      metalness: 0.48,
      roughness: 0.48,
      normalMap: beadMaps.normalMap,
      normalScale: new THREE.Vector2(0.14, 0.14),
      roughnessMap: beadMaps.roughnessMap,
      clearcoat: 0.06,
      clearcoatRoughness: 0.6,
    }),
  )
  const body = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(BC1_W, upperH, BC1_D, 4, 0.11)),
    bodyMat,
  )
  body.position.set(0, FOOT_H + lowerH + upperH / 2, 0)
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  // Ultra-crisp 6x silk-screened top plate aligned 1:1 with diagram coordinates
  const plateTex = trackTex(createBc1PlateTexture())
  const plate = new THREE.Mesh(
    trackGeo(createRoundedTopPlane(BC1_W - 0.04, BC1_D - 0.04, 0.12, 8)),
    trackMat(
      new THREE.MeshPhysicalMaterial({
        map: plateTex,
        metalness: 0.36,
        roughness: 0.52,
        normalMap: beadMaps.normalMap,
        normalScale: new THREE.Vector2(0.1, 0.1),
        roughnessMap: beadMaps.roughnessMap,
        clearcoat: 0,
      }),
    ),
  )
  plate.position.set(0, TOP_Y + 0.012, 0)
  plate.receiveShadow = true
  group.add(plate)

  // Subtle coated glass optical lens dome inside the laser bay
  const lensMesh = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(4.5 * UNIT, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.45)),
    trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0x3b4876,
        metalness: 0.2,
        roughness: 0.06,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
      }),
    ),
  )
  lensMesh.scale.set(1, 0.32, 1)
  lensMesh.position.set(dx(180.5), TOP_Y + 0.018, dz(180.5))
  group.add(lensMesh)

  /* ---------------- 1b. 10 Raised LEGO-Compatible Corner Studs ---------------- */

  const LEGO_STUDS: [number, number][] = [
    [9, 25], [26, 25], [9, 42], [26, 42],
    [345, 25], [362, 25], [345, 42], [362, 42],
    [9, 109], [362, 109],
  ]
  const studOuterR = 4.9 * UNIT // ~2.4 mm radius (4.8 mm LEGO stud diameter)
  const studH = 0.22 // ~2.2 mm proud aluminum stud height
  const studGeo = trackGeo(new THREE.CylinderGeometry(studOuterR * 0.96, studOuterR, studH, 24))
  const studBevelGeo = trackGeo(new THREE.CylinderGeometry(studOuterR * 0.86, studOuterR * 0.96, 0.025, 24))
  const studBoreGeo = trackGeo(new THREE.CircleGeometry(studOuterR * 0.52, 20)).rotateX(-Math.PI / 2)
  const studHexGeo = trackGeo(new THREE.CircleGeometry(studOuterR * 0.36, 6)).rotateX(-Math.PI / 2)
  const studWallMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xcacbc6,
      metalness: 0.44,
      roughness: 0.44,
      normalMap: beadMaps.normalMap,
      normalScale: new THREE.Vector2(0.08, 0.08),
    }),
  )
  const studBoreMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x5c5d5a, roughness: 0.7 }))
  const studInnerMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x343533, roughness: 0.85 }))

  for (const [sx, sy] of LEGO_STUDS) {
    const sg = new THREE.Group()
    sg.position.set(dx(sx), TOP_Y + 0.012, dz(sy))

    const cyl = new THREE.Mesh(studGeo, studWallMat)
    cyl.position.y = studH / 2
    cyl.castShadow = true
    cyl.receiveShadow = true
    sg.add(cyl)

    const bevel = new THREE.Mesh(studBevelGeo, studWallMat)
    bevel.position.y = studH + 0.0125
    sg.add(bevel)

    const bore = new THREE.Mesh(studBoreGeo, studBoreMat)
    bore.position.y = studH + 0.028
    sg.add(bore)

    const hex = new THREE.Mesh(studHexGeo, studInnerMat)
    hex.position.y = studH + 0.032
    sg.add(hex)

    group.add(sg)
  }

  /* ---------------- 2. Precision Flush Edge Jacks, BT Button & Power Switch ---------------- */

  const darkAnodizedMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.38, roughness: 0.5 }),
  )
  const brushedRingMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x8e9094, metalness: 0.72, roughness: 0.32 }),
  )
  const orangeMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xff5a1f,
      roughness: 0.38,
      metalness: 0.04,
      clearcoat: 0.18,
    }),
  )

  // Flush precision-milled 3.5mm TRS jack socket on side edge only (no top-plate half-moon cutout)
  const jackRimGeo = trackGeo(new THREE.RingGeometry(0.155, 0.215, 24))
  const jackBoreGeo = trackGeo(new THREE.CircleGeometry(0.155, 24))
  const jackSleeveGeo = trackGeo(new THREE.RingGeometry(0.135, 0.158, 24))

  const addFlushJack = (diagX: number, zEdge: number, dir: number) => {
    const x = dx(diagX)
    const y = FOOT_H + BC1_H * 0.52
    const zFace = zEdge + dir * 0.006

    const rim = new THREE.Mesh(jackRimGeo, darkAnodizedMat)
    rim.position.set(x, y, zFace)
    if (dir < 0) rim.rotation.y = Math.PI
    group.add(rim)

    const sleeve = new THREE.Mesh(jackSleeveGeo, brushedRingMat)
    sleeve.position.set(x, y, zFace + dir * 0.002)
    if (dir < 0) sleeve.rotation.y = Math.PI
    group.add(sleeve)

    const bore = new THREE.Mesh(
      jackBoreGeo,
      trackMat(new THREE.MeshBasicMaterial({ color: 0x050506 })),
    )
    bore.position.set(x, y, zFace + dir * 0.003)
    if (dir < 0) bore.rotation.y = Math.PI
    group.add(bore)
  }

  // Rear (-Z): OUTPUT, SYNC OUT, DATA, USB-C
  addFlushJack(33, -BC1_D / 2, -1)
  addFlushJack(118, -BC1_D / 2, -1)
  addFlushJack(236, -BC1_D / 2, -1)

  // Flush USB-C port on rear edge
  const usbShell = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(0.92, 0.34, 0.04, 2, 0.12)),
    darkAnodizedMat,
  )
  usbShell.position.set(dx(290), FOOT_H + BC1_H * 0.52, -BC1_D / 2 - 0.002)
  group.add(usbShell)

  // Front (+Z): clean flush PHONES jack on front chassis wall
  addFlushJack(281, BC1_D / 2, 1)

  // Left & Right side-wall LEGO Technic / EP-dock connecting pin holes (matching bc1-angle.jpg)
  const pinRimGeo = trackGeo(new THREE.RingGeometry(0.19, 0.27, 24))
  const pinBoreGeo = trackGeo(new THREE.CircleGeometry(0.19, 24))
  const pinRimMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x7a7b79, roughness: 0.52, metalness: 0.25 }))
  const pinBoreMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x0b0b0d }))
  // Two pairs near rear & front corners (8 mm LEGO pitch = 0.80 world units) + mid-front clip holes
  const sidePinZs = [
    dz(25), dz(42), dz(109),
    dz(466), dz(483),
  ]
  const pinY = FOOT_H + lowerH + upperH * 0.52
  for (const side of [-1, 1] as const) {
    const xFace = side * (BC1_W / 2 + 0.008)
    const rotY = side > 0 ? Math.PI / 2 : -Math.PI / 2
    for (const pz of sidePinZs) {
      const rim = new THREE.Mesh(pinRimGeo, pinRimMat)
      rim.position.set(xFace, pinY, pz)
      rim.rotation.y = rotY
      group.add(rim)

      const bore = new THREE.Mesh(pinBoreGeo, pinBoreMat)
      bore.position.set(xFace + side * 0.003, pinY, pz)
      bore.rotation.y = rotY
      group.add(bore)
    }
  }

  const outputJackLocal = new THREE.Vector3(dx(33), FOOT_H + BC1_H * 0.52, -BC1_D / 2 - 0.02)

  // Key press state tracking for smooth depression animation
  const keyGroups = new Map<
    string,
    { group: THREE.Group; restY: number; restZ?: number; axis: 'y' | 'z'; pressed: boolean }
  >()

  // Back-edge BT push button
  const btGroup = new THREE.Group()
  const btMesh = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(9 * UNIT, 0.44, 0.24, 2, 0.05)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x262729, roughness: 0.52, metalness: 0.14 })),
  )
  btMesh.castShadow = true
  btGroup.add(btMesh)
  const btRestZ = -BC1_D / 2 - 0.08
  btGroup.position.set(dx(75.5), FOOT_H + BC1_H * 0.52, btRestZ)
  tagControl(btGroup, {
    kind: 'button',
    keyId: 'bt',
    deckIndex,
    onDown: () => deck.btDown(),
    onUp: () => deck.btUp(),
  })
  keyGroups.set('bt', { group: btGroup, restY: btGroup.position.y, restZ: btRestZ, axis: 'z', pressed: false })
  group.add(btGroup)

  // Back-edge sliding orange POWER switch
  const pwrHousing = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(18 * UNIT, 0.56, 0.16, 2, 0.05)),
    darkAnodizedMat,
  )
  pwrHousing.position.set(dx(341), FOOT_H + BC1_H * 0.52, -BC1_D / 2 - 0.04)
  group.add(pwrHousing)

  const pwrNub = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(8.6 * UNIT, 0.52, 0.34, 2, 0.06)),
    orangeMat,
  )
  pwrNub.castShadow = true
  const pwrOffX = dx(336.5)
  const pwrOnX = dx(345.5)
  pwrNub.position.set(pwrOnX, FOOT_H + BC1_H * 0.52, -BC1_D / 2 - 0.16)
  const pwrAction = {
    kind: 'toggle' as const,
    deckIndex,
    onToggle: () => deck.powerSwitch(deck.getState().power === 'off'),
    midi: `d${deckIndex}.power`,
  }
  tagControl(pwrNub, pwrAction)
  tagControl(pwrHousing, pwrAction)
  group.add(pwrNub)

  /* ---------------- 3. Flush Glossy Displays ---------------- */

  const displays = createBc1DisplayUpdater()

  const addDisplay = (x: number, y: number, w: number, h: number, tex: THREE.CanvasTexture) => {
    const sw = w * UNIT
    const sd = h * UNIT
    const bezel = new THREE.Mesh(
      trackGeo(new RoundedBoxGeometry(sw + 0.07, 0.028, sd + 0.07, 2, 0.014)),
      darkAnodizedMat,
    )
    bezel.position.set(dx(x + w / 2), TOP_Y + 0.028, dz(y + h / 2))
    group.add(bezel)

    const screen = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(sw, sd)).rotateX(-Math.PI / 2),
      trackMat(
        new THREE.MeshPhysicalMaterial({
          map: tex,
          emissiveMap: tex,
          emissive: new THREE.Color(0xffffff),
          emissiveIntensity: 1.2,
          roughness: 0.1,
          metalness: 0.04,
          clearcoat: 1.0,
          clearcoatRoughness: 0.06,
        }),
      ),
    )
    screen.position.set(dx(x + w / 2), TOP_Y + 0.056, dz(y + h / 2))
    group.add(screen)
  }

  addDisplay(118, 337, 135, 17, displays.mainTex)
  addDisplay(270, 337, 34, 17, displays.variTex)
  addDisplay(320, 337, 34, 17, displays.lineTex)
  addDisplay(337, 286, 17, 34, displays.vuTex)

  /* ---------------- 4. Recessed Status LEDs ---------------- */

  const ledBezelGeo = trackGeo(new THREE.RingGeometry(0.068, 0.095, 16)).rotateX(-Math.PI / 2)
  const ledLensGeo = trackGeo(new THREE.SphereGeometry(0.072, 14, 10))
  const makeLed = (x: number, y: number) => {
    const bezel = new THREE.Mesh(ledBezelGeo, darkAnodizedMat)
    bezel.position.set(dx(x), TOP_Y + 0.022, dz(y))
    group.add(bezel)

    const mat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x4a4a48,
        emissive: new THREE.Color(0xff2a1a),
        emissiveIntensity: 0,
        roughness: 0.22,
      }),
    )
    const mesh = new THREE.Mesh(ledLensGeo, mat)
    mesh.scale.set(1, 0.42, 1)
    mesh.position.set(dx(x), TOP_Y + 0.026, dz(y))
    group.add(mesh)
    return mat
  }

  const btLedMat = makeLed(63.5, 5.6)
  const cueLedMats = [0, 1, 2].map((i) => makeLed(COL[i] + 6, 377))

  /* ---------------- 5. Sculpted Low-Profile TE Keycaps in Milled Wells ---------------- */

  const wellMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x565652, roughness: 0.72, metalness: 0.12 }),
  )

  const makeKey = (opts: {
    id: string
    x: number
    y: number
    w: number
    h: number
    height: number
    bg: string
    fg: string
    label: string
    align: 'top' | 'center' | 'corner'
    onDown: () => void
    onUp?: () => void
  }) => {
    const sw = opts.w * UNIT
    const sd = opts.h * UNIT
    const kh = opts.height

    // Recessed key well frame matching .key-well in styles.css
    const well = new THREE.Mesh(
      trackGeo(createRoundedTopPlane(sw + 0.03, sd + 0.03, 0.06, 4)),
      wellMat,
    )
    well.position.set(dx(opts.x + opts.w / 2), TOP_Y + 0.022, dz(opts.y + opts.h / 2))
    group.add(well)

    const kg = new THREE.Group()
    const capW = sw - 0.08
    const capD = sd - 0.08

    // Matte sculpted low-profile beveled cap (no clearcoat to avoid specular snapping)
    const cap = new THREE.Mesh(
      trackGeo(new RoundedBoxGeometry(capW, kh, capD, 3, 0.055)),
      trackMat(
        new THREE.MeshStandardMaterial({
          color: opts.bg,
          roughness: 0.58,
          metalness: 0.04,
        }),
      ),
    )
    cap.castShadow = true
    cap.receiveShadow = true
    kg.add(cap)

    const lblTex = trackTex(createKeyLabelTexture(opts.label, opts.bg, opts.fg, opts.align))
    const lbl = new THREE.Mesh(
      trackGeo(createRoundedTopPlane(capW - 0.09, capD - 0.09, 0.04, 4)),
      trackMat(
        new THREE.MeshStandardMaterial({
          map: lblTex,
          roughness: 0.58,
          metalness: 0.04,
        }),
      ),
    )
    lbl.position.y = kh / 2 + 0.014
    lbl.receiveShadow = true
    kg.add(lbl)

    const restY = TOP_Y + 0.024 + kh / 2
    kg.position.set(dx(opts.x + opts.w / 2), restY, dz(opts.y + opts.h / 2))
    tagControl(kg, {
      kind: 'button',
      keyId: opts.id,
      deckIndex,
      onDown: opts.onDown,
      onUp: opts.onUp,
    })
    keyGroups.set(opts.id, { group: kg, restY, axis: 'y', pressed: false })
    group.add(kg)
  }

  // 12 charcoal small numpad keys (matching .key-well.small .key)
  PAD.forEach((row, ri) =>
    row.forEach((v, ci) => {
      makeKey({
        id: `pad-${v}`,
        x: PAD_X[ci],
        y: PAD_Y[ri],
        w: 17,
        h: 17,
        height: 0.21,
        bg: '#404043',
        fg: '#ecebe7',
        label: v === 1 ? 'I' : String(v),
        align: 'center',
        onDown: () => (v === 'T' ? deck.pressTime() : v === 'C' ? deck.pressCancel() : deck.pressDigit(v)),
      })
    }),
  )

  // ENTER
  makeKey({
    id: 'enter',
    x: 17,
    y: 387,
    w: 34,
    h: 34,
    height: 0.25,
    bg: '#232325',
    fg: '#f2f1ed',
    label: 'ENTER',
    align: 'top',
    onDown: () => deck.enterDown(),
    onUp: () => deck.enterUp(),
  })

  // CUE 1-3 (matching .key-well.grey .key)
  for (let i = 0; i < 3; i++) {
    makeKey({
      id: `cue-${i}`,
      x: COL[i],
      y: 387,
      w: 34,
      h: 34,
      height: 0.25,
      bg: '#d0d0cb',
      fg: '#3a3b3c',
      label: i === 0 ? 'I' : String(i + 1),
      align: 'corner',
      onDown: () => deck.cueDown(i),
      onUp: () => deck.cueUp(i),
    })
  }

  // Transport keys
  makeKey({
    id: 'prev',
    x: COL[1],
    y: 438,
    w: 34,
    h: 34,
    height: 0.25,
    bg: '#232325',
    fg: '#f2f1ed',
    label: 'PREV',
    align: 'top',
    onDown: () => deck.pressPrev(),
  })
  makeKey({
    id: 'next',
    x: COL[2],
    y: 438,
    w: 34,
    h: 34,
    height: 0.25,
    bg: '#232325',
    fg: '#f2f1ed',
    label: 'NEXT',
    align: 'top',
    onDown: () => deck.pressNext(),
  })
  makeKey({
    id: 'stop',
    x: COL[3],
    y: 438,
    w: 34,
    h: 34,
    height: 0.25,
    bg: '#d0d0cb',
    fg: '#3a3b3c',
    label: 'STOP',
    align: 'top',
    onDown: () => deck.pressStop(),
  })
  // Deep TE navy PLAY key (matching .key-well.blue .key: #1e3162)
  makeKey({
    id: 'play',
    x: COL[4],
    y: 438,
    w: 34,
    h: 34,
    height: 0.25,
    bg: '#1c2f5e',
    fg: '#d4dbef',
    label: 'PLAY',
    align: 'top',
    onDown: () => deck.pressPlay(),
  })

  /* ---------------- 6. Machined Knurled VARISPEED & Satin Off-White LEVEL Knobs ---------------- */

  const knurlTex = trackTex(createKnurlBumpTexture())

  const makeBc1Knob = (opts: {
    x: number
    y: number
    capUnits: number
    height: number
    color: number
    topColor: number
    tickColor: number
    knurled?: boolean
    metalness: number
    min: number
    max: number
    getValue: () => number
    setValue: (v: number) => void
    onReset?: () => void
    midi?: string
    disabled?: () => string | null
  }) => {
    const cx = dx(opts.x + 17)
    const cz = dz(opts.y + 17)
    const capR = (opts.capUnits / 2) * UNIT

    const rotor = new THREE.Group()
    rotor.position.set(cx, TOP_Y + 0.018, cz)

    // Invisible cup-sized hit zone so dragging anywhere in the recessed cup works
    const cupHit = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(16 * UNIT, 16 * UNIT, 0.15, 24)),
      trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })),
    )
    cupHit.position.y = 0.08
    rotor.add(cupHit)

    // Real BC-1 / EP-series 2-tone knob matching docs/references/bc1-angle.jpg:
    // slim neck -> satin metallic-grey aluminum barrel -> color-coded top cap
    const neckH = 0.1
    const midH = opts.height * 0.64
    const tipH = opts.height - neckH - midH

    const neckMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x5c5e62, roughness: 0.45, metalness: 0.35 }))
    const barrelMat = trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0xa6a8ab,
        metalness: 0.46,
        roughness: 0.36,
        bumpMap: opts.knurled ? knurlTex : null,
        bumpScale: opts.knurled ? 0.018 : 0,
        normalMap: beadMaps.normalMap,
        normalScale: new THREE.Vector2(0.05, 0.05),
      }),
    )
    const capMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: opts.topColor,
        metalness: opts.metalness,
        roughness: 0.44,
      }),
    )

    const neck = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(capR * 0.82, capR * 0.82, neckH, 32)),
      neckMat,
    )
    neck.position.y = neckH / 2
    neck.castShadow = true
    rotor.add(neck)

    const barrel = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(capR * 0.98, capR, midH, 48)),
      barrelMat,
    )
    barrel.position.y = neckH + midH / 2
    barrel.castShadow = true
    barrel.receiveShadow = true
    rotor.add(barrel)

    const tip = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(capR * 0.96, capR * 0.98, tipH, 48)),
      capMat,
    )
    tip.position.y = neckH + midH + tipH / 2
    tip.castShadow = true
    tip.receiveShadow = true
    rotor.add(tip)

    // Crisp chamfered top bevel ring
    const bevel = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(capR * 0.88, capR * 0.96, 0.036, 48)),
      capMat,
    )
    bevel.position.y = opts.height + 0.018
    bevel.castShadow = true
    rotor.add(bevel)

    // Refined radial indicator line matching .knob-mark in styles.css
    const tick = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.048, 0.018, capR * 0.42)),
      trackMat(new THREE.MeshStandardMaterial({ color: opts.tickColor, roughness: 0.45 })),
    )
    tick.position.set(0, opts.height + 0.04, -capR * 0.56)
    rotor.add(tick)

    tagControl(rotor, {
      kind: 'knob',
      deckIndex,
      min: opts.min,
      max: opts.max,
      getValue: opts.getValue,
      setValue: opts.setValue,
      onReset: opts.onReset,
      midi: opts.midi,
      disabled: opts.disabled,
    })
    group.add(rotor)
    return rotor
  }

  // Gunmetal knurled aluminum VARISPEED knob (uniform 17u diameter × 1.18 tall matching real EP encoders)
  const variRotor = makeBc1Knob({
    x: COL[3],
    y: 387,
    capUnits: 17,
    height: 1.18,
    color: 0x525357,
    topColor: 0x626368,
    tickColor: 0xd8d8da,
    knurled: true,
    metalness: 0.58,
    min: 50,
    max: 150,
    getValue: () => deck.getState().varispeed,
    setValue: (v) => deck.setVarispeed(v),
    onReset: () => deck.setVarispeed(100),
    midi: `d${deckIndex}.varispeed`,
    disabled: () => deck.varispeedBlocked(),
  })

  // Warm off-white satin LEVEL knob (uniform 17u diameter × 1.18 tall)
  const levelRotor = makeBc1Knob({
    x: COL[4],
    y: 387,
    capUnits: 17,
    height: 1.18,
    color: 0xeae6dc,
    topColor: 0xf4f1e8,
    tickColor: 0x4a4844,
    knurled: false,
    metalness: 0.08,
    min: 0,
    max: 100,
    getValue: () => deck.getState().level,
    setValue: (v) => deck.setLevel(v),
    midi: `d${deckIndex}.level`,
  })

  /* ---------------- 7. Orange JOG 3D Spring-Return Rocker Switch ---------------- */

  const jogCenterX = dx(COL[0] + 17)
  const jogCenterZ = dz(438 + 8.5)

  // Invisible hit plane covering the flush borderless recessed aperture painted into the aluminum plate
  const jogSlotHit = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(34 * UNIT, 17 * UNIT)).rotateX(-Math.PI / 2),
    trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })),
  )
  jogSlotHit.position.set(jogCenterX, TOP_Y + 0.025, jogCenterZ)
  group.add(jogSlotHit)

  const jogMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff5b1c,
      roughness: 0.48,
      metalness: 0.04,
    }),
  )

  // Sub-surface pivot matching docs/references/bc1-angle.jpg: matte satin orange rocker paddle
  // with subtle rounded edges sitting inside the borderless milled cavity.
  const jogPivot = new THREE.Group()
  jogPivot.position.set(jogCenterX, TOP_Y - 0.36, jogCenterZ)
  const jogStickH = 1.32 // extends ~0.96 proud above plate, matching VARISPEED/LEVEL skyline
  const jogCap = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(12.8 * UNIT, jogStickH, 13.4 * UNIT, 3, 0.065)),
    jogMat,
  )
  jogCap.position.y = jogStickH / 2
  jogCap.castShadow = true
  jogCap.receiveShadow = true
  jogPivot.add(jogCap)

  const jogAction = {
    kind: 'jog' as const,
    deckIndex,
    setValue: (v: number) => deck.setJog(v),
    midi: `d${deckIndex}.jog`,
  }
  tagControl(jogPivot, jogAction)
  tagControl(jogSlotHit, jogAction)
  group.add(jogPivot)

  /* ---------------- 8. Detailed Turntable Platter & Hovering Physical CD ---------------- */

  const ttGroup = new THREE.Group()
  ttGroup.position.set(dx(CX), TOP_Y + 0.016, dz(CY))
  group.add(ttGroup)

  const platterR = 35.5 * UNIT // exact radius from PlateArt.tsx (r = 35)
  const platterSpin = new THREE.Group()
  ttGroup.add(platterSpin)

  const ttTex = trackTex(createTurntableTexture())
  const platterSideMat = trackMat(
    new THREE.MeshPhysicalMaterial({ color: 0x26272a, roughness: 0.38, metalness: 0.55 }),
  )
  const platterTopMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      map: ttTex,
      roughness: 0.36,
      metalness: 0.4,
      clearcoat: 0.12,
      clearcoatRoughness: 0.4,
    }),
  )
  const platter = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(platterR, platterR * 1.02, 0.34, 64)),
    [platterSideMat, platterTopMat, platterSideMat],
  )
  platter.position.y = 0.17
  platter.castShadow = true
  platter.receiveShadow = true
  platterSpin.add(platter)

  // Real Red Book 15 mm CD spindle clamp (r = 0.74 = 14.8 mm diameter, matching docs/references/bc1-angle.jpg)
  const spindleR = 0.74
  const spindleMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.36, metalness: 0.38 }),
  )
  const spindle = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(spindleR * 0.94, spindleR, 0.72, 36)),
    spindleMat,
  )
  spindle.position.y = 0.42
  spindle.castShadow = true
  spindle.receiveShadow = true
  platterSpin.add(spindle)

  // Chamfered top crown + recessed dark center bore on the spindle hub
  const spindleCap = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(spindleR * 0.74, spindleR * 0.94, 0.08, 36)),
    spindleMat,
  )
  spindleCap.position.y = 0.82
  spindleCap.castShadow = true
  platterSpin.add(spindleCap)

  const spindleCenter = new THREE.Mesh(
    trackGeo(new THREE.CircleGeometry(spindleR * 0.34, 24)).rotateX(-Math.PI / 2),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.8 })),
  )
  spindleCenter.position.y = 0.865
  platterSpin.add(spindleCenter)

  // 3 stainless steel spring ball-bearing detents gripping the 15 mm CD center hole
  const ballGeo = trackGeo(new THREE.SphereGeometry(0.085, 12, 12))
  const steelMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xdce0e5, metalness: 0.92, roughness: 0.14 }))
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const ball = new THREE.Mesh(ballGeo, steelMat)
    ball.position.set(Math.cos(a) * (spindleR * 0.96), 0.63, Math.sin(a) * (spindleR * 0.96))
    platterSpin.add(ball)
  }

  // Elevated cantilevered open-air CD (~5.6 mm clear above aluminum plate)
  const discGroup = new THREE.Group()
  discGroup.position.y = 0.56
  ttGroup.add(discGroup)

  const discTopMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.02,
      roughness: 0.16,
      metalness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
    }),
  )
  const discTop = new THREE.Mesh(
    trackGeo(new THREE.CircleGeometry(DISC_R, 72)).rotateX(-Math.PI / 2),
    discTopMat,
  )
  discTop.position.y = 0.055
  discTop.castShadow = true
  discTop.receiveShadow = true
  discGroup.add(discTop)

  // The print smeared around the centre, faded in with spin speed: a real disc's
  // print blurs into arcs, where a crisp texture just strobes from frame to frame
  const discBlurMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      roughness: 0.16,
      metalness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
    }),
  )
  const discBlur = new THREE.Mesh(discTop.geometry, discBlurMat)
  discBlur.position.y = 0.057
  discBlur.visible = false
  discGroup.add(discBlur)

  // Clear polycarbonate edge rim
  const discRim = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(DISC_R, DISC_R, 0.11, 72, 1, true)),
    trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0xdce4ee,
        transparent: true,
        opacity: 0.68,
        roughness: 0.06,
        metalness: 0.28,
        clearcoat: 1.0,
      }),
    ),
  )
  discGroup.add(discRim)

  // Mirror-silver polycarbonate data underside (castShadow false to prevent self-shadow fighting with discTop)
  const discBottom = new THREE.Mesh(
    trackGeo(new THREE.RingGeometry(DISC_R * 0.29, DISC_R * 0.996, 72)).rotateX(Math.PI / 2),
    trackMat(new THREE.MeshStandardMaterial({ color: 0xcbd0dc, metalness: 0.92, roughness: 0.14 })),
  )
  discBottom.position.y = -0.055
  discBottom.castShadow = false
  discGroup.add(discBottom)

  const discAction = { kind: 'disc' as const, deckIndex }
  tagControl(platterSpin, discAction)
  tagControl(discGroup, discAction)

  let activeDiscKey = ''
  let activeDiscTex: THREE.CanvasTexture | null = null
  let activeBlurTex: THREE.CanvasTexture | null = null
  let spinAngle = 0
  let spinOmega = 0
  let lastSpinDelta = 0
  let lastDisplayUpdate = 0

  const setPressed = (keyId: string, down: boolean) => {
    const entry = keyGroups.get(keyId)
    if (entry) entry.pressed = down
  }

  const update = (s: DeckState, dt: number, now: number) => {
    const on = s.power === 'on'
    const spinning = on && s.transport === 'playing'

    // Fast CD-like spin (~188 RPM at 100% varispeed, ~0.32s/rev) with smooth motor inertia
    const targetOmega = spinning ? ((Math.PI * 2) / 0.32) * (s.vari / 100) : 0
    const accel = spinning ? 8.5 : 5.5
    spinOmega += (targetOmega - spinOmega) * Math.min(1, dt * accel)
    if (Math.abs(spinOmega) > 0.002) {
      lastSpinDelta = spinOmega * dt
      spinAngle -= lastSpinDelta
      platterSpin.rotation.y = spinAngle
      discGroup.rotation.y = spinAngle
    } else {
      spinOmega = 0
      lastSpinDelta = 0
    }
    const blur = Math.min(1, Math.abs(spinOmega) / ((Math.PI * 2) / 0.32))
    discBlurMat.opacity = blur
    discBlur.visible = blur > 0.01

    if (s.disc) {
      discGroup.visible = true
      const key = `${s.disc.title}|${s.disc.color ?? ''}|${s.disc.tracks.map((t) => `${t.title}:${t.duration}`).join(',')}`
      if (key !== activeDiscKey) {
        activeDiscKey = key
        activeDiscTex?.dispose()
        activeDiscTex = createDiscTexture(s.disc)
        discTopMat.map = activeDiscTex
        discTopMat.needsUpdate = true
        activeBlurTex?.dispose()
        activeBlurTex = createDiscBlurTexture(s.disc)
        discBlurMat.map = activeBlurTex
        discBlurMat.needsUpdate = true
      }
    } else {
      discGroup.visible = false
    }

    pwrNub.position.x += ((s.power !== 'off' ? pwrOnX : pwrOffX) - pwrNub.position.x) * Math.min(1, dt * 20)

    const variT = (s.varispeed - 50) / 100
    variRotor.rotation.y = -THREE.MathUtils.degToRad(-140 + variT * 280)
    const lvlT = s.level / 100
    levelRotor.rotation.y = -THREE.MathUtils.degToRad(-140 + lvlT * 280)

    // 3D spring-return rocker tilt (+/- 22 deg around Z axis)
    const targetJogRotZ = -s.jog * THREE.MathUtils.degToRad(22)
    jogPivot.rotation.z += (targetJogRotZ - jogPivot.rotation.z) * Math.min(1, dt * 26)

    for (const entry of keyGroups.values()) {
      if (entry.axis === 'y') {
        const target = entry.restY - (entry.pressed ? 0.08 : 0)
        entry.group.position.y += (target - entry.group.position.y) * Math.min(1, dt * 34)
      } else if (entry.restZ !== undefined) {
        const target = entry.restZ + (entry.pressed ? 0.08 : 0)
        entry.group.position.z += (target - entry.group.position.z) * Math.min(1, dt * 34)
      }
    }

    const bt = BT_COLOR[on ? s.bt : 'off']
    const btOn = bt.on && (!bt.blink || Math.floor(now / 320) % 2 === 0)
    btLedMat.emissive.setHex(bt.color)
    btLedMat.emissiveIntensity = btOn ? 2.4 : 0
    btLedMat.color.setHex(btOn ? bt.color : 0x4a4a48)

    for (let i = 0; i < 3; i++) {
      const lit = on && !!s.cues[i]
      cueLedMats[i].emissiveIntensity = lit ? 2.4 : 0
      cueLedMats[i].color.setHex(lit ? 0xff4028 : 0x4a4a48)
    }

    if (now - lastDisplayUpdate >= 33) {
      lastDisplayUpdate = now
      displays.update(s, now)
    }
  }

  return {
    group,
    outputJackLocal,
    update,
    getSpinDelta: () => lastSpinDelta,
    setPressed,
    dispose() {
      displays.dispose()
      activeDiscTex?.dispose()
      activeBlurTex?.dispose()
      disposables.forEach((d) => d.dispose())
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      textures.forEach((t) => t.dispose())
    },
  }
}
