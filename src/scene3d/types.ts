import * as THREE from 'three'
import type { Deck } from '../engine/deck'
import type { Mixer } from '../engine/mixer'

export type ControlAction =
  | {
      kind: 'button'
      keyId: string
      deckIndex?: number
      cursor?: string
      onDown: () => void
      onUp?: () => void
    }
  | {
      kind: 'knob'
      deckIndex?: number
      min: number
      max: number
      getValue: () => number
      setValue: (v: number) => void
      onTap?: () => void
      onReset?: () => void
    }
  | {
      kind: 'fader'
      getValue: () => number
      setValue: (v: number) => void
    }
  | {
      kind: 'jog'
      deckIndex?: number
      setValue: (v: number) => void
    }
  | {
      kind: 'pad'
      setMod: (stick: number, pad: number, lock?: boolean) => void
    }
  | {
      kind: 'disc'
      deckIndex: number
    }
  | {
      kind: 'oled'
      onClickUv: (u: number, v: number) => void
      onWheel: (deltaY: number) => void
    }
  | {
      kind: 'toggle'
      deckIndex?: number
      onToggle: () => void
    }

export interface ControlTag {
  action: ControlAction
}

/**
 * Tag a mesh (and optionally its children) with an interactive control action
 * picked up by the Studio3D raycaster.
 */
export function tagControl(obj: THREE.Object3D, action: ControlAction) {
  obj.traverse((child) => {
    child.userData.control = action
  })
}

/**
 * Creates a rounded flat rectangle lying in the XZ plane (normal = +Y)
 * with exact planar UVs matching a top-down 2D canvas of size (w, d):
 *   u = 0 at -w/2, u = 1 at +w/2
 *   v = 1 at -d/2 (top of canvas), v = 0 at +d/2 (bottom of canvas)
 */
export function createRoundedTopPlane(w: number, d: number, r: number, curveSegments = 8): THREE.BufferGeometry {
  const hw = w / 2
  const hd = d / 2
  const cr = Math.min(r, hw * 0.49, hd * 0.49)
  const shape = new THREE.Shape()
  shape.moveTo(-hw + cr, -hd)
  shape.lineTo(hw - cr, -hd)
  shape.absarc(hw - cr, -hd + cr, cr, -Math.PI / 2, 0, false)
  shape.lineTo(hw, hd - cr)
  shape.absarc(hw - cr, hd - cr, cr, 0, Math.PI / 2, false)
  shape.lineTo(-hw + cr, hd)
  shape.absarc(-hw + cr, hd - cr, cr, Math.PI / 2, Math.PI, false)
  shape.lineTo(-hw, -hd + cr)
  shape.absarc(-hw + cr, -hd + cr, cr, Math.PI, Math.PI * 1.5, false)

  const geom = new THREE.ShapeGeometry(shape, curveSegments)
  // ShapeGeometry lies in XY (+Y up). Rotate -90 deg around X so +Y becomes -Z (top of unit).
  // Wait: rotating (x, y, 0) by -PI/2 around X gives (x, 0, -y).
  // So y = +hd maps to z = -hd (top edge of canvas -> v = 1),
  // and y = -hd maps to z = +hd (bottom edge of canvas -> v = 0).
  const pos = geom.attributes.position
  const uvs = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    uvs[i * 2] = (x + hw) / w
    uvs[i * 2 + 1] = (y + hd) / d
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geom.rotateX(-Math.PI / 2)
  geom.computeVertexNormals()
  return geom
}

export type DeckRef = { deck: Deck; index: number }
export type MixerRef = { mixer: Mixer }
