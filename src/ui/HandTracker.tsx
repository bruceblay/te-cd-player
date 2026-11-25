import { useEffect, useRef } from 'react'
import { renderHands, type HandStyle, type Pt, type RenderedHand } from './handRender'
import { snapToTarget, type HandTarget } from './handTargets'
import { OneEuro } from './oneEuro'

export interface HandStatus {
  state: 'off' | 'loading' | 'active' | 'error'
  hands: number
  illustratedFallback?: boolean
  error?: string
}

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

// Slight overscan so you can reach all 4 screen edges without leaving the camera view
const MARGIN = 0.08
const SMOOTH = 0.45
const PINCH_ON = 0.38
const PINCH_OFF = 0.50
/** a pinch lands where the cursor was this long ago, before the fingers started closing */
const REWIND_MS = 110
/** a pinch released this quickly is a click, however much the hand jittered */
const TAP_MS = 320

interface HandSlot {
  id: number
  pts: Pt[] | null
  pinched: boolean
  target: Element | null
  downAt: Pt
  world?: Pt[]
  lastSeen: number
  /** aim smoothing, one filter per axis */
  fx: OneEuro
  fy: OneEuro
  /** knuckles-to-fingertip offset, learned while the hand is open and frozen while pinching */
  offset: Pt | null
  /** the damped aim point last frame */
  aim: Pt | null
  /** recent aim points, for landing a pinch where the cursor was before it started */
  history: { t: number; x: number; y: number }[]
  /** the aim point at pinch-down, so drags move relative to the snapped press point */
  aimAtDown: Pt
  downTime: number
}

const newSlot = (id: number): HandSlot => ({
  id,
  pts: null,
  pinched: false,
  target: null,
  downAt: { x: 0, y: 0 },
  lastSeen: 0,
  fx: new OneEuro(1, 0.007),
  fy: new OneEuro(1, 0.007),
  offset: null,
  aim: null,
  history: [],
  aimAtDown: { x: 0, y: 0 },
  downTime: 0,
})

function mapCoord(nx: number, ny: number, nz: number, w: number, h: number): Pt {
  const mx = (1 - nx - MARGIN) / (1 - 2 * MARGIN)
  const my = (ny - MARGIN) / (1 - 2 * MARGIN)
  return {
    x: mx * w,
    y: my * h,
    z: nz * w / (1 - 2 * MARGIN),
  }
}

function makePointer(type: string, id: number, p: Pt, down: boolean) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: id,
    pointerType: 'mouse',
    isPrimary: id === 101,
    clientX: p.x,
    clientY: p.y,
    screenX: p.x,
    screenY: p.y,
    button: 0,
    buttons: down ? 1 : 0,
    pressure: down ? 0.5 : 0,
  })
}

function releaseSlot(slot: HandSlot, at?: Pt) {
  if (!slot.pinched) return
  slot.pinched = false
  const p = at ?? slot.downAt
  const target = slot.target
  slot.target = null
  if (!target || !target.isConnected) return
  target.dispatchEvent(makePointer('pointerup', slot.id, p, false))
  // Pinch-tap: fire click so standard buttons, LCD pills, checkboxes & drawer controls work seamlessly.
  // A quick pinch always counts, so hand jitter can't swallow a click.
  if (Math.hypot(p.x - slot.downAt.x, p.y - slot.downAt.y) < 22 || performance.now() - slot.downTime < TAP_MS) {
    target.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: p.x,
        clientY: p.y,
        button: 0,
      }),
    )
  }
}

export function HandTracker({
  enabled,
  style,
  onStatus,
}: {
  enabled: boolean
  style: HandStyle
  onStatus: (status: HandStatus) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const styleRef = useRef(style)
  styleRef.current = style
  const statusCb = useRef(onStatus)
  statusCb.current = onStatus

  useEffect(() => {
    if (!enabled) {
      statusCb.current({ state: 'off', hands: 0 })
      return
    }

    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null
    let landmarker: import('@mediapipe/tasks-vision').HandLandmarker | null = null
    let mesh: Awaited<ReturnType<typeof import('./handMesh').createHandMesh>> | undefined
    let meshRequested = false

    const slots: [HandSlot, HandSlot] = [newSlot(101), newSlot(102)]
    let lastFallback = false
    let lastHandCount = -1
    let lastVideoTime = -1

    const syncCanvasSize = () => {
      const c = canvasRef.current
      if (!c) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = window.innerWidth
      const h = window.innerHeight
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
      }
      const ctx = c.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    window.addEventListener('resize', syncCanvasSize)
    syncCanvasSize()

    // Promote the hand-overlay canvas into the browser top-layer via Popover API so
    // hands always paint ABOVE both the slide-out drawer AND <dialog>.showModal() modals.
    const promoteTopLayer = () => {
      const c = canvasRef.current as (HTMLCanvasElement & { showPopover?: () => void; hidePopover?: () => void }) | null
      if (!c || typeof c.showPopover !== 'function') return
      try {
        // Re-showing moves the popover to the very top of the top-layer stack above newly opened dialogs
        if (c.matches(':popover-open')) c.hidePopover()
        c.showPopover()
      } catch {
        /* fallback to high z-index if Popover API unsupported */
      }
    }
    promoteTopLayer()

    // Whenever any <dialog> opens (gets the `open` attribute), re-promote the hand overlay above it
    const dialogObserver = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.target instanceof HTMLDialogElement && m.target.open) {
          promoteTopLayer()
          break
        }
      }
    })
    dialogObserver.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    })

    const start = async () => {
      statusCb.current({ state: 'loading', hands: 0 })
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('webcam not available in this browser')
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        })
        if (cancelled) return
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        if (cancelled) return

        const vision = await import('@mediapipe/tasks-vision')
        if (cancelled) return
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT)
        if (cancelled) return
        try {
          landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.55,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          })
        } catch {
          landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.55,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          })
        }
        if (cancelled) {
          landmarker.close()
          return
        }
        statusCb.current({ state: 'active', hands: 0 })

        const loop = () => {
          if (cancelled) return
          raf = requestAnimationFrame(loop)
          const v = videoRef.current
          const c = canvasRef.current
          if (!v || !c || !landmarker || v.readyState < 2) return
          if (v.currentTime === lastVideoTime) return
          lastVideoTime = v.currentTime

          const now = performance.now()
          const res = landmarker.detectForVideo(v, now)
          const w = window.innerWidth
          const h = window.innerHeight
          const rawHands = res.landmarks.map((lms) => lms.map((lm) => mapCoord(lm.x, lm.y, lm.z, w, h)))

          // Assign detected hands to slots minimizing centroid jump so dual-hand pinches stay stable
          const assigned: (Pt[] | null)[] = [null, null]
          if (rawHands.length === 1) {
            const p0 = rawHands[0][0]
            if (slots[0].pts && slots[1].pts) {
              const d0 = Math.hypot(p0.x - slots[0].pts[0].x, p0.y - slots[0].pts[0].y)
              const d1 = Math.hypot(p0.x - slots[1].pts[0].x, p0.y - slots[1].pts[0].y)
              assigned[d0 <= d1 ? 0 : 1] = rawHands[0]
            } else if (slots[1].pts && !slots[0].pts) {
              assigned[1] = rawHands[0]
            } else {
              assigned[0] = rawHands[0]
            }
          } else if (rawHands.length >= 2) {
            const [a, b] = rawHands
            if (slots[0].pts && slots[1].pts) {
              const keep =
                Math.hypot(a[0].x - slots[0].pts[0].x, a[0].y - slots[0].pts[0].y) +
                Math.hypot(b[0].x - slots[1].pts[0].x, b[0].y - slots[1].pts[0].y)
              const swap =
                Math.hypot(b[0].x - slots[0].pts[0].x, b[0].y - slots[0].pts[0].y) +
                Math.hypot(a[0].x - slots[1].pts[0].x, a[0].y - slots[1].pts[0].y)
              if (keep <= swap) {
                assigned[0] = a
                assigned[1] = b
              } else {
                assigned[0] = b
                assigned[1] = a
              }
            } else {
              // left-to-right ordering initially
              if (a[0].x <= b[0].x) {
                assigned[0] = a
                assigned[1] = b
              } else {
                assigned[0] = b
                assigned[1] = a
              }
            }
          }

          const rendered: RenderedHand[] = []
          for (let i = 0; i < 2; i++) {
            const slot = slots[i]
            const raw = assigned[i]
            if (!raw) {
              if (now - slot.lastSeen > 180) {
                releaseSlot(slot)
                slot.pts = null
                slot.world = undefined
                slot.fx.reset()
                slot.fy.reset()
                slot.offset = null
                slot.aim = null
                slot.history = []
              }
              continue
            }
            slot.lastSeen = now
            // EMA smoothing for steady knob/fader control
            if (!slot.pts) {
              slot.pts = raw
            } else {
              slot.pts = raw.map((p, k) => ({
                x: slot.pts![k].x + (p.x - slot.pts![k].x) * SMOOTH,
                y: slot.pts![k].y + (p.y - slot.pts![k].y) * SMOOTH,
                z: (slot.pts![k].z ?? 0) + ((p.z ?? 0) - (slot.pts![k].z ?? 0)) * SMOOTH,
              }))
            }
            const pts = slot.pts
            const palm = Math.max(24, Math.hypot(pts[0].x - pts[9].x, pts[0].y - pts[9].y))
            const pinchDist = Math.hypot(pts[4].x - pts[8].x, pts[4].y - pts[8].y) / palm
            const strength = Math.max(0, Math.min(1, (0.7 - pinchDist) / 0.35))
            const nextPinched = slot.pinched ? pinchDist < PINCH_OFF : pinchDist < PINCH_ON

            // Aim from the index and middle knuckles, which barely move when you pinch (the
            // fingertip does). An offset learned with the hand open keeps the cursor at the fingertip.
            const knuckles = { x: (raw[5].x + raw[9].x) / 2, y: (raw[5].y + raw[9].y) / 2 }
            const tipOffset = { x: raw[8].x - knuckles.x, y: raw[8].y - knuckles.y }
            if (!slot.offset) slot.offset = tipOffset
            else if (!slot.pinched && strength < 0.15) {
              slot.offset = { x: slot.offset.x + (tipOffset.x - slot.offset.x) * 0.12, y: slot.offset.y + (tipOffset.y - slot.offset.y) * 0.12 }
            }
            let aim: Pt = {
              x: slot.fx.filter(knuckles.x + slot.offset.x, now),
              y: slot.fy.filter(knuckles.y + slot.offset.y, now),
            }
            // As the fingers close, damp the cursor so the pinch motion can't drag it off target
            if (!slot.pinched && slot.aim && strength > 0.15) {
              const keep = 1 - 0.85 * Math.min(1, (strength - 0.15) / 0.6)
              aim = { x: slot.aim.x + (aim.x - slot.aim.x) * keep, y: slot.aim.y + (aim.y - slot.aim.y) * keep }
            }
            aim.x = Math.max(0, Math.min(w - 1, aim.x))
            aim.y = Math.max(0, Math.min(h - 1, aim.y))
            slot.aim = aim
            slot.history.push({ t: now, x: aim.x, y: aim.y })
            while (slot.history.length > 2 && now - slot.history[0].t > 400) slot.history.shift()

            let cursor: Pt = aim
            let snapped: HandTarget | null = null
            if (nextPinched && !slot.pinched) {
              // land the press where the cursor was just before the pinch began, snapped to the nearest control
              const before = [...slot.history].reverse().find((e) => now - e.t >= REWIND_MS) ?? slot.history[0]
              const press = snapToTarget(before.x, before.y, now)
              cursor = press ? { x: press.x, y: press.y } : { x: before.x, y: before.y }
              snapped = press?.target ?? null
              slot.pinched = true
              slot.downAt = { ...cursor }
              slot.aimAtDown = { ...aim }
              slot.downTime = now
              const el = document.elementFromPoint(cursor.x, cursor.y)
              slot.target = el
              el?.dispatchEvent(makePointer('pointerdown', slot.id, cursor, true))
            } else if (nextPinched && slot.pinched) {
              // drags move relative to the press point
              cursor = {
                x: Math.max(0, Math.min(w - 1, slot.downAt.x + aim.x - slot.aimAtDown.x)),
                y: Math.max(0, Math.min(h - 1, slot.downAt.y + aim.y - slot.aimAtDown.y)),
              }
              slot.target?.dispatchEvent(makePointer('pointermove', slot.id, cursor, true))
            } else {
              if (slot.pinched) releaseSlot(slot, { x: slot.downAt.x + aim.x - slot.aimAtDown.x, y: slot.downAt.y + aim.y - slot.aimAtDown.y })
              // open hand: show where a pinch would land
              const hover = snapToTarget(aim.x, aim.y, now)
              if (hover) {
                cursor = { x: hover.x, y: hover.y }
                snapped = hover.target
              }
            }

            const detection = rawHands.indexOf(raw)
            const side = res.handedness[detection]?.[0]?.categoryName
            const previous = slot.world
            slot.world = res.worldLandmarks[detection]?.map((p, k) => {
              const q = previous?.[k]
              return q ? {
                x: q.x + (p.x - q.x) * SMOOTH,
                y: q.y + (p.y - q.y) * SMOOTH,
                z: q.z! + (p.z - q.z!) * SMOOTH,
              } : p
            })
            rendered.push({ slot: i, world: slot.world, side: side === 'Left' ? 'Left' : 'Right', pts, cursor, pinched: slot.pinched, pinchStrength: strength, snap: snapped })
          }

          const ctx = c.getContext('2d')
          const style = styleRef.current
          if (rendered.length && !meshRequested && style !== 'wireframe') {
            meshRequested = true
            void import('./handMesh').then(m => m.createHandMesh(style)).then(result => {
              if (cancelled) result.dispose()
              else mesh = result
            }).catch(() => { /* Canvas hands remain available without WebGL. */ })
          }
          if (!ctx) return
          const fallback = renderHands(ctx, rendered, style, mesh?.draw)
          if (rendered.length !== lastHandCount || fallback !== lastFallback) {
            lastHandCount = rendered.length
            lastFallback = fallback
            statusCb.current({ state: 'active', hands: rendered.length, illustratedFallback: fallback })
          }
        }
        raf = requestAnimationFrame(loop)
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'couldn’t start hand tracking'
        statusCb.current({
          state: 'error',
          hands: 0,
          error: /denied|permission/i.test(msg) ? 'camera permission denied' : msg,
        })
      }
    }

    void start()

    return () => {
      cancelled = true
      mesh?.dispose()
      cancelAnimationFrame(raf)
      dialogObserver.disconnect()
      window.removeEventListener('resize', syncCanvasSize)
      for (const s of slots) releaseSlot(s)
      landmarker?.close()
      stream?.getTracks().forEach((t) => t.stop())
      const c = canvasRef.current as (HTMLCanvasElement & { hidePopover?: () => void }) | null
      c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
      try {
        if (c && c.matches(':popover-open')) c.hidePopover?.()
      } catch {
        /* ignore */
      }
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <>
      <video ref={videoRef} className="hand-cam" muted playsInline aria-hidden />
      <canvas ref={canvasRef} className="hand-overlay" popover="manual" aria-hidden />
    </>
  )
}
