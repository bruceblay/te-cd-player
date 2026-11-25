import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import coasterTopUrl from '../assets/props/coaster-top.jpg'
import type { PropId } from '../ui/DeskProps'
import { createResinDiceMaterial } from './materials'
import { mergeStatic } from './mergeStatic'

/** World-unit thickness of the rustic ceramic tile coaster (8.4 mm). */
export const COASTER_H = 0.84

export interface PropRig3D {
  id: PropId
  /** Root placed on the desk/CD surface at (x, baseY, z) and rotated around Y by deskRot */
  root: THREE.Group
  /** Visual sub-group lifted/tilted during drag & drop settle */
  body: THREE.Group
  /** True for d6 and d20 */
  isDie: boolean
  /** Current rolled face for dice */
  face: number
  /** Immediately orient die to face (no animation) */
  setFace: (face: number) => void
  /** Launch a real 3D multi-bounce gravity tumble landing on targetFace */
  roll: (targetFace: number, onDrop: boolean, onSkid?: (dx: number, dz: number) => void) => void
  /** Trigger a subtle physical settle micro-hop for non-dice items */
  settle: () => void
  /** Optional click action (e.g., blow out / relight candle) */
  onClick?: () => void
  /** Advance animations (returns true while animating) */
  update: (dt: number) => boolean
  /** True while the item animates on its own (a lit candle's flame, the tea's steam) */
  ambient: () => boolean
  /** Dispose GPU geometries, materials, and textures */
  dispose: () => void
}

/** World-unit footprint (1 unit = 10 mm) used for collision-free placement, solid pushing & surface checks. */
export const PROP_FOOTPRINT_3D: Record<
  PropId,
  { halfW: number; halfD: number; radius: number; height: number; mass: number }
> = {
  succulent: { halfW: 3.1, halfD: 3.1, radius: 3.1, height: 6.8, mass: 6.0 },
  die: { halfW: 0.9, halfD: 0.9, radius: 0.95, height: 1.8, mass: 1.0 },
  d20: { halfW: 1.55, halfD: 1.55, radius: 1.6, height: 2.55, mass: 1.8 },
  pencil: { halfW: 8.3, halfD: 0.55, radius: 4.5, height: 0.85, mass: 0.8 },
  keycap: { halfW: 1.0, halfD: 1.0, radius: 1.05, height: 1.1, mass: 0.7 },
  capo: { halfW: 4.3, halfD: 3.4, radius: 3.9, height: 2.0, mass: 2.5 },
  candle: { halfW: 2.8, halfD: 2.8, radius: 2.9, height: 6.2, mass: 5.0 },
  tea: { halfW: 5.5, halfD: 4.7, radius: 5.0, height: 7.0, mass: 8.0 },
  coaster: { halfW: 5.4, halfD: 5.4, radius: 5.7, height: COASTER_H, mass: 3.5 },
  baggie: { halfW: 2.05, halfD: 2.45, radius: 2.4, height: 0.75, mass: 0.55 },
}

const UP_Y = new THREE.Vector3(0, 1, 0)

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

function tagProp(obj: THREE.Object3D, id: PropId) {
  obj.traverse((child) => {
    child.userData.propId = id
    if (child instanceof THREE.Mesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })
}

/* ============================================================
   1. POTTED ECHEVERIA SUCCULENT (60 mm terracotta pot + rosette)
   ============================================================ */

function makeSoilTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#2d2219'
  ctx.fillRect(0, 0, 256, 256)
  let seed = 41317
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let i = 0; i < 1600; i++) {
    const x = rand() * 256
    const y = rand() * 256
    const r = 0.8 + rand() * 2.6
    const v = rand()
    if (v > 0.94) {
      // tiny pale perlite mineral flecks
      ctx.fillStyle = `rgba(218, 206, 188, ${0.4 + rand() * 0.35})`
    } else if (v > 0.5) {
      ctx.fillStyle = `rgba(62, 46, 34, ${0.45 + rand() * 0.4})`
    } else {
      ctx.fillStyle = `rgba(26, 18, 12, ${0.5 + rand() * 0.4})`
    }
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeTerracottaTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, '#c87c58')
  g.addColorStop(0.24, '#bf724e')
  g.addColorStop(0.85, '#ad6242')
  g.addColorStop(1, '#8f4f34')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)

  let seed = 99271
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let i = 0; i < 2400; i++) {
    const x = rand() * 256
    const y = rand() * 256
    const w = 1 + rand() * 4
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255, 224, 198, 0.08)' : 'rgba(72, 34, 18, 0.1)'
    ctx.fillRect(x, y, w, 1.2)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Sculpted plump echeveria leaf extending along +Z, slightly cupped upward with vertex-color rose tip. */
function makeSucculentLeafGeometry(): THREE.BufferGeometry {
  const segL = 10
  const segW = 7
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  const baseCol = new THREE.Color('#4d6b53')
  const midCol = new THREE.Color('#7fa382')
  const edgeCol = new THREE.Color('#97b897')
  const tipCol = new THREE.Color('#b87872')
  const tmp = new THREE.Color()

  for (let il = 0; il <= segL; il++) {
    const t = il / segL // 0 = stem base, 1 = pointed tip
    // Broad spatula silhouette tapering to a crisp mucronate point at t=1
    const halfW = Math.sin(Math.pow(t, 0.72) * Math.PI) * 0.44 * (1 - 0.14 * t)
    const thick = Math.sin(Math.pow(t, 0.65) * Math.PI) * 0.17 + 0.015 * (1 - t)
    // Gentle upward spoon curve toward the tip
    const curveY = Math.pow(t, 2.2) * 0.16 - 0.06 * Math.sin(t * Math.PI)
    const z = t * 1.48

    for (let iw = 0; iw <= segW; iw++) {
      const s = (iw / segW) * 2 - 1 // -1..+1 across leaf width
      const x = s * halfW
      // Top surface gently cupped, underside fuller/keeled
      const cup = (s * s) * 0.075 * Math.sin(t * Math.PI)
      const yTop = curveY + thick * 0.42 * (1 - 0.55 * s * s) + cup
      positions.push(x, yTop, z)

      // Powdery farina green transitioning to subtle dusty rose on leaf tip
      if (t < 0.55) {
        tmp.lerpColors(baseCol, midCol, t / 0.55)
      } else if (t < 0.86) {
        tmp.lerpColors(midCol, edgeCol, (t - 0.55) / 0.31)
      } else {
        tmp.lerpColors(edgeCol, tipCol, (t - 0.86) / 0.14)
      }
      // Subtle blush along outer leaf margins near the tip
      if (t > 0.62 && Math.abs(s) > 0.72) {
        tmp.lerp(tipCol, 0.25 * ((t - 0.62) / 0.38))
      }
      colors.push(tmp.r, tmp.g, tmp.b)
    }
  }

  // Bottom surface ring so leaves have true 3D plump thickness from low camera angles
  const topCount = (segL + 1) * (segW + 1)
  for (let il = 0; il <= segL; il++) {
    const t = il / segL
    const halfW = Math.sin(Math.pow(t, 0.72) * Math.PI) * 0.44 * (1 - 0.14 * t)
    const thick = Math.sin(Math.pow(t, 0.65) * Math.PI) * 0.17 + 0.015 * (1 - t)
    const curveY = Math.pow(t, 2.2) * 0.16 - 0.06 * Math.sin(t * Math.PI)
    const z = t * 1.48

    for (let iw = 0; iw <= segW; iw++) {
      const s = (iw / segW) * 2 - 1
      const x = s * halfW
      const yBot = curveY - thick * 0.78 * (1 - s * s * 0.82)
      positions.push(x, yBot, z)

      tmp.lerpColors(baseCol, midCol, Math.min(1, t * 0.85))
      if (t > 0.85) tmp.lerp(tipCol, (t - 0.85) / 0.15)
      colors.push(tmp.r * 0.86, tmp.g * 0.88, tmp.b * 0.86)
    }
  }

  const row = segW + 1
  // Top triangles
  for (let il = 0; il < segL; il++) {
    for (let iw = 0; iw < segW; iw++) {
      const a = il * row + iw
      const b = a + 1
      const c = a + row
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  // Bottom triangles (wound opposite)
  for (let il = 0; il < segL; il++) {
    for (let iw = 0; iw < segW; iw++) {
      const a = topCount + il * row + iw
      const b = a + 1
      const c = a + row
      const d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  }
  // Stitch left & right seams
  for (let il = 0; il < segL; il++) {
    // left (iw = 0)
    const t0 = il * row
    const t1 = (il + 1) * row
    const b0 = topCount + t0
    const b1 = topCount + t1
    indices.push(t0, b0, t1, t1, b0, b1)
    // right (iw = segW)
    const tr0 = il * row + segW
    const tr1 = (il + 1) * row + segW
    const br0 = topCount + tr0
    const br1 = topCount + tr1
    indices.push(tr0, tr1, br0, tr1, br1, br0)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

function buildSucculent(t: ReturnType<typeof createTracker>): THREE.Group {
  const g = new THREE.Group()

  // Lathe-turned classic terracotta clay pot (~5.7 wide at rim, 3.6 tall)
  const potProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(1.85, 0.0),
    new THREE.Vector2(1.94, 0.14),
    new THREE.Vector2(2.42, 2.55),
    new THREE.Vector2(2.48, 2.75),
    new THREE.Vector2(2.74, 2.86),
    new THREE.Vector2(2.82, 3.0),
    new THREE.Vector2(2.86, 3.62),
    new THREE.Vector2(2.74, 3.74),
    new THREE.Vector2(2.5, 3.74),
    new THREE.Vector2(2.38, 3.62),
    new THREE.Vector2(2.15, 2.85),
    new THREE.Vector2(0.0, 2.85),
  ]
  const potTex = t.tex(makeTerracottaTexture())
  const potMat = t.mat(
    new THREE.MeshStandardMaterial({
      map: potTex,
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.25,
    }),
  )
  const pot = new THREE.Mesh(t.geo(new THREE.LatheGeometry(potProfile, 40)), potMat)
  g.add(pot)

  // Potting soil slightly recessed inside the rim
  const soilTex = t.tex(makeSoilTexture())
  const soilMat = t.mat(
    new THREE.MeshStandardMaterial({
      map: soilTex,
      roughness: 0.96,
      metalness: 0.0,
    }),
  )
  const soil = new THREE.Mesh(t.geo(new THREE.CylinderGeometry(2.36, 2.25, 0.34, 32)), soilMat)
  soil.position.y = 3.44
  g.add(soil)

  // Sculpted echeveria rosette (38 leaves arranged in golden-angle phyllotaxis)
  const leafGeo = t.geo(makeSucculentLeafGeometry())
  const leafMat = t.mat(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.66,
      metalness: 0.02,
      envMapIntensity: 0.35,
    }),
  )

  const rosette = new THREE.Group()
  rosette.position.y = 3.62
  const golden = 137.508 * (Math.PI / 180)
  const totalLeaves = 38
  for (let i = 0; i < totalLeaves; i++) {
    const f = i / (totalLeaves - 1) // 0 = tight center bud, 1 = wide outer ring
    const angle = i * golden
    const scale = 0.42 + Math.pow(f, 0.72) * 1.32
    // Upright inner bud splaying gently upward over the terracotta rim so no leaf ever clips the pot
    const pitch = -1.26 + Math.pow(f, 0.72) * 1.02
    const r = 0.06 + Math.pow(f, 0.9) * 0.62
    const yOff = (1 - f) * 0.42

    const leafPivot = new THREE.Group()
    leafPivot.position.set(Math.sin(angle) * r, yOff, Math.cos(angle) * r)
    leafPivot.rotation.y = angle

    const leaf = new THREE.Mesh(leafGeo, leafMat)
    leaf.rotation.x = pitch
    leaf.scale.set(scale * (0.94 + 0.12 * Math.sin(i * 2.7)), scale, scale)
    leafPivot.add(leaf)
    rosette.add(leafPivot)
  }
  g.add(rosette)

  return g
}

/* ============================================================
   2. CASINO RUBY D6 DIE (16 mm = 1.6 world units)
   ============================================================ */

const D6_PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-0.24, 0.24], [0.24, -0.24]],
  3: [[-0.24, 0.24], [0, 0], [0.24, -0.24]],
  4: [[-0.24, 0.24], [0.24, 0.24], [-0.24, -0.24], [0.24, -0.24]],
  5: [[-0.24, 0.24], [0.24, 0.24], [0, 0], [-0.24, -0.24], [0.24, -0.24]],
  6: [[-0.24, 0.25], [0.24, 0.25], [-0.24, 0], [0.24, 0], [-0.24, -0.25], [0.24, -0.25]],
}

const D6_FACE_BASIS: Record<number, { n: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 }> = {
  1: { n: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, -1) },
  6: { n: new THREE.Vector3(0, -1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1) },
  2: { n: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) },
  5: { n: new THREE.Vector3(0, 0, -1), u: new THREE.Vector3(-1, 0, 0), v: new THREE.Vector3(0, 1, 0) },
  3: { n: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 0, -1), v: new THREE.Vector3(0, 1, 0) },
  4: { n: new THREE.Vector3(-1, 0, 0), u: new THREE.Vector3(0, 0, 1), v: new THREE.Vector3(0, 1, 0) },
}

function buildD6Mesh(t: ReturnType<typeof createTracker>): {
  dieGroup: THREE.Group
  restY: number
  faceQuats: Map<number, THREE.Quaternion>
} {
  const S = 1.6 // 16 mm casino die
  const dieGroup = new THREE.Group()

  // Translucent ruby resin all the way through (an opaque core showed through the shell)
  const shell = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(S, S, S, 5, S * 0.145)),
    t.mat(createResinDiceMaterial(S)),
  )
  dieGroup.add(shell)

  const pipRimGeo = t.geo(new THREE.CircleGeometry(S * 0.096, 18))
  const pipRimMat = t.mat(new THREE.MeshBasicMaterial({ color: '#4c0206', transparent: true, opacity: 0.55 }))
  const pipGeo = t.geo(new THREE.SphereGeometry(S * 0.088, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52))
  const pipMat = t.mat(
    new THREE.MeshStandardMaterial({ color: '#fbf9f6', roughness: 0.25, metalness: 0.02, envMapIntensity: 0.5 }),
  )

  const faceQuats = new Map<number, THREE.Quaternion>()
  for (let face = 1; face <= 6; face++) {
    const { n, u, v } = D6_FACE_BASIS[face]
    // Quaternion aligning local face normal `n` -> world UP_Y (0, 1, 0)
    const basis = new THREE.Matrix4().makeBasis(u, n, new THREE.Vector3().crossVectors(u, n))
    const q = new THREE.Quaternion().setFromRotationMatrix(basis).invert()
    faceQuats.set(face, q)

    const facePlaneQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n))
    const pipOrient = new THREE.Quaternion().setFromUnitVectors(UP_Y, n)
    for (const [px, py] of D6_PIPS[face]) {
      const pos = n
        .clone()
        .multiplyScalar(S * 0.501)
        .addScaledVector(u, px * S)
        .addScaledVector(v, py * S)
      const rim = new THREE.Mesh(pipRimGeo, pipRimMat)
      rim.position.copy(pos)
      rim.quaternion.copy(facePlaneQ)
      dieGroup.add(rim)

      const pip = new THREE.Mesh(pipGeo, pipMat)
      pip.position.copy(pos).addScaledVector(n, -S * 0.008)
      pip.quaternion.copy(pipOrient)
      pip.scale.set(1, 0.28, 1)
      dieGroup.add(pip)
    }
  }

  return { dieGroup, restY: S * 0.5, faceQuats }
}

/* ============================================================
   3. CRYSTAL CRIMSON D20 DIE (21 mm)
   ============================================================ */

function makeD20NumTexture(num: number): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, 128, 128)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${num >= 10 ? 50 : 56}px "Helvetica Neue", Arial, sans-serif`
  ctx.fillStyle = 'rgb(52 0 4 / 0.55)'
  ctx.fillText(String(num), 64, 70)
  ctx.fillStyle = '#faf7f4'
  ctx.fillText(String(num), 64, 67)
  if (num === 6 || num === 9) {
    ctx.strokeStyle = '#faf7f4'
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(46, 97)
    ctx.lineTo(82, 97)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/**
 * Crisp polyhedral beveled icosahedron: 20 dead-flat equilateral triangular faces with subtle,
 * tangent-continuous (G1) rounded edge fillets along all 30 edges and gently domed 12 corners.
 * Preserves sharp geometric facet contrast like a real tumbled resin tabletop d20.
 */
function makeBeveledIcosahedronGeometry(radius: number, inset = 0.075): THREE.BufferGeometry {
  const ref = new THREE.IcosahedronGeometry(radius, 0)
  const pos = ref.attributes.position

  // Deduplicate the 12 vertices
  const verts: THREE.Vector3[] = []
  const vertIndex = (v: THREE.Vector3) => {
    for (let i = 0; i < verts.length; i++) {
      if (verts[i].distanceToSquared(v) < 1e-6) return i
    }
    verts.push(v.clone())
    return verts.length - 1
  }

  interface FaceInfo {
    idx: [number, number, number]
    normal: THREE.Vector3
    center: THREE.Vector3
    shrunk: [THREE.Vector3, THREE.Vector3, THREE.Vector3]
  }
  const faces: FaceInfo[] = []

  for (let i = 0; i < 20; i++) {
    const v0 = new THREE.Vector3().fromBufferAttribute(pos, i * 3)
    const v1 = new THREE.Vector3().fromBufferAttribute(pos, i * 3 + 1)
    const v2 = new THREE.Vector3().fromBufferAttribute(pos, i * 3 + 2)
    const center = new THREE.Vector3().add(v0).add(v1).add(v2).divideScalar(3)
    const n = new THREE.Vector3().crossVectors(v1.clone().sub(v0), v2.clone().sub(v0)).normalize()
    const i0 = vertIndex(v0)
    let i1 = vertIndex(v1)
    let i2 = vertIndex(v2)
    if (n.dot(center) < 0) {
      n.negate()
      const tmp = i1
      i1 = i2
      i2 = tmp
    }
    const p0 = verts[i0].clone().lerp(center, inset)
    const p1 = verts[i1].clone().lerp(center, inset)
    const p2 = verts[i2].clone().lerp(center, inset)
    faces.push({ idx: [i0, i1, i2], normal: n, center, shrunk: [p0, p1, p2] })
  }
  ref.dispose()

  const outPos: number[] = []
  const outNorm: number[] = []
  const pushTri = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    na: THREE.Vector3,
    nb: THREE.Vector3,
    nc: THREE.Vector3,
  ) => {
    outPos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    outNorm.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z)
  }

  // 1. 20 crisp dead-flat triangular faces
  for (const f of faces) {
    pushTri(f.shrunk[0], f.shrunk[1], f.shrunk[2], f.normal, f.normal, f.normal)
  }

  // Map directed edges -> face + shrunk endpoints
  const edgeMap = new Map<string, { f: FaceInfo; pStart: THREE.Vector3; pEnd: THREE.Vector3 }>()
  for (const f of faces) {
    for (let e = 0; e < 3; e++) {
      const a = f.idx[e]
      const b = f.idx[(e + 1) % 3]
      edgeMap.set(`${a}_${b}`, { f, pStart: f.shrunk[e], pEnd: f.shrunk[(e + 1) % 3] })
    }
  }

  // 2. 30 subtle G1-tangent rounded bevel strips bridging adjacent flat faces
  const halfAngle = Math.acos(faces[0].normal.dot(faces[1].normal) > 0.5 ? faces[0].normal.dot(faces[1].normal) : 0.745356) * 0.5
  const bulgeFactor = Math.tan(halfAngle * 0.5)
  const visitedEdges = new Set<string>()
  const BEVEL_SEGS = 4

  for (const [key, e1] of edgeMap) {
    const [aStr, bStr] = key.split('_')
    const revKey = `${bStr}_${aStr}`
    if (visitedEdges.has(key) || visitedEdges.has(revKey)) continue
    const e2 = edgeMap.get(revKey)
    if (!e2) continue
    visitedEdges.add(key)

    const n1 = e1.f.normal
    const n2 = e2.f.normal
    const nMid = n1.clone().add(n2).normalize()
    // Edge runs from vertex a -> b on face 1 (pStart -> pEnd), and b -> a on face 2 (pStart -> pEnd)
    const a1 = e1.pStart
    const b1 = e1.pEnd
    const a2 = e2.pEnd
    const b2 = e2.pStart

    const bulgeA = a1.distanceTo(a2) * 0.5 * bulgeFactor
    const bulgeB = b1.distanceTo(b2) * 0.5 * bulgeFactor

    const stripA: THREE.Vector3[] = []
    const stripB: THREE.Vector3[] = []
    const stripN: THREE.Vector3[] = []
    for (let s = 0; s <= BEVEL_SEGS; s++) {
      const t = s / BEVEL_SEGS
      const arch = Math.sin(t * Math.PI)
      stripA.push(a1.clone().lerp(a2, t).addScaledVector(nMid, bulgeA * arch))
      stripB.push(b1.clone().lerp(b2, t).addScaledVector(nMid, bulgeB * arch))
      stripN.push(n1.clone().lerp(n2, t).normalize())
    }
    for (let s = 0; s < BEVEL_SEGS; s++) {
      // Outward winding from a1 -> b1 -> b2 -> a2
      pushTri(stripA[s], stripA[s + 1], stripB[s], stripN[s], stripN[s + 1], stripN[s])
      pushTri(stripB[s], stripA[s + 1], stripB[s + 1], stripN[s], stripN[s + 1], stripN[s + 1])
    }
  }

  // 3. 12 tight smoothly-domed pentagonal vertex caps
  for (let vi = 0; vi < verts.length; vi++) {
    const vDir = verts[vi].clone().normalize()
    const corners: { p: THREE.Vector3; n: THREE.Vector3; ang: number }[] = []
    const refTan = Math.abs(vDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    const uAxis = new THREE.Vector3().crossVectors(refTan, vDir).normalize()
    const wAxis = new THREE.Vector3().crossVectors(vDir, uAxis).normalize()

    let avgProj = 0
    let avgSpread = 0
    for (const f of faces) {
      const slot = f.idx.indexOf(vi)
      if (slot < 0) continue
      const p = f.shrunk[slot]
      avgProj += p.dot(vDir)
      const rel = p.clone().sub(verts[vi])
      const u = rel.dot(uAxis)
      const w = rel.dot(wAxis)
      avgSpread += Math.hypot(u, w)
      corners.push({ p, n: f.normal, ang: Math.atan2(w, u) })
    }
    corners.sort((a, b) => a.ang - b.ang)
    avgProj /= corners.length
    avgSpread /= corners.length
    const apex = vDir.clone().multiplyScalar(avgProj + avgSpread * 0.24)

    for (let k = 0; k < corners.length; k++) {
      const c0 = corners[k]
      const c1 = corners[(k + 1) % corners.length]
      // Check outward winding against vDir
      const triN = new THREE.Vector3().crossVectors(c0.p.clone().sub(apex), c1.p.clone().sub(apex))
      if (triN.dot(vDir) >= 0) {
        pushTri(apex, c0.p, c1.p, vDir, c0.n, c1.n)
      } else {
        pushTri(apex, c1.p, c0.p, vDir, c1.n, c0.n)
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(outNorm, 3))
  geo.computeBoundingSphere()
  return geo
}

function buildD20Mesh(t: ReturnType<typeof createTracker>): {
  dieGroup: THREE.Group
  restY: number
  faceQuats: Map<number, THREE.Quaternion>
} {
  const radius = 1.56 // chunky ~25 mm face-to-face tabletop d20 (~30 mm across corners)
  const inradius = radius * 0.79465447 // exact icosahedron center-to-face distance
  const dieGroup = new THREE.Group()

  const refGeo = new THREE.IcosahedronGeometry(radius, 0)
  const posAttr = refGeo.attributes.position
  const faceBasis: { normal: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; center: THREE.Vector3 }[] = []

  for (let i = 0; i < 20; i++) {
    const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, i * 3)
    const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i * 3 + 1)
    const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i * 3 + 2)
    const center = new THREE.Vector3().add(v0).add(v1).add(v2).divideScalar(3)
    const e1 = new THREE.Vector3().subVectors(v1, v0)
    const e2 = new THREE.Vector3().subVectors(v2, v0)
    const normal = new THREE.Vector3().crossVectors(e1, e2).normalize()
    if (normal.dot(center) < 0) normal.negate()
    const up = new THREE.Vector3().subVectors(v0, center).normalize()
    const right = new THREE.Vector3().crossVectors(up, normal).normalize()
    up.crossVectors(normal, right).normalize()
    faceBasis.push({ normal, right, up, center })
  }
  refGeo.dispose()

  const beveledGeo = t.geo(makeBeveledIcosahedronGeometry(radius, 0.1))

  const shell = new THREE.Mesh(beveledGeo, t.mat(createResinDiceMaterial(radius * 1.6, 0.62)))
  dieGroup.add(shell)

  const faceQuats = new Map<number, THREE.Quaternion>()
  const labelGeo = t.geo(new THREE.PlaneGeometry(radius * 0.62, radius * 0.62))
  const order = [20, 2, 14, 8, 12, 18, 4, 16, 6, 10, 1, 19, 7, 13, 9, 3, 17, 5, 15, 11]

  for (let i = 0; i < 20; i++) {
    const { normal, right, up, center } = faceBasis[i]
    const facePlaneQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal))
    // Align outward face normal -> +Y and numeral upright toward -Z (facing viewer)
    const uprightBasis = new THREE.Matrix4().makeBasis(right, normal, up.clone().negate())
    const num = order[i]
    faceQuats.set(num, new THREE.Quaternion().setFromRotationMatrix(uprightBasis).invert())

    const tex = t.tex(makeD20NumTexture(num))
    const labelMat = t.mat(
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    )
    const mesh = new THREE.Mesh(labelGeo, labelMat)
    mesh.position.copy(center).addScaledVector(normal, 0.008)
    mesh.quaternion.copy(facePlaneQ)
    dieGroup.add(mesh)
  }

  return { dieGroup, restY: inradius, faceQuats }
}

/* ============================================================
   4. BLACKWING MATTE STUDIO PENCIL (165 mm = 16.5 world units)
   ============================================================ */

/** Lofted Blackwing brass ferrule: cylindrical collar transitioning smoothly into a wide flattened clip sleeve. */
function makeBlackwingFerruleGeometry(r: number, lenCyl: number, lenFlat: number): THREE.BufferGeometry {
  const segX = 24
  const segTheta = 36
  const totalLen = lenCyl + lenFlat
  const positions: number[] = []
  const indices: number[] = []

  for (let ix = 0; ix <= segX; ix++) {
    const u = ix / segX
    const x = u * totalLen
    // 0 during cylindrical collar, smooth S-curve 0..1 across flattened flare
    const flatT = x <= lenCyl ? 0 : Math.min(1, (x - lenCyl) / lenFlat)
    const s = flatT * flatT * (3 - 2 * flatT)

    // Subtle double beaded crimp ridges on the cylindrical portion (matching Blackwing ferrule)
    const bead1 = Math.exp(-Math.pow((x - lenCyl * 0.32) / 0.085, 2)) * 0.042
    const bead2 = Math.exp(-Math.pow((x - lenCyl * 0.72) / 0.085, 2)) * 0.042
    const rCyl = r + bead1 + bead2

    // Target flat rectangular cross-section (wide along Z, thin along Y) with rounded corners
    const targetHalfZ = r * 1.18
    const targetHalfY = r * 0.54

    for (let it = 0; it <= segTheta; it++) {
      const th = (it / segTheta) * Math.PI * 2
      const cos = Math.cos(th)
      const sin = Math.sin(th)

      // Cylindrical circle
      const cy = sin * rCyl
      const cz = cos * rCyl

      // Rounded superellipse rectangle for the flattened Blackwing eraser clip
      const pow = 0.42
      const ry = Math.sign(sin) * Math.pow(Math.abs(sin), pow) * targetHalfY
      const rz = Math.sign(cos) * Math.pow(Math.abs(cos), pow) * targetHalfZ

      const y = cy + (ry - cy) * s
      const z = cz + (rz - cz) * s
      positions.push(x, y, z)
    }
  }

  const ring = segTheta + 1
  for (let ix = 0; ix < segX; ix++) {
    for (let it = 0; it < segTheta; it++) {
      const a = ix * ring + it
      const b = a + 1
      const c = a + ring
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

/** Sharpened cedar cone with mathematically exact 6-point hexagonal black lacquer scallops. */
function makeSharpenedTipGeometry(rHex: number, lenWood: number, rLead: number): THREE.BufferGeometry {
  const segX = 28
  const segTheta = 48
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  const apothem = rHex * Math.cos(Math.PI / 6)
  const blackCol = new THREE.Color('#191a1c')
  const cedarLight = new THREE.Color('#deb992')
  const cedarDark = new THREE.Color('#c59b72')
  const tmp = new THREE.Color()

  for (let ix = 0; ix <= segX; ix++) {
    const u = ix / segX // 0 = lead junction (-lenWood), 1 = full hex barrel (0)
    const x = -lenWood * (1 - u)
    const rCone = rLead + (rHex * 1.01 - rLead) * u

    for (let it = 0; it <= segTheta; it++) {
      const th = (it / segTheta) * Math.PI * 2
      // Hexagonal prism radius at angle th (flat faces aligned to top/bottom)
      const sector = ((((th - Math.PI / 6) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6
      const rPrism = apothem / Math.cos(sector)

      // Clamp surface to the smaller of the rotary sharpener cone and the hexagonal barrel
      const isLacquer = rCone >= rPrism
      const rad = Math.min(rCone, rPrism)
      const y = Math.sin(th) * rad
      const z = Math.cos(th) * rad
      positions.push(x, y, z)

      if (isLacquer) {
        colors.push(blackCol.r, blackCol.g, blackCol.b)
      } else {
        // Subtle fine longitudinal cedar grain rings
        const grain = 0.5 + 0.5 * Math.sin(u * 26 + Math.sin(th * 3) * 1.8)
        tmp.lerpColors(cedarDark, cedarLight, 0.35 + grain * 0.65)
        colors.push(tmp.r, tmp.g, tmp.b)
      }
    }
  }

  const ring = segTheta + 1
  for (let ix = 0; ix < segX; ix++) {
    for (let it = 0; it < segTheta; it++) {
      const a = ix * ring + it
      const b = a + 1
      const c = a + ring
      const d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

function buildPencil(t: ReturnType<typeof createTracker>): THREE.Group {
  const g = new THREE.Group()
  const R = 0.37 // 7.4 mm hex across corners
  const flatY = R * Math.cos(Math.PI / 6) // 0.3204 so hex flat sits flush on table!

  // Group centered along X axis (tip toward -X, Blackwing rectangular eraser toward +X)
  const axis = new THREE.Group()
  axis.position.y = flatY

  // Matte-black lacquered hexagonal wood barrel (11.5 units long)
  const barrelLen = 11.5
  const barrelStartX = -5.75
  const barrelEndX = barrelStartX + barrelLen
  const barrelGeo = t.geo(new THREE.CylinderGeometry(R, R, barrelLen, 6))
  barrelGeo.rotateY(Math.PI / 6)
  barrelGeo.rotateZ(Math.PI / 2)
  const barrelMat = t.mat(
    new THREE.MeshPhysicalMaterial({
      color: 0x191a1c,
      roughness: 0.44,
      metalness: 0.06,
      clearcoat: 0.22,
      clearcoatRoughness: 0.34,
    }),
  )
  const barrel = new THREE.Mesh(barrelGeo, barrelMat)
  barrel.position.x = (barrelStartX + barrelEndX) * 0.5
  axis.add(barrel)

  // Sharpened raw warm cedar cone with authentic 6-scallop hexagonal black lacquer transition
  const woodLen = 1.95
  const rLead = 0.115
  const tipWoodGeo = t.geo(makeSharpenedTipGeometry(R, woodLen, rLead))
  const tipWoodMat = t.mat(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.02,
    }),
  )
  const tipWood = new THREE.Mesh(tipWoodGeo, tipWoodMat)
  tipWood.position.x = barrelStartX
  axis.add(tipWood)

  // Dark metallic-sheen sharpened graphite tip
  const graphiteMat = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0x24262a,
      roughness: 0.3,
      metalness: 0.44,
    }),
  )
  const leadLen = 0.66
  const leadGeo = t.geo(new THREE.ConeGeometry(rLead * 1.02, leadLen, 16))
  leadGeo.rotateZ(Math.PI / 2)
  const lead = new THREE.Mesh(leadGeo, graphiteMat)
  lead.position.x = barrelStartX - woodLen - leadLen * 0.5 + 0.02
  axis.add(lead)

  // Iconic Palomino Blackwing brushed-brass ferrule (beaded cylinder -> wide flattened rectangular sleeve)
  const brassMat = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0xd5b777,
      metalness: 0.88,
      roughness: 0.26,
      envMapIntensity: 1.05,
    }),
  )
  const ferruleCyl = 0.88
  const ferruleFlat = 1.18
  const ferruleGeo = t.geo(makeBlackwingFerruleGeometry(R * 0.96, ferruleCyl, ferruleFlat))
  const ferrule = new THREE.Mesh(ferruleGeo, brassMat)
  ferrule.position.x = barrelEndX - 0.04
  axis.add(ferrule)

  // Signature raised brass clip tab at the flat ferrule mouth holding the rectangular eraser
  const clipTab = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(0.11, R * 1.14, R * 0.68, 2, 0.03)),
    brassMat,
  )
  clipTab.position.x = barrelEndX - 0.04 + ferruleCyl + ferruleFlat - 0.01
  axis.add(clipTab)

  // Signature Blackwing flat square-ish charcoal-grey matte rubber eraser
  const eraserMat = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0x5c5e63,
      roughness: 0.9,
      metalness: 0.0,
    }),
  )
  const eraserLen = 0.78
  const eraser = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(eraserLen, R * 0.86, R * 1.98, 3, 0.065)),
    eraserMat,
  )
  eraser.position.x = barrelEndX - 0.04 + ferruleCyl + ferruleFlat + eraserLen * 0.5 - 0.14
  axis.add(eraser)

  g.add(axis)
  return g
}

/* ============================================================
   5. TEENAGE ENGINEERING ORANGE "ESC" KEYCAP (18 mm)
   ============================================================ */

function makeEscLegendTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ff5a1f'
  ctx.fillRect(0, 0, 256, 256)
  // Subtle concave dish shading
  const g = ctx.createRadialGradient(128, 122, 14, 128, 128, 124)
  g.addColorStop(0, 'rgba(0, 0, 0, 0.09)')
  g.addColorStop(0.75, 'rgba(0, 0, 0, 0.0)')
  g.addColorStop(1, 'rgba(255, 255, 255, 0.08)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  // Crisp silk-screened ESC legend in upper-left TE style
  ctx.fillStyle = '#f8f6f2'
  ctx.font = '600 62px "Helvetica Neue", Helvetica, Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('ESC', 34, 38)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** Sculpted trapezoidal PBT keycap mesh with rounded corners and gently scooped top dish. */
function makeKeycapGeometry(baseW: number, topW: number, h: number): THREE.BufferGeometry {
  // Build a high-res rounded-square frustum by shaping a subdivided BoxGeometry
  const geo = new THREE.BoxGeometry(baseW, h, baseW, 12, 8, 12)
  const pos = geo.attributes.position
  const halfB = baseW * 0.5
  const halfT = topW * 0.5
  const halfH = h * 0.5

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i)
    let y = pos.getY(i)
    let z = pos.getZ(i)
    const ty = (y + halfH) / h // 0 at bottom skirt, 1 at top face

    // Taper smoothly from wide base skirt to narrower sculpted top face (slight backward tilt)
    const scale = 1 - ty * (1 - halfT / halfB)
    x *= scale
    z *= scale
    z -= ty * 0.06

    // Round the 4 vertical corners gently
    const maxC = halfB * scale
    const r = maxC * 0.18
    const ax = Math.abs(x)
    const az = Math.abs(z)
    if (ax > maxC - r && az > maxC - r) {
      const dx = ax - (maxC - r)
      const dz = az - (maxC - r)
      const d = Math.hypot(dx, dz)
      if (d > r) {
        const k = r / d
        x = Math.sign(x) * (maxC - r + dx * k)
        z = Math.sign(z) * (maxC - r + dz * k)
      }
    }

    // Gentle spherical fingertip scoop on the top face + slight top bevel rounding
    if (ty > 0.85) {
      const nx = x / halfT
      const nz = (z + 0.06) / halfT
      const r2 = Math.min(1.4, nx * nx + nz * nz)
      const dish = (1 - Math.min(1, r2 * 0.72)) * 0.085
      const edgeBevel = Math.max(0, r2 - 0.88) * 0.06
      y -= (dish + edgeBevel) * ((ty - 0.85) / 0.15)
    }

    pos.setXYZ(i, x, y + halfH, z)
  }

  geo.computeVertexNormals()
  return geo
}

function buildKeycap(t: ReturnType<typeof createTracker>): THREE.Group {
  const g = new THREE.Group()
  const baseW = 1.82
  const topW = 1.36
  const h = 1.04

  const pbtMat = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0xff5a1f,
      roughness: 0.54,
      metalness: 0.02,
      envMapIntensity: 0.45,
    }),
  )
  const cap = new THREE.Mesh(t.geo(makeKeycapGeometry(baseW, topW, h)), pbtMat)
  g.add(cap)

  // Crisp ESC top-surface legend sitting flush inside the scooped dish
  const legendTex = t.tex(makeEscLegendTexture())
  const legendGeo = t.geo(new THREE.PlaneGeometry(topW * 0.82, topW * 0.82, 8, 8))
  legendGeo.rotateX(-Math.PI / 2)
  // Match the dish curvature
  const lp = legendGeo.attributes.position
  for (let i = 0; i < lp.count; i++) {
    const lx = lp.getX(i)
    const lz = lp.getZ(i)
    const nx = lx / (topW * 0.5)
    const nz = lz / (topW * 0.5)
    const r2 = Math.min(1, (nx * nx + nz * nz) * 0.72)
    lp.setY(i, h - (1 - r2) * 0.085 + 0.008)
  }
  legendGeo.computeVertexNormals()

  const legend = new THREE.Mesh(
    legendGeo,
    t.mat(
      new THREE.MeshStandardMaterial({
        map: legendTex,
        roughness: 0.52,
        metalness: 0.02,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    ),
  )
  legend.position.z = -0.06
  g.add(legend)

  return g
}

/* ============================================================
   6. MATTE-BLACK SPRING-LOADED GUITAR TRIGGER CAPO (84 mm)
   Matched closely to src/assets/props/capo.webp
   ============================================================ */

class HelixSpringCurve extends THREE.Curve<THREE.Vector3> {
  private p0: THREE.Vector3
  private axis: THREE.Vector3
  private u: THREE.Vector3
  private v: THREE.Vector3
  private len: number
  private radius: number
  private turns: number

  constructor(start: THREE.Vector3, end: THREE.Vector3, radius: number, turns: number) {
    super()
    this.p0 = start.clone()
    this.axis = new THREE.Vector3().subVectors(end, start)
    this.len = this.axis.length()
    this.axis.normalize()
    const ref = Math.abs(this.axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    this.u = new THREE.Vector3().crossVectors(this.axis, ref).normalize()
    this.v = new THREE.Vector3().crossVectors(this.axis, this.u).normalize()
    this.radius = radius
    this.turns = turns
  }

  override getPoint(t: number, optionalTarget = new THREE.Vector3()): THREE.Vector3 {
    const ang = t * this.turns * Math.PI * 2
    return optionalTarget
      .copy(this.p0)
      .addScaledVector(this.axis, t * this.len)
      .addScaledVector(this.u, Math.cos(ang) * this.radius)
      .addScaledVector(this.v, Math.sin(ang) * this.radius)
  }
}

function buildCapo(t: ReturnType<typeof createTracker>): THREE.Group {
  const g = new THREE.Group()

  const aluMat = t.mat(
    new THREE.MeshPhysicalMaterial({
      color: 0x1a1c1f,
      roughness: 0.34,
      metalness: 0.62,
      clearcoat: 0.28,
      clearcoatRoughness: 0.32,
      envMapIntensity: 0.95,
    }),
  )
  const rubberMat = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0x34363a,
      roughness: 0.88,
      metalness: 0.02,
    }),
  )
  const springMat = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0x9aa0a8,
      roughness: 0.24,
      metalness: 0.9,
    }),
  )
  const rivetMat = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0xd8dce2,
      roughness: 0.2,
      metalness: 0.94,
    }),
  )

  const extrudeOpts = (depth: number, bevel = 0.09): THREE.ExtrudeGeometryOptions => ({
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.85,
    bevelSegments: 3,
    curveSegments: 24,
  })

  // Note: ExtrudeGeometry + rotateX(PI/2) maps Shape (sx, sy) -> World (x = sx, z = sy),
  // matching capo.png orientation directly (-Z = top bar, +Z = bottom handles).
  const H_BODY = 0.78
  const BEVEL = 0.095

  // 1. Upper Fretboard Bar + Pivot Knuckle + Sweeping Left Rear Handle
  const upperShape = new THREE.Shape()
  upperShape.moveTo(-2.78, -2.68)
  upperShape.quadraticCurveTo(-2.42, -3.38, -1.6, -3.36)
  // Long sleek tapered top fretboard backplate running right
  upperShape.quadraticCurveTo(1.2, -3.3, 3.88, -2.92)
  upperShape.quadraticCurveTo(4.14, -2.86, 4.12, -2.64)
  upperShape.quadraticCurveTo(4.08, -2.44, 3.82, -2.44)
  upperShape.quadraticCurveTo(1.2, -2.66, -1.12, -2.64)
  // Wraps tightly under the round pivot hub into the inner left handle wall
  upperShape.quadraticCurveTo(-1.32, -2.0, -1.9, -1.48)
  upperShape.quadraticCurveTo(-2.6, 0.05, -3.32, 2.02)
  upperShape.quadraticCurveTo(-3.46, 2.72, -3.32, 3.24)
  upperShape.quadraticCurveTo(-3.36, 3.48, -3.62, 3.44)
  upperShape.quadraticCurveTo(-3.98, 3.3, -4.02, 2.55)
  upperShape.quadraticCurveTo(-4.0, 1.65, -3.45, 0.25)
  upperShape.quadraticCurveTo(-3.1, -1.25, -2.78, -2.68)

  const upperGeo = t.geo(new THREE.ExtrudeGeometry(upperShape, extrudeOpts(H_BODY, BEVEL)))
  upperGeo.rotateX(Math.PI / 2)
  const upperBody = new THREE.Mesh(upperGeo, aluMat)
  upperBody.position.y = H_BODY + BEVEL
  g.add(upperBody)

  // 2. Thick rectangular dark-charcoal silicone fretboard clamping pad nestled under the top bar
  const fretPadShape = new THREE.Shape()
  fretPadShape.moveTo(-1.12, -2.62)
  fretPadShape.quadraticCurveTo(1.3, -2.62, 3.86, -2.45)
  fretPadShape.quadraticCurveTo(4.0, -2.42, 3.92, -2.14)
  fretPadShape.quadraticCurveTo(3.84, -2.02, 3.62, -2.04)
  fretPadShape.quadraticCurveTo(1.25, -2.18, -1.04, -2.16)
  fretPadShape.quadraticCurveTo(-1.24, -2.26, -1.12, -2.62)

  const fretPadGeo = t.geo(new THREE.ExtrudeGeometry(fretPadShape, extrudeOpts(0.74, 0.06)))
  fretPadGeo.rotateX(Math.PI / 2)
  const fretPad = new THREE.Mesh(fretPadGeo, rubberMat)
  fretPad.position.y = 0.74 + 0.06 + 0.04
  g.add(fretPad)

  // 3. Soft curved rubber thumb pad along the outer lower-left handle
  const thumbPadShape = new THREE.Shape()
  thumbPadShape.moveTo(-3.48, 0.35)
  thumbPadShape.quadraticCurveTo(-4.14, 1.65, -4.16, 2.68)
  thumbPadShape.quadraticCurveTo(-4.16, 3.15, -3.96, 3.22)
  thumbPadShape.quadraticCurveTo(-3.84, 2.55, -3.86, 1.85)
  thumbPadShape.quadraticCurveTo(-3.68, 1.0, -3.36, 0.42)
  thumbPadShape.closePath()
  const thumbPadGeo = t.geo(new THREE.ExtrudeGeometry(thumbPadShape, extrudeOpts(0.68, 0.055)))
  thumbPadGeo.rotateX(Math.PI / 2)
  const thumbPad = new THREE.Mesh(thumbPadGeo, rubberMat)
  thumbPad.position.y = 0.68 + 0.055 + 0.07
  g.add(thumbPad)

  // 4. Articulated Lower Neck-Cradle Jaw + Sleek Curved Right Trigger Lever
  const lowerShape = new THREE.Shape()
  lowerShape.moveTo(-1.76, -1.8)
  // Deep smooth U-shaped guitar neck cradle sweeping down then up to the right beak
  lowerShape.quadraticCurveTo(-0.85, -0.58, 0.52, -0.62)
  lowerShape.quadraticCurveTo(1.65, -0.66, 2.58, -1.04)
  lowerShape.quadraticCurveTo(2.8, -1.1, 2.76, -0.92)
  // Crisp outer scoop sweeping down into the curved right trigger lever
  lowerShape.quadraticCurveTo(2.05, -0.32, 1.92, 0.42)
  lowerShape.quadraticCurveTo(1.86, 1.25, 2.86, 2.66)
  lowerShape.quadraticCurveTo(2.98, 2.88, 2.74, 2.98)
  lowerShape.quadraticCurveTo(2.5, 3.04, 2.36, 2.78)
  lowerShape.quadraticCurveTo(1.48, 1.38, 1.44, 0.42)
  lowerShape.quadraticCurveTo(1.42, -0.18, 0.72, -0.16)
  // Flat spring-seat boss under the cradle facing the left handle
  lowerShape.quadraticCurveTo(-0.28, -0.02, -1.32, -0.06)
  lowerShape.lineTo(-1.38, -0.42)
  lowerShape.quadraticCurveTo(-1.78, -0.98, -2.08, -1.52)
  lowerShape.closePath()

  const lowerGeo = t.geo(new THREE.ExtrudeGeometry(lowerShape, extrudeOpts(0.7, 0.085)))
  lowerGeo.rotateX(Math.PI / 2)
  const lowerArm = new THREE.Mesh(lowerGeo, aluMat)
  lowerArm.position.y = 0.7 + 0.085 + 0.05
  g.add(lowerArm)

  // 5. Cushioned charcoal silicone neck-cradle pad lining the inside U-curve of the lower jaw
  const neckPadShape = new THREE.Shape()
  neckPadShape.moveTo(-1.42, -1.84)
  neckPadShape.quadraticCurveTo(-0.62, -0.82, 0.62, -0.86)
  neckPadShape.quadraticCurveTo(1.65, -0.9, 2.46, -1.24)
  neckPadShape.quadraticCurveTo(2.62, -1.26, 2.56, -1.02)
  neckPadShape.quadraticCurveTo(1.65, -0.62, 0.52, -0.58)
  neckPadShape.quadraticCurveTo(-0.82, -0.54, -1.62, -1.68)
  neckPadShape.closePath()
  const neckPadGeo = t.geo(new THREE.ExtrudeGeometry(neckPadShape, extrudeOpts(0.68, 0.055)))
  neckPadGeo.rotateX(Math.PI / 2)
  const neckPad = new THREE.Mesh(neckPadGeo, rubberMat)
  neckPad.position.y = 0.68 + 0.055 + 0.07
  g.add(neckPad)

  // 6. Round machined circular pivot hub + recessed seam ring + brushed stainless steel center rivet
  const hubX = -2.08
  const hubZ = -2.38
  const hub = new THREE.Mesh(t.geo(new THREE.CylinderGeometry(0.68, 0.7, H_BODY + BEVEL * 2 + 0.05, 28)), aluMat)
  hub.position.set(hubX, (H_BODY + BEVEL * 2 + 0.05) * 0.5, hubZ)
  g.add(hub)

  const hubGroove = new THREE.Mesh(
    t.geo(new THREE.TorusGeometry(0.67, 0.025, 8, 28)).rotateX(Math.PI / 2),
    t.mat(new THREE.MeshBasicMaterial({ color: 0x0b0c0e })),
  )
  hubGroove.position.set(hubX, H_BODY + BEVEL * 2 + 0.045, hubZ)
  g.add(hubGroove)

  const rivet = new THREE.Mesh(t.geo(new THREE.CylinderGeometry(0.22, 0.22, H_BODY + BEVEL * 2 + 0.09, 20)), rivetMat)
  rivet.position.set(hubX, (H_BODY + BEVEL * 2 + 0.09) * 0.5, hubZ)
  g.add(rivet)

  // 7. Real 3D helical steel compression spring wedged cleanly in the V-pocket between handle & jaw
  const springStart = new THREE.Vector3(-2.5, 0.48, -0.56)
  const springEnd = new THREE.Vector3(-1.3, 0.48, -0.34)
  const helix = new HelixSpringCurve(springStart, springEnd, 0.27, 6.5)
  const spring = new THREE.Mesh(t.geo(new THREE.TubeGeometry(helix, 96, 0.056, 10, false)), springMat)
  g.add(spring)

  return g
}

/* ============================================================
   7. AMBER GLASS APOTHECARY CANDLE (54 mm × 58 mm, live flame!)
   ============================================================ */

function makeCandleLabelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#eee8dc'
  ctx.fillRect(0, 0, 512, 256)

  ctx.strokeStyle = 'rgba(35, 32, 28, 0.22)'
  ctx.lineWidth = 3
  ctx.strokeRect(18, 18, 476, 220)

  ctx.fillStyle = '#23201c'
  ctx.textAlign = 'center'
  ctx.font = '600 22px "Helvetica Neue", Helvetica, Arial, sans-serif'
  ctx.fillText('NO. 04 · STUDIO', 256, 76)
  ctx.font = '700 42px "Helvetica Neue", Helvetica, Arial, sans-serif'
  ctx.fillText('CEDAR + AMBER', 256, 134)
  ctx.font = '500 18px "Helvetica Neue", Helvetica, Arial, sans-serif'
  ctx.fillStyle = '#6c6458'
  ctx.fillText('HAND-POURED SOY WAX · 60G', 256, 186)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function buildCandle(t: ReturnType<typeof createTracker>): {
  group: THREE.Group
  update: (dt: number) => void
  toggle: () => void
  isLit: () => boolean
} {
  const g = new THREE.Group()
  const R = 2.65
  const H = 5.6

  // Solid poured cream soy wax recessed inside the amber glass jar
  const waxMat = t.mat(
    new THREE.MeshStandardMaterial({
      color: 0xf0e7d4,
      emissive: 0x3a1c04,
      emissiveIntensity: 0.42,
      roughness: 0.62,
      metalness: 0.0,
    }),
  )
  function turned(points: number[][]) {
    return t.geo(new THREE.LatheGeometry(points.map(([r,y]) => new THREE.Vector2(r,y)), 64))
  }
  const waxY = H - 1
  // The solid wax surface drops into the melt pool. Their edges meet at one ring.
  const wax = new THREE.Mesh(turned([[R-.19,waxY-.32],[R-.19,waxY+.04],
    [R-.29,waxY+.08],[1.65,waxY+.025],[1.25,waxY-.06]]), waxMat)
  g.add(wax)
  const poolMat = t.mat(new THREE.MeshPhysicalMaterial({
    color: 0xd8ae76, emissive: 0x5c2b06, emissiveIntensity: .28,
    roughness: .19, clearcoat: .7,
  }))
  g.add(new THREE.Mesh(turned([[1.25,waxY-.06],[.86,waxY-.13],[0,waxY-.15]]),poolMat))

  // Dense amber below the fill line occludes the wick and the flame from below.
  const bodyMat = t.mat(new THREE.MeshPhysicalMaterial({
    color: 0x754020, roughness: .22, clearcoat: .95, clearcoatRoughness: .11,
  }))
  const collarMat = t.mat(new THREE.MeshPhysicalMaterial({
    color: 0xab6531, roughness: .17, clearcoat: 1, transparent: true,
    opacity: .62, depthWrite: false,
  }))
  const jarBody = new THREE.Mesh(turned([[0,0],[R-.23,0],[R-.10,.07],
    [R,.28],[R,waxY],[R-.16,waxY],[R-.16,.34],[0,.34]]),bodyMat)
  const collar = new THREE.Mesh(turned([[R,waxY],[R,H-.16],[R-.025,H-.055],
    [R-.10,H],[R-.18,H-.04],[R-.20,H-.13],[R-.16,waxY]]),collarMat)
  collar.renderOrder = 2
  g.add(jarBody, collar)

  // Wrap-around cream apothecary label on front arc of the jar
  const labelTex = t.tex(makeCandleLabelTexture())
  const labelGeo = t.geo(new THREE.CylinderGeometry(R + 0.035, R + 0.035, 2.55, 28, 1, true, -0.95, 1.9))
  const label = new THREE.Mesh(
    labelGeo,
    t.mat(new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.84, metalness: 0.0 })),
  )
  label.position.y = 2.55
  g.add(label)

  // Charred dark braided cotton wick
  const wick = new THREE.Mesh(
    t.geo(new THREE.CylinderGeometry(0.055, 0.075, 0.72, 8)),
    t.mat(new THREE.MeshStandardMaterial({ color: 0x1c1816, roughness: 0.95 })),
  )
  wick.position.set(0.04, H - 0.83, 0)
  wick.rotation.z = -0.14
  g.add(wick)

  // Flickering flame and local warm light
  const flameGroup = new THREE.Group()
  flameGroup.position.set(0.08, H - 0.53, 0)
  g.add(flameGroup)

  const flame = new THREE.Mesh(
    turned([[0,0],[.11,.08],[.19,.29],[.17,.53],[.11,.76],[.055,.99],[0,1.27]]),
    t.mat(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })),
  )
  const pos = flame.geometry.getAttribute('position')
  const colors = []
  const amber = new THREE.Color(0xffa331), ivory = new THREE.Color(0xfff2be)
  const shade = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    pos.setX(i, pos.getX(i) + .10*y*y)
    shade.copy(ivory).lerp(amber, Math.min(1, y*.9))
    colors.push(shade.r, shade.g, shade.b)
  }
  flame.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors,3))
  flameGroup.add(flame)

  const light = new THREE.PointLight(0xffa038, 6, 19, 2)
  light.position.set(0, H + 0.6, 0)
  g.add(light)

  let lit = true
  let phase = Math.random() * 100

  return {
    group: g,
    isLit: () => lit,
    toggle() {
      lit = !lit
      flameGroup.visible = lit
      light.intensity = lit ? 6 : 0
      waxMat.emissiveIntensity = lit ? 0.42 : 0
      poolMat.emissiveIntensity = lit ? 0.28 : 0
    },
    update(dt: number) {
      if (!lit) return
      phase += dt
      const f1 = Math.sin(phase * 11.3) * 0.5 + Math.sin(phase * 19.7 + 1.4) * 0.3 + Math.sin(phase * 29.1) * 0.2
      const f2 = Math.cos(phase * 7.8 + 0.6)
      flameGroup.rotation.z = f1 * 0.09
      flameGroup.rotation.x = f2 * 0.06
      const sy = 0.94 + f1 * 0.11
      const sx = 1.0 - f1 * 0.05
      flameGroup.scale.set(sx, sy, sx)
      light.intensity = 6 + f1 * 1.1
    },
  }
}

/* ============================================================
   8. MATTE SPECKLED ARCHITECTURAL STONEWARE MUG OF TEA
      (92 mm × 70 mm squat bevel-base body, solid tab handle, live steam!)
   ============================================================ */

function makeStonewareGlazeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 512
  const ctx = c.getContext('2d')!

  // Clean, refined satin-matte pale warm-stone studio stoneware glaze
  const g = ctx.createLinearGradient(0, 0, 0, 512)
  g.addColorStop(0, '#dedbd4')
  g.addColorStop(0.55, '#d7d3cb')
  g.addColorStop(1, '#d0ccc3')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 512, 512)

  let seed = 62119
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }

  // Delicate, sparse high-fire stoneware mineral pinpoints (refined ceramic, never blotchy)
  for (let i = 0; i < 240; i++) {
    const x = rand() * 512
    const y = rand() * 512
    const accent = rand() > 0.94
    const r = accent ? 0.85 + rand() * 0.3 : 0.35 + rand() * 0.4
    const alpha = accent ? 0.22 + rand() * 0.12 : 0.08 + rand() * 0.11
    ctx.fillStyle = `rgba(68, 62, 54, ${alpha})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Ultra-fine porcelain/stoneware satin micro-texture
  for (let i = 0; i < 650; i++) {
    const x = rand() * 512
    const y = rand() * 512
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,253,249,0.035)' : 'rgba(84,78,70,0.025)'
    ctx.fillRect(x, y, 1, 1)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

function makeRawClayBaseTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const ctx = c.getContext('2d')!

  // Clean smooth unglazed raw stoneware clay foot
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, '#7c756d')
  g.addColorStop(0.6, '#716a62')
  g.addColorStop(1, '#645e56')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)

  let seed = 31907
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let i = 0; i < 520; i++) {
    const x = rand() * 256
    const y = rand() * 256
    const r = 0.45 + rand() * 0.65
    ctx.fillStyle = rand() > 0.45 ? 'rgba(42, 38, 33, 0.1)' : 'rgba(190, 182, 170, 0.08)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

function makeSteamTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 58)
  g.addColorStop(0, 'rgba(255, 252, 246, 0.34)')
  g.addColorStop(0.5, 'rgba(255, 250, 244, 0.14)')
  g.addColorStop(1, 'rgba(255, 250, 244, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeTeaSurfaceTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const ctx = c.getContext('2d')!
  // Rich realistic steeped black-tea depth: deep mahogany-amber center warming to golden honey at the ceramic wall
  const g = ctx.createRadialGradient(128, 128, 12, 128, 128, 128)
  g.addColorStop(0, '#4f1e07')
  g.addColorStop(0.55, '#682a0a')
  g.addColorStop(0.84, '#883c10')
  g.addColorStop(0.96, '#a55219')
  g.addColorStop(1, '#7a3b14')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)

  // Subtle organic micro tea-leaf steep flecks
  let seed = 77419
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let i = 0; i < 120; i++) {
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * 112
    ctx.fillStyle = `rgba(34, 12, 3, ${0.14 + rand() * 0.2})`
    ctx.beginPath()
    ctx.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 0.7 + rand() * 1.3, 0, Math.PI * 2)
    ctx.fill()
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function buildTeaMug(t: ReturnType<typeof createTracker>): {
  group: THREE.Group
  update: (dt: number) => void
} {
  const g = new THREE.Group()

  const glazeTex = t.tex(makeStonewareGlazeTexture())
  const clayTex = t.tex(makeRawClayBaseTexture())

  // Refined satin-matte studio ceramic glaze (DoubleSide so interior walls & floor are 100% solid opaque!)
  const glazeMat = t.mat(
    new THREE.MeshPhysicalMaterial({
      map: glazeTex,
      roughness: 0.64,
      metalness: 0.01,
      clearcoat: 0.14,
      clearcoatRoughness: 0.52,
      envMapIntensity: 0.42,
      side: THREE.DoubleSide,
    }),
  )

  // Unglazed raw dark-taupe stoneware clay lower tapered foot (DoubleSide solid base)
  const rawClayMat = t.mat(
    new THREE.MeshStandardMaterial({
      map: clayTex,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.22,
      side: THREE.DoubleSide,
    }),
  )

  // 1. Lower unglazed chamfered base (flat foot r=3.05 tapering cleanly out to shoulder r=4.58 at y=1.66)
  const baseProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(3.02, 0.0),
    new THREE.Vector2(3.2, 0.14),
    new THREE.Vector2(3.68, 0.6),
    new THREE.Vector2(4.18, 1.15),
    new THREE.Vector2(4.56, 1.64),
    new THREE.Vector2(4.58, 1.68),
    new THREE.Vector2(4.1, 1.68),
  ]
  const baseMesh = new THREE.Mesh(t.geo(new THREE.LatheGeometry(baseProfile, 52)), rawClayMat)
  g.add(baseMesh)

  // 2. Upper straight architectural cylinder + clean rim + glazed smooth interior (r=4.62, H=7.0)
  const bodyProfile = [
    new THREE.Vector2(4.58, 1.66),
    new THREE.Vector2(4.61, 2.0),
    new THREE.Vector2(4.62, 4.4),
    new THREE.Vector2(4.62, 6.74),
    new THREE.Vector2(4.58, 6.91),
    new THREE.Vector2(4.42, 7.0),
    new THREE.Vector2(4.24, 6.96),
    new THREE.Vector2(4.16, 6.78),
    new THREE.Vector2(4.12, 2.2),
    new THREE.Vector2(3.65, 1.15),
    new THREE.Vector2(2.7, 0.72),
    new THREE.Vector2(0.0, 0.68),
  ]
  const bodyMesh = new THREE.Mesh(t.geo(new THREE.LatheGeometry(bodyProfile, 52)), glazeMat)
  g.add(bodyMesh)

  // 3. Signature solid flat rectangular ceramic tab/fin handle (matte speckled glaze)
  const tabHandle = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(2.48, 3.45, 0.92, 4, 0.22)),
    glazeMat,
  )
  tabHandle.position.set(5.66, 4.68, 0)
  g.add(tabHandle)

  // Subtle hand-slipped ceramic join fillet where the flat tab meets the cylinder wall
  const tabFillet = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(0.48, 3.64, 1.18, 3, 0.24)),
    glazeMat,
  )
  tabFillet.position.set(4.63, 4.68, 0)
  g.add(tabFillet)

  // 4. Steeped rich amber-honey tea surface inside the wide squat mug (fully opaque so nothing beneath ever bleeds through!)
  const Y_TEA = 5.65
  const teaTex = t.tex(makeTeaSurfaceTexture())
  const teaMat = t.mat(
    new THREE.MeshPhysicalMaterial({
      map: teaTex,
      roughness: 0.05,
      metalness: 0.02,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      ior: 1.33,
      envMapIntensity: 1.35,
    }),
  )
  const teaDisk = new THREE.Mesh(t.geo(new THREE.CircleGeometry(4.14, 48)).rotateX(-Math.PI / 2), teaMat)
  teaDisk.position.y = Y_TEA
  g.add(teaDisk)

  // Solid ceramic inner floor plug right above the base for guaranteed zero light-leakage from below
  const innerFloor = new THREE.Mesh(t.geo(new THREE.CircleGeometry(3.8, 36)).rotateX(-Math.PI / 2), glazeMat)
  innerFloor.position.y = 0.75
  g.add(innerFloor)

  // 5. Thin cotton tea-bag string draping cleanly over the opposite rim to a natural paper tag
  const stringCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.8, 5.55, 0.9),
    new THREE.Vector3(-3.3, 6.25, 1.45),
    new THREE.Vector3(-4.22, 7.06, 1.78),
    new THREE.Vector3(-4.72, 6.45, 1.98),
    new THREE.Vector3(-4.84, 4.55, 2.04),
  ])
  const stringMesh = new THREE.Mesh(
    t.geo(new THREE.TubeGeometry(stringCurve, 24, 0.045, 6, false)),
    t.mat(new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.9 })),
  )
  g.add(stringMesh)

  const tag = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(1.15, 1.42, 0.08, 2, 0.03)),
    t.mat(new THREE.MeshStandardMaterial({ color: 0xe6dfd1, roughness: 0.88 })),
  )
  tag.position.set(-4.84, 3.9, 2.04)
  tag.rotation.y = Math.atan2(2.04, -4.84) + Math.PI / 2
  g.add(tag)

  // 6. Gently rising translucent 3D steam puffs
  const steamTex = t.tex(makeSteamTexture())
  const puffs: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; age: number; offset: number }[] = []
  for (let i = 0; i < 4; i++) {
    const mat = t.mat(
      new THREE.SpriteMaterial({
        map: steamTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    )
    const sprite = new THREE.Sprite(mat)
    sprite.position.set(0, 6.2, 0)
    g.add(sprite)
    puffs.push({ sprite, mat, age: i * 0.25, offset: i * 1.7 })
  }

  return {
    group: g,
    update(dt: number) {
      for (const p of puffs) {
        p.age = (p.age + dt * 0.24) % 1
        const u = p.age
        p.sprite.position.set(
          Math.sin(u * Math.PI * 2 + p.offset) * 0.95,
          6.1 + u * 6.5,
          Math.cos(u * Math.PI * 1.6 + p.offset) * 0.8,
        )
        const s = 1.8 + u * 4.0
        p.sprite.scale.set(s, s * 1.15, 1)
        p.mat.opacity = Math.sin(u * Math.PI) * 0.4
      }
    },
  }
}

/* ============================================================
   9. MINI ZIP-LOCK "FUN" BAGGIE (40 × 48 mm, solid pillowed 3D pouch)
   ============================================================ */

function makeBaggiePrintTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 640
  const ctx = c.getContext('2d')!

  // Frosted pearlescent-clear polyethylene base (opaque/solid-feeling with soft ambient bounce)
  const base = ctx.createLinearGradient(0, 0, 512, 640)
  base.addColorStop(0, '#dde4ec')
  base.addColorStop(0.35, '#eef3f8')
  base.addColorStop(0.65, '#d5dde7')
  base.addColorStop(1, '#e6ecf3')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 512, 640)

  // Subtle pillowed interior air-cushion shading so the pouch reads with real 3D fullness
  const pillow = ctx.createRadialGradient(256, 390, 36, 256, 390, 260)
  pillow.addColorStop(0, 'rgba(255, 255, 255, 0.55)')
  pillow.addColorStop(0.62, 'rgba(224, 232, 242, 0.16)')
  pillow.addColorStop(1, 'rgba(130, 144, 162, 0.26)')
  ctx.fillStyle = pillow
  ctx.fillRect(0, 118, 512, 522)

  // Glossy diagonal polyethylene crinkle sheen bands
  const sheen = ctx.createLinearGradient(40, 60, 470, 580)
  sheen.addColorStop(0, 'rgba(255,255,255,0.42)')
  sheen.addColorStop(0.24, 'rgba(255,255,255,0.02)')
  sheen.addColorStop(0.42, 'rgba(255,255,255,0.52)')
  sheen.addColorStop(0.56, 'rgba(148,162,178,0.12)')
  sheen.addColorStop(0.76, 'rgba(255,255,255,0.34)')
  sheen.addColorStop(1, 'rgba(255,255,255,0.08)')
  ctx.fillStyle = sheen
  ctx.fillRect(0, 0, 512, 640)

  // Crisp crimped heat-sealed side & bottom borders
  ctx.strokeStyle = 'rgba(142, 154, 168, 0.58)'
  ctx.lineWidth = 4
  ctx.strokeRect(18, 12, 476, 616)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.52)'
  ctx.fillRect(0, 0, 18, 640)
  ctx.fillRect(494, 0, 18, 640)
  ctx.fillRect(0, 622, 512, 18)

  // Fine diagonal crimp ticks along left & right heat-sealed edges
  ctx.strokeStyle = 'rgba(136, 148, 162, 0.4)'
  ctx.lineWidth = 2
  for (let y = 10; y < 632; y += 10) {
    ctx.beginPath()
    ctx.moveTo(2, y)
    ctx.lineTo(16, y + 6)
    ctx.moveTo(496, y)
    ctx.lineTo(510, y + 6)
    ctx.stroke()
  }

  // Top flap region slightly cooler/thinner above the zip seal
  ctx.fillStyle = 'rgba(166, 178, 194, 0.14)'
  ctx.fillRect(18, 12, 476, 98)

  // Signature coral-red zip-lock seal line + white inner lock groove
  ctx.fillStyle = '#e03630'
  ctx.fillRect(16, 110, 480, 18)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)'
  ctx.fillRect(16, 128, 480, 7)
  ctx.fillStyle = 'rgba(120, 26, 22, 0.25)'
  ctx.fillRect(16, 135, 480, 4)

  // Playful acid-house yellow smiley emblem printed cleanly on the pillowed front
  const sx = 256
  const sy = 392
  const sr = 86
  ctx.fillStyle = '#ffd526'
  ctx.beginPath()
  ctx.arc(sx, sy, sr, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#181816'
  ctx.lineWidth = 9
  ctx.stroke()

  // Eyes & wide acid smiley grin
  ctx.fillStyle = '#181816'
  ctx.beginPath()
  ctx.ellipse(sx - 27, sy - 22, 9.5, 16, 0, 0, Math.PI * 2)
  ctx.ellipse(sx + 27, sy - 22, 9.5, 16, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.beginPath()
  ctx.arc(sx, sy + 5, 49, 0.18 * Math.PI, 0.82 * Math.PI)
  ctx.lineWidth = 9.5
  ctx.lineCap = 'round'
  ctx.stroke()

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function buildBaggie(t: ReturnType<typeof createTracker>): THREE.Group {
  const g = new THREE.Group()
  const W = 4.0
  const D = 4.8

  // Real 3D pillowed polyethylene zip-lock pouch sitting strictly above y = 0 (never clips table!)
  const geo = t.geo(new THREE.BoxGeometry(W, 1, D, 24, 2, 28))
  const pos = geo.attributes.position

  const surfaceHeights = (x: number, z: number): { bot: number; top: number } => {
    const u = x / (W * 0.5) // -1..1
    const v = z / (D * 0.5) // -1 (top flap) .. +1 (bottom edge)
    const zipV = -0.62

    // Sealed pillow pocket occupies v in [zipV + 0.09 .. +0.92], |u| < 0.90 (stays well clear of the red zip bar)
    const uEdge = Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(u) / 0.9), 2.4))
    let vPillow = 0
    if (v > zipV + 0.09 && v < 0.92) {
      const vt = (v - (zipV + 0.09)) / (0.92 - (zipV + 0.09))
      vPillow = Math.pow(Math.sin(vt * Math.PI), 0.72)
    }

    const puff = uEdge * vPillow * 0.28
    const crinkle =
      uEdge *
      vPillow *
      (Math.sin(x * 2.5 + z * 1.9) * 0.018 + Math.cos(x * 4.2 - z * 3.1) * 0.01)

    // Subtle open-flap curl above the red zip seal
    const flapLift = v < zipV - 0.04 ? Math.pow((zipV - 0.04 - v) / (0.96 + zipV), 1.55) * 0.09 : 0

    // Bottom strictly >= 0.02 so the tabletop never pokes through!
    const bot = 0.02 + flapLift * 0.35
    const top = Math.max(bot + 0.07, 0.09 + puff + crinkle + flapLift)
    return { bot, top }
  }

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const { bot, top } = surfaceHeights(x, z)
    if (y > 0.1) pos.setY(i, top)
    else if (y < -0.1) pos.setY(i, bot)
    else pos.setY(i, (bot + top) * 0.5)
  }
  geo.computeVertexNormals()

  const printTex = t.tex(makeBaggiePrintTexture())
  const topMat = t.mat(
    new THREE.MeshPhysicalMaterial({
      map: printTex,
      roughness: 0.18,
      metalness: 0.04,
      clearcoat: 1.0,
      clearcoatRoughness: 0.07,
      ior: 1.48,
      envMapIntensity: 1.35,
    }),
  )
  const sideMat = t.mat(
    new THREE.MeshPhysicalMaterial({
      color: 0xdce4ee,
      roughness: 0.22,
      metalness: 0.03,
      clearcoat: 0.9,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.15,
    }),
  )
  // BoxGeometry material groups: [+x, -x, +y (printed top), -y (bottom), +z, -z]
  const pouch = new THREE.Mesh(geo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat])
  g.add(pouch)

  // Raised tactile 3D red zip-track ridge seated cleanly on the sculpted surface
  const zipZ = -0.62 * (D * 0.5)
  const zipH = surfaceHeights(0, zipZ).top
  const zipTrack = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(W - 0.16, 0.09, 0.13, 2, 0.025)),
    t.mat(new THREE.MeshPhysicalMaterial({ color: 0xe2362f, roughness: 0.24, clearcoat: 0.85 })),
  )
  zipTrack.position.set(0, zipH + 0.04, zipZ)
  g.add(zipTrack)

  // Secondary crisp white interlock groove right beneath the red zip bar
  const lockBead = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(W - 0.2, 0.055, 0.07, 2, 0.02)),
    t.mat(new THREE.MeshPhysicalMaterial({ color: 0xf4f7fb, roughness: 0.22, clearcoat: 0.8 })),
  )
  lockBead.position.set(0, zipH + 0.025, zipZ + 0.095)
  g.add(lockBead)

  // Slightly parted upper flap lip at the top edge for authentic zip-bag silhouette
  const topLip = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(W - 0.1, 0.035, 0.34, 2, 0.01)),
    sideMat,
  )
  topLip.position.set(0, 0.2, -D * 0.5 + 0.2)
  topLip.rotation.x = 0.18
  g.add(topLip)

  return g
}

/* ============================================================
   10. RUSTIC CERAMIC TILE COASTER (108 × 108 × 8.4 mm, Pine Barrens!)
   ============================================================ */

function makeCoasterEdgeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const ctx = c.getContext('2d')!
  // Chalky matte handmade off-white ceramic/travertine tile edge
  ctx.fillStyle = '#e7e2d7'
  ctx.fillRect(0, 0, 256, 64)
  let seed = 55109
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let i = 0; i < 900; i++) {
    const x = rand() * 256
    const y = rand() * 64
    const r = 0.6 + rand() * 1.8
    ctx.fillStyle = rand() > 0.55 ? 'rgba(255,253,248,0.22)' : 'rgba(138,128,112,0.16)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // Subtle uneven stone edge lip highlights
  for (let i = 0; i < 36; i++) {
    const x = rand() * 256
    const w = 6 + rand() * 20
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,252,245,0.14)' : 'rgba(116,106,92,0.12)'
    ctx.fillRect(x, rand() * 58, w, 2 + rand() * 4)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

function buildCoaster(t: ReturnType<typeof createTracker>): THREE.Group {
  const g = new THREE.Group()
  const W = 10.8
  const D = 10.8
  const corkH = 0.08
  const tileH = COASTER_H - corkH // 0.76

  // 1. Dark natural cork backing pad inset slightly under the stone tile
  const cork = new THREE.Mesh(
    t.geo(new THREE.BoxGeometry(W - 0.55, corkH, D - 0.55)),
    t.mat(new THREE.MeshStandardMaterial({ color: 0x5c4632, roughness: 0.96, metalness: 0.0 })),
  )
  cork.position.y = corkH * 0.5
  g.add(cork)

  // 2. Chunky rustic matte chalky-white travertine/ceramic tile slab
  const edgeTex = t.tex(makeCoasterEdgeTexture())
  const tileMat = t.mat(
    new THREE.MeshStandardMaterial({
      map: edgeTex,
      roughness: 0.86,
      metalness: 0.0,
      envMapIntensity: 0.28,
    }),
  )
  const slab = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(W, tileH, D, 3, 0.085)),
    tileMat,
  )
  slab.position.y = corkH + tileH * 0.5
  g.add(slab)

  // 3. Exact 100%-faithful photo-rectified coaster top artwork with subtle decoupage satin sheen
  const topTex = t.tex(new THREE.TextureLoader().load(coasterTopUrl))
  topTex.colorSpace = THREE.SRGBColorSpace
  topTex.anisotropy = 8
  const topMat = t.mat(
    new THREE.MeshPhysicalMaterial({
      map: topTex,
      roughness: 0.44,
      metalness: 0.0,
      clearcoat: 0.26,
      clearcoatRoughness: 0.36,
      envMapIntensity: 0.52,
    }),
  )
  const topFace = new THREE.Mesh(
    t.geo(new THREE.PlaneGeometry(W - 0.14, D - 0.14)).rotateX(-Math.PI / 2),
    topMat,
  )
  topFace.position.y = COASTER_H + 0.004
  g.add(topFace)

  return g
}

/* ============================================================
   BOUNCE PHYSICS & UNIFIED PROP RIG BUILDER
   ============================================================ */

function bounceHeight(t: number, peak: number): number {
  if (t < 0.48) {
    const u = t / 0.48
    return peak * 4 * u * (1 - u)
  }
  if (t < 0.76) {
    const u = (t - 0.48) / 0.28
    return peak * 0.34 * 4 * u * (1 - u)
  }
  if (t < 0.92) {
    const u = (t - 0.76) / 0.16
    return peak * 0.11 * 4 * u * (1 - u)
  }
  return 0
}

export function buildProp3D(id: PropId, initialFace = 1): PropRig3D {
  const tracker = createTracker()
  const root = new THREE.Group()
  root.name = `prop3d-${id}`
  const body = new THREE.Group()
  root.add(body)

  const isDie = id === 'die' || id === 'd20'
  let faceQuats: Map<number, THREE.Quaternion> | null = null
  let dieMesh: THREE.Group | null = null
  let restY = 0
  let curFace = initialFace
  let ambientUpdate: ((dt: number) => void) | null = null
  let ambientNow: () => boolean = () => false
  let clickAction: (() => void) | undefined = undefined

  if (id === 'succulent') {
    body.add(buildSucculent(tracker))
  } else if (id === 'die') {
    const d6 = buildD6Mesh(tracker)
    dieMesh = d6.dieGroup
    restY = d6.restY
    faceQuats = d6.faceQuats
    dieMesh.position.y = restY
    body.add(dieMesh)
  } else if (id === 'd20') {
    const d20 = buildD20Mesh(tracker)
    dieMesh = d20.dieGroup
    restY = d20.restY
    faceQuats = d20.faceQuats
    dieMesh.position.y = restY
    body.add(dieMesh)
  } else if (id === 'pencil') {
    body.add(buildPencil(tracker))
  } else if (id === 'keycap') {
    body.add(buildKeycap(tracker))
  } else if (id === 'capo') {
    body.add(buildCapo(tracker))
  } else if (id === 'candle') {
    const c = buildCandle(tracker)
    body.add(c.group)
    ambientUpdate = c.update
    ambientNow = c.isLit
    clickAction = c.toggle
  } else if (id === 'tea') {
    const m = buildTeaMug(tracker)
    body.add(m.group)
    ambientUpdate = m.update
    ambientNow = () => true
  } else if (id === 'coaster') {
    body.add(buildCoaster(tracker))
  } else {
    body.add(buildBaggie(tracker))
  }

  // fewer draw calls: a die's pips merge inside the die (which rolls as one), the plant merges whole
  if (dieMesh) for (const g of mergeStatic(dieMesh)) tracker.geo(g)
  else if (id === 'succulent') for (const g of mergeStatic(body)) tracker.geo(g)
  tagProp(root, id)
  // Keep transparent glass/flame/steam/grab-hit meshes from casting solid opaque shadow silhouettes
  if (id === 'candle' || id === 'tea') {
    root.traverse((obj) => {
      if (obj instanceof THREE.Sprite) obj.castShadow = false
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.Material
        if ('transparent' in mat && mat.transparent && (id !== 'tea' || mat.opacity < 0.5)) {
          obj.castShadow = false
          obj.receiveShadow = false
        }
      }
    })
  }

  const applyFaceImmediate = (face: number) => {
    curFace = face
    if (dieMesh && faceQuats) {
      const q = faceQuats.get(face) ?? faceQuats.get(1)
      if (q) dieMesh.quaternion.copy(q)
      dieMesh.position.y = restY
    }
  }
  applyFaceImmediate(initialFace)

  // Roll / settle animation state
  let rollAnim: {
    t: number
    dur: number
    peak: number
    startQ: THREE.Quaternion
    endQ: THREE.Quaternion
    tumbleAxis: THREE.Vector3
    tumbleSpins: number
    skidVx: number
    skidVz: number
    onSkid?: (dx: number, dz: number) => void
  } | null = null

  let settleAnim: { t: number; dur: number } | null = null
  const tmpQ = new THREE.Quaternion()
  const spinQ = new THREE.Quaternion()

  return {
    id,
    root,
    body,
    isDie,
    get face() {
      return curFace
    },
    set face(v: number) {
      curFace = v
    },
    setFace(face: number) {
      if (!rollAnim) applyFaceImmediate(face)
      else curFace = face
    },
    roll(targetFace: number, onDrop: boolean, onSkid?: (dx: number, dz: number) => void) {
      curFace = targetFace
      if (!dieMesh || !faceQuats) return
      const endQ = (faceQuats.get(targetFace) ?? faceQuats.get(1)!).clone()
      const startQ = dieMesh.quaternion.clone()
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      if (axis.lengthSq() < 0.01) axis.set(1, 0.3, 0.5).normalize()
      const skidDist = onDrop ? 0.6 + Math.random() * 1.1 : 1.4 + Math.random() * 2.2
      const skidAng = Math.random() * Math.PI * 2
      const dur = onDrop ? 0.62 : 0.9
      rollAnim = {
        t: 0,
        dur,
        peak: onDrop ? 2.1 : 3.6,
        startQ,
        endQ,
        tumbleAxis: axis,
        tumbleSpins: (onDrop ? 2.0 : 3.5) * Math.PI * 2,
        skidVx: (Math.cos(skidAng) * skidDist) / dur,
        skidVz: (Math.sin(skidAng) * skidDist) / dur,
        onSkid,
      }
    },
    settle() {
      settleAnim = { t: 0, dur: 0.22 }
    },
    onClick: clickAction,
    ambient: () => ambientNow(),
    update(dt: number) {
      let active = false
      ambientUpdate?.(dt)
      if (rollAnim && dieMesh) {
        rollAnim.t = Math.min(rollAnim.dur, rollAnim.t + dt)
        const u = rollAnim.t / rollAnim.dur
        const h = bounceHeight(u, rollAnim.peak)
        dieMesh.position.y = restY + h

        // Smooth deceleration of lateral skid across tabletop
        const skidDecay = Math.pow(1 - u, 1.5)
        rollAnim.onSkid?.(rollAnim.skidVx * skidDecay * dt * 1.6, rollAnim.skidVz * skidDecay * dt * 1.6)

        // Tumble freely in flight, then snap smoothly onto target face during the last hops
        const ease = 1 - Math.pow(1 - u, 3)
        tmpQ.copy(rollAnim.startQ).slerp(rollAnim.endQ, ease)
        const spinRemain = (1 - ease) * rollAnim.tumbleSpins
        spinQ.setFromAxisAngle(rollAnim.tumbleAxis, spinRemain)
        dieMesh.quaternion.copy(tmpQ).premultiply(spinQ)

        if (u >= 1) {
          dieMesh.quaternion.copy(rollAnim.endQ)
          dieMesh.position.y = restY
          rollAnim = null
        } else {
          active = true
        }
      }
      if (settleAnim) {
        settleAnim.t = Math.min(settleAnim.dur, settleAnim.t + dt)
        const u = settleAnim.t / settleAnim.dur
        const hop = Math.sin(u * Math.PI) * 0.22 * (1 - u)
        body.position.y = hop
        if (u >= 1) {
          body.position.y = 0
          settleAnim = null
        } else {
          active = true
        }
      }
      return active
    },
    dispose() {
      tracker.dispose()
    },
  }
}
