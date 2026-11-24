import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Deck } from '../engine/deck'
import type { Mixer } from '../engine/mixer'
import { capturePointer } from '../ui/controls'
import { BC1_D, BC1_W, buildBc1, type Bc1Rig } from './buildBc1'
import { SK_D, SK_W, buildSidekick, type SidekickRig } from './buildSidekick'
import { createStudioEnvironment, createStudioFloorTexture } from './materials'
import type { ControlAction } from './types'
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
  onSelectDeck,
  onOpenLid,
}: {
  decks: readonly [Deck, Deck]
  mixer: Mixer | null
  deckCount: 1 | 2
  mixerOn: boolean
  cables: StudioPatch[]
  onSelectDeck: (index: number) => void
  onOpenLid: (index: number) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [preset, setPreset] = useState<CameraPreset>('desk')

  const propsRef = useRef({ decks, mixer, deckCount, mixerOn, cables, onSelectDeck, onOpenLid })
  propsRef.current = { decks, mixer, deckCount, mixerOn, cables, onSelectDeck, onOpenLid }

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

    // Custom softbox + negative-fill photography studio environment
    const studioEnv = createStudioEnvironment(renderer)
    scene.environment = studioEnv.texture
    scene.environmentIntensity = 0.88

    // Sculpted directional studio lighting (warm softbox key + cool subtle rim)
    const hemi = new THREE.HemisphereLight(0xfdfbf7, 0xbdb7ab, 0.36)
    scene.add(hemi)

    const keyLight = new THREE.DirectionalLight(0xfffaf0, 1.55)
    keyLight.position.set(-22, 34, 20)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(4096, 4096)
    keyLight.shadow.camera.near = 8
    keyLight.shadow.camera.far = 96
    keyLight.shadow.camera.left = -30
    keyLight.shadow.camera.right = 30
    keyLight.shadow.camera.top = 22
    keyLight.shadow.camera.bottom = -22
    keyLight.shadow.bias = -0.00045
    keyLight.shadow.normalBias = 0.028
    keyLight.shadow.radius = 3.0
    scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight(0xdbe6f8, 0.42)
    fillLight.position.set(26, 16, -18)
    scene.add(fillLight)

    // Seamless studio cyclorama tabletop with subtle overhead softbox pool + shadows
    const floorTex = createStudioFloorTexture()
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: 0.92,
        metalness: 0,
        envMapIntensity: 0.18,
      }),
    )
    floor.receiveShadow = true
    scene.add(floor)
    // matte surround in the floor's edge tone, so zoomed-out views never show its border
    const surround = new THREE.Mesh(
      new THREE.RingGeometry(150, 900, 4, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 4),
      new THREE.MeshStandardMaterial({ color: '#d8d4cb', roughness: 0.92, metalness: 0, envMapIntensity: 0.18 }),
    )
    surround.position.y = -0.02
    scene.add(surround)

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

    /* ---------------- Unified Raycast Pointer Interaction ---------------- */

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()

    const pickControl = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const targets: THREE.Object3D[] = [bc1Rigs[0].group]
      if (bc1Rigs[1].group.visible) targets.push(bc1Rigs[1].group)
      if (sidekickRig && sidekickRig.group.visible) targets.push(sidekickRig.group)
      const hits = raycaster.intersectObjects(targets, true)
      for (const hit of hits) {
        const ctrl = hit.object.userData?.control as ControlAction | undefined
        if (ctrl) return { ctrl, hit }
      }
      return null
    }

    type DragState =
      | { kind: 'button'; action: Extract<ControlAction, { kind: 'button' }>; deckIndex?: number }
      | { kind: 'knob'; action: Extract<ControlAction, { kind: 'knob' }>; startY: number; startVal: number; moved: boolean }
      | { kind: 'fader'; action: Extract<ControlAction, { kind: 'fader' }>; startY: number; startVal: number }
      | { kind: 'jog'; action: Extract<ControlAction, { kind: 'jog' }>; startX: number }
      | { kind: 'pad'; action: Extract<ControlAction, { kind: 'pad' }>; startX: number; startY: number; lock: boolean }

    let activeDrag: DragState | null = null
    let lastTapKnob: { action: ControlAction; time: number } | null = null

    const setPressedVisual = (keyId: string, deckIndex: number | undefined, down: boolean) => {
      if (deckIndex !== undefined) bc1Rigs[deckIndex].setPressed(keyId, down)
      else sidekickRig?.setPressed(keyId, down)
    }

    const isHandPointer = (e: PointerEvent) => e.pointerId === 101 || e.pointerId === 102

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return
      const picked = pickControl(e.clientX, e.clientY)
      if (!picked) {
        // Prevent hand-tracking pinches from accidentally orbiting or panning the 3D camera
        if (isHandPointer(e)) {
          e.stopPropagation()
          e.preventDefault()
        }
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
        const picked = pickControl(e.clientX, e.clientY)
        if (!picked) {
          renderer.domElement.style.cursor = 'grab'
        } else {
          const k = picked.ctrl.kind
          renderer.domElement.style.cursor =
            k === 'knob' || k === 'fader' ? 'ns-resize' : k === 'jog' ? 'ew-resize' : k === 'pad' ? 'crosshair' : 'pointer'
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
        if (activeDrag.kind === 'button') {
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
      const picked = pickControl(e.clientX, e.clientY)
      if (picked && picked.ctrl.kind === 'oled') {
        e.preventDefault()
        e.stopPropagation()
        picked.ctrl.onWheel(e.deltaY)
      }
    }

    const onContextMenu = (e: MouseEvent) => {
      const picked = pickControl(e.clientX, e.clientY)
      if (picked && picked.ctrl.kind === 'pad') e.preventDefault()
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

    let raf = 0
    let lastTime = performance.now()

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      const { decks: curDecks, mixer: curMixer, deckCount: dc, mixerOn: mOn } = propsRef.current

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
      cableVisuals.forEach((cv) => cv.tube?.geometry.dispose())
      cableMat.dispose()
      floorTex.dispose()
      studioEnv.dispose()
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
    <div className="studio3d">
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
