import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Deck } from './engine/deck'
import { parseSpotify } from './sources/spotify'
import { completeSpotifyLogin, spotifyConfigured, spotifyLogout, spotifyToken } from './sources/spotifyAuth'
import { isSoundCloud } from './sources/soundcloud'
import { parseYouTube } from './sources/youtube'
import { Device } from './ui/Device'

function sourceOf(url: string) {
  if (parseYouTube(url)) return 'YouTube'
  if (isSoundCloud(url)) return 'SoundCloud'
  if (parseSpotify(url)) return 'Spotify'
  return null
}

// one deck for now; a second deck + mixer would add another instance
const deck = new Deck()
if (import.meta.env.DEV) Object.assign(window, { bc1: deck })

export default function App() {
  const s = useSyncExternalStore(deck.subscribe, deck.getState)
  const videoMount = useRef<HTMLDivElement>(null)
  const hiddenMount = useRef<HTMLDivElement>(null)
  const help = useRef<HTMLDialogElement>(null)
  const lid = useRef<HTMLDialogElement>(null)
  const linkInput = useRef<HTMLInputElement>(null)
  // the dialog would otherwise focus its first control (the esc button), not the link field
  const openLid = () => {
    lid.current?.showModal()
    linkInput.current?.focus()
  }
  const [url, setUrl] = useState('')
  const [spotifyIn, setSpotifyIn] = useState(false)

  useEffect(() => {
    deck.setMounts(videoMount.current, hiddenMount.current)
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

  const load = (input: string | File[]) => {
    lid.current?.close()
    void deck.loadDisc(input)
  }
  const detected = sourceOf(url.trim())
  const disc = s.disc

  return (
    <main className="page">
      <Device deck={deck} s={s} videoMount={videoMount} onOpenLid={() => openLid()} />
      {/* audio-only embeds (SoundCloud, Spotify) play from here, out of sight */}
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
          <div><dt>o  p</dt><dd>load disc, power</dd></div>
          <div className="wide"><dt>enter +</dt><dd>next: repeat · play: sync / tap · stop: tap / sync off · prev: rip · bt: broadcast</dd></div>
          <div className="wide"><dt>power off + play</dt><dd>battery check on the VU</dd></div>
        </dl>
      </dialog>

      <dialog ref={lid} className="lid" onClick={(e) => e.target === lid.current && lid.current?.close()}>
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault()
            if (detected) load(url.trim())
          }}
        >
          <header className="lid-head">
            <h2>load disc</h2>
            <button type="button" className="lid-close" onClick={() => lid.current?.close()}>
              esc
            </button>
          </header>
          <input
            className="lid-input"
            ref={linkInput}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="paste a link"
            aria-label="link"
            spellCheck={false}
            autoComplete="off"
          />
          <p className="lid-sources" aria-live="polite">
            {url.trim() && !detected ? (
              <span className="bad">can’t play this link</span>
            ) : (
              (['YouTube', 'SoundCloud', 'Spotify'] as const).map((src) => (
                <span key={src} className={detected === src ? 'on' : ''}>
                  {src.toLowerCase()}
                </span>
              ))
            )}
          </p>
          {detected === 'Spotify' && (
            <p className="lid-note">
              {spotifyConfigured()
                ? spotifyIn
                  ? 'Signed in to Spotify. Full deck control (Premium).'
                  : 'You’ll be sent to Spotify to sign in (Premium needed for playback).'
                : 'No Spotify client ID set: using the embed (one track per disc, no volume or skip). See README.'}
            </p>
          )}
          <footer className="lid-actions">
            <div className="lid-local">
              <label className="lid-text">
                files
                <input type="file" accept="audio/*" multiple onChange={(e) => e.target.files?.length && load([...e.target.files])} />
              </label>
              <label className="lid-text">
                folder
                <input
                  type="file"
                  multiple
                  {...({ webkitdirectory: '' } as object)}
                  onChange={(e) => e.target.files?.length && load([...e.target.files])}
                />
              </label>
              {disc && (
                <button type="button" className="lid-text" onClick={() => (deck.eject(), lid.current?.close())}>
                  eject
                </button>
              )}
              {spotifyIn && (
                <button type="button" className="lid-text muted" onClick={() => (spotifyLogout(), setSpotifyIn(false))}>
                  sign out of spotify
                </button>
              )}
            </div>
            <button type="submit" className="lid-primary" disabled={!detected}>
              load
            </button>
          </footer>
        </form>
      </dialog>
    </main>
  )
}
