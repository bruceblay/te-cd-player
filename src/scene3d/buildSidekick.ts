import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { SETTINGS, type Mixer, type MixerState } from '../engine/mixer'
import { FX_TYPES } from '../engine/sidekickFx'
import { createContactShadowTexture, createMicroBeadMaps } from './materials'
import { createSidekickLidTexture, createSidekickOledUpdater, createSidekickPlateTexture } from './textures'
import { createRoundedTopPlane, tagControl } from './types'

import { BC1_D, BC1_H } from './buildBc1'

// EP-136 K.O.-sidekick diagram: 202 x 552 units, scaled to match BC-1's exact length & slab height
// (matches 2D .rig 740fr : 374fr ratio so tops, bottoms, and top plates sit dead-flush).
const PW = 202
const PH = 552
const UNIT = BC1_D / PH // 0.0451573 world units per diagram unit

export const SK_W = PW * UNIT // 9.122
export const SK_D = BC1_D // 24.927 — exact match to BC-1 length
export const SK_H = BC1_H // 1.65 — flush top plate height
const FOOT_H = 0.06
const TOP_Y = FOOT_H + SK_H // 1.71

const COL = [19, 74]
const RIGHT = 147

const dx = (x: number) => (x - PW / 2) * UNIT
const dz = (y: number) => (y - PH / 2) * UNIT

type Ch = 0 | 1

export interface SidekickRig {
  group: THREE.Group
  jacksLocal: Record<'sk-aux' | 'sk-ch1' | 'sk-ch2', THREE.Vector3>
  update: (s: MixerState, dt: number, now: number) => void
  setPressed: (keyId: string, down: boolean) => void
  dispose: () => void
}

function createWideKeyTexture(label: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 320
  c.height = 156
  const ctx = c.getContext('2d')!
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8

  const render = () => {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = fg
    ctx.font = '500 42px "Manrope", "Helvetica Neue", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, c.width / 2, c.height / 2 + 2)
    tex.needsUpdate = true
  }

  render()
  void document.fonts?.ready.then(render)
  return tex
}

/**
 * Shallow concave dish profile (LatheGeometry) for the light-grey Sidekick Force Pad.
 * Points ordered bottom-outer -> top-center so all normals face outward/upward for
 * full-surface raycasting and accurate concave studio lighting.
 */
function createDishedPadGeometry(radius: number, height: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(radius * 0.99, 0),
    new THREE.Vector2(radius, height * 0.35),
    new THREE.Vector2(radius * 0.985, height - 0.015),
    new THREE.Vector2(radius * 0.94, height),
    new THREE.Vector2(radius * 0.84, height - 0.004),
    new THREE.Vector2(radius * 0.58, height - 0.022),
    new THREE.Vector2(radius * 0.28, height - 0.04),
    new THREE.Vector2(0, height - 0.045),
  ]
  return new THREE.LatheGeometry(pts, 48)
}

export function buildSidekick(mixer: Mixer): SidekickRig {
  const group = new THREE.Group()
  group.name = 'sidekick'

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

  const beadMaps = createMicroBeadMaps(3, 7)
  disposables.push(beadMaps)

  /* ---------------- 1. Contact Shadow, Anodized Chassis & 6x Faceplate ---------------- */

  const aoTex = trackTex(createContactShadowTexture())
  const aoPlane = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(SK_W * 1.38, SK_D * 1.18)).rotateX(-Math.PI / 2),
    trackMat(
      new THREE.MeshBasicMaterial({
        map: aoTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.72,
      }),
    ),
  )
  aoPlane.position.set(0.12, 0.004, 0.22)
  group.add(aoPlane)

  const foot = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(SK_W - 0.45, FOOT_H, SK_D - 0.45, 2, 0.03)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x202022, roughness: 0.92, metalness: 0.05 })),
  )
  foot.position.set(0, FOOT_H / 2, 0)
  foot.castShadow = true
  foot.receiveShadow = true
  group.add(foot)

  // Two-tone EP-136 sandwich chassis: slim dark charcoal lower casing + matte grey upper housing
  const lowerH = 0.36
  const upperH = SK_H - lowerH
  const lowerShell = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(SK_W - 0.04, lowerH + 0.08, SK_D - 0.04, 3, 0.08)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x222325, roughness: 0.65, metalness: 0.08 })),
  )
  lowerShell.position.set(0, FOOT_H + lowerH / 2, 0)
  lowerShell.castShadow = true
  lowerShell.receiveShadow = true
  group.add(lowerShell)

  const body = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(SK_W, upperH, SK_D, 4, 0.1)),
    trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0xaeaeac,
        metalness: 0.06,
        roughness: 0.58,
        normalMap: beadMaps.normalMap,
        normalScale: new THREE.Vector2(0.08, 0.08),
        roughnessMap: beadMaps.roughnessMap,
        clearcoat: 0,
      }),
    ),
  )
  body.position.set(0, FOOT_H + lowerH + upperH / 2, 0)
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  const plateTex = trackTex(createSidekickPlateTexture())
  const plate = new THREE.Mesh(
    trackGeo(createRoundedTopPlane(SK_W - 0.03, SK_D - 0.03, 0.11, 8)),
    trackMat(
      new THREE.MeshPhysicalMaterial({
        map: plateTex,
        metalness: 0.05,
        roughness: 0.58,
        normalMap: beadMaps.normalMap,
        normalScale: new THREE.Vector2(0.06, 0.06),
        roughnessMap: beadMaps.roughnessMap,
        clearcoat: 0,
      }),
    ),
  )
  plate.position.set(0, TOP_Y + 0.012, 0)
  plate.receiveShadow = true
  group.add(plate)

  // Physically raised off-white K.O.-SIDEKICK battery/top lid plate (y: 19..129, proud ~2.4 mm)
  const LID_H = 0.24
  const lidD = 110 * UNIT
  const lidBody = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(SK_W - 0.05, LID_H, lidD, 3, 0.04)),
    trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0xe3e2de,
        roughness: 0.48,
        metalness: 0.04,
      }),
    ),
  )
  lidBody.position.set(0, TOP_Y + 0.012 + LID_H / 2, dz(19 + 55))
  lidBody.castShadow = true
  lidBody.receiveShadow = true
  group.add(lidBody)

  const lidTex = trackTex(createSidekickLidTexture())
  const lidTop = new THREE.Mesh(
    trackGeo(createRoundedTopPlane(SK_W - 0.1, lidD - 0.06, 0.03, 4)),
    trackMat(
      new THREE.MeshStandardMaterial({
        map: lidTex,
        roughness: 0.48,
        metalness: 0.04,
      }),
    ),
  )
  lidTop.position.set(0, TOP_Y + 0.012 + LID_H + 0.01, dz(19 + 55))
  lidTop.receiveShadow = true
  group.add(lidTop)

  /* ---------------- 2. Flush Edge Jacks, System Screw & Pill Power Switch ---------------- */

  const darkAnodizedMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.35, roughness: 0.52 }),
  )
  const brushedRingMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x8e9094, metalness: 0.72, roughness: 0.32 }),
  )
  const orangeMat = trackMat(
    new THREE.MeshPhysicalMaterial({ color: 0xff5a1f, roughness: 0.36, metalness: 0.04, clearcoat: 0.16 }),
  )

  // Flush precision-milled 3.5mm TRS sockets
  const jackRimGeo = trackGeo(new THREE.RingGeometry(0.145, 0.205, 24))
  const jackSleeveGeo = trackGeo(new THREE.RingGeometry(0.128, 0.148, 24))
  const jackBoreGeo = trackGeo(new THREE.CircleGeometry(0.145, 24))

  const addFlushJack = (diagX: number, zEdge: number, dir: number) => {
    const x = dx(diagX)
    const y = FOOT_H + SK_H * 0.52
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

  // Rear (-Z): OUTPUT, AUX, CH1, CH2, USB-C
  addFlushJack(18.5, -SK_D / 2, -1)
  addFlushJack(56, -SK_D / 2, -1)
  addFlushJack(78, -SK_D / 2, -1)
  addFlushJack(95, -SK_D / 2, -1)

  const usbMesh = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(0.84, 0.32, 0.04, 2, 0.1)),
    darkAnodizedMat,
  )
  usbMesh.position.set(dx(128), FOOT_H + SK_H * 0.52, -SK_D / 2 - 0.002)
  group.add(usbMesh)

  // Front (+Z): clean flush PHONES jack on front chassis wall (no black top-plate half-moon)
  addFlushJack(167, SK_D / 2, 1)

  // Left & Right side-wall LEGO Technic connecting pin holes (matching docs/references/sidekick-side.png)
  const pinRimGeo = trackGeo(new THREE.RingGeometry(0.19, 0.27, 24))
  const pinBoreGeo = trackGeo(new THREE.CircleGeometry(0.19, 24))
  const pinRimMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x747573, roughness: 0.54, metalness: 0.16 }))
  const pinBoreMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x0b0b0d }))
  const sidePinZs = [dz(34), dz(52), dz(108), dz(496), dz(514)]
  const pinY = FOOT_H + lowerH + upperH * 0.52
  for (const side of [-1, 1] as const) {
    const xFace = side * (SK_W / 2 + 0.008)
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

  const jacksLocal: Record<'sk-aux' | 'sk-ch1' | 'sk-ch2', THREE.Vector3> = {
    'sk-aux': new THREE.Vector3(dx(56), FOOT_H + SK_H * 0.52, -SK_D / 2 - 0.02),
    'sk-ch1': new THREE.Vector3(dx(78), FOOT_H + SK_H * 0.52, -SK_D / 2 - 0.02),
    'sk-ch2': new THREE.Vector3(dx(95), FOOT_H + SK_H * 0.52, -SK_D / 2 - 0.02),
  }

  // Flush bottom-right lid system button hit target sitting right on the raised lid surface
  const systemHit = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 16)),
    trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })),
  )
  systemHit.position.set(dx(193.5), TOP_Y + LID_H + 0.05, dz(119.5))
  tagControl(systemHit, {
    kind: 'button',
    keyId: 'system',
    onDown: () => mixer.systemPress(),
  })
  group.add(systemHit)

  // Top-right band recessed pill POWER toggle switch matching docs/references/sidekick-top.jpg:
  // deep recessed pill channel (burnt orange when ON, cool recessed grey when OFF) + proud round orange thumb puck.
  const pwrTrackMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xb8350d, roughness: 0.52, metalness: 0.05 }),
  )
  // Rounded capsule track built via flat extruded pill shape so it has true semicircular ends
  const pillW = 22 * UNIT
  const pillD = 10.6 * UNIT
  const pillR = pillD / 2
  const pwrTrack = new THREE.Mesh(
    trackGeo(createRoundedTopPlane(pillW, pillD, pillR, 12)),
    pwrTrackMat,
  )
  pwrTrack.position.set(dx(174), TOP_Y + 0.022, dz(9.5))
  group.add(pwrTrack)

  // Subtle recessed dark rim around the pill slot
  const pwrRimGeo = trackGeo(createRoundedTopPlane(pillW + 0.05, pillD + 0.05, pillR + 0.025, 12))
  const pwrRim = new THREE.Mesh(
    pwrRimGeo,
    trackMat(new THREE.MeshStandardMaterial({ color: 0x3a241c, roughness: 0.75 })),
  )
  pwrRim.position.set(dx(174), TOP_Y + 0.017, dz(9.5))
  group.add(pwrRim)

  // Sculpted bright TE orange circular thumb puck (slides left=OFF, right=ON inside the pill slot)
  const pwrPuckGroup = new THREE.Group()
  const puckR = 5.0 * UNIT
  const puckBase = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(puckR * 0.96, puckR, 0.2, 32)),
    orangeMat,
  )
  puckBase.position.y = 0.1
  puckBase.castShadow = true
  puckBase.receiveShadow = true
  pwrPuckGroup.add(puckBase)

  const puckDome = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(puckR * 0.84, puckR * 0.96, 0.04, 32)),
    orangeMat,
  )
  puckDome.position.y = 0.22
  puckDome.castShadow = true
  pwrPuckGroup.add(puckDome)

  const pwrOffX = dx(168.5)
  const pwrOnX = dx(179.5)
  pwrPuckGroup.position.set(pwrOnX, TOP_Y + 0.024, dz(9.5))
  const pwrToggle = {
    kind: 'toggle' as const,
    onToggle: () => mixer.setPower(!mixer.getState().power),
  }
  tagControl(pwrPuckGroup, pwrToggle)
  tagControl(pwrTrack, pwrToggle)
  group.add(pwrPuckGroup)

  /* ---------------- 3. Flush Glossy Orange Pixel OLED ---------------- */

  const oled = createSidekickOledUpdater()
  const oledW = 36 * UNIT
  const oledD = 73 * UNIT
  const oledBezel = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(oledW + 0.08, 0.028, oledD + 0.08, 2, 0.015)),
    darkAnodizedMat,
  )
  oledBezel.position.set(dx(RIGHT + 18), TOP_Y + 0.028, dz(147 + 36.5))
  group.add(oledBezel)

  const oledScreen = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(oledW, oledD)).rotateX(-Math.PI / 2),
    trackMat(
      new THREE.MeshPhysicalMaterial({
        map: oled.tex,
        emissiveMap: oled.tex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.25,
        roughness: 0.08,
        metalness: 0.04,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
      }),
    ),
  )
  oledScreen.position.set(dx(RIGHT + 18), TOP_Y + 0.056, dz(147 + 36.5))

  let lastWheel = 0
  tagControl(oledScreen, {
    kind: 'oled',
    onClickUv: (u, v) => {
      const s = mixer.getState()
      if (!s.power) return
      const lx = u * 72
      const ly = (1 - v) * 146
      if (s.screen === 'fx') {
        for (let i = 0; i < FX_TYPES.length; i++) {
          const y0 = 20 + i * 18
          if (ly >= y0 && ly <= y0 + 16) {
            mixer.selectFx(FX_TYPES[i])
            return
          }
        }
      } else if (s.screen === 'settings') {
        for (let i = 0; i < SETTINGS.length; i++) {
          const y0 = 24 + i * 30
          if (ly >= y0 && ly <= y0 + 26) {
            mixer.selectSetting(i)
            return
          }
        }
      } else if (s.screen === 'main') {
        if (ly >= 98 && ly <= 115) {
          mixer.openFxMenu()
        } else if (ly >= 115 && ly <= 128) {
          if (lx < 27) mixer.toggleLock()
          else if (lx < 45) mixer.toggleBothFx()
          else mixer.toggleSerial()
        } else if (ly >= 129) {
          mixer.focusFx(lx < 36 ? 0 : 1)
        }
      }
    },
    onWheel: (deltaY) => {
      const s = mixer.getState()
      if (!s.power || (s.screen !== 'fx' && s.screen !== 'main')) return
      const now = performance.now()
      if (now - lastWheel < 140 || Math.abs(deltaY) < 4) return
      lastWheel = now
      mixer.stepFx(deltaY > 0 ? 1 : -1)
    },
  })
  group.add(oledScreen)

  /* ---------------- 4. Exact TE Two-Tier Knobs (matching .sk-knob) ---------------- */

  const KNOB_COLORS: Record<'orange' | 'white' | 'grey' | 'black', { base: number; cap: number; tab: number }> = {
    orange: { base: 0xff5b1c, cap: 0xfb5719, tab: 0xff5b1c },
    white: { base: 0xecebea, cap: 0xf0efee, tab: 0xc5c4c2 },
    grey: { base: 0x7b7b7b, cap: 0x747474, tab: 0xa2a2a2 },
    black: { base: 0x1e1e20, cap: 0x1b1b1d, tab: 0x6e6e70 },
  }

  const makeSkKnob = (opts: {
    x: number
    y: number
    color: 'orange' | 'white' | 'grey' | 'black'
    pointer?: boolean
    min: number
    max: number
    getValue: () => number
    setValue: (v: number) => void
    onTap?: () => void
    onReset?: () => void
  }) => {
    const cx = dx(opts.x + 18.5)
    const cz = dz(opts.y + 18.5)
    const pal = KNOB_COLORS[opts.color]
    // Real EP-136 K.O.-sidekick 3-part knob profile:
    // color-coded flat flange -> slim neck -> satin grey aluminum middle barrel -> color-coded tip cap
    const baseR = 16.5 * UNIT
    const capR = 8.4 * UNIT
    const baseH = 0.16
    const neckH = 0.1
    const midH = 0.78
    const tipH = 0.32

    const rotor = new THREE.Group()
    rotor.position.set(cx, TOP_Y + 0.018, cz)

    const baseMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: pal.base,
        roughness: 0.5,
        metalness: 0.04,
      }),
    )
    const neckMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x626468,
        roughness: 0.45,
        metalness: 0.35,
      }),
    )
    const barrelMat = trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0xa6a8ab,
        roughness: 0.36,
        metalness: 0.44,
        normalMap: beadMaps.normalMap,
        normalScale: new THREE.Vector2(0.05, 0.05),
      }),
    )
    const tipMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: pal.cap,
        roughness: 0.46,
        metalness: 0.05,
      }),
    )

    // Flat precision lower flange disc (color-coded)
    const base = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(baseR * 0.985, baseR, baseH, 40)),
      baseMat,
    )
    base.position.y = baseH / 2
    base.castShadow = true
    base.receiveShadow = true
    rotor.add(base)

    // Slight recessed collar neck between flange and barrel
    const neck = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(capR * 0.84, capR * 0.84, neckH, 32)),
      neckMat,
    )
    neck.position.y = baseH + neckH / 2
    neck.castShadow = true
    rotor.add(neck)

    // Satin metallic-grey middle cylinder barrel
    const barrel = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(capR * 0.98, capR, midH, 36)),
      barrelMat,
    )
    barrel.position.y = baseH + neckH + midH / 2
    barrel.castShadow = true
    barrel.receiveShadow = true
    rotor.add(barrel)

    // Color-coded top tip cap + subtle chamfer
    const tip = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(capR * 0.96, capR * 0.98, tipH, 36)),
      tipMat,
    )
    tip.position.y = baseH + neckH + midH + tipH / 2
    tip.castShadow = true
    tip.receiveShadow = true
    rotor.add(tip)

    const capBevel = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(capR * 0.88, capR * 0.96, 0.032, 36)),
      tipMat,
    )
    capBevel.position.y = baseH + neckH + midH + tipH + 0.016
    capBevel.castShadow = true
    rotor.add(capBevel)

    // EQ pointer tab: sits cleanly ON TOP of the flat outer flange (never overhangs!)
    if (opts.pointer) {
      const tabW = 2.8 * UNIT
      const tabL = 5.0 * UNIT
      const tab = new THREE.Mesh(
        trackGeo(new RoundedBoxGeometry(tabW, 0.055, tabL, 2, 0.018)),
        trackMat(new THREE.MeshStandardMaterial({ color: pal.tab, roughness: 0.44, metalness: 0.05 })),
      )
      // Positioned cleanly between the stalk and outer flange edge (toward -Z at 0 deg)
      tab.position.set(0, baseH + 0.025, -(capR + (baseR - capR) * 0.52))
      tab.castShadow = true
      rotor.add(tab)
    }

    tagControl(rotor, {
      kind: 'knob',
      min: opts.min,
      max: opts.max,
      getValue: opts.getValue,
      setValue: opts.setValue,
      onTap: opts.onTap,
      onReset: opts.onReset,
    })
    group.add(rotor)
    return rotor
  }

  const gainRotors: THREE.Group[] = []
  const eqRotors: { high: THREE.Group; mid: THREE.Group; low: THREE.Group }[] = []

  for (const c of [0, 1] as Ch[]) {
    const x = COL[c]
    gainRotors.push(
      makeSkKnob({
        x,
        y: 147,
        color: 'orange',
        min: 0,
        max: 1,
        getValue: () => {
          const g = mixer.gainKnob(c)
          return (g.value - g.min) / (g.max - g.min)
        },
        setValue: (norm) => {
          const g = mixer.gainKnob(c)
          g.set(g.min + norm * (g.max - g.min))
        },
        onTap: () => mixer.gainTap(c),
      }),
    )
    eqRotors.push({
      high: makeSkKnob({
        x,
        y: 202,
        color: 'white',
        pointer: true,
        min: -1,
        max: 1,
        getValue: () => mixer.getState().ch[c].eq.high,
        setValue: (v) => mixer.setEq(c, 'high', v),
        onReset: () => mixer.setEq(c, 'high', 0),
      }),
      mid: makeSkKnob({
        x,
        y: 257,
        color: 'grey',
        pointer: true,
        min: -1,
        max: 1,
        getValue: () => mixer.getState().ch[c].eq.mid,
        setValue: (v) => mixer.setEq(c, 'mid', v),
        onReset: () => mixer.setEq(c, 'mid', 0),
      }),
      low: makeSkKnob({
        x,
        y: 312,
        color: 'black',
        pointer: true,
        min: -1,
        max: 1,
        getValue: () => mixer.getState().ch[c].eq.low,
        setValue: (v) => mixer.setEq(c, 'low', v),
        onReset: () => mixer.setEq(c, 'low', 0),
      }),
    })
  }

  const volumeRotor = makeSkKnob({
    x: RIGHT,
    y: 312,
    color: 'white',
    min: 0,
    max: 1,
    getValue: () => mixer.getState().master,
    setValue: (v) => mixer.setMaster(v),
  })

  const phonesRotor = makeSkKnob({
    x: RIGHT,
    y: 440,
    color: 'grey',
    min: 0,
    max: 1,
    getValue: () => mixer.getState().phones,
    setValue: (v) => mixer.setPhones(v),
  })

  /* ---------------- 5. Round Matte-Grey Sidekick Fader Caps (matching .sk-fader-cap) ---------------- */

  const faderCaps: THREE.Group[] = []
  const faderTopZ = dz(402)
  const faderBotZ = dz(478)
  const faderBarrelMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xa6a8ab,
      roughness: 0.36,
      metalness: 0.44,
      normalMap: beadMaps.normalMap,
      normalScale: new THREE.Vector2(0.05, 0.05),
    }),
  )
  const faderTipMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x6a6b6d,
      roughness: 0.48,
      metalness: 0.06,
    }),
  )
  const faderStemMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.55, metalness: 0.25 }),
  )

  for (const c of [0, 1] as Ch[]) {
    const cx = dx(COL[c] + 18.5)
    const slotHit = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(18 * UNIT, 0.14, 84 * UNIT)),
      trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })),
    )
    slotHit.position.set(cx, TOP_Y + 0.06, dz(440))

    const capGroup = new THREE.Group()
    // 3-part TE fader post matching docs/references/sidekick-side.png & sidekick-top.jpg:
    // dark lower stem -> brushed light-grey metallic barrel -> darker matte-grey top cap
    const r = 8.4 * UNIT
    const stemH = 0.18
    const midH = 0.68
    const tipH = 0.26

    const stem = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(r * 0.62, r * 0.62, stemH, 24)),
      faderStemMat,
    )
    stem.position.y = stemH / 2
    stem.castShadow = true
    capGroup.add(stem)

    const barrel = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(r * 0.98, r, midH, 36)),
      faderBarrelMat,
    )
    barrel.position.y = stemH + midH / 2
    barrel.castShadow = true
    barrel.receiveShadow = true
    capGroup.add(barrel)

    const tip = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(r * 0.96, r * 0.98, tipH, 36)),
      faderTipMat,
    )
    tip.position.y = stemH + midH + tipH / 2
    tip.castShadow = true
    tip.receiveShadow = true
    capGroup.add(tip)

    const topBevel = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(r * 0.86, r * 0.96, 0.032, 36)),
      faderTipMat,
    )
    topBevel.position.y = stemH + midH + tipH + 0.016
    topBevel.castShadow = true
    capGroup.add(topBevel)

    capGroup.position.set(cx, TOP_Y + 0.018, faderTopZ)

    const action = {
      kind: 'fader' as const,
      getValue: () => mixer.getState().ch[c].fader,
      setValue: (v: number) => mixer.setFader(c, v),
    }
    tagControl(capGroup, action)
    tagControl(slotHit, action)
    group.add(slotHit)
    group.add(capGroup)
    faderCaps.push(capGroup)
  }

  /* ---------------- 6. Soft Light-Grey Concave Dished Force Pad & Orange MOD Stick ---------------- */

  const padX = dx(RIGHT + 18.5)
  const padZ = dz(257 + 18.5)
  const padR = 18.0 * UNIT

  const padGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x90908e,
      emissive: new THREE.Color(0xff5a1f),
      emissiveIntensity: 0,
      roughness: 0.35,
    }),
  )
  const padRing = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(padR * 0.99, 0.032, 10, 44)).rotateX(Math.PI / 2),
    padGlowMat,
  )
  padRing.position.set(padX, TOP_Y + 0.035, padZ)
  group.add(padRing)

  const padMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd5d5d4,
      emissive: new THREE.Color(0xff5a1f),
      emissiveIntensity: 0,
      roughness: 0.52,
      metalness: 0.04,
    }),
  )
  const padMesh = new THREE.Mesh(
    trackGeo(createDishedPadGeometry(padR * 0.98, 0.16)),
    padMat,
  )
  const padRestY = TOP_Y + 0.018
  padMesh.position.set(padX, padRestY, padZ)
  padMesh.castShadow = true
  padMesh.receiveShadow = true
  const padAction = {
    kind: 'pad' as const,
    setMod: (stick: number, pad: number, lock?: boolean) => mixer.setMod(stick, pad, lock),
  }
  tagControl(padMesh, padAction)
  tagControl(padRing, padAction)
  group.add(padMesh)

  // Orange MOD 3D spring-return rocker switch matching docs/references/sidekick-top.jpg & sidekick-side.png:
  // sits cleanly inside the flush borderless recessed cavity painted into the chassis plate.
  const modCenterX = dx(RIGHT + 18.5)
  const modCenterZ = dz(367 + 9)

  // Invisible hit plane covering the full recessed cavity so grabbing anywhere in the slot rocks the lever
  const modSlotHit = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(37 * UNIT, 18 * UNIT)).rotateX(-Math.PI / 2),
    trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })),
  )
  modSlotHit.position.set(modCenterX, TOP_Y + 0.025, modCenterZ)
  group.add(modSlotHit)

  // Matte satin TE orange matching GAIN knobs (no harsh clearcoat)
  const modMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff5b1c,
      roughness: 0.48,
      metalness: 0.04,
    }),
  )

  // Sub-surface pivot so rocking tilts cleanly inside the borderless cavity
  const modPivot = new THREE.Group()
  modPivot.position.set(modCenterX, TOP_Y - 0.36, modCenterZ)
  const modStickH = 1.24 // extends ~0.88 proud above plate, matching sidekick-side.png
  const modCap = new THREE.Mesh(
    trackGeo(new RoundedBoxGeometry(13.8 * UNIT, modStickH, 14.0 * UNIT, 3, 0.065)),
    modMat,
  )
  modCap.position.y = modStickH / 2
  modCap.castShadow = true
  modCap.receiveShadow = true
  modPivot.add(modCap)

  const modAction = {
    kind: 'jog' as const,
    setValue: (v: number) => mixer.setStick(v),
  }
  tagControl(modPivot, modAction)
  tagControl(modSlotHit, modAction)
  group.add(modPivot)

  /* ---------------- 7. Flush Low-Profile Rectangular Buttons (CUE, FX, SELECT) ---------------- */

  const keyGroups = new Map<
    string,
    {
      group: THREE.Group
      restY: number
      pressed: boolean
      lblMat: THREE.MeshStandardMaterial
      offTex: THREE.CanvasTexture
      litTex: THREE.CanvasTexture
      wasLit: boolean
    }
  >()

  const makeSkKey = (opts: {
    id: string
    x: number
    y: number
    bg: string
    fg: string
    litFg: string
    label: string
    onDown: () => void
    onUp: () => void
  }) => {
    const sw = 37 * UNIT
    const sd = 18 * UNIT
    const kh = 0.16

    // Dark recessed frame matching .key-well.sk-key
    const frame = new THREE.Mesh(
      trackGeo(createRoundedTopPlane(sw + 0.02, sd + 0.02, 0.05, 4)),
      trackMat(new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.65 })),
    )
    frame.position.set(dx(opts.x + 18.5), TOP_Y + 0.022, dz(opts.y + 9))
    group.add(frame)

    const kg = new THREE.Group()
    const capW = sw - 0.08
    const capD = sd - 0.08
    const cap = new THREE.Mesh(
      trackGeo(new RoundedBoxGeometry(capW, kh, capD, 3, 0.038)),
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

    const offTex = trackTex(createWideKeyTexture(opts.label, opts.bg, opts.fg))
    const litTex = trackTex(createWideKeyTexture(opts.label, opts.bg, opts.litFg))
    const lblMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: offTex,
        emissiveMap: litTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0,
        roughness: 0.58,
        metalness: 0.04,
      }),
    )
    const lbl = new THREE.Mesh(
      trackGeo(createRoundedTopPlane(capW - 0.07, capD - 0.07, 0.03, 4)),
      lblMat,
    )
    lbl.position.y = kh / 2 + 0.014
    kg.add(lbl)

    const restY = TOP_Y + 0.024 + kh / 2
    kg.position.set(dx(opts.x + 18.5), restY, dz(opts.y + 9))
    tagControl(kg, {
      kind: 'button',
      keyId: opts.id,
      onDown: opts.onDown,
      onUp: opts.onUp,
    })
    keyGroups.set(opts.id, { group: kg, restY, pressed: false, lblMat, offTex, litTex, wasLit: false })
    group.add(kg)
  }

  for (const c of [0, 1] as Ch[]) {
    makeSkKey({
      id: `sk-cue-${c}`,
      x: COL[c],
      y: 367,
      bg: '#2c2c2e',
      fg: '#ececec',
      litFg: '#ff7a40',
      label: 'CUE',
      onDown: () => mixer.cueDown(c),
      onUp: () => mixer.cueUp(c),
    })
    makeSkKey({
      id: `sk-fx-${c}`,
      x: COL[c],
      y: 495,
      bg: '#787878',
      fg: '#dadada',
      litFg: '#ffffff',
      label: 'FX',
      onDown: () => mixer.fxDown(c),
      onUp: () => mixer.fxUp(c),
    })
  }

  makeSkKey({
    id: 'sk-select',
    x: RIGHT,
    y: 495,
    bg: '#9e9e9e',
    fg: '#f6f6f6',
    litFg: '#ff5210',
    label: 'SELECT',
    onDown: () => mixer.selectDown(),
    onUp: () => mixer.selectUp(),
  })

  /* ---------------- 8. Live Update Loop ---------------- */

  let lastOledUpdate = 0

  const setPressed = (keyId: string, down: boolean) => {
    const entry = keyGroups.get(keyId)
    if (entry) entry.pressed = down
  }

  const update = (s: MixerState, dt: number, now: number) => {
    const lerp = Math.min(1, dt * 24)

    pwrPuckGroup.position.x += ((s.power ? pwrOnX : pwrOffX) - pwrPuckGroup.position.x) * lerp
    pwrTrackMat.color.setHex(s.power ? 0xb8350d : 0x727270)

    for (const c of [0, 1] as Ch[]) {
      const g = mixer.gainKnob(c)
      const gNorm = (g.value - g.min) / (g.max - g.min)
      gainRotors[c].rotation.y = -THREE.MathUtils.degToRad(-140 + gNorm * 280)
      eqRotors[c].high.rotation.y = -THREE.MathUtils.degToRad(s.ch[c].eq.high * 140)
      eqRotors[c].mid.rotation.y = -THREE.MathUtils.degToRad(s.ch[c].eq.mid * 140)
      eqRotors[c].low.rotation.y = -THREE.MathUtils.degToRad(s.ch[c].eq.low * 140)

      const targetZ = faderBotZ + (faderTopZ - faderBotZ) * s.ch[c].fader
      faderCaps[c].position.z += (targetZ - faderCaps[c].position.z) * Math.min(1, dt * 30)
    }

    volumeRotor.rotation.y = -THREE.MathUtils.degToRad(-140 + s.master * 280)
    phonesRotor.rotation.y = -THREE.MathUtils.degToRad(-140 + s.phones * 280)

    // Force pad depression & subtle warm orange glow under pressure
    const padTargetY = padRestY - s.pad * 0.055
    padMesh.position.y += (padTargetY - padMesh.position.y) * Math.min(1, dt * 30)
    padGlowMat.emissiveIntensity = s.power ? s.pad * 2.4 : 0
    padMat.emissiveIntensity = s.power ? s.pad * 0.22 : 0

    // 3D spring-return rocker tilt (+/- 22 deg around Z axis)
    const targetModRotZ = -s.stick * THREE.MathUtils.degToRad(22)
    modPivot.rotation.z += (targetModRotZ - modPivot.rotation.z) * Math.min(1, dt * 26)

    for (const [id, entry] of keyGroups.entries()) {
      const targetY = entry.restY - (entry.pressed ? 0.05 : 0)
      entry.group.position.y += (targetY - entry.group.position.y) * Math.min(1, dt * 34)
      let lit = false
      if (s.power) {
        if (id === 'sk-cue-0') lit = s.ch[0].cue
        else if (id === 'sk-cue-1') lit = s.ch[1].cue
        else if (id === 'sk-fx-0') lit = s.focus === 0 || s.focus === 'both'
        else if (id === 'sk-fx-1') lit = s.focus === 1 || s.focus === 'both'
        else if (id === 'sk-select') lit = s.selectHeld
      }
      if (lit !== entry.wasLit) {
        entry.wasLit = lit
        entry.lblMat.map = lit ? entry.litTex : entry.offTex
        entry.lblMat.emissiveIntensity = lit && (id.startsWith('sk-cue') || id === 'sk-select') ? 0.35 : 0
        entry.lblMat.needsUpdate = true
      }
    }

    if (now - lastOledUpdate >= 33) {
      lastOledUpdate = now
      oled.update(s)
    }
  }

  return {
    group,
    jacksLocal,
    update,
    setPressed,
    dispose() {
      oled.dispose()
      disposables.forEach((d) => d.dispose())
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      textures.forEach((t) => t.dispose())
    },
  }
}
