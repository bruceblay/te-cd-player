import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Merge a model's static parts into one mesh per material, so a scene of
 * hundreds of screws, labels, panels and leaves costs a handful of draw calls.
 *
 * Left alone: anything in `keep` or under it (parts that move), anything
 * clickable (userData.control / propId / lightSwitch, which picking reads off
 * the hit mesh), transparent or multi-material meshes, hidden ones, and
 * anything marked userData.noMerge. Returns the new geometries so the caller
 * can dispose of them with the model.
 */
export function mergeStatic(root: THREE.Object3D, keep: Iterable<THREE.Object3D> = []): THREE.BufferGeometry[] {
  const keepSet = new Set(keep)
  root.updateMatrixWorld(true)
  const toRoot = root.matrixWorld.clone().invert()

  const excluded = (o: THREE.Object3D): boolean => {
    for (let n: THREE.Object3D | null = o; n && n !== root; n = n.parent) {
      if (keepSet.has(n) || !n.visible) return true
      const u = n.userData
      if (u.control || u.propId || u.lightSwitch || u.noMerge) return true
    }
    return false
  }

  const groups = new Map<string, { material: THREE.Material; meshes: THREE.Mesh[] }>()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return
    if (Array.isArray(m.material) || m.material.transparent || m.renderOrder !== 0) return
    if (excluded(m)) return
    const g = m.geometry
    if (Object.keys(g.morphAttributes).length) return
    const rel = new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld)
    if (rel.determinant() < 0) return // mirrored: merging would flip its faces
    const attrs = Object.keys(g.attributes).sort().join(',')
    const key = [m.material.uuid, m.castShadow, m.receiveShadow, m.frustumCulled, attrs, g.index ? 'i' : 'n'].join('|')
    let entry = groups.get(key)
    if (!entry) groups.set(key, (entry = { material: m.material, meshes: [] }))
    entry.meshes.push(m)
  })

  const made: THREE.BufferGeometry[] = []
  for (const { material, meshes } of groups.values()) {
    if (meshes.length < 2) continue
    const parts = meshes.map((m) => m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld)))
    const merged = mergeGeometries(parts, false)
    parts.forEach((p) => p.dispose())
    if (!merged) continue
    const mesh = new THREE.Mesh(merged, material)
    mesh.castShadow = meshes[0].castShadow
    mesh.receiveShadow = meshes[0].receiveShadow
    mesh.name = 'merged-static'
    root.add(mesh)
    for (const m of meshes) m.removeFromParent()
    made.push(merged)
  }
  return made
}
