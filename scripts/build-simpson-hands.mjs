// Run with node scripts/build-simpson-hands.mjs to bake the four-digit meshes.
import { readFileSync, writeFileSync } from 'node:fs'
import { Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three'
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js'

const folder = new URL('../src/assets/hands/', import.meta.url)
const clamp = t => Math.max(0, Math.min(1, t))

function capsule(start, end, r0, r1, joint) {
  const axis = end.clone().sub(start)
  const lengthSq = axis.lengthSq()
  return { joint, distance(p) {
    const x = p.x - start.x, y = p.y - start.y, z = p.z - start.z
    const t = clamp((x * axis.x + y * axis.y + z * axis.z) / lengthSq)
    return Math.hypot(x - axis.x * t, y - axis.y * t, z - axis.z * t) - (r0 + t * (r1 - r0))
  } }
}

for (const side of ['left', 'right']) {
  const file = readFileSync(new URL(side + '.glb', folder))
  const gltf = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)))
  const skin = gltf.skins[0]
  const order = skin.joints.map((_, i) => side === 'right' ? i : 24 - i)
  const nodes = order.map(i => gltf.nodes[skin.joints[i]])
  const rest = nodes.map(n => new Vector3(...n.translation))
  // Center one physical finger between the original middle and ring chains.
  for (let i = 10; i <= 14; i++) rest[i].lerp(rest[i + 5], 0.5)
  const across = rest[6].clone().sub(rest[21]).normalize()
  const forward = rest[11].clone().sub(rest[0])
  const depth = across.clone().cross(forward).normalize()
  forward.crossVectors(depth, across).normalize()
  const palmCenter = rest[0].clone().lerp(rest[11], .50)
  // Seat the finger roots in the palm plane. The tracked pose will supply curl.
  for (const base of [1, 6, 11, 21]) {
    const offset = rest[base].clone().sub(palmCenter).dot(depth)
    for (let i = base; i <= base + 3; i++) rest[i].addScaledVector(depth, -offset)
  }
  const fingers = []
  for (const [base, radius] of [[1, .0108], [6, .0114], [11, .0118], [21, .0105]]) {
    const start = rest[base].clone()
    for (let i = base + 1; i <= base + 3; i++) rest[i].lerp(start, 0.12)
    // One tapered tube per finger. The internal joints affect its motion only.
    const surface = capsule(start, rest[base+3], radius, radius * .89, base)
    const segments = []
    for (let k = 0; k < 3; k++) {
      segments.push(capsule(rest[base+k], rest[base+k+1], 0, 0, base+k))
    }
    fingers.push({ surface, segments, start, axis: rest[base+3].clone().sub(start).normalize() })
  }

  // A single rounded pad gives the palm a broad face and a tapered wrist.
  const local = new Vector3()
  function palmDistance(p) {
    local.subVectors(p, palmCenter)
    const y = local.dot(forward)
    const width = .035 + .010 * clamp(.48 + y / .083)
    const x = Math.abs(local.dot(across)) / width
    const z = Math.abs(local.dot(depth)) / .018
    // Rounded rectangle in the palm plane, elliptical through its thickness.
    // The top edge sits below the knuckles so the webbing starts low and the
    // three fingers read as fingers, not a row of thumbs.
    const outline = Math.pow(x ** 3 + Math.abs(y / (y > 0 ? .042 : .058)) ** 3, 1/3)
    return (Math.pow(outline ** 3 + z ** 3, 1/3) - 1) * .026
  }

  const size = 76, half = .123
  const center = rest[0].clone().lerp(rest[14], .47)
  const field = new MarchingCubes(size, new MeshBasicMaterial(), false, false, 40000)
  field.isolation = 0
  const p = new Vector3()
  function sample(p, weights) {
    const blend = .0055
    let sum = Math.exp(-palmDistance(p) / blend)
    if (weights) weights[0] = sum
    for (const { surface, segments, start, axis } of fingers) {
      const w = Math.exp(-surface.distance(p) / blend)
      sum += w
      if (weights) {
        // Keep the palm face anchored behind each knuckle. Fade into the
        // rotating finger along its length, without a circular socket imprint.
        const along = local.subVectors(p, start).dot(axis)
        const t = clamp((along + .003) / .020)
        const mobile = t*t*(3-2*t)
        weights[0] += w * (1-mobile)
        const influences = segments.map(segment => Math.exp(-segment.distance(p) / .004))
        const total = influences.reduce((a, b) => a + b)
        for (let i = 0; i < segments.length; i++) weights[segments[i].joint] += w * mobile * influences[i] / total
      }
    }
    return blend * Math.log(sum)
  }
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    p.set(x, y, z).multiplyScalar(2 * half / size).addScalar(-half).add(center)
    field.field[x + size * (y + size*z)] = sample(p)
  }
  field.update()

  const positions = [], normals = [], joints = [], weights = [], indices = [], inverse = []
  const unique = new Map()
  const lo = new Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate()
  const normal = new Vector3()
  for (let i = 0; i < field.count; i++) {
    p.fromArray(field.positionArray, 3*i).multiplyScalar(half).add(center)
    const key = p.toArray().map(v => Math.round(v*1e8)).join(',')
    if (!unique.has(key)) {
      unique.set(key, unique.size)
      positions.push(...p.toArray())
      lo.min(p); hi.max(p)
      normals.push(...normal.fromArray(field.normalArray, 3*i).normalize().toArray())
      const influence = Array(25).fill(0)
      sample(p, influence)
      const top = order.map((_, j) => j).sort((a,b) => influence[b]-influence[a]).slice(0,4)
      const sum = top.reduce((n,j) => n+influence[j], 0)
      joints.push(...top.map(j => order[j]))
      weights.push(...top.map(j => influence[j]/sum))
    }
    indices.push(unique.get(key))
  }
  for (const i of order) {
    const n = nodes[i]
    n.translation = rest[i].toArray()
    const matrix = new Matrix4().compose(rest[i], new Quaternion(...n.rotation), new Vector3(...(n.scale ?? [1,1,1])))
    inverse.push(...matrix.invert().elements)
  }

  const parts = []
  gltf.bufferViews = []
  gltf.accessors = []
  let offset = 0
  function attribute(array, type, componentType, width) {
    const bytes = Buffer.from(array.buffer)
    const index = parts.length / 2
    gltf.bufferViews.push({buffer:0, byteOffset:offset, byteLength:bytes.length})
    gltf.accessors.push({bufferView:index, componentType, count:array.length/width, type})
    const padding = Buffer.alloc((4-bytes.length%4)%4)
    parts.push(bytes, padding)
    offset += bytes.length + padding.length
    return index
  }
  const attributes = {
    POSITION: attribute(new Float32Array(positions),'VEC3',5126,3),
    NORMAL: attribute(new Float32Array(normals),'VEC3',5126,3),
    JOINTS_0: attribute(new Uint8Array(joints),'VEC4',5121,4),
    WEIGHTS_0: attribute(new Float32Array(weights),'VEC4',5126,4),
  }
  Object.assign(gltf.accessors[0], {min:lo.toArray(), max:hi.toArray()})
  gltf.meshes[0].primitives = [{attributes, indices:attribute(new Uint16Array(indices),'SCALAR',5123,1), material:0}]
  skin.inverseBindMatrices = attribute(new Float32Array(inverse),'MAT4',5126,16)
  gltf.buffers = [{byteLength:offset}]
  const json = Buffer.from(JSON.stringify(gltf))
  const desc = Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)])
  const header = Buffer.alloc(20), bin = Buffer.alloc(8)
  header.write('glTF'); header.writeUInt32LE(2,4); header.writeUInt32LE(28+desc.length+offset,8)
  header.writeUInt32LE(desc.length,12); header.write('JSON',16)
  bin.writeUInt32LE(offset); bin.write('BIN',4)
  writeFileSync(new URL('simpson-'+side+'.glb',folder), Buffer.concat([header, desc, bin, ...parts]))
}
