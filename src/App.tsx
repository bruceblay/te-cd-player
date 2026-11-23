import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Deck } from './engine/deck'
import { completeSpotifyLogin, spotifyToken } from './sources/spotifyAuth'
import { Device } from './ui/Device'
import { BurnDialog, type BurnDialogHandle } from './ui/BurnDialog'
import { Mixer, type MixerState } from './engine/mixer'
import { Sidekick } from './ui/Sidekick'
import { Cable, type End } from './ui/Cable'
import type { Jack } from './engine/mixer'


const decks = [new Deck(), new Deck()] as const
const outputs = ['bc1-out', 'bc2-out']
const inputs: Record<string, Jack> = { 'sk-ch1': 0, 'sk-ch2': 1, 'sk-aux': 'aux' }
const defaultCables = outputs.map((a, i) => ({ a, b: `sk-ch${i + 1}` }))
type Patch = Record<End, string | null>

// the optional K.O.-sidekick mixer, created the first time it's added
let mixer: Mixer | null = null
const getMixer = () => (mixer ??= new Mixer())
const noSub = () => () => {}
const noState = () => null
const readMixerPref = () => {
  try {
    return localStorage.getItem('bc1.mixer') !== '0'
  } catch {
    return true
  }
}
if (import.meta.env.DEV) Object.assign(window, { bc1: decks[0], bc2: decks[1] })

export default function App() {
  const active = useRef(0)
  const [mixerOn, setMixerOn] = useState(readMixerPref)
  const ms = useSyncExternalStore<MixerState | null>(
    mixerOn ? getMixer().subscribe : noSub,
    mixerOn ? getMixer().getState : noState,
  )
  const [cables, setCables] = useState<Patch[]>(defaultCables)
  useEffect(() => {
    if (mixerOn) {
      decks.forEach((deck, i) => {
        const { a, b } = cables[i]
        getMixer().plug(deck, a && b ? inputs[b] : null)
      })
    } else {
      active.current = 0
      decks[1].powerSwitch(false)
      mixer?.detach()
    }
  }, [mixerOn, cables])
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { mix: mixerOn ? getMixer() : null })
    try {
      localStorage.setItem('bc1.mixer', mixerOn ? '1' : '0')
    } catch {
      /* private mode: just not remembered */
    }
  }, [mixerOn])
  const hiddenMount = useRef<(HTMLDivElement | null)[]>([])
  const help = useRef<HTMLDialogElement>(null)
  const burn = useRef<(BurnDialogHandle | null)[]>([])
  const openLid = (i: number) => {
    active.current = i
    sessionStorage.setItem('bc1.spotify.deck', String(i))
    burn.current[i]?.open()
  }
  const [spotifyIn, setSpotifyIn] = useState(false)

  useEffect(() => {
    decks.forEach((deck, i) => deck.setMount(hiddenMount.current[i]))
    void spotifyToken().then((t) => setSpotifyIn(!!t))
    void completeSpotifyLogin().then((pending) => {
      if (pending) {
        setSpotifyIn(true)
        void decks[sessionStorage.getItem('bc1.spotify.deck') === '1' ? 1 : 0].loadDisc(pending)
      }
    })
  }, [])

  // keyboard: mirrors the panel
  useEffect(() => {
    const pressed = new Map<string, Deck>()
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
    const down = (e: KeyboardEvent) => {
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
      else if (k === 'm') setMixerOn((v) => !v)
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
  }, [])

  return (
    <main className="page">
      {/* the deck keeps its place in the tree either way, so a playing video isn't torn down */}
      <div className={mixerOn ? 'rig' : 'solo'}>
        {decks.map((deck, i) => (i === 0 || mixerOn) && (
          <Device key={i} deck={deck} index={i} output={outputs[i]} onSelect={() => { active.current = i }} onOpenLid={() => openLid(i)} />
        ))}
        {mixerOn && ms && <Sidekick mixer={getMixer()} s={ms} />}
        {mixerOn && cables.map((cable, i) => (
          <Cable key={i} {...cable}
            accepts={{ a: [outputs[i]], b: Object.keys(inputs).filter(id => id !== cables[1 - i].b) }}
            onChange={(end, jack) => setCables(current => {
              if (end === 'b' && jack && current[1 - i].b === jack) return current
              return current.map((patch, j) => j === i ? { ...patch, [end]: jack } : patch)
            })}
          />
        ))}
      </div>
      {decks.map((_, i) => <div key={i} className="offscreen" ref={el => { hiddenMount.current[i] = el }} aria-hidden />)}

      <dialog ref={help} className="lid help-dialog" onClick={(e) => e.target === help.current && help.current?.close()}>
        <header className="lid-head">
          <h2>keys</h2>
          <button type="button" className="lid-close" onClick={() => help.current?.close()}>
            esc
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
          <div><dt>o  p</dt><dd>burn disc, power</dd></div>
          <div><dt>m</dt><dd>solo / two-deck rig</dd></div>
          <div className="wide"><dt>enter +</dt><dd>next: repeat · play: sync / tap · stop: tap / sync off · prev: rip · bt: broadcast</dd></div>
          <div className="wide"><dt>power off + play</dt><dd>battery check on the VU</dd></div>
        </dl>
      </dialog>

      {decks.map((deck, i) => <BurnDialog key={i} ref={el => { burn.current[i] = el }} deck={deck} mount={() => hiddenMount.current[i]} spotifyIn={spotifyIn} onSpotifyOut={() => setSpotifyIn(false)} />)}
    </main>
  )
}
