import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Deck } from './engine/deck'
import { completeSpotifyLogin, spotifyToken } from './sources/spotifyAuth'
import { Device } from './ui/Device'
import { BurnDialog, type BurnDialogHandle } from './ui/BurnDialog'
import { Mixer, type MixerState } from './engine/mixer'
import { Sidekick } from './ui/Sidekick'
import { Cable, type End } from './ui/Cable'
import type { Jack } from './engine/mixer'


// one deck for now; a second deck + mixer would add another instance
const deck = new Deck()

// the optional K.O.-sidekick mixer, created the first time it's added
let mixer: Mixer | null = null
const getMixer = () => (mixer ??= new Mixer())
const noSub = () => () => {}
const noState = () => null
const readMixerPref = () => {
  try {
    return localStorage.getItem('bc1.mixer') === '1'
  } catch {
    return false
  }
}
if (import.meta.env.DEV) Object.assign(window, { bc1: deck })

export default function App() {
  const s = useSyncExternalStore(deck.subscribe, deck.getState)
  const [mixerOn, setMixerOn] = useState(readMixerPref)
  const ms = useSyncExternalStore<MixerState | null>(
    mixerOn ? getMixer().subscribe : noSub,
    mixerOn ? getMixer().getState : noState,
  )
  // the patch cable from the BC-1's OUTPUT to a sidekick input
  const [cable, setCable] = useState<Record<End, string | null>>({ a: 'bc1-out', b: 'sk-ch1' })
  const jack: Jack = cable.a && cable.b ? ({ 'sk-ch1': 0, 'sk-ch2': 1, 'sk-aux': 'aux' } as const)[cable.b as 'sk-ch1'] ?? null : null
  useEffect(() => {
    if (mixerOn) getMixer().plug(deck, jack)
  }, [mixerOn, jack])
  useEffect(() => {
    if (!mixerOn) mixer?.detach()
    if (import.meta.env.DEV) Object.assign(window, { mix: mixerOn ? getMixer() : null })
    try {
      localStorage.setItem('bc1.mixer', mixerOn ? '1' : '0')
    } catch {
      /* private mode: just not remembered */
    }
  }, [mixerOn])
  const hiddenMount = useRef<HTMLDivElement>(null)
  const help = useRef<HTMLDialogElement>(null)
  const burn = useRef<BurnDialogHandle>(null)
  const openLid = () => burn.current?.open()
  const [spotifyIn, setSpotifyIn] = useState(false)

  useEffect(() => {
    deck.setMount(hiddenMount.current)
    void spotifyToken().then((t) => setSpotifyIn(!!t))
    void completeSpotifyLogin().then((pending) => {
      if (pending) {
        setSpotifyIn(true)
        void deck.loadDisc(pending)
      }
    })
  }, [])

  // keyboard: mirrors the panel
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof HTMLElement && e.target.closest('.key, .knob, .jog-cap') && (e.key === ' ' || e.key === 'Enter')) return
      const k = e.key
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
      else if (k === 'o') openLid()
      else if (k === 'p') deck.powerSwitch(deck.getState().power === 'off')
      else if (k === 'm') setMixerOn((v) => !v)
      else if (k === '?') (help.current?.open ? help.current.close() : help.current?.showModal())
      else handled = false
      if (handled) e.preventDefault()
    }
    const up = (e: KeyboardEvent) => {
      if (typing(e)) return
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
        <Device deck={deck} s={s} onOpenLid={() => openLid()} />
        {mixerOn && ms && <Sidekick mixer={getMixer()} s={ms} />}
        {mixerOn && (
          <Cable
            a={cable.a}
            b={cable.b}
            accepts={{ a: ['bc1-out'], b: ['sk-ch1', 'sk-ch2', 'sk-aux'] }}
            onChange={(end, j) => setCable((c) => ({ ...c, [end]: j }))}
          />
        )}
      </div>
      {/* the streaming players (YouTube, SoundCloud, Spotify) play from here, out of sight */}
      <div className="offscreen" ref={hiddenMount} aria-hidden />

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
          <div><dt>m</dt><dd>add / remove the K.O.-sidekick mixer</dd></div>
          <div className="wide"><dt>enter +</dt><dd>next: repeat · play: sync / tap · stop: tap / sync off · prev: rip · bt: broadcast</dd></div>
          <div className="wide"><dt>power off + play</dt><dd>battery check on the VU</dd></div>
        </dl>
      </dialog>

      <BurnDialog ref={burn} deck={deck} mount={() => hiddenMount.current} spotifyIn={spotifyIn} onSpotifyOut={() => setSpotifyIn(false)} />
    </main>
  )
}
