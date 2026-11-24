import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Deck } from './engine/deck'
import { completeSpotifyLogin, fetchSpotifyProfile, spotifyToken, type SpotifyProfile } from './sources/spotifyAuth'
import { Device } from './ui/Device'
import { BurnDialog, type BurnDialogHandle } from './ui/BurnDialog'
import { Mixer, type MixerState } from './engine/mixer'
import { Sidekick } from './ui/Sidekick'
import { Cable, type End } from './ui/Cable'
import { Studio3D } from './scene3d/Studio3D'
import {
  SideDrawer,
  readHandStyle,
  readLayout,
  readViewMode,
  saveHandStyle,
  saveLayout,
  saveViewMode,
  type LayoutConfig,
  type ViewMode,
} from './ui/SideDrawer'
import {
  DeskProps,
  clearGearOverlap,
  createInitialProps,
  readPropsEnabled,
  readSavedProps,
  saveProps,
  savePropsEnabled,
  scatterProps,
  spawnProp,
  type PlacedProp,
  type PropId,
} from './ui/DeskProps'
import { HandTracker, type HandStatus } from './ui/HandTracker'
import type { HandStyle } from './ui/handRender'
import type { Jack } from './engine/mixer'
import { buildControls, midiLearn } from './engine/midiLearn'
import { MidiLearnLayer } from './ui/MidiLearn'


const decks = [new Deck(), new Deck()] as const

/** ?og renders the gear alone, with demo discs, for the 1200x630 link-preview image */
const OG = new URLSearchParams(location.search).has('og')
if (OG) {
  const t = (title: string, duration: number) => ({ title, duration })
  decks[0].showcase({
    id: 'og-a',
    kind: 'mix',
    title: 'cds.bruceblay.com',
    color: '#22468c',
    tracks: [t('burn a disc', 214), t('youtube', 187), t('soundcloud', 242), t('spotify', 198), t('local files', 231), t('two decks', 176), t('k.o. sidekick', 263), t('patch cables', 205)],
  })
  decks[1].showcase({
    id: 'og-b',
    kind: 'mix',
    title: 'side b',
    color: '#ff5a1f',
    tracks: [t('varispeed', 201), t('cue 1 2 3', 168), t('jog', 192), t('filter', 225), t('delay', 239), t('tape', 184), t('loop', 210), t('tremolo', 196), t('siren', 172)],
  })
}
const outputs = ['bc1-out', 'bc2-out']
const inputs: Record<string, Jack> = { 'sk-ch1': 0, 'sk-ch2': 1, 'sk-aux': 'aux' }
const defaultCables = outputs.map((a, i) => ({ a, b: `sk-ch${i + 1}` }))
type Patch = Record<End, string | null>

// the optional K.O.-sidekick mixer, created the first time it's added
let mixer: Mixer | null = null
const getMixer = () => (mixer ??= new Mixer())
const noSub = () => () => {}
const noState = () => null
const CABLES_KEY = 'bc1.cables'
const readCables = (): Patch[] => {
  try {
    const raw = localStorage.getItem(CABLES_KEY)
    if (!raw) return defaultCables
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length !== outputs.length) return defaultCables
    const usedB = new Set<string>()
    return outputs.map((out, i) => {
      const item = parsed[i]
      if (!item || typeof item !== 'object') return defaultCables[i]
      const { a, b } = item as Record<string, unknown>
      const validA = a === null ? null : a === out ? out : defaultCables[i].a
      let validB: string | null = null
      if (b === null) {
        validB = null
      } else if (typeof b === 'string' && b in inputs && !usedB.has(b)) {
        validB = b
        usedB.add(b)
      } else {
        const fallback = defaultCables[i].b
        validB = fallback && !usedB.has(fallback) ? fallback : null
        if (validB) usedB.add(validB)
      }
      return { a: validA, b: validB }
    })
  } catch {
    return defaultCables
  }
}
if (import.meta.env.DEV) Object.assign(window, { bc1: decks[0], bc2: decks[1] })
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    decks.forEach((d) => d.dispose())
    mixer?.detach()
  })
}

export default function App() {
  const active = useRef(0)
  const rigRef = useRef<HTMLDivElement>(null)
  const prevRects = useRef<Map<string, DOMRect>>(new Map())
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerOpenRef = useRef(false)
  drawerOpenRef.current = drawerOpen
  const [view, setView] = useState<ViewMode>(readViewMode)
  useEffect(() => {
    saveViewMode(view)
  }, [view])
  const [handsOn, setHandsOn] = useState(false)
  const [handStyle, setHandStyle] = useState<HandStyle>(readHandStyle)
  const [handStatus, setHandStatus] = useState<HandStatus>({ state: 'off', hands: 0 })
  useEffect(() => {
    saveHandStyle(handStyle)
  }, [handStyle])
  const [propsOn, setPropsOn] = useState(readPropsEnabled)
  useEffect(() => {
    savePropsEnabled(propsOn)
  }, [propsOn])
  const [props, setProps] = useState<PlacedProp[] | null>(readSavedProps)
  // On first load (no saved positions), scatter randomly outside the live gear bounds and persist
  useLayoutEffect(() => {
    if (props !== null) return
    const initial = createInitialProps()
    setProps(initial)
    saveProps(initial)
  }, [props])
  useEffect(() => {
    if (props !== null) saveProps(props)
  }, [props])
  // After a rotation or resize (and on load, for positions saved on another screen) pull back any desk
  // items the gear now covers or the viewport now clips
  useEffect(() => {
    let t = 0
    const refit = () => {
      clearTimeout(t)
      t = window.setTimeout(() => setProps((cur) => (cur ? clearGearOverlap(cur) : cur)), 250)
    }
    refit()
    window.addEventListener('resize', refit)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', refit)
    }
  }, [view])
  const updateProps = (updater: (cur: PlacedProp[]) => PlacedProp[]) => {
    setProps((cur) => updater(cur ?? []))
  }
  const toggleProp = (id: PropId) => {
    updateProps((cur) => (cur.some((p) => p.id === id) ? cur.filter((p) => p.id !== id) : [...cur, spawnProp(id, cur)]))
  }
  const [layout, setLayout] = useState<LayoutConfig>(readLayout)
  const deckCount = layout.decks
  const mixerOn = deckCount === 2 || layout.sidekick
  const ms = useSyncExternalStore<MixerState | null>(
    mixerOn ? getMixer().subscribe : noSub,
    mixerOn ? getMixer().getState : noState,
  )
  const [cables, setCables] = useState<Patch[]>(readCables)
  const snapshotLayout = () => {
    const map = new Map<string, DOMRect>()
    rigRef.current?.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
      map.set(el.dataset.flip!, el.getBoundingClientRect())
    })
    prevRects.current = map
  }
  const updateLayout = (next: LayoutConfig) => {
    snapshotLayout()
    setLayout(next)
    if (next.decks === 2) {
      setCables((current) => {
        if (!current[0].b || current[0].b !== current[1].b) return current
        const free = Object.keys(inputs).find((id) => id !== current[0].b) ?? null
        return [current[0], { ...current[1], b: free }]
      })
    }
  }
  useLayoutEffect(() => {
    const prev = prevRects.current
    if (!prev.size) return
    prevRects.current = new Map()
    // Relocate any desk items now covered by the resized/expanded gear BEFORE FLIP transforms start
    setProps((cur) => (cur ? clearGearOverlap(cur) : cur))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = rigRef.current
    if (!root) return
    const easing = 'cubic-bezier(0.22, 1, 0.36, 1)'
    const duration = 280
    const anims: Animation[] = []
    root.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
      const before = prev.get(el.dataset.flip!)
      if (before) {
        const after = el.getBoundingClientRect()
        if (!after.width || !before.width) return
        const dx = before.left - after.left
        const dy = before.top - after.top
        const sx = before.width / after.width
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.002) return
        anims.push(
          el.animate(
            [
              { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx})` },
              { transformOrigin: '0 0', transform: 'none' },
            ],
            { duration, easing },
          ),
        )
      } else {
        anims.push(
          el.animate(
            [
              { opacity: 0, transform: 'scale(0.97)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 240, easing },
          ),
        )
      }
    })
    const cableEls = [...root.querySelectorAll<SVGElement>('.cable')]
    if (cableEls.length && anims.length) {
      cableEls.forEach((el) => {
        el.style.opacity = '0'
      })
      void Promise.allSettled(anims.map((a) => a.finished)).then(() => {
        window.dispatchEvent(new Event('resize'))
        requestAnimationFrame(() => {
          cableEls.forEach((el) => {
            el.style.opacity = ''
            el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
          })
        })
      })
    }
  }, [deckCount, mixerOn])
  useEffect(() => {
    try {
      localStorage.setItem(CABLES_KEY, JSON.stringify(cables))
    } catch {
      /* private mode: just not remembered */
    }
  }, [cables])
  useEffect(() => {
    if (mixerOn) {
      const c0 = cables[0]
      getMixer().plug(decks[0], c0.a && c0.b ? inputs[c0.b] : null)
      if (deckCount === 2) {
        const c1 = cables[1]
        getMixer().plug(decks[1], c1.a && c1.b ? inputs[c1.b] : null)
      } else {
        active.current = 0
        decks[1].powerSwitch(false)
        getMixer().plug(decks[1], null)
      }
    } else {
      active.current = 0
      decks[1].powerSwitch(false)
      mixer?.detach()
    }
  }, [mixerOn, deckCount, cables, decks])
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { mix: mixerOn ? getMixer() : null })
    saveLayout(layout)
  }, [layout, mixerOn])
  const hiddenMount = useRef<(HTMLDivElement | null)[]>([])
  const help = useRef<HTMLDialogElement>(null)
  const burn = useRef<(BurnDialogHandle | null)[]>([])
  const openLid = (i: number) => {
    active.current = i
    burn.current[i]?.open()
  }
  const [spotifyIn, setSpotifyIn] = useState(false)
  const [spotifyProfile, setSpotifyProfile] = useState<SpotifyProfile | null>(null)

  useEffect(() => {
    decks.forEach((deck, i) => deck.setMount(hiddenMount.current[i]))
  }, [decks])

  useEffect(() => {
    let alive = true
    const initSpotify = async () => {
      const res = await completeSpotifyLogin()
      if (!alive) return
      const token = res.ok ? await spotifyToken() : await spotifyToken()
      if (!alive) return
      const signedIn = !!token
      setSpotifyIn(signedIn)
      if (signedIn) {
        void fetchSpotifyProfile().then((p) => alive && setSpotifyProfile(p))
      }
      if (res.handled && res.pending) {
        const idx = res.pending.deckIndex === 1 && deckCount === 2 ? 1 : 0
        active.current = idx
        burn.current[idx]?.open({
          draft: res.pending.draft,
          pendingUrl: res.ok ? res.pending.pendingUrl : undefined,
          error: res.ok ? undefined : res.error,
        })
      }
    }
    void initSpotify()
    return () => {
      alive = false
    }
  }, [])

  // keyboard: mirrors the panel
  useEffect(() => {
    const pressed = new Map<string, Deck>()
    const typing = (e: KeyboardEvent) =>
      e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
    const down = (e: KeyboardEvent) => {
      if (drawerOpenRef.current) {
        if (e.key === 'Escape' && !e.repeat) {
          setDrawerOpen(false)
          e.preventDefault()
        }
        return
      }
      if (document.querySelector('dialog[open]')) {
        if (e.key === '?' && help.current?.open && !e.repeat) {
          help.current.close()
          e.preventDefault()
        }
        return
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof HTMLElement && e.target.closest('.key, .knob, .jog-cap') && (e.key === ' ' || e.key === 'Enter')) return
      const k = e.key
      const deck = decks[active.current]
      let handled = true
      if (e.repeat) return e.preventDefault()
      if (k === ' ') deck.pressPlay()
      else if (k === 'x') deck.pressStop()
      else if (k === 'ArrowLeft') deck.pressPrev()
      else if (k === 'ArrowRight') deck.pressNext()
      else if (/^[0-9]$/.test(k)) deck.pressDigit(+k)
      else if (k === 't') deck.pressTime()
      else if (k === 'Escape' || k === 'c') deck.pressCancel()
      else if (k === 'Enter') deck.enterDown()
      else if (k === 'q') deck.cueDown(0)
      else if (k === 'w') deck.cueDown(1)
      else if (k === 'e') deck.cueDown(2)
      else if (k === ',' || k === '<') deck.setJog(e.shiftKey ? -1 : -0.3)
      else if (k === '.' || k === '>') deck.setJog(e.shiftKey ? 1 : 0.3)
      else if (k === 'b') deck.btDown()
      else if (k === 'o') openLid(active.current)
      else if (k === 'p') deck.powerSwitch(deck.getState().power === 'off')
      else if (k === 'm') {
        snapshotLayout()
        setLayout((l) => (l.decks === 2 || l.sidekick ? { decks: 1, sidekick: false } : { decks: 2, sidekick: true }))
      }
      else if (k === '?') help.current?.showModal()
      else handled = false
      if (handled) {
        pressed.set(e.code || k, deck)
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      const deck = pressed.get(e.code || e.key)
      if (!deck) return
      pressed.delete(e.code || e.key)
      const k = e.key
      if (k === 'Enter') deck.enterUp()
      else if (k === 'q') deck.cueUp(0)
      else if (k === 'w') deck.cueUp(1)
      else if (k === 'e') deck.cueUp(2)
      else if (k === ',' || k === '.' || k === '<' || k === '>') deck.setJog(0)
      else if (k === 'b') deck.btUp()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [decks])

  // MIDI learn: keep the mappable controls in step with the layout, and reconnect if it was on last time
  useEffect(() => {
    midiLearn.setControls(buildControls(decks, deckCount, () => (mixerOn ? getMixer() : null)))
  }, [decks, deckCount, mixerOn])
  useEffect(() => {
    if (!OG) midiLearn.restore()
  }, [])

  return (
    <main className={`page ${view === '3d' ? 'page-3d' : ''}`}>
      {!OG && <MidiLearnLayer />}
      {!OG && <SideDrawer
        open={drawerOpen}
        onOpen={() => setDrawerOpen(true)}
        onClose={() => setDrawerOpen(false)}
        view={view}
        onView={setView}
        layout={layout}
        onLayout={updateLayout}
        handsOn={handsOn}
        onHandsOn={setHandsOn}
        handStyle={handStyle}
        onHandStyle={setHandStyle}
        handStatus={handStatus}
        propsOn={propsOn}
        onPropsOn={setPropsOn}
        props={props ?? []}
        onToggleProp={toggleProp}
        onScatterProps={() => updateProps((cur) => scatterProps(cur))}
        onClearProps={() => setProps([])}
        spotifyIn={spotifyIn}
        spotifyProfile={spotifyProfile}
        onSpotifyOut={() => {
          setSpotifyIn(false)
          setSpotifyProfile(null)
        }}
      />}
      {!OG && view === '2d' && propsOn && props && <DeskProps items={props} decks={decks} onChange={updateProps} />}
      <HandTracker enabled={handsOn && !OG} style={handStyle} onStatus={setHandStatus} />
      {view === '3d' && !OG ? (
        <Studio3D
          decks={decks}
          mixer={mixerOn ? getMixer() : null}
          deckCount={deckCount}
          mixerOn={mixerOn}
          cables={cables}
          onSelectDeck={(i) => {
            active.current = i
          }}
          onOpenLid={openLid}
        />
      ) : (
        /* the deck keeps its place in the tree either way, so a playing video isn't torn down */
        <div ref={rigRef} className={mixerOn ? (deckCount === 1 ? 'rig one-deck' : 'rig') : 'solo'}>
          {decks.map((deck, i) => i < deckCount && (
            <Device key={i} deck={deck} index={i} output={outputs[i]} onSelect={() => { active.current = i }} onOpenLid={() => openLid(i)} />
          ))}
          {mixerOn && ms && <Sidekick mixer={getMixer()} s={ms} />}
          {mixerOn && cables.slice(0, deckCount).map((cable, i) => {
            const preferred = defaultCables[i].b
            const otherB = deckCount === 2 ? cables[1 - i].b : null
            const freeB = Object.keys(inputs)
              .filter((id) => id !== otherB)
              .sort((x, y) => (x === preferred ? -1 : y === preferred ? 1 : 0))
            return (
              <Cable key={i} {...cable}
                accent={i === 0 ? '#ff5a1f' : '#6c6d70'}
                accepts={{ a: [outputs[i]], b: freeB }}
                onChange={(end, jack) => setCables(current => {
                  if (end === 'b' && jack && deckCount === 2 && current[1 - i].b === jack) return current
                  return current.map((patch, j) => j === i ? { ...patch, [end]: jack } : patch)
                })}
              />
            )
          })}
        </div>
      )}
      {decks.map((deck, i) => <div key={i} className="offscreen" ref={el => { hiddenMount.current[i] = el; deck.setMount(el) }} aria-hidden />)}

      <dialog ref={help} className="lid help-dialog" onClick={(e) => e.target === help.current && help.current?.close()}>
        <header className="lid-head">
          <h2>keys</h2>
          <button type="button" className="lid-close" aria-label="close" onClick={() => help.current?.close()}>
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" /></svg>
          </button>
        </header>
        <dl className="help">
          <div><dt>space</dt><dd>play / pause</dd></div>
          <div><dt>x</dt><dd>stop (twice: track 1)</dd></div>
          <div><dt>← →</dt><dd>prev / next</dd></div>
          <div><dt>, .</dt><dd>jog (shift 8×)</dd></div>
          <div><dt>0–9 t</dt><dd>numpad, time field</dd></div>
          <div><dt>enter / esc</dt><dd>enter / cancel</dd></div>
          <div><dt>q w e</dt><dd>cue 1–3 (hold clears)</dd></div>
          <div><dt>b</dt><dd>bluetooth (hold pairs)</dd></div>
          <div><dt>o  p</dt><dd>make disc, power</dd></div>
          <div><dt>m</dt><dd>solo / two-deck rig</dd></div>
          <div className="wide"><dt>enter +</dt><dd>next: repeat · play: sync / tap · stop: tap / sync off · prev: rip · bt: broadcast</dd></div>
          <div className="wide"><dt>power off + play</dt><dd>battery check on the VU</dd></div>
        </dl>
      </dialog>

      {decks.map((deck, i) => (
        <BurnDialog
          key={i}
          ref={(el) => {
            burn.current[i] = el
          }}
          deck={deck}
          deckIndex={i}
          mount={() => hiddenMount.current[i]}
          spotifyIn={spotifyIn}
          spotifyProfile={spotifyProfile}
          onSpotifyOut={() => {
            setSpotifyIn(false)
            setSpotifyProfile(null)
          }}
        />
      ))}
    </main>
  )
}
