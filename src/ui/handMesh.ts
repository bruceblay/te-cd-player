import {
  BufferGeometry, Mesh, DirectionalLight, Float32BufferAttribute, Group, HemisphereLight, Matrix4, MeshStandardMaterial,
  OrthographicCamera, Quaternion, Scene, SkinnedMesh, Vector3, WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import type { MeshHandStyle, RenderedHand } from './handRender'

const left = new URL('../assets/hands/left.glb', import.meta.url).href
const simpsonLeft = new URL('../assets/hands/simpson-left.glb', import.meta.url).href
const simpsonRight = new URL('../assets/hands/simpson-right.glb', import.meta.url).href
const right = new URL('../assets/hands/right.glb', import.meta.url).href

// WebXR includes four metacarpal bases inside the palm that MediaPipe doesn't report.
const landmarks = [0, 1, 2, 3, 4, -1, 5, 6, 7, 8, -1, 9, 10, 11, 12, -1, 13, 14, 15, 16, -1, 17, 18, 19, 20]

function palmFrame(points: Vector3[]) {
  const across = new Vector3().subVectors(points[6], points[21]).normalize()
  const forward = new Vector3().subVectors(points[11], points[0])
  const normal = new Vector3().crossVectors(across, forward).normalize()
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(across, forward.crossVectors(normal, across), normal))
}

// Build a tapered nail in bind space, then attach it to the distal finger joint.
function makeClaw(base: Vector3, tip: Vector3, palmward: Vector3, rotation: Quaternion, material: MeshStandardMaterial) {
  const axis = tip.clone().sub(base).normalize()
  const across = new Vector3().crossVectors(axis, palmward).normalize()
  const inward = new Vector3().crossVectors(across, axis).normalize()
  const length = base.distanceTo(tip)
  const positions: number[] = [], indices: number[] = []
  const local = rotation.clone().invert()
  const vertex = new Vector3()
  const rings = 9, sides = 12
  for (let j = 0; j <= rings; j++) {
    const t = j / rings
    const width = length * 0.51 * Math.pow(1 - t, 0.75)
    for (let k = 0; k < sides; k++) {
      const angle = 2 * Math.PI * k / sides
      vertex.copy(axis).multiplyScalar(length * (0.80 + 2.35 * t))
        .addScaledVector(inward, length * (-0.34 + 0.93 * t * t) + width * 0.57 * Math.sin(angle))
        .addScaledVector(across, width * Math.cos(angle)).applyQuaternion(local)
      positions.push(vertex.x, vertex.y, vertex.z)
      if (j < rings) {
        const a = j * sides + k, b = j * sides + (k + 1) % sides
        indices.push(a, a + sides, b, b, a + sides, b + sides)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return new Mesh(geometry, material)
}

export function makeRig(template: Group, material: MeshStandardMaterial, horn: MeshStandardMaterial) {
  const root = clone(template)
  const mesh = root.getObjectByProperty('isSkinnedMesh', true) as SkinnedMesh
  mesh.material = material
  mesh.frustumCulled = false
  // The generic-hand asset has 25 sibling joints in WebXR order, in mesh space.
  const joints = mesh.skeleton.bones
  const bones = joints[0].name === 'wrist' ? joints : joints.slice().reverse()
  const rest = bones.map(b => b.position.clone())
  const rotation = bones.map(b => b.quaternion.clone())
  const target = rest.map(() => new Vector3())
  const restFrameInverse = palmFrame(rest).invert()
  const restLength = rest[0].distanceTo(rest[11])
  const palmward = rest[4].clone().sub(rest[0])
  const normal = new Vector3(0, 0, 1).applyQuaternion(restFrameInverse.clone().invert())
  if (normal.dot(palmward) < 0) normal.negate()
  const claws = [3, 8, 13, 18, 23].map(i => {
    const claw = makeClaw(rest[i], rest[i + 1], normal, rotation[i], horn)
    bones[i].add(claw)
    return claw
  })
  if (!mesh.geometry.hasAttribute('color')) {
    // Feather the open wrist and add a little warmth where skin covers joints.
    const points = mesh.geometry.getAttribute('position')
    const axis = rest[11].clone().sub(rest[0]).normalize()
    const vertex = new Vector3()
    const colors = [], moss = [], yellow = []
    for (let i = 0; i < points.count; i++) {
      vertex.fromBufferAttribute(points, i)
      const distance = Math.min(...rest.slice(1).map(joint => vertex.distanceToSquared(joint)))
      const warmth = Math.exp(-distance / (restLength * 0.12) ** 2)
      // Mottling is sampled in bind space so it follows the skin through a curl.
      const broad = Math.sin(vertex.x * 195 + Math.sin(vertex.z * 140)) * Math.cos(vertex.y * 210)
      const fleck = Math.sin(vertex.z * 650 + vertex.y * 390) * Math.cos(vertex.x * 510)
      const shade = 0.78 + broad * 0.14 + fleck * 0.07
      const along = vertex.sub(rest[0]).dot(axis) / restLength
      const fade = Math.max(0, Math.min(1, (along + 0.18) / 0.38))
      moss.push(shade + warmth * 0.13, shade, shade * 0.78, fade * fade * (3 - 2 * fade))
      yellow.push(1, 1, 1, fade * fade * (3 - 2 * fade))
      colors.push(1, 1 - warmth * 0.10, 1 - warmth * 0.14, fade * fade * (3 - 2 * fade))
    }
    mesh.geometry.setAttribute('flatTone', new Float32BufferAttribute(yellow, 4))
    mesh.geometry.setAttribute('skinTone', new Float32BufferAttribute(colors, 4))
    mesh.geometry.setAttribute('mossTone', new Float32BufferAttribute(moss, 4))
    mesh.geometry.setAttribute('color', mesh.geometry.getAttribute('skinTone'))
  }
  const restDir = new Vector3(), targetDir = new Vector3(), delta = new Quaternion()
  const direction = new Quaternion()

  function pose(hand: RenderedHand, style: MeshHandStyle) {
    const simpson = style === 'simpson', goblin = style === 'goblin'
    for (const claw of claws) claw.visible = goblin
    mesh.geometry.setAttribute('color', mesh.geometry.getAttribute(simpson ? 'flatTone' : goblin ? 'mossTone' : 'skinTone'))
    const world = hand.world
    for (const [i, landmark] of landmarks.entries()) {
      if (landmark < 0) continue
      const p = (world ?? hand.pts)[landmark]
      // Screen points already include the selfie mirror. World points do not.
      target[i].set(world ? -p.x : p.x, -p.y, -(p.z ?? 0))
    }
    const palm = palmFrame(target).multiply(restFrameInverse)
    if (simpson) {
      for (let i = 11; i <= 14; i++) target[i].lerp(target[i + 5], 0.5)
    }
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i]
      // Wrist, thumb base and knuckles form one palm. Each phalanx inherits
      // its parent's endpoint, so tracking noise cannot pull a finger apart.
      const anchored = i <= 1 || landmarks[i] === -1 || (i > 1 && i % 5 === 1)
      if (anchored) {
        bone.position.subVectors(rest[i], rest[0]).applyQuaternion(palm)
        direction.copy(palm)
      } else {
        bone.position.subVectors(rest[i], rest[i - 1]).applyQuaternion(direction).multiplyScalar(goblin ? 1.09 : 1).add(bones[i - 1].position)
      }
      if (i > 0 && landmarks[i] >= 0 && i % 5 !== 4) {
        restDir.subVectors(rest[i + 1], rest[i]).normalize().applyQuaternion(direction)
        targetDir.subVectors(target[i + 1], target[i])
        if (targetDir.lengthSq() > 1e-10) {
          delta.setFromUnitVectors(restDir, targetDir.normalize())
          direction.premultiply(delta)
        }
      }
      bone.quaternion.copy(direction).multiply(rotation[i])
    }

    // Fit one screen scale across the palm; an edge-on or foreshortened
    // middle metacarpal alone is a poor estimate of hand size.
    let screenSpan = 0, modelSpan = 0
    for (const i of [6, 11, 16, 21]) {
      const p = hand.pts[landmarks[i]], wrist = hand.pts[0]
      screenSpan += Math.hypot(p.x - wrist.x, p.y - wrist.y)
      modelSpan += Math.hypot(bones[i].position.x, bones[i].position.y)
    }
    const scale = screenSpan / Math.max(restLength * 0.5, modelSpan)
    root.scale.setScalar(scale)
    const anchor = targetDir.copy(bones[9].position)
    if (hand.pinched) anchor.lerp(bones[4].position, 0.5)
    root.position.set(hand.cursor.x, -hand.cursor.y, 0).addScaledVector(anchor, -scale)
  }
  return { root, pose, dispose() {
    mesh.skeleton.dispose()
    for (const claw of claws) claw.geometry.dispose()
  } }
}

export async function createHandMesh(initialStyle: MeshHandStyle = 'man') {
  const loader = new GLTFLoader()
  const family = (style: MeshHandStyle) => style === 'simpson' ? 'simpson' : 'standard'
  type Family = ReturnType<typeof family>
  const load = (kind: Family) => Promise.all((kind === 'simpson' ? [simpsonLeft, simpsonRight] : [left, right])
    .map(url => loader.loadAsync(url).then(g => g.scene)))
  const first = family(initialStyle)
  const templates = await load(first)
  const renderer = new WebGLRenderer({ alpha: true, antialias: true })
  renderer.setClearColor(0, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  const scene = new Scene()
  const camera = new OrthographicCamera(0, 1, 0, -1, 1, 12000)
  camera.position.z = 6000
  const material = new MeshStandardMaterial({ roughness: 0.73, vertexColors: true, transparent: true })
  const horn = new MeshStandardMaterial({ color: 0xd6c49b, roughness: 0.46 })
  scene.add(new HemisphereLight(0xffede0, 0x7e635b, 1.65))
  const key = new DirectionalLight(0xffefdf, 2.2)
  key.position.set(-2, 3, 4)
  const fill = new DirectionalLight(0xd6e5fc, 1.1)
  fill.position.set(3, 1, -2)
  scene.add(key, fill)
  function addRigs(models: Group[]) {
    return [0, 1].map(() => models.map(template => {
      const rig = makeRig(template, material, horn)
      rig.root.visible = false
      scene.add(rig.root)
      return rig
    }))
  }
  function disposeModels(models: Group[]) {
    for (const template of models) {
      const mesh = template.getObjectByProperty('isSkinnedMesh', true) as SkinnedMesh
      mesh.geometry.dispose()
      mesh.skeleton.dispose()
      for (const m of [mesh.material].flat()) m.dispose()
    }
  }
  const pools = new Map([[first, { models: templates, rigs: addRigs(templates) }]])
  const requested = new Set([first])
  let disposed = false
  return {
    draw(ctx: CanvasRenderingContext2D, hands: RenderedHand[], style: MeshHandStyle) {
      if (renderer.getContext().isContextLost()) return false
      const w = window.innerWidth, h = window.innerHeight
      if (camera.right !== w || camera.bottom !== -h) {
        camera.right = w
        camera.bottom = -h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h, false)
      }
      // Lift Simpson’s shadow color for the flatter lighting of drawn cels.
      material.emissive.set(style === 'simpson' ? 0xe5ad0e : 0x000000)
      material.color.set({ man: 0xb17d64, woman: 0xd5a18a, simpson: 0x92772a, goblin: 0x739648 }[style])
      const kind = family(style)
      const pool = pools.get(kind)
      if (!pool) {
        if (!requested.has(kind)) {
          requested.add(kind)
          void load(kind).then(models => {
            if (disposed) disposeModels(models)
            else pools.set(kind, { models, rigs: addRigs(models) })
          }).catch(() => { /* Keep the illustrated fallback. */ })
        }
        return false
      }
      for (const entry of pools.values()) for (const pair of entry.rigs) for (const rig of pair) rig.root.visible = false
      for (const hand of hands) {
        // The webcam frame is mirrored for display, which reverses chirality.
        const rig = pool.rigs[hand.slot][hand.side === 'Right' ? 0 : 1]
        rig.pose(hand, style)
        rig.root.visible = true
      }
      renderer.render(scene, camera)
      ctx.drawImage(renderer.domElement, 0, 0, w, h)
      return true
    },
    dispose() {
      disposed = true
      for (const entry of pools.values()) {
        for (const pair of entry.rigs) for (const rig of pair) rig.dispose()
        disposeModels(entry.models)
      }
      horn.dispose()
      material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
