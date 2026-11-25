import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export type DieKind = 'd6' | 'd20'

export interface Dice3DHandle {
  /** Launch a real 3D tumbling bounce roll landing on `targetFace`. */
  roll(targetFace: number, onDrop?: boolean): void
  /** Imperatively sync Z-axis desk rotation (used at 60fps when riding a spinning CD). */
  setDeskRot(deg: number): void
}

const UP_Z = new THREE.Vector3(0, 0, 1)

/* ---------------- D6 geometry & face quaternions ---------------- */

const D6_PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-0.24, 0.24], [0.24, -0.24]],
  3: [[-0.24, 0.24], [0, 0], [0.24, -0.24]],
  4: [[-0.24, 0.24], [0.24, 0.24], [-0.24, -0.24], [0.24, -0.24]],
  5: [[-0.24, 0.24], [0.24, 0.24], [0, 0], [-0.24, -0.24], [0.24, -0.24]],
  6: [[-0.24, 0.25], [0.24, 0.25], [-0.24, 0], [0.24, 0], [-0.24, -0.25], [0.24, -0.25]],
}

// Standard casino layout: opposite faces sum to 7
const D6_FACE_BASIS: Record<number, { n: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 }> = {
  1: { n: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) },
  6: { n: new THREE.Vector3(0, 0, -1), u: new THREE.Vector3(-1, 0, 0), v: new THREE.Vector3(0, 1, 0) },
  2: { n: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, -1) },
  5: { n: new THREE.Vector3(0, -1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1) },
  3: { n: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 0, -1), v: new THREE.Vector3(0, 1, 0) },
  4: { n: new THREE.Vector3(-1, 0, 0), u: new THREE.Vector3(0, 0, 1), v: new THREE.Vector3(0, 1, 0) },
}

function buildD6(): { group: THREE.Group; faceQuats: Map<number, THREE.Quaternion>; textures: THREE.Texture[] } {
  const group = new THREE.Group()

  // Subtle deeper inner ruby core for authentic translucent resin depth
  const coreGeo = new RoundedBoxGeometry(0.82, 0.82, 0.82, 3, 0.12)
  const coreMat = new THREE.MeshStandardMaterial({
    color: '#4e0206',
    roughness: 0.45,
    metalness: 0.05,
  })
  group.add(new THREE.Mesh(coreGeo, coreMat))

  // Glossy translucent ruby-red acrylic shell
  const shellGeo = new RoundedBoxGeometry(1, 1, 1, 5, 0.145)
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#b40710'),
    emissive: new THREE.Color('#300004'),
    emissiveIntensity: 0.5,
    roughness: 0.09,
    metalness: 0.02,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    reflectivity: 1.0,
    ior: 1.5,
    transparent: true,
    opacity: 0.88,
    envMapIntensity: 1.45,
  })
  group.add(new THREE.Mesh(shellGeo, shellMat))

  // Recessed-look ivory white pips on all 6 faces
  const pipRimGeo = new THREE.CircleGeometry(0.096, 20)
  const pipRimMat = new THREE.MeshBasicMaterial({ color: '#4c0206', transparent: true, opacity: 0.55 })
  const pipGeo = new THREE.SphereGeometry(0.088, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52)
  const pipMat = new THREE.MeshStandardMaterial({
    color: '#fbf9f6',
    roughness: 0.25,
    metalness: 0.02,
    envMapIntensity: 0.6,
  })

  const faceQuats = new Map<number, THREE.Quaternion>()
  for (let face = 1; face <= 6; face++) {
    const { n, u, v } = D6_FACE_BASIS[face]
    const basis = new THREE.Matrix4().makeBasis(u, v, n)
    const faceQ = new THREE.Quaternion().setFromRotationMatrix(basis)
    // Inverse aligns face normal -> +Z (facing overhead camera)
    faceQuats.set(face, faceQ.clone().invert())

    const pipOrient = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)
    for (const [px, py] of D6_PIPS[face]) {
      const pos = n.clone().multiplyScalar(0.501).addScaledVector(u, px).addScaledVector(v, py)
      const rim = new THREE.Mesh(pipRimGeo, pipRimMat)
      rim.position.copy(pos)
      rim.quaternion.copy(faceQ)
      group.add(rim)

      const pip = new THREE.Mesh(pipGeo, pipMat)
      pip.position.copy(pos).addScaledVector(n, -0.008)
      pip.quaternion.copy(pipOrient)
      pip.scale.set(1, 0.28, 1)
      group.add(pip)
    }
  }

  return { group, faceQuats, textures: [] }
}

/* ---------------- D20 geometry & face quaternions ---------------- */

function makeNumTexture(num: number): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, 128, 128)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${num >= 10 ? 52 : 58}px "Barlow", "Helvetica Neue", Arial, sans-serif`
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

function makeBeveledIcosahedron(radius: number, inset = 0.075): THREE.BufferGeometry {
  const ref = new THREE.IcosahedronGeometry(radius, 0)
  const pos = ref.attributes.position
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
    faces.push({
      idx: [i0, i1, i2],
      normal: n,
      shrunk: [
        verts[i0].clone().lerp(center, inset),
        verts[i1].clone().lerp(center, inset),
        verts[i2].clone().lerp(center, inset),
      ],
    })
  }
  ref.dispose()

  const outPos: number[] = []
  const outNorm: number[] = []
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3) => {
    outPos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    outNorm.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z)
  }

  for (const f of faces) pushTri(f.shrunk[0], f.shrunk[1], f.shrunk[2], f.normal, f.normal, f.normal)

  const edgeMap = new Map<string, { f: FaceInfo; pStart: THREE.Vector3; pEnd: THREE.Vector3 }>()
  for (const f of faces) {
    for (let e = 0; e < 3; e++) {
      edgeMap.set(`${f.idx[e]}_${f.idx[(e + 1) % 3]}`, { f, pStart: f.shrunk[e], pEnd: f.shrunk[(e + 1) % 3] })
    }
  }

  const bulgeFactor = Math.tan(Math.acos(0.745356) * 0.25)
  const visited = new Set<string>()
  const SEGS = 3
  for (const [key, e1] of edgeMap) {
    const [aStr, bStr] = key.split('_')
    const rev = `${bStr}_${aStr}`
    if (visited.has(key) || visited.has(rev)) continue
    const e2 = edgeMap.get(rev)
    if (!e2) continue
    visited.add(key)
    const n1 = e1.f.normal
    const n2 = e2.f.normal
    const nMid = n1.clone().add(n2).normalize()
    const a1 = e1.pStart
    const b1 = e1.pEnd
    const a2 = e2.pEnd
    const b2 = e2.pStart
    const bulgeA = a1.distanceTo(a2) * 0.5 * bulgeFactor
    const bulgeB = b1.distanceTo(b2) * 0.5 * bulgeFactor
    const sA: THREE.Vector3[] = []
    const sB: THREE.Vector3[] = []
    const sN: THREE.Vector3[] = []
    for (let s = 0; s <= SEGS; s++) {
      const t = s / SEGS
      const arch = Math.sin(t * Math.PI)
      sA.push(a1.clone().lerp(a2, t).addScaledVector(nMid, bulgeA * arch))
      sB.push(b1.clone().lerp(b2, t).addScaledVector(nMid, bulgeB * arch))
      sN.push(n1.clone().lerp(n2, t).normalize())
    }
    for (let s = 0; s < SEGS; s++) {
      pushTri(sA[s], sA[s + 1], sB[s], sN[s], sN[s + 1], sN[s])
      pushTri(sB[s], sA[s + 1], sB[s + 1], sN[s], sN[s + 1], sN[s + 1])
    }
  }

  for (let vi = 0; vi < verts.length; vi++) {
    const vDir = verts[vi].clone().normalize()
    const refTan = Math.abs(vDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    const uAxis = new THREE.Vector3().crossVectors(refTan, vDir).normalize()
    const wAxis = new THREE.Vector3().crossVectors(vDir, uAxis).normalize()
    const corners: { p: THREE.Vector3; n: THREE.Vector3; ang: number }[] = []
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
      const triN = new THREE.Vector3().crossVectors(c0.p.clone().sub(apex), c1.p.clone().sub(apex))
      if (triN.dot(vDir) >= 0) pushTri(apex, c0.p, c1.p, vDir, c0.n, c1.n)
      else pushTri(apex, c1.p, c0.p, vDir, c1.n, c0.n)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(outNorm, 3))
  geo.computeBoundingSphere()
  return geo
}

function buildD20(): { group: THREE.Group; faceQuats: Map<number, THREE.Quaternion>; textures: THREE.Texture[] } {
  const group = new THREE.Group()
  const radius = 0.66
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

  const geo = makeBeveledIcosahedron(radius, 0.075)
  const coreGeo = new THREE.IcosahedronGeometry(radius * 0.76, 0)

  // Deep ruby core inside the crisp beveled resin icosahedron
  const coreMat = new THREE.MeshStandardMaterial({
    color: '#460207',
    roughness: 0.45,
    metalness: 0.05,
  })
  group.add(new THREE.Mesh(coreGeo, coreMat))

  // Glossy crisp translucent crimson resin shell with tight rounded bevels
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#9c0612'),
    emissive: new THREE.Color('#2a0005'),
    emissiveIntensity: 0.5,
    roughness: 0.09,
    metalness: 0.03,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    reflectivity: 1.0,
    ior: 1.52,
    transparent: true,
    opacity: 0.88,
    envMapIntensity: 1.5,
  })
  group.add(new THREE.Mesh(geo, shellMat))

  // Map 20 faces -> numbers 1..20 with exact engraved decals & face-up quaternions
  const faceQuats = new Map<number, THREE.Quaternion>()
  const textures: THREE.Texture[] = []
  const labelGeo = new THREE.PlaneGeometry(radius * 0.62, radius * 0.62)

  // Pair opposite faces roughly so high/low numbers distribute evenly across the die
  const order = [20, 2, 14, 8, 12, 18, 4, 16, 6, 10, 1, 19, 7, 13, 9, 3, 17, 5, 15, 11]

  for (let i = 0; i < 20; i++) {
    const { normal, right, up, center } = faceBasis[i]
    const basis = new THREE.Matrix4().makeBasis(right, up, normal)
    const faceQ = new THREE.Quaternion().setFromRotationMatrix(basis)
    const num = order[i]
    faceQuats.set(num, faceQ.clone().invert())

    const tex = makeNumTexture(num)
    textures.push(tex)
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    })
    const mesh = new THREE.Mesh(labelGeo, mat)
    mesh.position.copy(center).addScaledVector(normal, 0.004)
    mesh.quaternion.copy(faceQ)
    group.add(mesh)
  }

  return { group, faceQuats, textures }
}

/* ---------------- Soft dynamic tabletop shadow texture ---------------- */

function makeShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 58)
  g.addColorStop(0, 'rgba(38, 28, 18, 0.56)')
  g.addColorStop(0.45, 'rgba(38, 28, 18, 0.28)')
  g.addColorStop(0.8, 'rgba(38, 28, 18, 0.06)')
  g.addColorStop(1, 'rgba(38, 28, 18, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

/* ---------------- Multi-bounce parabolic gravity curve ---------------- */

function bounceHeight(t: number, peak: number): { h: number; phase: number } {
  // 3 damped parabolic hops + final flat settle
  if (t < 0.48) {
    const u = t / 0.48
    return { h: peak * 4 * u * (1 - u), phase: 0 }
  }
  if (t < 0.76) {
    const u = (t - 0.48) / 0.28
    return { h: peak * 0.34 * 4 * u * (1 - u), phase: 1 }
  }
  if (t < 0.92) {
    const u = (t - 0.76) / 0.16
    return { h: peak * 0.09 * 4 * u * (1 - u), phase: 2 }
  }
  return { h: 0, phase: 3 }
}

/* ---------------- React Component ---------------- */

export const Dice3D = forwardRef<
  Dice3DHandle,
  {
    kind: DieKind
    face: number
    rot: number
    size: number
    grabbing: boolean
  }
>(function Dice3D({ kind, face, rot, size, grabbing }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    die: THREE.Group
    shadow: THREE.Mesh
    shadowMat: THREE.MeshBasicMaterial
    faceQuats: Map<number, THREE.Quaternion>
    deskRotDeg: number
    face: number
    grabbing: boolean
    raf: number
    anim: null | {
      start: number
      duration: number
      peak: number
      startQ: THREE.Quaternion
      targetFace: number
      targetRotDeg: number
      spinAxis: THREE.Vector3
      spinAngle: number
      wobbleAxis: THREE.Vector3
    }
    renderNow: () => void
  } | null>(null)

  const composeRestingQuat = (faceQuats: Map<number, THREE.Quaternion>, f: number, deskDeg: number) => {
    const fq = faceQuats.get(f) ?? new THREE.Quaternion()
    const zq = new THREE.Quaternion().setFromAxisAngle(UP_Z, (-deskDeg * Math.PI) / 180)
    return zq.multiply(fq)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'default' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 30)
    camera.position.set(0, 0, 5.4)
    camera.lookAt(0, 0, 0)

    const pmrem = new THREE.PMREMGenerator(renderer)
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex

    // Studio top-left key light matching the BC-1 faceplate lighting
    const key = new THREE.DirectionalLight('#fffbf2', 2.4)
    key.position.set(-3.2, 4.0, 6.2)
    scene.add(key)

    const fill = new THREE.DirectionalLight('#ffd4ce', 0.9)
    fill.position.set(3.4, -3.2, 2.6)
    scene.add(fill)

    const amb = new THREE.AmbientLight('#ffffff', 0.4)
    scene.add(amb)

    // Soft dynamic shadow sitting on the desk plane (z = -0.56)
    const shadowTex = makeShadowTexture()
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.72, depthWrite: false })
    const shadowSize = kind === 'd6' ? 1.55 : 1.6
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(shadowSize, shadowSize), shadowMat)
    shadow.position.set(0.08, -0.14, -0.58)
    scene.add(shadow)

    const built = kind === 'd6' ? buildD6() : buildD20()
    const die = built.group
    scene.add(die)

    const renderNow = () => {
      const st = stateRef.current
      if (!st) return
      const a = st.anim
      if (!a) {
        const lift = st.grabbing ? 0.42 : 0
        die.position.set(0, 0, lift)
        die.quaternion.copy(composeRestingQuat(st.faceQuats, st.face, st.deskRotDeg))
        shadow.position.set(0.08 + lift * 0.28, -0.14 - lift * 0.36, -0.58)
        const ss = 1 + lift * 0.34
        shadow.scale.set(ss, ss, 1)
        shadowMat.opacity = 0.72 / (1 + lift * 0.9)
        renderer.render(scene, camera)
        return
      }

      const now = performance.now()
      const t = Math.min(1, (now - a.start) / a.duration)
      const { h } = bounceHeight(t, a.peak)

      // Smoothly ease tumbling angular momentum into the exact landing face
      const targetQ = composeRestingQuat(st.faceQuats, a.targetFace, a.targetRotDeg)
      if (t < 0.88) {
        // Decay spin velocity smoothly across bounces so it physically slows down on impact
        const u = t / 0.88
        const easeOut = 1 - Math.pow(1 - u, 2.6)
        const remainingSpin = a.spinAngle * (1 - easeOut)
        const spinQ = new THREE.Quaternion().setFromAxisAngle(a.spinAxis, remainingSpin)
        const baseQ = a.startQ.clone().slerp(targetQ, easeOut)
        die.quaternion.copy(spinQ.multiply(baseQ))
      } else {
        // Final damped rocking wobble as the die settles flat on the desk
        const u = (t - 0.88) / 0.12
        const rock = Math.sin(u * Math.PI * 2.5) * (1 - u) * 0.11
        const rockQ = new THREE.Quaternion().setFromAxisAngle(a.wobbleAxis, rock)
        die.quaternion.copy(rockQ.multiply(targetQ))
      }

      die.position.set(0, 0, h)
      // Height-reactive tabletop shadow snaps crisp on every bounce impact!
      shadow.position.set(0.08 + h * 0.28, -0.14 - h * 0.36, -0.58)
      const ss = 1 + h * 0.32
      shadow.scale.set(ss, ss, 1)
      shadowMat.opacity = 0.74 / (1 + h * 0.85)
      renderer.render(scene, camera)

      if (t < 1) {
        st.raf = requestAnimationFrame(renderNow)
      } else {
        st.anim = null
        st.face = a.targetFace
        st.deskRotDeg = a.targetRotDeg
        st.raf = 0
        renderNow()
      }
    }

    stateRef.current = {
      renderer,
      scene,
      camera,
      die,
      shadow,
      shadowMat,
      faceQuats: built.faceQuats,
      deskRotDeg: rot,
      face,
      grabbing,
      raf: 0,
      anim: null,
      renderNow,
    }

    const canvasPx = Math.round(size * 2.6)
    renderer.setSize(canvasPx, canvasPx, false)
    renderNow()

    return () => {
      if (stateRef.current?.raf) cancelAnimationFrame(stateRef.current.raf)
      stateRef.current = null
      envTex.dispose()
      pmrem.dispose()
      shadowTex.dispose()
      built.textures.forEach((t) => t.dispose())
      renderer.dispose()
    }
    // Only re-initialize WebGL scene if kind changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  // Sync size changes (window resize / 1-deck ↔ 2-deck scale changes)
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    const canvasPx = Math.round(size * 2.6)
    st.renderer.setSize(canvasPx, canvasPx, false)
    st.renderNow()
  }, [size])

  // Sync resting props (face, rot, grabbing) when not mid-roll
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    st.grabbing = grabbing
    if (st.anim) {
      st.anim.targetRotDeg = rot
      return
    }
    st.face = face
    st.deskRotDeg = rot
    st.renderNow()
  }, [face, rot, grabbing])

  useImperativeHandle(ref, () => ({
    roll(targetFace: number, onDrop = false) {
      const st = stateRef.current
      if (!st) return
      if (st.raf) cancelAnimationFrame(st.raf)
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduce) {
        st.anim = null
        st.face = targetFace
        st.renderNow()
        return
      }
      // Random 3D tumble axis with healthy X/Y tilt so faces visibly flip over each other
      const spinAxis = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 0.9,
      ).normalize()
      const wobbleAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, 0).normalize()
      const turns = onDrop ? 1.3 + Math.random() * 1.1 : 2.3 + Math.random() * 1.6
      st.anim = {
        start: performance.now(),
        duration: onDrop ? 620 : 900,
        peak: onDrop ? 0.72 : 1.45,
        startQ: st.die.quaternion.clone(),
        targetFace,
        targetRotDeg: st.deskRotDeg,
        spinAxis,
        spinAngle: Math.PI * 2 * turns,
        wobbleAxis,
      }
      st.raf = requestAnimationFrame(st.renderNow)
    },
    setDeskRot(deg: number) {
      const st = stateRef.current
      if (!st) return
      st.deskRotDeg = deg
      if (st.anim) st.anim.targetRotDeg = deg
      else st.renderNow()
    },
  }))

  const canvasPx = Math.round(size * 2.6)
  return (
    <canvas
      ref={canvasRef}
      className="dice3d-canvas"
      style={{ width: canvasPx, height: canvasPx }}
      aria-hidden
    />
  )
})
