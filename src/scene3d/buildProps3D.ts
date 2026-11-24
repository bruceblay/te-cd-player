import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { PropId } from '../ui/DeskProps'

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
  /** Advance animations (returns true while animating) */
  update: (dt: number) => boolean
  /** Dispose GPU geometries, materials, and textures */
  dispose: () => void
}

/** World-unit footprint (1 unit = 10 mm) used for collision-free placement & surface checks. */
export const PROP_FOOTPRINT_3D: Record<PropId, { halfW: number; halfD: number; radius: number }> = {
  succulent: { halfW: 3.1, halfD: 3.1, radius: 3.1 },
  die: { halfW: 0.9, halfD: 0.9, radius: 0.95 },
  d20: { halfW: 1.15, halfD: 1.15, radius: 1.2 },
  pencil: { halfW: 8.3, halfD: 0.55, radius: 4.5 },
  keycap: { halfW: 1.0, halfD: 1.0, radius: 1.05 },
  capo: { halfW: 4.3, halfD: 3.4, radius: 3.9 },
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
  const soil = new THREE.Mesh(t.geo(new THREE.CylinderGeometry(2.34, 2.25, 0.28, 32)), soilMat)
  soil.position.y = 3.22
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
  rosette.position.y = 3.44
  const golden = 137.508 * (Math.PI / 180)
  const totalLeaves = 38
  for (let i = 0; i < totalLeaves; i++) {
    const f = i / (totalLeaves - 1) // 0 = tight center bud, 1 = wide outer ring
    const angle = i * golden
    const scale = 0.42 + Math.pow(f, 0.72) * 1.38
    const pitch = -1.24 + Math.pow(f, 0.68) * 1.16 // upright in center -> splayed horizontally outside
    const r = 0.06 + Math.pow(f, 0.9) * 0.72
    const yOff = (1 - f) * 0.44

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

  // Deeper inner ruby core for authentic translucent resin depth
  const core = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(S * 0.82, S * 0.82, S * 0.82, 3, S * 0.12)),
    t.mat(new THREE.MeshStandardMaterial({ color: '#4c0206', roughness: 0.45, metalness: 0.05 })),
  )
  dieGroup.add(core)

  // Glossy translucent ruby-red acrylic shell
  const shell = new THREE.Mesh(
    t.geo(new RoundedBoxGeometry(S, S, S, 5, S * 0.145)),
    t.mat(
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#b60812'),
        emissive: new THREE.Color('#2d0004'),
        emissiveIntensity: 0.45,
        roughness: 0.09,
        metalness: 0.02,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
        ior: 1.5,
        transparent: true,
        opacity: 0.88,
        envMapIntensity: 1.35,
      }),
    ),
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

function buildD20Mesh(t: ReturnType<typeof createTracker>): {
  dieGroup: THREE.Group
  restY: number
  faceQuats: Map<number, THREE.Quaternion>
} {
  const radius = 1.15 // ~21 mm across flats
  const inradius = radius * 0.794654 // exact icosahedron center-to-face distance
  const dieGroup = new THREE.Group()
  const geo = t.geo(new THREE.IcosahedronGeometry(radius, 0))

  const core = new THREE.Mesh(
    t.geo(new THREE.IcosahedronGeometry(radius * 0.78, 0)),
    t.mat(new THREE.MeshStandardMaterial({ color: '#460207', roughness: 0.45, metalness: 0.05 })),
  )
  dieGroup.add(core)

  const shell = new THREE.Mesh(
    geo,
    t.mat(
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#9c0612'),
        emissive: new THREE.Color('#2a0005'),
        emissiveIntensity: 0.45,
        roughness: 0.1,
        metalness: 0.04,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        ior: 1.52,
        flatShading: true,
        transparent: true,
        opacity: 0.88,
        envMapIntensity: 1.4,
      }),
    ),
  )
  dieGroup.add(shell)

  const edges = t.geo(new THREE.EdgesGeometry(geo, 1))
  const edgeLines = new THREE.LineSegments(
    edges,
    t.mat(new THREE.LineBasicMaterial({ color: '#ff9ca4', transparent: true, opacity: 0.28 })),
  )
  dieGroup.add(edgeLines)

  const posAttr = geo.attributes.position
  const faceQuats = new Map<number, THREE.Quaternion>()
  const labelGeo = t.geo(new THREE.PlaneGeometry(radius * 0.66, radius * 0.66))
  const order = [20, 2, 14, 8, 12, 18, 4, 16, 6, 10, 1, 19, 7, 13, 9, 3, 17, 5, 15, 11]

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
   Matched closely to src/assets/props/capo.png
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
  } else {
    body.add(buildCapo(tracker))
  }

  tagProp(root, id)

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
    update(dt: number) {
      let active = false
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
