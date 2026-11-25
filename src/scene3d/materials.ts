import * as THREE from 'three'
import { trackImage } from '../ui/boot'

function createSoftboxTexture(intensity: number, tint = [255, 252, 245]): THREE.CanvasTexture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.06, S / 2, S / 2, S * 0.5)
  g.addColorStop(0, `rgb(${tint[0]}, ${tint[1]}, ${tint[2]})`)
  g.addColorStop(0.45, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, 0.72)`)
  g.addColorStop(0.78, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, 0.22)`)
  g.addColorStop(1, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, 0)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  // Keep intensity parameter available via material color scaling
  void intensity
  return tex
}

/**
 * Custom Teenage Engineering-style product photography studio environment:
 * feathered diffused softboxes + gentle mid-tone wrap so reflections sweep
 * smoothly across flat keycaps and aluminum without specular snapping.
 * Accepts 'studio' (pale warm paper) or 'wood' (warm walnut workbench bounce).
 */
export function createStudioEnvironment(
  renderer: THREE.WebGLRenderer,
  surface: 'studio' | 'wood' = 'studio',
): {
  texture: THREE.Texture
  dispose: () => void
} {
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()

  const envScene = new THREE.Scene()
  envScene.background = new THREE.Color(surface === 'wood' ? 0x423a33 : 0x5a5853)

  const warmSoftTex = createSoftboxTexture(1, surface === 'wood' ? [255, 246, 234] : [255, 251, 244])
  const coolSoftTex = createSoftboxTexture(1, [232, 240, 255])

  // Warm studio floor bounce (warm wood bounce reflects subtly in aluminum edges & CD underside)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: surface === 'wood' ? 0x876f58 : 0xbcb7ac }),
  )
  floor.position.y = -12
  envScene.add(floor)

  // Soft studio cyclorama wall
  const backWall = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 38),
    new THREE.MeshBasicMaterial({ color: surface === 'wood' ? 0x62564b : 0x9c9992 }),
  )
  backWall.position.set(0, 4, -28)
  envScene.add(backWall)

  // Large feathered overhead diffused studio softbox
  const topSoftbox = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 36).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: warmSoftTex,
      transparent: true,
      color: new THREE.Color(1.85, 1.83, 1.79),
    }),
  )
  topSoftbox.position.set(-2, 22, 2)
  envScene.add(topSoftbox)

  // Feathered left-front key softbox
  const keyStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 22),
    new THREE.MeshBasicMaterial({
      map: warmSoftTex,
      transparent: true,
      color: new THREE.Color(2.15, 2.1, 2.0),
    }),
  )
  keyStrip.position.set(-22, 16, 16)
  keyStrip.lookAt(0, 0, 0)
  envScene.add(keyStrip)

  // Feathered cool right-rear rim light
  const rimStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 14),
    new THREE.MeshBasicMaterial({
      map: coolSoftTex,
      transparent: true,
      color: new THREE.Color(1.4, 1.48, 1.62),
    }),
  )
  rimStrip.position.set(22, 13, -16)
  rimStrip.lookAt(0, 0, 0)
  envScene.add(rimStrip)

  // Gentle front fill bounce
  const frontFill = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 16),
    new THREE.MeshBasicMaterial({
      map: warmSoftTex,
      transparent: true,
      color: new THREE.Color(1.1, 1.08, 1.04),
    }),
  )
  frontFill.position.set(4, 8, 26)
  frontFill.lookAt(0, 0, 0)
  envScene.add(frontFill)

  // Softened side negative-fill flags for subtle metallic contour without hard edge snaps
  const flagMat = new THREE.MeshBasicMaterial({ color: 0x353432 })
  const leftFlag = new THREE.Mesh(new THREE.PlaneGeometry(24, 14), flagMat)
  leftFlag.position.set(-28, 2, -6)
  leftFlag.lookAt(0, 2, 0)
  envScene.add(leftFlag)

  const rightFlag = new THREE.Mesh(new THREE.PlaneGeometry(24, 14), flagMat)
  rightFlag.position.set(28, 2, 8)
  rightFlag.lookAt(0, 2, 0)
  envScene.add(rightFlag)

  const rt = pmrem.fromScene(envScene, 0.055)
  pmrem.dispose()
  warmSoftTex.dispose()
  coolSoftTex.dispose()

  // Dispose temporary env geometries/materials
  envScene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
      else obj.material.dispose()
    }
  })

  return {
    texture: rt.texture,
    dispose() {
      rt.dispose()
    },
  }
}

/**
 * Tileable procedural bead-blasted anodized aluminum micro-texture
 * (normal + roughness maps) so aluminum slabs read as real CNC metal.
 */
export function createMicroBeadMaps(repeatX = 4, repeatY = 5): {
  normalMap: THREE.DataTexture
  roughnessMap: THREE.DataTexture
  dispose: () => void
} {
  const size = 256
  const height = new Float32Array(size * size)

  // Deterministic high-frequency bead-blast grain + subtle micro-clumping
  let seed = 1337
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let i = 0; i < size * size; i++) {
    height[i] = rand()
  }

  // Slight box blur pass for realistic satin bead profile
  const smooth = new Float32Array(size * size)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      smooth[y * size + x] =
        at(x, y) * 0.5 +
        (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) * 0.125
    }
  }

  const normalData = new Uint8Array(size * size * 4)
  const roughData = new Uint8Array(size * size * 4)
  const strength = 1.6
  const sAt = (x: number, y: number) => smooth[((y + size) % size) * size + ((x + size) % size)]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const dx = (sAt(x + 1, y) - sAt(x - 1, y)) * strength
      const dy = (sAt(x, y + 1) - sAt(x, y - 1)) * strength
      const invLen = 1 / Math.hypot(dx, dy, 1)
      normalData[idx] = Math.round((-dx * invLen * 0.5 + 0.5) * 255)
      normalData[idx + 1] = Math.round((-dy * invLen * 0.5 + 0.5) * 255)
      normalData[idx + 2] = Math.round((invLen * 0.5 + 0.5) * 255)
      normalData[idx + 3] = 255

      // Micro roughness variance centered around ~0.78..0.96 (multiplied by material.roughness)
      const rVal = Math.round((0.82 + (smooth[y * size + x] - 0.5) * 0.24) * 255)
      roughData[idx] = rVal
      roughData[idx + 1] = rVal
      roughData[idx + 2] = rVal
      roughData[idx + 3] = 255
    }
  }

  const normalMap = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat)
  normalMap.wrapS = THREE.RepeatWrapping
  normalMap.wrapT = THREE.RepeatWrapping
  normalMap.repeat.set(repeatX, repeatY)
  normalMap.needsUpdate = true

  const roughnessMap = new THREE.DataTexture(roughData, size, size, THREE.RGBAFormat)
  roughnessMap.wrapS = THREE.RepeatWrapping
  roughnessMap.wrapT = THREE.RepeatWrapping
  roughnessMap.repeat.set(repeatX, repeatY)
  roughnessMap.needsUpdate = true

  return {
    normalMap,
    roughnessMap,
    dispose() {
      normalMap.dispose()
      roughnessMap.dispose()
    },
  }
}

/**
 * Fine machined radial knurling bump map for cylindrical encoder knobs (BC-1 VARISPEED).
 */
export function createKnurlBumpTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 64
  const ctx = c.getContext('2d')!
  const ribs = 72
  for (let i = 0; i < ribs; i++) {
    const x = (i / ribs) * c.width
    const w = c.width / ribs
    const g = ctx.createLinearGradient(x, 0, x + w, 0)
    g.addColorStop(0, '#202020')
    g.addColorStop(0.35, '#efefef')
    g.addColorStop(0.65, '#ffffff')
    g.addColorStop(1, '#202020')
    ctx.fillStyle = g
    ctx.fillRect(x, 0, w + 0.5, c.height)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.anisotropy = 4
  return tex
}

/**
 * Soft multi-layered ambient-occlusion contact shadow plane texture for grounding
 * each hardware slab naturally onto the studio desk.
 */
export function createContactShadowTexture(): THREE.CanvasTexture {
  const S = 256
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, S, S)

  const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.fill()
  }

  // Broad soft ambient shadow
  ctx.save()
  ctx.filter = 'blur(18px)'
  ctx.fillStyle = 'rgba(34, 28, 20, 0.24)'
  roundRect(38, 42, S - 76, S - 76, 16)
  ctx.restore()

  // Tight dark contact occlusion directly under the chassis perimeter
  ctx.save()
  ctx.filter = 'blur(5px)'
  ctx.fillStyle = 'rgba(20, 18, 14, 0.42)'
  roundRect(44, 44, S - 88, S - 88, 10)
  ctx.restore()

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Seamless warm studio paper backdrop with subtle overhead softbox pool & soft vignette.
 */
export function createStudioFloorTexture(): THREE.CanvasTexture {
  const S = 1024
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(S * 0.46, S * 0.46, S * 0.04, S * 0.5, S * 0.5, S * 0.56)
  g.addColorStop(0, '#ebe8e1')
  g.addColorStop(0.52, '#e4e1d9')
  g.addColorStop(1, '#d8d4cb')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)

  // Very subtle photographic paper tooth
  let seed = 4201
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let i = 0; i < 14000; i++) {
    const x = rand() * S
    const y = rand() * S
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)'
    ctx.fillRect(x, y, 1.5, 1.5)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/**
 * Loads the Knobs weathered walnut/oak tabletop photo and derives genuine PBR maps
 * (albedo with mild corner-vignette normalization, Sobel grain-pore normalMap, and
 * open-pore roughnessMap) so real 3D studio lighting rakes across every wood pore.
 */
export function createWoodTablePbrMaps(url: string): {
  map: THREE.CanvasTexture
  edgeMap: THREE.CanvasTexture
  normalMap: THREE.DataTexture
  roughnessMap: THREE.DataTexture
  dispose: () => void
} {
  const W = 1280
  const H = 720

  const albedoCanvas = document.createElement('canvas')
  albedoCanvas.width = W
  albedoCanvas.height = H
  const ctx = albedoCanvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#806b55'
  ctx.fillRect(0, 0, W, H)

  const map = new THREE.CanvasTexture(albedoCanvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 16

  // Horizontal edge-grain slice of the same timber canvas for the thick table slab edges (avoids vertical squishing)
  const edgeMap = new THREE.CanvasTexture(albedoCanvas)
  edgeMap.colorSpace = THREE.SRGBColorSpace
  edgeMap.anisotropy = 8
  edgeMap.repeat.set(1, 0.08)
  edgeMap.offset.set(0, 0.46)

  const normalData = new Uint8Array(W * H * 4)
  const roughData = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    normalData[i * 4] = 128
    normalData[i * 4 + 1] = 128
    normalData[i * 4 + 2] = 255
    normalData[i * 4 + 3] = 255
    roughData[i * 4] = 225
    roughData[i * 4 + 1] = 225
    roughData[i * 4 + 2] = 225
    roughData[i * 4 + 3] = 255
  }

  const normalMap = new THREE.DataTexture(normalData, W, H, THREE.RGBAFormat)
  normalMap.anisotropy = 8
  normalMap.needsUpdate = true

  const roughnessMap = new THREE.DataTexture(roughData, W, H, THREE.RGBAFormat)
  roughnessMap.anisotropy = 8
  roughnessMap.needsUpdate = true

  let disposed = false
  const img = new Image()
  img.onload = () => {
    if (disposed) return
    ctx.drawImage(img, 0, 0, W, H)

    const imgData = ctx.getImageData(0, 0, W, H)
    const px = imgData.data
    const lum = new Float32Array(W * H)

    // Gently counter residual corner darkening so real 3D directional lighting shapes the wood cleanly
    const cx = W * 0.5
    const cy = H * 0.5
    for (let y = 0; y < H; y++) {
      const ny = (y - cy) / cy
      for (let x = 0; x < W; x++) {
        const nx = (x - cx) / cx
        const r2 = nx * nx + ny * ny
        const lift = 1 + Math.min(0.22, r2 * 0.12)
        const idx = (y * W + x) * 4
        const r = Math.min(255, px[idx] * lift)
        const g = Math.min(255, px[idx + 1] * lift)
        const b = Math.min(255, px[idx + 2] * lift)
        px[idx] = r
        px[idx + 1] = g
        px[idx + 2] = b
        lum[y * W + x] = (r * 0.299 + g * 0.587 + b * 0.114) / 255
      }
    }
    ctx.putImageData(imgData, 0, 0)
    map.needsUpdate = true
    edgeMap.needsUpdate = true

    // Sobel gradient -> wood pore & grain micro-relief normalMap + open-pore roughnessMap
    const at = (x: number, y: number) => {
      const cx2 = x < 0 ? 0 : x >= W ? W - 1 : x
      const cy2 = y < 0 ? 0 : y >= H ? H - 1 : y
      return lum[cy2 * W + cx2]
    }
    const strength = 3.2
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const tl = at(x - 1, y - 1)
        const t = at(x, y - 1)
        const tr = at(x + 1, y - 1)
        const l = at(x - 1, y)
        const r = at(x + 1, y)
        const bl = at(x - 1, y + 1)
        const b = at(x, y + 1)
        const br = at(x + 1, y + 1)

        const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength
        const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength
        const inv = 1 / Math.hypot(dx, dy, 1)

        const idx = (y * W + x) * 4
        normalData[idx] = Math.round((-dx * inv * 0.5 + 0.5) * 255)
        normalData[idx + 1] = Math.round((dy * inv * 0.5 + 0.5) * 255)
        normalData[idx + 2] = Math.round((inv * 0.5 + 0.5) * 255)
        normalData[idx + 3] = 255

        // Darker pores & knots are dead-matte (~0.97); sanded lighter fibers have subtle dry satin (~0.76)
        const lVal = lum[y * W + x]
        const rough = Math.max(0.74, Math.min(0.98, 1.04 - lVal * 0.44))
        const rByte = Math.round(rough * 255)
        roughData[idx] = rByte
        roughData[idx + 1] = rByte
        roughData[idx + 2] = rByte
        roughData[idx + 3] = 255
      }
    }
    normalMap.needsUpdate = true
    roughnessMap.needsUpdate = true
  }
  trackImage(img, url) // counts towards the loading screen
  img.src = url

  return {
    map,
    edgeMap,
    normalMap,
    roughnessMap,
    dispose() {
      disposed = true
      map.dispose()
      edgeMap.dispose()
      normalMap.dispose()
      roughnessMap.dispose()
    },
  }
}

/**
 * Cast resin for the dice: light passes through and the red deepens with the
 * distance it travels, so thin edges glow and the middle reads dark, with no
 * separate core mesh. `thickness` is the die's size in its own units; `clarity`
 * below 1 clouds the resin, for a faceted die that would otherwise look like panes.
 */
export function createResinDiceMaterial(thickness: number, clarity = 1): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: '#ff2b38',
    transmission: clarity,
    thickness,
    attenuationColor: new THREE.Color('#e4101f'),
    attenuationDistance: thickness * 0.8,
    roughness: 0.14,
    metalness: 0,
    ior: 1.5,
    specularIntensity: 0.8,
    envMapIntensity: 0.85,
  })
}
