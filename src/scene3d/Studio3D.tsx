import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import knobsWoodUrl from '../assets/knobs-wood.jpg'
import type { Deck } from '../engine/deck'
import type { Mixer } from '../engine/mixer'
import { capturePointer } from '../ui/controls'
import { BC1_D, BC1_W, buildBc1, type Bc1Rig } from './buildBc1'
import { buildProp3D, type PropRig3D } from './buildProps3D'
import { SK_D, SK_W, buildSidekick, type SidekickRig } from './buildSidekick'
import type { PlacedProp, PropId } from '../ui/DeskProps'
import {
  createStudioEnvironment,
  createStudioFloorTexture,
  createWoodTablePbrMaps,
} from './materials'
import { createRoundedTopPlane, type ControlAction } from './types'
import { controlIdFor3d, midiLearn } from '../engine/midiLearn'

export type CameraPreset = 'desk' | 'low' | 'top' | 'sidekick'

export interface StudioPatch {
  a: string | null
  b: string | null
}

const GAP = 1.15

function layoutPositions(deckCount: 1 | 2, mixerOn: boolean) {
  const skZ = (BC1_D - SK_D) / 2 // 0 — tops and bottoms sit dead-flush
  if (!mixerOn) {
    return {
      deckX: [0, 26] as [number, number],
      skX: 16,
      skZ,
      rigWidth: BC1_W,
    }
  }
  if (deckCount === 1) {
    const total = BC1_W + GAP + SK_W
    return {
      deckX: [-total / 2 + BC1_W / 2, 26] as [number, number],
      skX: total / 2 - SK_W / 2,
      skZ,
      rigWidth: total,
    }
  }
  const offset = SK_W / 2 + GAP + BC1_W / 2
  return {
    deckX: [-offset, offset] as [number, number],
    skX: 0,
    skZ,
    rigWidth: BC1_W * 2 + SK_W + GAP * 2,
  }
}

/** camera distance that fits the whole rig in a viewport of this aspect */
function fitDistance(deckCount: 1 | 2, mixerOn: boolean, aspect: number) {
  const { rigWidth } = layoutPositions(deckCount, mixerOn)
  const tanHalfV = Math.tan(THREE.MathUtils.degToRad(32) / 2)
  const tanHalfH = tanHalfV * aspect
  // portrait screens only have width to spare, so frame tighter
  const margin = aspect < 1 ? 0.54 : 0.62
  const distForW = (rigWidth * margin) / tanHalfH
  // phones in landscape are short: leave room for the preset bar below the rig
  const distForD = (BC1_D * (aspect > 2 ? 0.8 : 0.62)) / tanHalfV
  return Math.max(distForW, distForD, 36)
}

function presetPose(
  preset: CameraPreset,
  deckCount: 1 | 2,
  mixerOn: boolean,
  aspect: number,
): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const { skX, skZ } = layoutPositions(deckCount, mixerOn)
  const baseDist = fitDistance(deckCount, mixerOn, aspect)
  const portrait = aspect < 1

  if (preset === 'sidekick' && mixerOn) {
    return {
      pos: new THREE.Vector3(skX + 3.2, 30.8, skZ + 23.0),
      target: new THREE.Vector3(skX, 1.0, skZ + 1.5),
    }
  }
  if (preset === 'low') {
    const d = baseDist * 1.0
    return {
      pos: new THREE.Vector3(d * 0.22, d * 0.34, d * 0.9),
      target: new THREE.Vector3(0, 1.0, 0.8),
    }
  }
  if (preset === 'top') {
    const d = baseDist * 1.08
    return {
      pos: new THREE.Vector3(0, d, 0.8),
      target: new THREE.Vector3(0, 0.8, 0),
    }
  }
  // 'desk' hero POV (steeper in portrait so the rig's depth fills more height)
  const d = baseDist * 1.03
  return {
    pos: portrait
      ? new THREE.Vector3(d * 0.08, d * 0.84, d * 0.52)
      : new THREE.Vector3(d * 0.14, d * 0.72, d * 0.68),
    // short landscape screens: nudge the rig up, clear of the preset bar
    target: new THREE.Vector3(0, 0.9, aspect > 2 ? 2.6 : 0.4),
  }
}

interface CableVisual {
  group: THREE.Group
  tube: THREE.Mesh | null
  plugA: THREE.Group
  plugB: THREE.Group
  lastKey: string
}

/**
 * Teenage Engineering slim machined off-white/silver 3.5mm patch plug matching 2D Cable.tsx.
 */
function createTePlugMesh(accentColor: number): THREE.Group {
  const g = new THREE.Group()

  // Thin metallic 3.5mm base collar flush against the jack
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.155, 0.155, 0.12, 18).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xbcbcb8, metalness: 0.82, roughness: 0.25 }),
  )
  collar.position.z = -0.06
  g.add(collar)

  // Slim matte off-white barrel
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.195, 0.195, 0.78, 20).rotateX(Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0xe6e5e0, roughness: 0.42, metalness: 0.05, clearcoat: 0.12 }),
  )
  barrel.position.z = -0.5
  barrel.castShadow = true
  g.add(barrel)

  // Subtle recessed ring accent
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(0.202, 0.202, 0.09, 20).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.4, metalness: 0.08 }),
  )
  ring.position.z = -0.22
  g.add(ring)

  // Tapered light-grey strain relief boot
  const boot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.115, 0.165, 0.42, 16).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xc9c8c3, roughness: 0.58 }),
  )
  boot.position.z = -1.1
  boot.castShadow = true
  g.add(boot)

  return g
}

export function Studio3D({
  decks,
  mixer,
  deckCount,
  mixerOn,
  cables,
  surface = 'wood',
  propsOn = false,
  deskProps = [],
  onUpdateProps,
  onSelectDeck,
  onOpenLid,
}: {
  decks: readonly [Deck, Deck]
  mixer: Mixer | null
  deckCount: 1 | 2
  mixerOn: boolean
  cables: StudioPatch[]
  surface?: 'studio' | 'wood'
  propsOn?: boolean
  deskProps?: PlacedProp[]
  onUpdateProps?: (updater: (cur: PlacedProp[]) => PlacedProp[]) => void
  onSelectDeck: (index: number) => void
  onOpenLid: (index: number) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [preset, setPreset] = useState<CameraPreset>('desk')

  const propsRef = useRef({
    decks,
    mixer,
    deckCount,
    mixerOn,
    cables,
    surface,
    propsOn,
    deskProps,
    onUpdateProps,
    onSelectDeck,
    onOpenLid,
  })
  propsRef.current = {
    decks,
    mixer,
    deckCount,
    mixerOn,
    cables,
    surface,
    propsOn,
    deskProps,
    onUpdateProps,
    onSelectDeck,
    onOpenLid,
  }

  const cameraGoalRef = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const aspectRef = useRef(16 / 9)
  const presetRef = useRef<CameraPreset>('desk')
  presetRef.current = preset
  const applyDepthRef = useRef<() => void>(() => {})

  useEffect(() => {
    const activePreset: CameraPreset = preset === 'sidekick' && !mixerOn ? 'desk' : preset
    if (activePreset !== preset) setPreset(activePreset)
    applyDepthRef.current()
    cameraGoalRef.current = presetPose(activePreset, deckCount, mixerOn, aspectRef.current)
  }, [preset, deckCount, mixerOn])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const width = host.clientWidth || window.innerWidth
    const height = host.clientHeight || window.innerHeight
    aspectRef.current = width / Math.max(1, height)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#dfdcd4')
    scene.fog = new THREE.Fog('#dfdcd4', 95, 220)

    const camera = new THREE.PerspectiveCamera(32, aspectRef.current, 2.0, 180)
    // far plane, fog and zoom-out limit follow the fit distance so narrow screens still see the rig
    const applyDepth = () => {
      const base = fitDistance(propsRef.current.deckCount, propsRef.current.mixerOn, aspectRef.current)
      camera.far = Math.max(180, base + 170)
      camera.updateProjectionMatrix()
      const fog = scene.fog as THREE.Fog
      fog.near = Math.max(95, base + 37)
      fog.far = Math.max(220, base + 162)
      controls.maxDistance = Math.max(95, base * 1.4)
    }
    const initPose = presetPose('desk', propsRef.current.deckCount, propsRef.current.mixerOn, aspectRef.current)
    camera.position.copy(initPose.pos)

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.touchAction = 'none'
    host.appendChild(renderer.domElement)

    // Dual studio environments (pale studio paper vs warm Knobs walnut workbench bounce)
    const studioEnv = createStudioEnvironment(renderer, 'studio')
    const woodEnv = createStudioEnvironment(renderer, 'wood')

    // Sculpted directional studio lighting (warm softbox key + cool subtle rim)
    const hemi = new THREE.HemisphereLight(0xfdfbf7, 0xbdb7ab, 0.36)
    scene.add(hemi)

    const keyLight = new THREE.DirectionalLight(0xfffaf0, 1.55)
    keyLight.position.set(-22, 34, 20)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(4096, 4096)
    keyLight.shadow.camera.near = 8
    keyLight.shadow.camera.far = 112
    keyLight.shadow.camera.left = -44
    keyLight.shadow.camera.right = 44
    keyLight.shadow.camera.top = 30
    keyLight.shadow.camera.bottom = -30
    keyLight.shadow.bias = -0.00045
    keyLight.shadow.normalBias = 0.028
    keyLight.shadow.radius = 3.0
    scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight(0xdbe6f8, 0.42)
    fillLight.position.set(26, 16, -18)
    scene.add(fillLight)

    // 1. Seamless pale studio cyclorama floor & far surround ring
    const floorTex = createStudioFloorTexture()
    const studioFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: 0.92,
        metalness: 0,
        envMapIntensity: 0.18,
      }),
    )
    studioFloor.receiveShadow = true
    scene.add(studioFloor)

    // matte surround in the floor's edge tone, so zoomed-out studio views never show its border
    const surround = new THREE.Mesh(
      new THREE.RingGeometry(150, 900, 4, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 4),
      new THREE.MeshStandardMaterial({ color: '#d8d4cb', roughness: 0.92, metalness: 0, envMapIntensity: 0.18 }),
    )
    surround.position.y = -0.02
    scene.add(surround)

    // 2. Physical 3D solid-timber Knobs studio workbench table (top flush at y = 0, exact 16:9 grain aspect)
    const woodMaps = createWoodTablePbrMaps(knobsWoodUrl)
    const woodTableGroup = new THREE.Group()
    woodTableGroup.name = 'knobs-wood-table'

    const TABLE_W = 128
    const TABLE_D = 72
    const TABLE_H = 3.6

    // Thick solid oiled walnut/oak timber slab body with natural un-squished horizontal edge grain
    const slabEdgeMat = new THREE.MeshStandardMaterial({
      color: 0xa4927f,
      map: woodMaps.edgeMap,
      roughness: 0.84,
      metalness: 0.0,
      envMapIntensity: 0.16,
    })
    const slabBody = new THREE.Mesh(
      new RoundedBoxGeometry(TABLE_W, TABLE_H, TABLE_D, 4, 0.24),
      slabEdgeMat,
    )
    slabBody.position.set(0, -TABLE_H / 2 - 0.015, 0)
    slabBody.castShadow = true
    slabBody.receiveShadow = true
    woodTableGroup.add(slabBody)

    // Real PBR top wood grain surface (derived normal + roughness maps catch raking studio light)
    const slabTopMat = new THREE.MeshStandardMaterial({
      color: 0xcdc0b2,
      map: woodMaps.map,
      normalMap: woodMaps.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: woodMaps.roughnessMap,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0.2,
    })
    const slabTop = new THREE.Mesh(
      createRoundedTopPlane(TABLE_W - 0.34, TABLE_D - 0.34, 0.22, 8),
      slabTopMat,
    )
    slabTop.position.set(0, 0.001, 0)
    slabTop.receiveShadow = true
    woodTableGroup.add(slabTop)

    // Recessed matte powder-coated black steel studio desk apron & legs beneath the timber slab
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x191817, roughness: 0.68, metalness: 0.35 })
    const apron = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W - 12, 2.4, TABLE_D - 12), steelMat)
    apron.position.set(0, -TABLE_H - 1.2, 0)
    woodTableGroup.add(apron)

    const legGeo = new THREE.BoxGeometry(2.0, 28, 2.0)
    for (const lx of [-(TABLE_W / 2 - 8), TABLE_W / 2 - 8]) {
      for (const lz of [-(TABLE_D / 2 - 8), TABLE_D / 2 - 8]) {
        const leg = new THREE.Mesh(legGeo, steelMat)
        leg.position.set(lx, -TABLE_H - 14, lz)
        woodTableGroup.add(leg)
      }
    }
    scene.add(woodTableGroup)

    // Apply active surface theme (studio vs wood) dynamically without tearing down WebGL
    let appliedSurface: 'studio' | 'wood' | null = null
    const applySurface = (mode: 'studio' | 'wood') => {
      if (mode === appliedSurface) return
      appliedSurface = mode
      const isWood = mode === 'wood'
      studioFloor.visible = !isWood
      surround.visible = !isWood
      woodTableGroup.visible = isWood
      scene.environment = isWood ? woodEnv.texture : studioEnv.texture
      scene.environmentIntensity = isWood ? 0.92 : 0.88
      const bgHex = isWood ? 0x1e1a16 : 0xdfdcd4
      scene.background = new THREE.Color(bgHex)
      scene.fog = new THREE.Fog(bgHex, isWood ? 88 : 95, isWood ? 195 : 220)
      hemi.color.setHex(isWood ? 0xfff8ee : 0xfdfbf7)
      hemi.groundColor.setHex(isWood ? 0x735d49 : 0xbdb7ab)
      hemi.intensity = isWood ? 0.42 : 0.36
      keyLight.color.setHex(isWood ? 0xfff4e2 : 0xfffaf0)
      keyLight.intensity = isWood ? 1.65 : 1.55
      fillLight.intensity = isWood ? 0.46 : 0.42
    }
    applySurface(propsRef.current.surface)

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(initPose.target)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minPolarAngle = 0.02
    controls.maxPolarAngle = Math.PI * 0.455
    controls.minDistance = 12
    controls.maxDistance = 95
    controls.panSpeed = 0.85
    controls.rotateSpeed = 0.75
    applyDepth()
    applyDepthRef.current = applyDepth
    controls.update()

    const cancelGoal = () => {
      cameraGoalRef.current = null
    }
    controls.addEventListener('start', cancelGoal)

    // Build both BC-1 decks
    const bc1Rigs: [Bc1Rig, Bc1Rig] = [
      buildBc1(propsRef.current.decks[0], 0),
      buildBc1(propsRef.current.decks[1], 1),
    ]
    const initLayout = layoutPositions(propsRef.current.deckCount, propsRef.current.mixerOn)
    bc1Rigs[0].group.position.set(initLayout.deckX[0], 0, 0)
    bc1Rigs[1].group.position.set(initLayout.deckX[1], 0, 0)
    bc1Rigs[1].group.visible = propsRef.current.deckCount === 2
    scene.add(bc1Rigs[0].group, bc1Rigs[1].group)

    // Lazily build Sidekick
    let sidekickRig: SidekickRig | null = null
    const ensureSidekick = () => {
      const m = propsRef.current.mixer
      if (sidekickRig || !m) return sidekickRig
      sidekickRig = buildSidekick(m)
      const pos = layoutPositions(propsRef.current.deckCount, propsRef.current.mixerOn)
      sidekickRig.group.position.set(pos.skX, 0, pos.skZ)
      scene.add(sidekickRig.group)
      return sidekickRig
    }
    if (propsRef.current.mixerOn) ensureSidekick()

    // Iconic TE off-white / light-grey 3.5mm arching patch cables (matching 2D .cable-body)
    const cableMat = new THREE.MeshPhysicalMaterial({
      color: 0xe6e5e0,
      roughness: 0.46,
      metalness: 0.04,
      clearcoat: 0.12,
      clearcoatRoughness: 0.48,
    })
    const cableVisuals: CableVisual[] = [0, 1].map((i) => {
      const group = new THREE.Group()
      const accent = i === 0 ? 0xff5a1f : 0x6c6d70
      const plugA = createTePlugMesh(accent)
      const plugB = createTePlugMesh(accent)
      group.add(plugA, plugB)
      group.visible = false
      scene.add(group)
      return { group, tube: null, plugA, plugB, lastKey: '' }
    })

    const updateCables = () => {
      const { mixerOn: mOn, deckCount: dc, cables: patches } = propsRef.current
      const sk = sidekickRig
      for (let i = 0; i < 2; i++) {
        const cv = cableVisuals[i]
        const patch = patches[i]
        const jackKey = patch?.b as 'sk-aux' | 'sk-ch1' | 'sk-ch2' | null
        if (!mOn || !sk || i >= dc || !patch?.a || !jackKey || !(jackKey in sk.jacksLocal)) {
          cv.group.visible = false
          continue
        }
        cv.group.visible = true
        const pA = bc1Rigs[i].outputJackLocal.clone().add(bc1Rigs[i].group.position)
        const pB = sk.jacksLocal[jackKey].clone().add(sk.group.position)

        const key = `${pA.x.toFixed(2)},${pA.z.toFixed(2)}|${pB.x.toFixed(2)},${pB.z.toFixed(2)}`
        if (key === cv.lastKey) continue
        cv.lastKey = key

        cv.plugA.position.copy(pA)
        cv.plugB.position.copy(pB)

        const start = pA.clone().add(new THREE.Vector3(0, 0, -1.28))
        const end = pB.clone().add(new THREE.Vector3(0, 0, -1.28))
        const span = Math.abs(end.x - start.x)
        const reachZ = 2.4 + Math.min(4.6, span * 0.24) + i * 0.65
        // Gentle natural gravity drape resting slightly above the studio desk
        const archY = 0.65 + Math.min(1.4, span * 0.04) + i * 0.28

        const c1 = new THREE.Vector3(start.x, archY, start.z - reachZ)
        const c2 = new THREE.Vector3(end.x, archY, end.z - reachZ)
        const curve = new THREE.CubicBezierCurve3(start, c1, c2, end)

        if (cv.tube) {
          cv.tube.geometry.dispose()
          cv.group.remove(cv.tube)
        }
        const tubeGeo = new THREE.TubeGeometry(curve, 52, 0.105, 12, false)
        const tube = new THREE.Mesh(tubeGeo, cableMat)
        tube.castShadow = true
        tube.receiveShadow = true
        cv.tube = tube
        cv.group.add(tube)
      }
    }

    /* ---------------- 3D Desk Props (real-world scale on the walnut table) ---------------- */

    const propsGroup = new THREE.Group()
    propsGroup.name = 'desk-props-3d'
    scene.add(propsGroup)

    const DISC_CX_LOCAL = (236.5 - 185) * (12 / 246) // +2.5122
    const DISC_CZ_LOCAL = (177 - 255.5) * (12 / 246) // -3.8293
    const DISC_R_WORLD = 6.0
    const DISC_TOP_Y = 2.345

    interface PropLive3D {
      rig: PropRig3D
      x: number
      z: number
      rot: number
      liftY: number
      curY: number
      dirty: boolean
    }
    const propRigs = new Map<PropId, PropLive3D>()

    const surfaceYAt = (x: number, z: number): number => {
      const { decks: curDecks, deckCount: dc, mixerOn: mOn } = propsRef.current
      for (let i = 0; i < dc; i++) {
        const deckX = bc1Rigs[i].group.position.x
        const s = curDecks[i].getState()
        if (s.disc) {
          const cx = deckX + DISC_CX_LOCAL
          const cz = DISC_CZ_LOCAL
          if (Math.hypot(x - cx, z - cz) <= DISC_R_WORLD * 0.96) return DISC_TOP_Y
        }
        if (Math.abs(x - deckX) <= BC1_W * 0.5 && Math.abs(z) <= BC1_D * 0.5) return 1.715
      }
      if (mOn && sidekickRig && sidekickRig.group.visible) {
        const sx = sidekickRig.group.position.x
        const sz = sidekickRig.group.position.z
        if (Math.abs(x - sx) <= SK_W * 0.5 && Math.abs(z - sz) <= SK_D * 0.5) {
          return z - sz < -4.2 ? 1.96 : 1.72
        }
      }
      return 0
    }

    const rollDieFace = (id: PropId, avoid: number): number => {
      const max = id === 'die' ? 6 : 20
      let v = 1 + Math.floor(Math.random() * max)
      if (v === avoid) v = (v % max) + 1
      return v
    }

    const persistProp = (id: PropId, patch: Partial<Pick<PlacedProp, 'x3d' | 'z3d' | 'rot' | 'face'>>) => {
      propsRef.current.onUpdateProps?.((cur) =>
        cur.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      )
    }

    const clampTable = (x: number, z: number): [number, number] => [
      Math.max(-58, Math.min(58, x)),
      Math.max(-32, Math.min(32, z)),
    ]

    const launchDieRoll3D = (id: PropId, onDrop: boolean) => {
      const live = propRigs.get(id)
      if (!live || !live.rig.isDie) return
      const nextFace = rollDieFace(id, live.rig.face)
      const dir = Math.random() > 0.5 ? 1 : -1
      const rotDelta = onDrop
        ? dir * (18 + Math.round(Math.random() * 44))
        : dir * (35 + Math.round(Math.random() * 110))
      live.rot += rotDelta
      live.rig.root.rotation.y = THREE.MathUtils.degToRad(-live.rot)
      live.rig.roll(nextFace, onDrop, (dx, dz) => {
        const [nx, nz] = clampTable(live.x + dx, live.z + dz)
        live.x = nx
        live.z = nz
        live.curY = surfaceYAt(nx, nz)
        live.rig.root.position.set(nx, live.curY, nz)
        live.dirty = true
      })
      persistProp(id, { x3d: live.x, z3d: live.z, rot: live.rot, face: nextFace })
    }

    /* ---------------- Unified Raycast Pointer Interaction ---------------- */

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const planeHit = new THREE.Vector3()

    type PickResult =
      | { kind: 'control'; ctrl: ControlAction; hit: THREE.Intersection }
      | { kind: 'prop'; id: PropId; hit: THREE.Intersection }

    const pickScene = (clientX: number, clientY: number): PickResult | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const targets: THREE.Object3D[] = [bc1Rigs[0].group]
      if (bc1Rigs[1].group.visible) targets.push(bc1Rigs[1].group)
      if (sidekickRig && sidekickRig.group.visible) targets.push(sidekickRig.group)
      if (propsRef.current.propsOn && propsGroup.visible) targets.push(propsGroup)
      const hits = raycaster.intersectObjects(targets, true)
      for (const hit of hits) {
        const propId = hit.object.userData?.propId as PropId | undefined
        if (propId) return { kind: 'prop', id: propId, hit }
        const ctrl = hit.object.userData?.control as ControlAction | undefined
        if (ctrl) return { kind: 'control', ctrl, hit }
      }
      return null
    }

    const intersectDragPlane = (clientX: number, clientY: number, y: number): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      dragPlane.constant = -y
      return raycaster.ray.intersectPlane(dragPlane, planeHit)
    }

    type DragState =
      | { kind: 'button'; action: Extract<ControlAction, { kind: 'button' }>; deckIndex?: number }
      | { kind: 'knob'; action: Extract<ControlAction, { kind: 'knob' }>; startY: number; startVal: number; moved: boolean }
      | { kind: 'fader'; action: Extract<ControlAction, { kind: 'fader' }>; startY: number; startVal: number }
      | { kind: 'jog'; action: Extract<ControlAction, { kind: 'jog' }>; startX: number }
      | { kind: 'pad'; action: Extract<ControlAction, { kind: 'pad' }>; startX: number; startY: number; lock: boolean }
      | {
          kind: 'prop'
          id: PropId
          startClientX: number
          startClientY: number
          planeY: number
          offsetX: number
          offsetZ: number
          moved: boolean
        }

    let activeDrag: DragState | null = null
    let lastTapKnob: { action: ControlAction; time: number } | null = null

    const setPressedVisual = (keyId: string, deckIndex: number | undefined, down: boolean) => {
      if (deckIndex !== undefined) bc1Rigs[deckIndex].setPressed(keyId, down)
      else sidekickRig?.setPressed(keyId, down)
    }

    const isHandPointer = (e: PointerEvent) => e.pointerId === 101 || e.pointerId === 102

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return
      const picked = pickScene(e.clientX, e.clientY)
      if (!picked) {
        // Prevent hand-tracking pinches from accidentally orbiting or panning the 3D camera
        if (isHandPointer(e)) {
          e.stopPropagation()
          e.preventDefault()
        }
        return
      }

      if (picked.kind === 'prop') {
        if (e.button !== 0) return
        if (midiLearn.getState().learning) return
        const live = propRigs.get(picked.id)
        if (!live) return
        controls.enabled = false
        capturePointer(renderer.domElement, e.pointerId)
        e.stopPropagation()
        const planeY = live.curY
        const hitPt = intersectDragPlane(e.clientX, e.clientY, planeY)
        const offsetX = hitPt ? live.x - hitPt.x : 0
        const offsetZ = hitPt ? live.z - hitPt.z : 0
        activeDrag = {
          kind: 'prop',
          id: picked.id,
          startClientX: e.clientX,
          startClientY: e.clientY,
          planeY,
          offsetX,
          offsetZ,
          moved: false,
        }
        renderer.domElement.style.cursor = 'grabbing'
        return
      }

      const { ctrl, hit } = picked
      if (e.button === 2 && ctrl.kind !== 'pad') return

      // MIDI learn: a click picks the control instead of working it
      if (midiLearn.getState().learning) {
        e.stopPropagation()
        e.preventDefault()
        midiLearn.selectTarget(ctrl.midi ?? (ctrl.kind === 'button' ? controlIdFor3d(ctrl.keyId, ctrl.deckIndex) : null))
        return
      }

      controls.enabled = false
      capturePointer(renderer.domElement, e.pointerId)
      e.stopPropagation()

      if ('deckIndex' in ctrl && ctrl.deckIndex !== undefined) {
        propsRef.current.onSelectDeck(ctrl.deckIndex)
      }

      if (ctrl.kind === 'button') {
        setPressedVisual(ctrl.keyId, ctrl.deckIndex, true)
        ctrl.onDown()
        activeDrag = { kind: 'button', action: ctrl, deckIndex: ctrl.deckIndex }
      } else if (ctrl.kind === 'toggle') {
        ctrl.onToggle()
      } else if (ctrl.kind === 'disc') {
        propsRef.current.onOpenLid(ctrl.deckIndex)
      } else if (ctrl.kind === 'oled') {
        if (hit.uv) ctrl.onClickUv(hit.uv.x, hit.uv.y)
      } else if (ctrl.kind === 'knob') {
        if (ctrl.disabled?.()) return
        const now = performance.now()
        if (lastTapKnob && lastTapKnob.action === ctrl && now - lastTapKnob.time < 320 && ctrl.onReset) {
          ctrl.onReset()
          lastTapKnob = null
          return
        }
        lastTapKnob = { action: ctrl, time: now }
        activeDrag = { kind: 'knob', action: ctrl, startY: e.clientY, startVal: ctrl.getValue(), moved: false }
      } else if (ctrl.kind === 'fader') {
        activeDrag = { kind: 'fader', action: ctrl, startY: e.clientY, startVal: ctrl.getValue() }
      } else if (ctrl.kind === 'jog') {
        activeDrag = { kind: 'jog', action: ctrl, startX: e.clientX }
      } else if (ctrl.kind === 'pad') {
        const lock = e.button === 2
        activeDrag = { kind: 'pad', action: ctrl, startX: e.clientX, startY: e.clientY, lock }
        ctrl.setMod(0, 0.6)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!activeDrag) {
        const picked = pickScene(e.clientX, e.clientY)
        if (!picked) {
          renderer.domElement.title = ''
          renderer.domElement.style.cursor = 'grab'
          return
        }
        if (picked.kind === 'prop') {
          const isDie = picked.id === 'die' || picked.id === 'd20'
          renderer.domElement.title = isDie
            ? 'click to roll · drag to move · scroll to rotate'
            : 'drag to move · scroll to rotate'
          renderer.domElement.style.cursor = 'grab'
          return
        }
        const blocked = picked.ctrl.kind === 'knob' ? picked.ctrl.disabled?.() : null
        renderer.domElement.title = blocked ?? ''
        if (blocked) {
          renderer.domElement.style.cursor = 'not-allowed'
        } else {
          const k = picked.ctrl.kind
          renderer.domElement.style.cursor =
            k === 'knob' || k === 'fader' ? 'ns-resize' : k === 'jog' ? 'ew-resize' : k === 'pad' ? 'crosshair' : 'pointer'
        }
        return
      }

      if (activeDrag.kind === 'prop') {
        if (!activeDrag.moved && Math.hypot(e.clientX - activeDrag.startClientX, e.clientY - activeDrag.startClientY) > 4) {
          activeDrag.moved = true
        }
        if (!activeDrag.moved) return
        const live = propRigs.get(activeDrag.id)
        if (!live) return
        const hitPt = intersectDragPlane(e.clientX, e.clientY, activeDrag.planeY)
        if (!hitPt) return
        const [nx, nz] = clampTable(hitPt.x + activeDrag.offsetX, hitPt.z + activeDrag.offsetZ)
        live.x = nx
        live.z = nz
        live.curY = surfaceYAt(nx, nz)
        return
      }

      if (activeDrag.kind === 'knob') {
        const dy = activeDrag.startY - e.clientY
        if (!activeDrag.action.onTap || Math.abs(dy) > 3) activeDrag.moved = true
        if (!activeDrag.moved) return
        const { min, max } = activeDrag.action
        const sens = e.shiftKey ? 0.1 : 0.55
        const next = Math.min(max, Math.max(min, activeDrag.startVal + dy * sens * ((max - min) / 100)))
        activeDrag.action.setValue(next)
      } else if (activeDrag.kind === 'fader') {
        const dy = activeDrag.startY - e.clientY
        const next = Math.min(1, Math.max(0, activeDrag.startVal + dy / 130))
        activeDrag.action.setValue(next)
      } else if (activeDrag.kind === 'jog') {
        const dx = e.clientX - activeDrag.startX
        const v = Math.max(-1, Math.min(1, dx / 48))
        activeDrag.action.setValue(v)
      } else if (activeDrag.kind === 'pad') {
        const stick = Math.max(-1, Math.min(1, (e.clientX - activeDrag.startX) / 60))
        const pad = Math.max(0.05, Math.min(1, 0.6 + (activeDrag.startY - e.clientY) / 80))
        activeDrag.action.setMod(stick, pad)
      }
    }

    const endDrag = (e?: PointerEvent) => {
      if (activeDrag) {
        if (activeDrag.kind === 'prop') {
          const live = propRigs.get(activeDrag.id)
          if (live) {
            if (!activeDrag.moved) {
              if (live.rig.isDie) launchDieRoll3D(activeDrag.id, false)
            } else if (live.rig.isDie) {
              launchDieRoll3D(activeDrag.id, true)
            } else {
              const nudge = Math.round((Math.random() - 0.5) * 12)
              live.rot += nudge
              live.rig.settle()
              persistProp(activeDrag.id, { x3d: live.x, z3d: live.z, rot: live.rot })
            }
          }
          renderer.domElement.style.cursor = 'grab'
        } else if (activeDrag.kind === 'button') {
          setPressedVisual(activeDrag.action.keyId, activeDrag.deckIndex, false)
          activeDrag.action.onUp?.()
        } else if (activeDrag.kind === 'knob') {
          if (!activeDrag.moved) activeDrag.action.onTap?.()
        } else if (activeDrag.kind === 'jog') {
          activeDrag.action.setValue(0)
        } else if (activeDrag.kind === 'pad') {
          activeDrag.action.setMod(0, 0, activeDrag.lock)
        }
        activeDrag = null
      }
      if (e) {
        try {
          if (renderer.domElement.hasPointerCapture(e.pointerId)) {
            renderer.domElement.releasePointerCapture(e.pointerId)
          }
        } catch {
          /* synthetic hand-tracking pointer */
        }
      }
      controls.enabled = true
    }

    const onWheel = (e: WheelEvent) => {
      const picked = pickScene(e.clientX, e.clientY)
      if (!picked) return
      if (picked.kind === 'prop') {
        e.preventDefault()
        e.stopPropagation()
        const live = propRigs.get(picked.id)
        if (!live) return
        const step = e.shiftKey ? 5 : 15
        live.rot += e.deltaY > 0 ? step : -step
        live.rig.root.rotation.y = THREE.MathUtils.degToRad(-live.rot)
        persistProp(picked.id, { rot: live.rot })
        return
      }
      if (picked.ctrl.kind === 'oled') {
        e.preventDefault()
        e.stopPropagation()
        picked.ctrl.onWheel(e.deltaY)
      }
    }

    const onContextMenu = (e: MouseEvent) => {
      const picked = pickScene(e.clientX, e.clientY)
      if (picked && picked.kind === 'control' && picked.ctrl.kind === 'pad') e.preventDefault()
    }

    const dom = renderer.domElement
    // Protect both our handlers and Three.js OrbitControls from throwing on synthetic
    // hand-tracking PointerEvents (whose pointerId is not a browser-registered active pointer).
    const origSetCapture = dom.setPointerCapture.bind(dom)
    const origReleaseCapture = dom.releasePointerCapture.bind(dom)
    dom.setPointerCapture = (id: number) => {
      try {
        origSetCapture(id)
      } catch {
        /* synthetic pointer */
      }
    }
    dom.releasePointerCapture = (id: number) => {
      try {
        if (dom.hasPointerCapture(id)) origReleaseCapture(id)
      } catch {
        /* synthetic pointer */
      }
    }
    dom.addEventListener('pointerdown', onPointerDown, true)
    dom.addEventListener('pointermove', onPointerMove)
    dom.addEventListener('pointerup', endDrag)
    dom.addEventListener('pointercancel', endDrag)
    dom.addEventListener('wheel', onWheel, { passive: false, capture: true })
    dom.addEventListener('contextmenu', onContextMenu)

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth || window.innerWidth
      const h = host.clientHeight || window.innerHeight
      const prev = aspectRef.current
      aspectRef.current = w / Math.max(1, h)
      camera.aspect = aspectRef.current
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      applyDepth()
      // reframe after a rotation or big resize
      if (Math.abs(Math.log(aspectRef.current / prev)) > 0.15) {
        cameraGoalRef.current = presetPose(presetRef.current, propsRef.current.deckCount, propsRef.current.mixerOn, aspectRef.current)
      }
    })
    ro.observe(host)

    let lastDeskPropsRef: PlacedProp[] | null = null
    let cdFlushAccum = 0

    const updateProps3D = (dt: number) => {
      const { propsOn: pOn, deskProps: items, decks: curDecks, deckCount: dc } = propsRef.current
      propsGroup.visible = pOn
      if (!pOn) return

      const propsChanged = items !== lastDeskPropsRef
      if (propsChanged) {
        lastDeskPropsRef = items
        const keepIds = new Set(items.map((p) => p.id))
        for (const [id, live] of propRigs) {
          if (!keepIds.has(id)) {
            propsGroup.remove(live.rig.root)
            live.rig.dispose()
            propRigs.delete(id)
          }
        }
        for (const p of items) {
          let live = propRigs.get(p.id)
          const tx = p.x3d ?? 0
          const tz = p.z3d ?? 16
          if (!live) {
            const rig = buildProp3D(p.id, p.face ?? 1)
            const curY = surfaceYAt(tx, tz)
            rig.root.position.set(tx, curY, tz)
            rig.root.rotation.y = THREE.MathUtils.degToRad(-p.rot)
            propsGroup.add(rig.root)
            live = { rig, x: tx, z: tz, rot: p.rot, liftY: 0, curY, dirty: false }
            propRigs.set(p.id, live)
          } else {
            const isDragging = activeDrag?.kind === 'prop' && activeDrag.id === p.id
            if (!isDragging && !live.dirty) {
              live.x = tx
              live.z = tz
              live.rot = p.rot
              live.rig.setFace(p.face ?? 1)
            }
          }
        }
      }

      // Active spinning CDs for the 3D disc-riding Easter egg — locked 1:1 to live CD motor inertia!
      const spinners: { cx: number; cz: number; dRad: number }[] = []
      for (let i = 0; i < dc; i++) {
        const s = curDecks[i].getState()
        const dRad = bc1Rigs[i].getSpinDelta()
        if (s.disc && Math.abs(dRad) > 1e-6) {
          spinners.push({
            cx: bc1Rigs[i].group.position.x + DISC_CX_LOCAL,
            cz: DISC_CZ_LOCAL,
            dRad,
          })
        }
      }

      let anyAnimatingOrSpinning = false
      let anyDirty = false
      const liftLerp = Math.min(1, dt * 18)

      for (const [id, live] of propRigs) {
        const draggingThis = activeDrag?.kind === 'prop' && activeDrag.id === id && activeDrag.moved
        const animActive = live.rig.update(dt)
        if (animActive) anyAnimatingOrSpinning = true

        // Ride spinning CD rigidly in 3D (matches discGroup.rotation.y -= spinOmega * dt)
        if (!draggingThis && spinners.length) {
          for (const sp of spinners) {
            const dx = live.x - sp.cx
            const dz = live.z - sp.cz
            if (Math.hypot(dx, dz) <= DISC_R_WORLD * 0.96) {
              const cos = Math.cos(sp.dRad)
              const sin = Math.sin(sp.dRad)
              live.x = sp.cx + dx * cos - dz * sin
              live.z = sp.cz + dx * sin + dz * cos
              live.rot += THREE.MathUtils.radToDeg(sp.dRad)
              live.dirty = true
              anyAnimatingOrSpinning = true
              break
            }
          }
        }

        const targetLift = draggingThis ? 1.55 : 0
        live.liftY += (targetLift - live.liftY) * liftLerp
        const targetTilt = draggingThis ? 0.08 : 0
        live.rig.body.rotation.x += (targetTilt - live.rig.body.rotation.x) * liftLerp

        const baseY = surfaceYAt(live.x, live.z)
        live.curY += (baseY - live.curY) * Math.min(1, dt * 22)
        live.rig.root.position.set(live.x, live.curY + live.liftY, live.z)
        live.rig.root.rotation.y = THREE.MathUtils.degToRad(-live.rot)

        if (live.dirty) anyDirty = true
      }

      // Periodically flush dirty positions (after roll skids or CD riding stops) back to persisted state
      if (anyDirty && !anyAnimatingOrSpinning) {
        cdFlushAccum += dt
        if (cdFlushAccum > 0.12) {
          cdFlushAccum = 0
          const updates = new Map<PropId, { x3d: number; z3d: number; rot: number }>()
          for (const [id, live] of propRigs) {
            if (live.dirty) {
              live.dirty = false
              updates.set(id, { x3d: live.x, z3d: live.z, rot: live.rot })
            }
          }
          if (updates.size) {
            propsRef.current.onUpdateProps?.((cur) =>
              cur.map((p) => {
                const u = updates.get(p.id)
                return u ? { ...p, ...u } : p
              }),
            )
          }
        }
      }
    }

    let raf = 0
    let lastTime = performance.now()

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      const { decks: curDecks, mixer: curMixer, deckCount: dc, mixerOn: mOn, surface: curSurface } = propsRef.current
      applySurface(curSurface)

      const lp = layoutPositions(dc, mOn)
      const posLerp = Math.min(1, dt * 10)
      bc1Rigs[0].group.position.x += (lp.deckX[0] - bc1Rigs[0].group.position.x) * posLerp
      bc1Rigs[1].group.visible = dc === 2
      if (dc === 2) {
        bc1Rigs[1].group.position.x += (lp.deckX[1] - bc1Rigs[1].group.position.x) * posLerp
      }

      if (mOn) {
        const sk = ensureSidekick()
        if (sk && curMixer) {
          sk.group.visible = true
          sk.group.position.x += (lp.skX - sk.group.position.x) * posLerp
          sk.group.position.z = lp.skZ
          sk.update(curMixer.getState(), dt, now)
        }
      } else if (sidekickRig) {
        sidekickRig.group.visible = false
      }

      bc1Rigs[0].update(curDecks[0].getState(), dt, now)
      if (dc === 2) bc1Rigs[1].update(curDecks[1].getState(), dt, now)

      updateCables()
      updateProps3D(dt)

      if (cameraGoalRef.current) {
        const camLerp = Math.min(1, dt * 6.5)
        camera.position.lerp(cameraGoalRef.current.pos, camLerp)
        controls.target.lerp(cameraGoalRef.current.target, camLerp)
        if (
          camera.position.distanceTo(cameraGoalRef.current.pos) < 0.04 &&
          controls.target.distanceTo(cameraGoalRef.current.target) < 0.04
        ) {
          cameraGoalRef.current = null
        }
      }

      controls.update()
      renderer.render(scene, camera)
    }

    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.removeEventListener('start', cancelGoal)
      controls.dispose()
      dom.removeEventListener('pointerdown', onPointerDown, true)
      dom.removeEventListener('pointermove', onPointerMove)
      dom.removeEventListener('pointerup', endDrag)
      dom.removeEventListener('pointercancel', endDrag)
      dom.removeEventListener('wheel', onWheel, true)
      dom.removeEventListener('contextmenu', onContextMenu)
      bc1Rigs[0].dispose()
      bc1Rigs[1].dispose()
      sidekickRig?.dispose()
      for (const live of propRigs.values()) live.rig.dispose()
      propRigs.clear()
      cableVisuals.forEach((cv) => cv.tube?.geometry.dispose())
      cableMat.dispose()
      floorTex.dispose()
      woodMaps.dispose()
      slabEdgeMat.dispose()
      slabTopMat.dispose()
      steelMat.dispose()
      studioEnv.dispose()
      woodEnv.dispose()
      renderer.dispose()
      dom.remove()
    }
  }, [])

  const presets: { id: CameraPreset; label: string }[] = mixerOn
    ? [
        { id: 'desk', label: 'desk' },
        { id: 'low', label: 'low' },
        { id: 'top', label: 'top' },
        { id: 'sidekick', label: 'mixer' },
      ]
    : [
        { id: 'desk', label: 'desk' },
        { id: 'low', label: 'low' },
        { id: 'top', label: 'top' },
      ]

  return (
    <div className={`studio3d ${surface === 'wood' ? 'is-wood' : ''}`}>
      <div className="studio3d-canvas" ref={hostRef} />
      <div className="cam-bar" role="group" aria-label="camera angles">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={preset === p.id ? 'on' : ''}
            onClick={() => {
              setPreset(p.id)
              cameraGoalRef.current = presetPose(p.id, deckCount, mixerOn, aspectRef.current)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
