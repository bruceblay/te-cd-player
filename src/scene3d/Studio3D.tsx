import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import knobsWoodUrl from '../assets/knobs-wood.jpg'
import type { Deck } from '../engine/deck'
import type { Mixer } from '../engine/mixer'
import { capturePointer } from '../ui/controls'
import { BC1_D, BC1_W, buildBc1, type Bc1Rig } from './buildBc1'
import { COASTER_H, PROP_FOOTPRINT_3D, buildProp3D, type PropRig3D } from './buildProps3D'
import { SK_D, SK_W, buildSidekick, type SidekickRig } from './buildSidekick'
import { buildStudioRoom } from './buildStudioRoom'
import { IS_PHONE } from '../ui/phone'
import { track } from '../analytics'
import { bootFrameDrawn, bootWith3DTextures } from '../ui/boot'
import { addHandTargets, type HandTarget } from '../ui/handTargets'
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

    const camera = new THREE.PerspectiveCamera(32, aspectRef.current, 2.0, 420)
    // far plane, fog and zoom-out limit follow the fit distance so narrow screens still see the rig
    const applyDepth = () => {
      const base = fitDistance(propsRef.current.deckCount, propsRef.current.mixerOn, aspectRef.current)
      const isWood = propsRef.current.surface === 'wood'
      camera.far = Math.max(isWood ? 440 : 180, base + 260)
      camera.updateProjectionMatrix()
      const fog = scene.fog as THREE.Fog
      if (isWood) {
        fog.near = Math.max(175, base + 95)
        fog.far = Math.max(410, base + 300)
      } else {
        fog.near = Math.max(95, base + 37)
        fog.far = Math.max(220, base + 162)
      }
      controls.maxDistance = Math.max(95, Math.min(isWood ? 118 : 140, base * 1.4))
    }
    const initPose = presetPose('desk', propsRef.current.deckCount, propsRef.current.mixerOn, aspectRef.current)
    camera.position.copy(initPose.pos)

    bootWith3DTextures()
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    // phones draw at 1.5x: just over half the pixels of 2x, which a phone screen will not show
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_PHONE ? 1.5 : 2))
    renderer.setSize(width, height)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02
    // the resin dice redraw what's behind them; half resolution halves that pass's cost and looks the same
    renderer.transmissionResolutionScale = 0.5
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
    keyLight.shadow.camera.far = 132
    keyLight.shadow.camera.left = -58
    keyLight.shadow.camera.right = 58
    keyLight.shadow.camera.top = 40
    keyLight.shadow.camera.bottom = -34
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

    const legH = 66.4 // reaches studio floor at y = -70
    const legGeo = new THREE.BoxGeometry(2.0, legH, 2.0)
    for (const lx of [-(TABLE_W / 2 - 8), TABLE_W / 2 - 8]) {
      for (const lz of [-(TABLE_D / 2 - 8), TABLE_D / 2 - 8]) {
        const leg = new THREE.Mesh(legGeo, steelMat)
        leg.position.set(lx, -TABLE_H - legH * 0.5, lz)
        woodTableGroup.add(leg)
      }
    }
    scene.add(woodTableGroup)

    // 3. Full Mid-Century Music Studio Room + Desktop Studio Monitor Speakers
    const studioRoom = buildStudioRoom()
    scene.add(studioRoom.group)

    // Apply active surface theme (studio vs wood) dynamically without tearing down WebGL
    let appliedSurface: 'studio' | 'wood' | null = null
    let controlsReady = false
    const applySurface = (mode: 'studio' | 'wood') => {
      if (mode === appliedSurface) return
      appliedSurface = mode
      const isWood = mode === 'wood'
      studioFloor.visible = !isWood
      surround.visible = !isWood
      woodTableGroup.visible = isWood
      studioRoom.group.visible = isWood
      scene.environment = isWood ? woodEnv.texture : studioEnv.texture
      scene.environmentIntensity = isWood ? 0.92 : 0.88
      const bgHex = isWood ? 0x26211c : 0xdfdcd4
      scene.background = new THREE.Color(bgHex)
      scene.fog = new THREE.Fog(bgHex, isWood ? 175 : 95, isWood ? 410 : 220)
      hemi.color.setHex(isWood ? 0xfff8ee : 0xfdfbf7)
      hemi.groundColor.setHex(isWood ? 0x735d49 : 0xbdb7ab)
      hemi.intensity = isWood ? 0.52 : 0.36
      keyLight.color.setHex(isWood ? 0xfff4e2 : 0xfffaf0)
      keyLight.intensity = isWood ? 1.65 : 1.55
      fillLight.intensity = isWood ? 0.46 : 0.42
      lightBase = { hemi: hemi.intensity, key: keyLight.intensity, fill: fillLight.intensity, env: scene.environmentIntensity, fog: bgHex }
      // the black light belongs to the room: leaving it turns it off
      if (!isWood) blacklightOn = false
      if (controlsReady) applyDepth()
    }
    // Black light: the room switch dims everything to a violet glow and lights the UV paint.
    // `blacklight` eases smoothly 0..1 both ways.
    let lightBase = { hemi: 0, key: 0, fill: 0, env: 0, fog: 0 }
    let blacklightOn = false
    let blacklight = 0
    const fogDark = new THREE.Color(0x0d0718)
    const fogMix = new THREE.Color()
    const applyBlacklight = (dt: number) => {
      const target = blacklightOn ? 1 : 0
      if (target === 0 && blacklight === 0) return
      blacklight += (target - blacklight) * Math.min(1, dt * 2.4)
      if (Math.abs(target - blacklight) < 0.002) blacklight = target
      // ease in and out, so the change starts and lands gently
      const level = blacklight * blacklight * (3 - 2 * blacklight)
      const room = 1 - 0.9 * level
      hemi.intensity = lightBase.hemi * room
      keyLight.intensity = lightBase.key * room
      fillLight.intensity = lightBase.fill * room
      scene.environmentIntensity = lightBase.env * (1 - 0.8 * level)
      fogMix.setHex(lightBase.fog).lerp(fogDark, level)
      ;(scene.background as THREE.Color).copy(fogMix)
      ;(scene.fog as THREE.Fog).color.copy(fogMix)
      studioRoom.setBlacklight(level, blacklightOn)
    }
    const toggleBlacklight = () => {
      blacklightOn = !blacklightOn
      studioRoom.setBlacklight(blacklight, blacklightOn)
      track('light_switch', { on: blacklightOn })
    }
    const hitLightSwitch = (clientX: number, clientY: number) => {
      if (!studioRoom.group.visible) return false
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      return raycaster.intersectObject(studioRoom.lightSwitch, true).length > 0
    }
    applySurface(propsRef.current.surface)

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement)
    controlsReady = true
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

    interface GearHeightMap {
      minX: number
      minZ: number
      step: number
      cols: number
      rows: number
      data: Float32Array
    }

    const bakeGearHeightMap = (
      group: THREE.Group,
      halfW: number,
      halfD: number,
      skipPred?: (obj: THREE.Object3D) => boolean,
    ): GearHeightMap => {
      const step = 0.25 // 2.5 mm precision — catches every button, key, knob, and CD spindle
      const minX = -halfW - 0.1
      const minZ = -halfD - 0.1
      const cols = Math.ceil((halfW * 2 + 0.2) / step) + 1
      const rows = Math.ceil((halfD * 2 + 0.2) / step) + 1
      const data = new Float32Array(cols * rows)

      group.updateMatrixWorld(true)
      const ox = group.position.x
      const oz = group.position.z

      const solidMeshes: { mesh: THREE.Mesh; minX: number; maxX: number; minZ: number; maxZ: number }[] = []
      const box = new THREE.Box3()
      group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return
        if (skipPred?.(obj)) return
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        if (!mats.some((m) => !m.transparent || m.opacity >= 0.85)) return
        box.setFromObject(obj)
        if (box.max.y < 0.05) return // skip grounded contact shadow plane
        solidMeshes.push({
          mesh: obj,
          minX: box.min.x - 0.02,
          maxX: box.max.x + 0.02,
          minZ: box.min.z - 0.02,
          maxZ: box.max.z + 0.02,
        })
      })

      const downRay = new THREE.Raycaster()
      const downDir = new THREE.Vector3(0, -1, 0)
      const origin = new THREE.Vector3()
      const candidates: THREE.Object3D[] = []

      for (let r = 0; r < rows; r++) {
        const wz = oz + minZ + r * step
        for (let c = 0; c < cols; c++) {
          const wx = ox + minX + c * step
          candidates.length = 0
          for (let k = 0; k < solidMeshes.length; k++) {
            const m = solidMeshes[k]
            if (wx >= m.minX && wx <= m.maxX && wz >= m.minZ && wz <= m.maxZ) {
              candidates.push(m.mesh)
            }
          }
          if (!candidates.length) continue
          origin.set(wx, 10, wz)
          downRay.set(origin, downDir)
          const hits = downRay.intersectObjects(candidates, false)
          if (hits.length) {
            data[r * cols + c] = hits[0].point.y
          }
        }
      }

      return { minX, minZ, step, cols, rows, data }
    }

    const sampleHeightMap = (hm: GearHeightMap, lx: number, lz: number): number => {
      const c = Math.round((lx - hm.minX) / hm.step)
      const r = Math.round((lz - hm.minZ) / hm.step)
      if (c < 0 || c >= hm.cols || r < 0 || r >= hm.rows) return 0
      return hm.data[r * hm.cols + c]
    }

    const skipDynamicGearMeshes = (obj: THREE.Object3D) => {
      const kind = obj.userData?.control?.kind as string | undefined
      if (kind === 'fader') return true
      // Skip only the removable CD disc mesh group (keep the platter & center spindle post!)
      let cur: THREE.Object3D | null = obj
      while (cur) {
        if (cur.name === 'bc1-disc-group') return true
        cur = cur.parent
      }
      return false
    }

    let bc1HeightMap: GearHeightMap | null = null
    let skHeightMap: GearHeightMap | null = null
    const getBc1HeightMap = () => {
      if (!bc1HeightMap) bc1HeightMap = bakeGearHeightMap(bc1Rigs[0].group, BC1_W * 0.5, BC1_D * 0.5, skipDynamicGearMeshes)
      return bc1HeightMap
    }
    const getSkHeightMap = () => {
      if (!skHeightMap && sidekickRig) {
        skHeightMap = bakeGearHeightMap(sidekickRig.group, SK_W * 0.5, SK_D * 0.5, skipDynamicGearMeshes)
      }
      return skHeightMap
    }

    // Sidekick live fader geometry constants (matching buildSidekick.ts)
    const SK_UNIT = BC1_D / 552
    const SK_FADER_XS = [(19 + 18.5 - 101) * SK_UNIT, (74 + 18.5 - 101) * SK_UNIT]
    const SK_FADER_TOP_Z = (402 - 276) * SK_UNIT
    const SK_FADER_BOT_Z = (478 - 276) * SK_UNIT
    const SK_FADER_R = 8.4 * SK_UNIT + 0.1
    const SK_FADER_TOP_Y = 2.89

    const centerOverGear = (x: number, z: number): boolean => {
      const { deckCount: dc, mixerOn: mOn } = propsRef.current
      for (let i = 0; i < dc; i++) {
        if (Math.abs(x - bc1Rigs[i].group.position.x) <= BC1_W * 0.5 && Math.abs(z) <= BC1_D * 0.5) return true
      }
      if (mOn && sidekickRig && sidekickRig.group.visible) {
        const sx = sidekickRig.group.position.x
        const sz = sidekickRig.group.position.z
        if (Math.abs(x - sx) <= SK_W * 0.5 && Math.abs(z - sz) <= SK_D * 0.5) return true
      }
      return false
    }

    const gearHeightAtPoint = (wx: number, wz: number): number => {
      const { decks: curDecks, mixer: curMixer, deckCount: dc, mixerOn: mOn } = propsRef.current
      let h = 0
      const bMap = getBc1HeightMap()
      for (let i = 0; i < dc; i++) {
        const lx = wx - bc1Rigs[i].group.position.x
        const lz = wz
        if (Math.abs(lx) <= BC1_W * 0.5 + 0.12 && Math.abs(lz) <= BC1_D * 0.5 + 0.12) {
          const bh = sampleHeightMap(bMap, lx, lz)
          if (bh > h) h = bh
          const dr = Math.hypot(lx - DISC_CX_LOCAL, lz - DISC_CZ_LOCAL)
          // Analytical guard for the 15 mm center CD spindle clamp (top at TOP_Y + 0.016 + 0.865 = 2.591)
          if (dr <= 0.84 && 2.6 > h) h = 2.6
          const s = curDecks[i].getState()
          if (s.disc && dr <= DISC_R_WORLD) {
            if (DISC_TOP_Y > h) h = DISC_TOP_Y
          }
        }
      }
      if (mOn && sidekickRig && sidekickRig.group.visible) {
        const lx = wx - sidekickRig.group.position.x
        const lz = wz - sidekickRig.group.position.z
        if (Math.abs(lx) <= SK_W * 0.5 + 0.12 && Math.abs(lz) <= SK_D * 0.5 + 0.12) {
          const sMap = getSkHeightMap()
          if (sMap) {
            const sh = sampleHeightMap(sMap, lx, lz)
            if (sh > h) h = sh
          }
          if (curMixer) {
            const ms = curMixer.getState()
            for (let c = 0; c < 2; c++) {
              const fz = SK_FADER_BOT_Z + (SK_FADER_TOP_Z - SK_FADER_BOT_Z) * ms.ch[c].fader
              if (Math.hypot(lx - SK_FADER_XS[c], lz - fz) <= SK_FADER_R) {
                if (SK_FADER_TOP_Y > h) h = SK_FADER_TOP_Y
              }
            }
          }
        }
      }
      return h
    }

    const isOnCoaster = (id: PropId, x: number, z: number, coaster: PropLive3D): boolean => {
      if (id === 'coaster') return false
      const cObb = propObb('coaster', coaster.x, coaster.z, coaster.rot)
      const dx = x - cObb.cx
      const dz = z - cObb.cz
      const lx = dx * cObb.ux + dz * cObb.uz
      const lz = dx * cObb.vx + dz * cObb.vz
      const footPad = id === 'tea' ? 2.1 : 0.85
      return Math.abs(lx) <= 5.4 + footPad && Math.abs(lz) <= 5.4 + footPad
    }

    const coasterRiders = (coaster: PropLive3D): PropId[] => {
      const riders: PropId[] = []
      for (const [pid, live] of propRigs) {
        if (pid !== 'coaster' && isOnCoaster(pid, live.x, live.z, coaster)) {
          riders.push(pid)
        }
      }
      return riders
    }

    const surfaceYForProp = (id: PropId, x: number, z: number, rotDeg: number): number => {
      const obb = propObb(id, x, z, rotDeg)
      const ex = Math.abs(obb.ux) * obb.halfW + Math.abs(obb.vx) * obb.halfD
      const ez = Math.abs(obb.uz) * obb.halfW + Math.abs(obb.vz) * obb.halfD

      // Fast AABB reject when completely over the empty desk tabletop
      const { deckCount: dc, mixerOn: mOn } = propsRef.current
      let nearGear = false
      for (let i = 0; i < dc; i++) {
        const dx = Math.abs(obb.cx - bc1Rigs[i].group.position.x)
        if (dx <= BC1_W * 0.5 + ex + 0.15 && Math.abs(obb.cz) <= BC1_D * 0.5 + ez + 0.15) {
          nearGear = true
          break
        }
      }
      if (!nearGear && mOn && sidekickRig && sidekickRig.group.visible) {
        const dx = Math.abs(obb.cx - sidekickRig.group.position.x)
        const dz = Math.abs(obb.cz - sidekickRig.group.position.z)
        if (dx <= SK_W * 0.5 + ex + 0.15 && dz <= SK_D * 0.5 + ez + 0.15) nearGear = true
      }
      let maxY = 0
      if (nearGear) {
        // Sample the prop's full rotated footprint at 2.5 mm resolution so no knob, button,
        // numpad key, fader, or CD spindle post can ever poke through the prop!
        const step = 0.25
        const hw = obb.halfW
        const hd = obb.halfD
        const stepsU = Math.max(2, Math.ceil((hw * 2) / step))
        const stepsV = Math.max(2, Math.ceil((hd * 2) / step))
        for (let iu = 0; iu <= stepsU; iu++) {
          const u = -hw + (iu / stepsU) * (hw * 2)
          const baseX = obb.cx + obb.ux * u
          const baseZ = obb.cz + obb.uz * u
          for (let iv = 0; iv <= stepsV; iv++) {
            const v = -hd + (iv / stepsV) * (hd * 2)
            const h = gearHeightAtPoint(baseX + obb.vx * v, baseZ + obb.vz * v)
            if (h > maxY) maxY = h
          }
        }
      }

      // Allow the mug of tea (and other props) to rest cleanly on top of the ceramic coaster!
      if (id !== 'coaster') {
        const coaster = propRigs.get('coaster')
        if (coaster && isOnCoaster(id, x, z, coaster)) {
          const topY = coaster.curY + COASTER_H
          if (topY > maxY) maxY = topY
        }
      }

      return maxY > 0 ? maxY + 0.015 : 0
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

    interface Obb2D {
      cx: number
      cz: number
      ux: number
      uz: number
      vx: number
      vz: number
      halfW: number
      halfD: number
    }

    const propObb = (id: PropId, x: number, z: number, rotDeg: number): Obb2D => {
      const fp = PROP_FOOTPRINT_3D[id]
      const theta = THREE.MathUtils.degToRad(-rotDeg)
      const cos = Math.cos(theta)
      const sin = Math.sin(theta)
      const ux = cos
      const uz = -sin
      const vx = sin
      const vz = cos
      // Offset mug center slightly toward its protruding solid rectangular tab handle
      const localCX = id === 'tea' ? 1.12 : 0
      const pad = 0.14
      return {
        cx: x + localCX * ux,
        cz: z + localCX * uz,
        ux,
        uz,
        vx,
        vz,
        halfW: fp.halfW + pad,
        halfD: fp.halfD + pad,
      }
    }

    const obbOverlap = (a: Obb2D, b: Obb2D): { nx: number; nz: number; pen: number } | null => {
      const dx = b.cx - a.cx
      const dz = b.cz - a.cz
      let minPen = Infinity
      let bestNx = 1
      let bestNz = 0

      const axes: [number, number][] = [
        [a.ux, a.uz],
        [a.vx, a.vz],
        [b.ux, b.uz],
        [b.vx, b.vz],
      ]
      for (const [ax, az] of axes) {
        const projA = a.halfW * Math.abs(a.ux * ax + a.uz * az) + a.halfD * Math.abs(a.vx * ax + a.vz * az)
        const projB = b.halfW * Math.abs(b.ux * ax + b.uz * az) + b.halfD * Math.abs(b.vx * ax + b.vz * az)
        const d = dx * ax + dz * az
        const pen = projA + projB - Math.abs(d)
        if (pen <= 0) return null
        if (pen < minPen) {
          minPen = pen
          const sign = d >= 0 ? 1 : -1
          bestNx = ax * sign
          bestNz = az * sign
        }
      }
      return { nx: bestNx, nz: bestNz, pen: minPen }
    }

    const clampDeskPropOutOfGear = (id: PropId, x: number, z: number, rotDeg: number): [number, number] => {
      const obb = propObb(id, x, z, rotDeg)
      const ex = Math.abs(obb.ux) * obb.halfW + Math.abs(obb.vx) * obb.halfD
      const ez = Math.abs(obb.uz) * obb.halfW + Math.abs(obb.vz) * obb.halfD
      const ox = obb.cx - x
      const oz = obb.cz - z
      let nx = x
      let nz = z

      const boxes: { cx: number; cz: number; hw: number; hd: number }[] = []
      const { deckCount: dc, mixerOn: mOn } = propsRef.current
      for (let i = 0; i < dc; i++) {
        boxes.push({ cx: bc1Rigs[i].group.position.x, cz: 0, hw: BC1_W * 0.5 + 0.25, hd: BC1_D * 0.5 + 0.25 })
      }
      if (mOn && sidekickRig && sidekickRig.group.visible) {
        boxes.push({
          cx: sidekickRig.group.position.x,
          cz: sidekickRig.group.position.z,
          hw: SK_W * 0.5 + 0.25,
          hd: SK_D * 0.5 + 0.25,
        })
      }

      for (const box of boxes) {
        const dx = nx + ox - box.cx
        const dz = nz + oz - box.cz
        const penX = box.hw + ex - Math.abs(dx)
        const penZ = box.hd + ez - Math.abs(dz)
        if (penX > 0 && penZ > 0) {
          if (penX < penZ) nx += (dx >= 0 ? 1 : -1) * penX
          else nz += (dz >= 0 ? 1 : -1) * penZ
        }
      }
      return clampTable(nx, nz)
    }

    const resolvePropCollisions = (draggedId: PropId | null) => {
      const list = Array.from(propRigs.values())
      if (list.length < 2) return

      const moveProp = (live: PropLive3D, dx: number, dz: number, keepOffGear: boolean): [number, number] => {
        const prevX = live.x
        const prevZ = live.z
        let [nx, nz] = clampTable(prevX + dx, prevZ + dz)
        if (keepOffGear && live.curY < 0.8) {
          ;[nx, nz] = clampDeskPropOutOfGear(live.rig.id, nx, nz, live.rot)
        }
        live.x = nx
        live.z = nz
        if (Math.abs(nx - prevX) > 1e-4 || Math.abs(nz - prevZ) > 1e-4) live.dirty = true
        return [nx - prevX, nz - prevZ]
      }

      for (let pass = 0; pass < 4; pass++) {
        let anyHit = false
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i]
            const b = list[j]
            // Coaster is a flat tabletop pad designed to sit underneath the mug (and other props)
            // and slide independently out from under them without horizontal collision rejection.
            if (a.rig.id === 'coaster' || b.rig.id === 'coaster') continue
            // Only collide props whose vertical spans actually overlap
            const hA = PROP_FOOTPRINT_3D[a.rig.id].height
            const hB = PROP_FOOTPRINT_3D[b.rig.id].height
            if (a.curY + hA <= b.curY + 0.05 || b.curY + hB <= a.curY + 0.05) continue

            const obbA = propObb(a.rig.id, a.x, a.z, a.rot)
            const obbB = propObb(b.rig.id, b.x, b.z, b.rot)
            const hit = obbOverlap(obbA, obbB)
            if (!hit || hit.pen <= 1e-4) continue
            anyHit = true

            const mA = PROP_FOOTPRINT_3D[a.rig.id].mass
            const mB = PROP_FOOTPRINT_3D[b.rig.id].mass
            let wA: number
            let wB: number
            if (a.rig.id === draggedId) {
              if (mB > mA * 2.4) {
                wA = 0.84
                wB = 0.16
              } else {
                wA = 0.08
                wB = 0.92
              }
            } else if (b.rig.id === draggedId) {
              if (mA > mB * 2.4) {
                wA = 0.16
                wB = 0.84
              } else {
                wA = 0.92
                wB = 0.08
              }
            } else {
              const total = mA + mB
              wA = mB / total
              wB = mA / total
            }

            const wantAx = -hit.nx * hit.pen * wA
            const wantAz = -hit.nz * hit.pen * wA
            const wantBx = hit.nx * hit.pen * wB
            const wantBz = hit.nz * hit.pen * wB

            const [gotAx, gotAz] = moveProp(a, wantAx, wantAz, a.rig.id !== draggedId)
            const [gotBx, gotBz] = moveProp(b, wantBx, wantBz, b.rig.id !== draggedId)

            // If one prop was blocked by the table edge or gear wall, feed the remainder back so they never overlap
            const remAx = wantAx - gotAx
            const remAz = wantAz - gotAz
            const remBx = wantBx - gotBx
            const remBz = wantBz - gotBz
            if (Math.hypot(remBx, remBz) > 1e-3) {
              moveProp(a, -remBx, -remBz, a.rig.id !== draggedId)
            }
            if (Math.hypot(remAx, remAz) > 1e-3) {
              moveProp(b, -remAx, -remAz, b.rig.id !== draggedId)
            }

            // Subtle tactile twist when a resting prop is nudged off-center
            if (pass === 0 && hit.pen > 0.03) {
              const rdx = obbB.cx - obbA.cx
              const rdz = obbB.cz - obbA.cz
              const cross = rdx * hit.nz - rdz * hit.nx
              const twist = Math.max(-1.6, Math.min(1.6, cross * hit.pen * 0.28))
              if (b.rig.id !== draggedId && wB > 0.25) b.rot += twist
              if (a.rig.id !== draggedId && wA > 0.25) a.rot -= twist
            }
          }
        }
        if (!anyHit) break
      }
    }

    const launchDieRoll3D = (id: PropId, onDrop: boolean) => {
      const live = propRigs.get(id)
      if (!live || !live.rig.isDie) return
      const nextFace = rollDieFace(id, live.rig.face)
      track('dice_roll', { die: id, view: '3d' })
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
        live.curY = surfaceYForProp(id, nx, nz, live.rot)
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

    // Hand-tracking snap targets: each scene control and desk item as a screen rectangle
    const snapBox = new THREE.Box3()
    const snapCorner = new THREE.Vector3()
    const removeHandTargets = addHandTargets(() => {
      const rect = renderer.domElement.getBoundingClientRect()
      const roots: THREE.Object3D[] = [bc1Rigs[0].group]
      if (bc1Rigs[1].group.visible) roots.push(bc1Rigs[1].group)
      if (sidekickRig && sidekickRig.group.visible) roots.push(sidekickRig.group)
      if (propsRef.current.propsOn && propsGroup.visible) roots.push(propsGroup)
      if (studioRoom.group.visible) roots.push(studioRoom.lightSwitch)
      const out: HandTarget[] = []
      camera.updateMatrixWorld()
      for (const root of roots) {
        root.traverseVisible((obj) => {
          const tag = obj.userData?.control ?? obj.userData?.propId ?? obj.userData?.lightSwitch
          // only the outermost object carrying a tag: its children share it
          if (!tag || (obj.parent && (obj.parent.userData?.control ?? obj.parent.userData?.propId ?? obj.parent.userData?.lightSwitch) === tag)) return
          snapBox.setFromObject(obj)
          if (snapBox.isEmpty()) return
          let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
          for (let i = 0; i < 8; i++) {
            snapCorner.set(i & 1 ? snapBox.max.x : snapBox.min.x, i & 2 ? snapBox.max.y : snapBox.min.y, i & 4 ? snapBox.max.z : snapBox.min.z)
            snapCorner.project(camera)
            if (snapCorner.z > 1) return // behind the camera
            const sx = rect.left + ((snapCorner.x + 1) / 2) * rect.width
            const sy = rect.top + ((1 - snapCorner.y) / 2) * rect.height
            left = Math.min(left, sx); right = Math.max(right, sx); top = Math.min(top, sy); bottom = Math.max(bottom, sy)
          }
          out.push({ left, top, right, bottom })
        })
      }
      return out
    })

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
          riders: PropId[]
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
      if (!picked && e.button === 0 && hitLightSwitch(e.clientX, e.clientY)) {
        toggleBlacklight()
        e.stopPropagation()
        e.preventDefault()
        return
      }
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
          riders: picked.id === 'coaster' ? coasterRiders(live) : [],
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
            : picked.id === 'candle'
              ? 'click to light / blow out · drag to move · scroll to rotate'
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
        const prevX = live.x
        const prevZ = live.z
        const [nx, nz] = clampTable(hitPt.x + activeDrag.offsetX, hitPt.z + activeDrag.offsetZ)
        live.x = nx
        live.z = nz
        live.curY = surfaceYForProp(live.rig.id, nx, nz, live.rot)
        // Moving the coaster carries anything sitting on top of it (like the mug of tea!)
        if (activeDrag.riders.length) {
          const dx = nx - prevX
          const dz = nz - prevZ
          for (const rid of activeDrag.riders) {
            const rider = propRigs.get(rid)
            if (!rider) continue
            const [rx, rz] = clampTable(rider.x + dx, rider.z + dz)
            rider.x = rx
            rider.z = rz
            rider.curY = surfaceYForProp(rid, rx, rz, rider.rot)
            rider.dirty = true
          }
        }
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
              else live.rig.onClick?.()
            } else if (live.rig.isDie) {
              launchDieRoll3D(activeDrag.id, true)
            } else {
              const nudge = Math.round((Math.random() - 0.5) * 12)
              const prevX = live.x
              const prevZ = live.z
              live.rot += nudge
              if (!centerOverGear(live.x, live.z)) {
                ;[live.x, live.z] = clampDeskPropOutOfGear(live.rig.id, live.x, live.z, live.rot)
              }
              const clampDx = live.x - prevX
              const clampDz = live.z - prevZ
              if (activeDrag.riders.length) {
                const rad = THREE.MathUtils.degToRad(nudge)
                const cos = Math.cos(rad)
                const sin = Math.sin(rad)
                for (const rid of activeDrag.riders) {
                  const rider = propRigs.get(rid)
                  if (!rider) continue
                  const rx0 = rider.x + clampDx - live.x
                  const rz0 = rider.z + clampDz - live.z
                  const [rx, rz] = clampTable(live.x + rx0 * cos - rz0 * sin, live.z + rx0 * sin + rz0 * cos)
                  rider.x = rx
                  rider.z = rz
                  rider.rot += nudge
                  rider.rig.settle()
                  persistProp(rid, { x3d: rider.x, z3d: rider.z, rot: rider.rot })
                }
              }
              resolvePropCollisions(null)
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
        const delta = e.deltaY > 0 ? step : -step
        live.rot += delta
        live.rig.root.rotation.y = THREE.MathUtils.degToRad(-live.rot)
        // Rotating the coaster rotates anything sitting on top of it around the coaster's center
        if (picked.id === 'coaster') {
          const rad = THREE.MathUtils.degToRad(delta)
          const cos = Math.cos(rad)
          const sin = Math.sin(rad)
          for (const rid of coasterRiders(live)) {
            const rider = propRigs.get(rid)
            if (!rider) continue
            const dx = rider.x - live.x
            const dz = rider.z - live.z
            const [rx, rz] = clampTable(live.x + dx * cos - dz * sin, live.z + dx * sin + dz * cos)
            rider.x = rx
            rider.z = rz
            rider.rot += delta
            rider.rig.root.position.set(rx, rider.curY + rider.liftY, rz)
            rider.rig.root.rotation.y = THREE.MathUtils.degToRad(-rider.rot)
            persistProp(rid, { x3d: rx, z3d: rz, rot: rider.rot })
          }
        }
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
            const curY = surfaceYForProp(p.id, tx, tz, p.rot)
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
        const ridingCoaster =
          activeDrag?.kind === 'prop' && activeDrag.moved && activeDrag.riders.includes(id)
        const animActive = live.rig.update(dt)
        if (animActive) anyAnimatingOrSpinning = true

        // Ride spinning CD rigidly in 3D (matches discGroup.rotation.y -= spinOmega * dt)
        if (!draggingThis && !ridingCoaster && spinners.length) {
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

        const lifted = draggingThis || ridingCoaster
        const targetLift = lifted ? 1.55 : 0
        live.liftY += (targetLift - live.liftY) * liftLerp
        const targetTilt = draggingThis ? 0.08 : 0
        live.rig.body.rotation.x += (targetTilt - live.rig.body.rotation.x) * liftLerp
      }

      // Solid physical prop-to-prop OBB collision resolution (mass-weighted pushing, never interpenetrating!)
      const activeDragId = activeDrag?.kind === 'prop' && activeDrag.moved ? activeDrag.id : null
      resolvePropCollisions(activeDragId)

      for (const [, live] of propRigs) {
        const baseY = surfaceYForProp(live.rig.id, live.x, live.z, live.rot)
        // Rise immediately onto taller obstructions (spindle/knobs) so nothing clips even for 1 frame; settle smoothly down
        if (baseY > live.curY) live.curY = baseY
        else live.curY += (baseY - live.curY) * Math.min(1, dt * 22)
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
      applyBlacklight(dt)

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
      bootFrameDrawn()
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
      removeHandTargets()
      studioRoom.dispose()
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
              track('camera_view', { view: p.id })
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
