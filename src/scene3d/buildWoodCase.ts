import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

interface Resources {
  tex<T extends THREE.Texture>(texture: T): T
  geo<T extends THREE.BufferGeometry>(g: T): T
  mat<T extends THREE.Material>(m: T): T
}

/*
 * The small wooden case on the middle shelf, after the builder's photograph: a
 * dark-stained hardwood box with finger-jointed corners and a shallow lid, two
 * nickel draw latches (pentagon catch plate on the lid, lever and wire bail on
 * the body), a red bakelite handle hung on wire loops, and rubber feet.
 * Units are centimetres; the group's origin is the middle of the case's footprint
 * on the shelf, with the front facing +Z.
 */
export const WOOD_CASE = { w: 34, h: 10.2, d: 21, lid: 3.1, feet: 0.35 }

/** stained hardwood: long wavy grain, darker late-wood lines and open pores */
function stainedWoodCanvas(endGrain: boolean): HTMLCanvasElement {
  const W = 1024
  const H = endGrain ? 256 : 512
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  let seed = endGrain ? 911 : 37
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  g.fillStyle = endGrain ? '#331b0f' : '#3d2213'
  g.fillRect(0, 0, W, H)
  if (endGrain) {
    // end grain: short stacked growth rings, rougher and a touch darker
    for (let i = 0; i < 260; i++) {
      const y = rnd() * H
      g.strokeStyle = `rgba(${rnd() < 0.5 ? '20,10,6' : '92,58,36'},${0.18 + rnd() * 0.3})`
      g.lineWidth = 1 + rnd() * 2
      g.beginPath()
      g.moveTo(0, y)
      for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3)
      g.stroke()
    }
    return c
  }
  // broad colour variation between boards
  for (let i = 0; i < 14; i++) {
    const y = rnd() * H
    const band = g.createLinearGradient(0, y - 40, 0, y + 40)
    const tone = rnd() < 0.55 ? '22,10,5' : '92,50,28'
    band.addColorStop(0, `rgba(${tone},0)`)
    band.addColorStop(0.5, `rgba(${tone},${0.14 + rnd() * 0.18})`)
    band.addColorStop(1, `rgba(${tone},0)`)
    g.fillStyle = band
    g.fillRect(0, y - 40, W, 80)
  }
  // grain lines run the length of the board, waving gently
  for (let i = 0; i < 260; i++) {
    const y0 = rnd() * H
    const amp = 2 + rnd() * 7
    const freq = 0.002 + rnd() * 0.006
    const phase = rnd() * 6.28
    const dark = rnd() < 0.75
    g.strokeStyle = dark ? `rgba(20,9,4,${0.1 + rnd() * 0.24})` : `rgba(104,60,34,${0.06 + rnd() * 0.12})`
    g.lineWidth = 0.6 + rnd() * (dark ? 1.8 : 1.2)
    g.beginPath()
    const start = rnd() * W * 0.4
    const len = W * (0.4 + rnd() * 0.8)
    for (let x = start; x <= start + len; x += 16) {
      const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1) * amp * 0.25
      if (x === start) g.moveTo(x % W, y)
      else g.lineTo(x % W, y)
    }
    g.stroke()
  }
  // open pores: short dark dashes along the grain
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(14,6,3,${0.18 + rnd() * 0.3})`
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 7, 0.8 + rnd() * 0.8)
  }
  // scattered light scuffs in the finish
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(150,112,84,${0.05 + rnd() * 0.12})`
    g.fillRect(rnd() * W, rnd() * H, 6 + rnd() * 40, 0.6 + rnd() * 1.2)
  }
  return c
}

/** UVs in centimetres, so the grain keeps one scale on every face and runs along the case */
function grainUVs(geo: THREE.BufferGeometry, scaleU = 26, scaleV = 13) {
  const { position, normal, uv } = geo.attributes
  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i), py = position.getY(i), pz = position.getZ(i)
    const side = Math.abs(normal.getX(i)) > 0.6
    const top = Math.abs(normal.getY(i)) > 0.6
    uv.setXY(i, (side ? pz : px) / scaleU, (top ? pz : py) / scaleV)
  }
  uv.needsUpdate = true
  return geo
}

export function buildWoodCase(t: Resources): THREE.Group {
  const { w: W, h: H, d: D, lid: LID, feet: FEET } = WOOD_CASE
  const group = new THREE.Group()
  group.name = 'wooden-case'
  const shade = (m: THREE.Mesh) => ((m.castShadow = m.receiveShadow = true), m)
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = shade(new THREE.Mesh(t.geo(geo), mat))
    m.position.set(x, y, z)
    group.add(m)
    return m
  }

  const woodTex = t.tex(new THREE.CanvasTexture(stainedWoodCanvas(false)))
  woodTex.colorSpace = THREE.SRGBColorSpace
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping
  woodTex.anisotropy = 8
  const wood = t.mat(
    new THREE.MeshPhysicalMaterial({
      map: woodTex,
      bumpMap: woodTex,
      bumpScale: 0.012,
      roughness: 0.5,
      clearcoat: 0.35,
      clearcoatRoughness: 0.45,
    }),
  )
  const endTex = t.tex(new THREE.CanvasTexture(stainedWoodCanvas(true)))
  endTex.colorSpace = THREE.SRGBColorSpace
  endTex.wrapS = endTex.wrapT = THREE.RepeatWrapping
  const endGrain = t.mat(new THREE.MeshStandardMaterial({ map: endTex, bumpMap: endTex, bumpScale: 0.02, roughness: 0.68 }))
  const seamMat = t.mat(new THREE.MeshStandardMaterial({ color: 0x0d0805, roughness: 0.9 }))
  const nickel = t.mat(new THREE.MeshStandardMaterial({ color: 0x9e9c95, metalness: 0.8, roughness: 0.42 }))
  const wire = t.mat(new THREE.MeshStandardMaterial({ color: 0xa3a19a, metalness: 0.88, roughness: 0.32 }))
  const screwMat = t.mat(new THREE.MeshStandardMaterial({ color: 0x8f8d86, metalness: 0.85, roughness: 0.42 }))
  const bakelite = t.mat(
    new THREE.MeshPhysicalMaterial({ color: 0x9c0d18, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
  )
  const rubber = t.mat(new THREE.MeshStandardMaterial({ color: 0x151312, roughness: 0.9 }))

  // body and lid, with a dark seam between them
  const base = FEET
  const bodyH = H - LID
  const seam = 0.14
  add(grainUVs(new RoundedBoxGeometry(W, bodyH - seam / 2, D, 3, 0.14)), wood, 0, base + (bodyH - seam / 2) / 2, 0)
  add(grainUVs(new RoundedBoxGeometry(W, LID - seam / 2, D, 3, 0.14)), wood, 0, base + bodyH + seam / 2 + (LID - seam / 2) / 2, 0)
  add(new THREE.BoxGeometry(W - 0.5, seam, D - 0.5), seamMat, 0, base + bodyH, 0)

  // finger joints: end-grain tabs alternate between the front/back boards and the
  // side boards at each corner, so each face shows every other finger
  const board = 0.95
  const fingers = (y0: number, y1: number, offset: number) => {
    const n = Math.max(2, Math.round((y1 - y0) / 1.18))
    const step = (y1 - y0) / n
    for (let i = 0; i < n; i++) {
      const y = y0 + (i + 0.5) * step
      const h = step - 0.05
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          if ((i + offset) % 2 === 0) {
            // tab of a side board showing on the front/back face
            add(new THREE.PlaneGeometry(board, h), endGrain, sx * (W / 2 - board / 2), y, sz * (D / 2 + 0.006)).rotation.y = sz < 0 ? Math.PI : 0
          } else {
            // tab of the front/back board showing on the side face
            const m = add(new THREE.PlaneGeometry(board, h), endGrain, sx * (W / 2 + 0.006), y, sz * (D / 2 - board / 2))
            m.rotation.y = sx * Math.PI / 2
          }
        }
      }
    }
  }
  fingers(base + 0.15, base + bodyH - seam / 2 - 0.15, 0)
  fingers(base + bodyH + seam / 2 + 0.12, base + H - 0.15, 1)

  const front = D / 2
  const screw = (x: number, y: number, z: number, r = 0.13) => {
    const s = add(new THREE.CylinderGeometry(r, r * 1.05, 0.07, 14), screwMat, x, y, z)
    s.rotation.x = Math.PI / 2
    const slot = add(new THREE.BoxGeometry(r * 1.7, r * 0.28, 0.03), seamMat, x, y, z + 0.04)
    slot.rotation.z = (x * 7.3 + y * 3.1) % Math.PI
  }

  // draw latches, a little in from each end
  const seamY = base + bodyH
  for (const lx of [-(W / 2 - 4.6), W / 2 - 4.6]) {
    // pentagon catch plate on the lid, point up, with a hooked lip at its foot
    const shape = new THREE.Shape()
    shape.moveTo(-1.05, -0.95)
    shape.lineTo(1.05, -0.95)
    shape.lineTo(1.05, 0.35)
    shape.lineTo(0, 1.25)
    shape.lineTo(-1.05, 0.35)
    shape.closePath()
    const plate = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.03, bevelSegments: 2 })
    add(plate, nickel, lx, seamY + 1.25, front + 0.01)
    screw(lx - 0.62, seamY + 1.45, front + 0.12)
    screw(lx + 0.62, seamY + 1.45, front + 0.12)
    add(new RoundedBoxGeometry(1.3, 0.32, 0.42, 2, 0.08), nickel, lx, seamY + 0.4, front + 0.2)

    // body plate, lever and wire bail
    add(new RoundedBoxGeometry(2.0, 2.7, 0.08, 2, 0.12), nickel, lx, seamY - 1.55, front + 0.04)
    for (const [sx, sy] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, -2.75], [0.7, -2.75]]) screw(lx + sx, seamY + sy, front + 0.12, 0.11)
    const lever = add(new RoundedBoxGeometry(1.45, 2.2, 0.5, 3, 0.22), nickel, lx, seamY - 1.75, front + 0.32)
    lever.rotation.x = -0.12
    add(new RoundedBoxGeometry(1.55, 0.3, 0.6, 2, 0.12), nickel, lx, seamY - 2.85, front + 0.42)
    const bailPath = new THREE.CurvePath<THREE.Vector3>()
    const bz = front + 0.62
    const corners = [
      new THREE.Vector3(lx - 0.62, seamY - 1.1, bz),
      new THREE.Vector3(lx - 0.62, seamY + 0.52, bz - 0.12),
      new THREE.Vector3(lx + 0.62, seamY + 0.52, bz - 0.12),
      new THREE.Vector3(lx + 0.62, seamY - 1.1, bz),
    ]
    for (let i = 0; i < 3; i++) bailPath.add(new THREE.LineCurve3(corners[i], corners[i + 1]))
    add(new THREE.TubeGeometry(bailPath, 24, 0.075, 8, false), wire)
  }

  // red bakelite handle on wire loops from two small brackets below the seam
  const hy = seamY - 2.5
  const hz = front + 0.8
  const grip = new RoundedBoxGeometry(12.6, 1.3, 0.85, 4, 0.4)
  add(grip, bakelite, 0, hy, hz)
  for (const sx of [-1, 1]) {
    const cx = sx * 7.1
    const cap = add(new RoundedBoxGeometry(2.3, 1.75, 1.15, 4, 0.5), bakelite, cx, hy + 0.1, hz + 0.05)
    cap.rotation.z = sx * 0.1
    screw(cx + sx * 0.3, hy + 0.42, hz + 0.65, 0.13)
    screw(cx + sx * 0.3, hy - 0.2, hz + 0.65, 0.13)
    const bx = sx * 6.1
    add(new RoundedBoxGeometry(1.1, 0.95, 0.12, 2, 0.1), nickel, bx, seamY - 0.75, front + 0.06)
    screw(bx, seamY - 0.75, front + 0.14, 0.1)
    const loop = new THREE.CatmullRomCurve3([
      new THREE.Vector3(bx - 0.35, seamY - 0.75, front + 0.16),
      new THREE.Vector3(bx - 0.3, seamY - 1.2, front + 0.5),
      new THREE.Vector3(cx - sx * 0.75, hy + 0.7, hz - 0.1),
      new THREE.Vector3(cx - sx * 0.3, hy + 0.7, hz - 0.1),
      new THREE.Vector3(bx + 0.35, seamY - 1.2, front + 0.5),
      new THREE.Vector3(bx + 0.35, seamY - 0.75, front + 0.16),
    ])
    add(new THREE.TubeGeometry(loop, 40, 0.07, 8, false), wire)
  }

  // rubber feet
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.55, 0.6, FEET, 16), rubber, sx * (W / 2 - 1.6), FEET / 2, sz * (D / 2 - 1.6))
  }
  return group
}
