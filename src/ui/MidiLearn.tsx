import { useEffect, useSyncExternalStore } from 'react'
import { controlIdForElement, describeSource, midiLearn } from '../engine/midiLearn'

const GEAR = '.device-wrap, .sidekick-wrap'
const CANDIDATES = ['.device-wrap', '.sidekick-wrap']
  .flatMap((w) => [`${w} [aria-label]`, `${w} [title]`])
  .join(', ')

export const useMidiLearn = () => useSyncExternalStore(midiLearn.subscribe, midiLearn.getState)

/** While learning: clicks on the 2D gear pick a control instead of working it, and mappable controls are outlined. */
export function MidiLearnLayer() {
  const s = useMidiLearn()

  useEffect(() => {
    if (!s.learning) return
    const inGear = (t: EventTarget | null) => t instanceof Element && !!t.closest(GEAR)
    const onDown = (e: PointerEvent) => {
      if (!inGear(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      midiLearn.selectTarget(controlIdForElement(e.target as Element)?.id ?? null)
    }
    const swallow = (e: Event) => {
      if (!inGear(e.target)) return
      e.preventDefault()
      e.stopPropagation()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      midiLearn.setLearning(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', swallow, true)
    window.addEventListener('click', swallow, true)
    window.addEventListener('dblclick', swallow, true)
    window.addEventListener('wheel', swallow, { capture: true, passive: false })
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', swallow, true)
      window.removeEventListener('click', swallow, true)
      window.removeEventListener('dblclick', swallow, true)
      window.removeEventListener('wheel', swallow, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [s.learning])

  // outline every mappable control: dashed when free, solid when mapped, filled ring on the pick
  useEffect(() => {
    const clear = () => document.querySelectorAll('[data-midi]').forEach((el) => el.removeAttribute('data-midi'))
    if (!s.learning) {
      clear()
      return
    }
    const mapped = new Set(Object.values(s.mappings))
    const paint = () => {
      clear()
      document.querySelectorAll(CANDIDATES).forEach((el) => {
        const hit = controlIdForElement(el)
        if (!hit || hit.el !== el) return
        el.setAttribute('data-midi', hit.id === s.target ? 'target' : mapped.has(hit.id) ? 'mapped' : 'free')
      })
    }
    paint()
    // the rig can re-render (layout switch) while learning
    const t = window.setInterval(paint, 800)
    return () => {
      window.clearInterval(t)
      clear()
    }
  }, [s.learning, s.target, s.mappings])

  if (!s.learning) return null

  const bound = s.lastBound
  const targetSource = s.target ? midiLearn.sourceFor(s.target) : null
  let text: string
  if (!s.devices.length) text = 'no MIDI device found, plug one in'
  else if (bound) text = `${midiLearn.labelFor(bound.control)} ← ${describeSource(bound.source)}`
  else if (s.target)
    text = `${midiLearn.labelFor(s.target)}${targetSource ? ` (${describeSource(targetSource)})` : ''} · move a control on your device`
  else text = 'MIDI learn · pick a control'

  return (
    <div className="midi-pill" role="status">
      <span className={`midi-pill-dot ${s.target ? 'listening' : ''}`} aria-hidden />
      <span className="midi-pill-text">{text}</span>
      {s.target && targetSource && (
        <button type="button" onClick={() => midiLearn.unmap(s.target!)}>
          unmap
        </button>
      )}
      <button type="button" className="done" onClick={() => midiLearn.setLearning(false)}>
        done
      </button>
    </div>
  )
}

/** Drawer section: connect, start learning, clear. */
export function MidiSection({ open, onLearn }: { open: boolean; onLearn: () => void }) {
  const s = useMidiLearn()
  const count = Object.keys(s.mappings).length
  const tab = open ? 0 : -1

  return (
    <section className="drawer-section drawer-divider">
      <div className="drawer-section-head">
        <h3 className="drawer-label">midi</h3>
        <div className="drawer-mini-actions">
          {s.connected && (
            <button type="button" className="drawer-link" tabIndex={tab} disabled={!count} onClick={() => midiLearn.clearAll()}>
              clear
            </button>
          )}
          {s.supported && (
            <button
              type="button"
              className="drawer-link"
              tabIndex={tab}
              onClick={() => (s.connected ? midiLearn.disconnect() : void midiLearn.connect())}
            >
              {s.connected ? 'disconnect' : 'connect'}
            </button>
          )}
        </div>
      </div>

      {!s.supported ? (
        <p className="drawer-note">this browser has no Web MIDI; try Chrome or Edge on a computer</p>
      ) : !s.connected ? (
        <p className="drawer-note">{s.error ?? 'connect a controller, then map its knobs and buttons to anything on the desk'}</p>
      ) : (
        <>
          <p className="sp-status">
            <span className="sp-dot midi" aria-hidden />
            <span>{s.devices.length ? s.devices.join(', ') : 'no devices plugged in'}</span>
          </p>
          <button
            type="button"
            className="drawer-cta"
            tabIndex={tab}
            onClick={() => {
              midiLearn.setLearning(true)
              onLearn()
            }}
          >
            learn
          </button>
          <p className="drawer-note">
            {count ? `${count} mapped · ` : ''}click a control, then move a knob or press a button on your controller
          </p>
        </>
      )}
    </section>
  )
}
