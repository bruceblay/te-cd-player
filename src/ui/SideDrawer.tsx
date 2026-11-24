import {
  beginSpotifyLogin,
  spotifyConfigured,
  spotifyLogout,
  type SpotifyProfile,
} from '../sources/spotifyAuth'
import { PROP_CATALOG, type PlacedProp, type PropId } from './DeskProps'
import { HAND_STYLES, type HandStyle } from './handRender'
import type { HandStatus } from './HandTracker'

export type DeckCount = 1 | 2
export type ViewMode = '2d' | '3d'

export interface LayoutConfig {
  decks: DeckCount
  /** only applies when decks === 1; 2 decks always includes the sidekick */
  sidekick: boolean
}

const DECKS_KEY = 'bc1.decks'
const MIXER_KEY = 'bc1.mixer'
const VIEW_KEY = 'bc1.view'
const HAND_STYLE_KEY = 'bc1.handStyle'
const HAND_STYLE_IDS = new Set<string>(HAND_STYLES.map((s) => s.id))

export function readViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === '2d' || v === '3d' ? v : '3d'
  } catch {
    return '3d'
  }
}

export function saveViewMode(view: ViewMode) {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    /* private mode: just not remembered */
  }
}

export function readHandStyle(): HandStyle {
  try {
    const v = localStorage.getItem(HAND_STYLE_KEY)
    return v && HAND_STYLE_IDS.has(v) ? (v as HandStyle) : 'wireframe'
  } catch {
    return 'wireframe'
  }
}

export function saveHandStyle(style: HandStyle) {
  try {
    localStorage.setItem(HAND_STYLE_KEY, style)
  } catch {
    /* private mode: just not remembered */
  }
}

export function readLayout(): LayoutConfig {
  try {
    const savedDecks = localStorage.getItem(DECKS_KEY)
    const savedMixer = localStorage.getItem(MIXER_KEY)
    if (savedDecks === '1') return { decks: 1, sidekick: savedMixer === '1' }
    if (savedDecks === '2') return { decks: 2, sidekick: true }
    // backwards compatibility with previous bc1.mixer-only preference
    if (savedMixer === '0') return { decks: 1, sidekick: false }
    return { decks: 2, sidekick: true }
  } catch {
    return { decks: 2, sidekick: true }
  }
}

export function saveLayout(layout: LayoutConfig) {
  try {
    localStorage.setItem(DECKS_KEY, String(layout.decks))
    localStorage.setItem(MIXER_KEY, layout.decks === 2 || layout.sidekick ? '1' : '0')
  } catch {
    /* private mode: just not remembered */
  }
}

export function SideDrawer({
  open,
  onOpen,
  onClose,
  view,
  onView,
  layout,
  onLayout,
  handsOn,
  onHandsOn,
  handStyle,
  onHandStyle,
  handStatus,
  propsOn,
  onPropsOn,
  props,
  onToggleProp,
  onScatterProps,
  onClearProps,
  spotifyIn,
  spotifyProfile,
  onSpotifyOut,
}: {
  open: boolean
  onOpen: () => void
  onClose: () => void
  view: ViewMode
  onView: (next: ViewMode) => void
  layout: LayoutConfig
  onLayout: (next: LayoutConfig) => void
  handsOn: boolean
  onHandsOn: (on: boolean) => void
  handStyle: HandStyle
  onHandStyle: (style: HandStyle) => void
  handStatus: HandStatus
  propsOn: boolean
  onPropsOn: (on: boolean) => void
  props: PlacedProp[]
  onToggleProp: (id: PropId) => void
  onScatterProps: () => void
  onClearProps: () => void
  spotifyIn: boolean
  spotifyProfile: SpotifyProfile | null
  onSpotifyOut: () => void
}) {
  const activeProps = new Set(props.map((p) => p.id))
  const spotifyReady = spotifyConfigured()
  return (
    <>
      <button
        type="button"
        className="menu-toggle light"
        aria-label="open menu"
        aria-expanded={open}
        aria-controls="side-drawer"
        onClick={onOpen}
      >
        <svg viewBox="0 0 20 14" width="20" height="14" aria-hidden>
          <path d="M1 2h18M1 7h18M1 12h18" />
        </svg>
      </button>

      <div className={`drawer-backdrop ${open ? 'open' : ''}`} onClick={onClose} aria-hidden />

      <aside
        id="side-drawer"
        className={`drawer ${open ? 'open' : ''}`}
        aria-label="settings"
        aria-hidden={!open}
      >
        <header className="drawer-head">
          <button type="button" className="lid-close" tabIndex={open ? 0 : -1} onClick={onClose}>
            esc
          </button>
        </header>

        <section className="drawer-section">
          <h3 className="drawer-label">layout</h3>

          <div className="drawer-row">
            <span className="drawer-row-label">view</span>
            <div className="seg-control" role="radiogroup" aria-label="view mode">
              {(['2d', '3d'] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={view === m}
                  tabIndex={open ? 0 : -1}
                  className={view === m ? 'on' : ''}
                  onClick={() => onView(m)}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="drawer-row">
            <span className="drawer-row-label">decks</span>
            <div className="seg-control" role="radiogroup" aria-label="number of decks">
              {([1, 2] as DeckCount[]).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={layout.decks === n}
                  tabIndex={open ? 0 : -1}
                  className={layout.decks === n ? 'on' : ''}
                  onClick={() => onLayout({ ...layout, decks: n })}
                >
                  {n} {n === 1 ? 'deck' : 'decks'}
                </button>
              ))}
            </div>
          </div>

          {layout.decks === 1 && (
            <label className="drawer-toggle">
              <span className="drawer-row-label">sidekick mixer</span>
              <input
                type="checkbox"
                checked={layout.sidekick}
                tabIndex={open ? 0 : -1}
                onChange={(e) => onLayout({ ...layout, sidekick: e.target.checked })}
              />
              <span className="drawer-switch" aria-hidden />
            </label>
          )}
        </section>

        <section className="drawer-section drawer-divider">
          <h3 className="drawer-label">controls</h3>

          <label className="drawer-toggle flush">
            <span className="drawer-row-label">hand tracking</span>
            <input
              type="checkbox"
              checked={handsOn}
              tabIndex={open ? 0 : -1}
              onChange={(e) => onHandsOn(e.target.checked)}
            />
            <span className="drawer-switch" aria-hidden />
          </label>

          <label className="drawer-row drawer-select-row">
            <span className="drawer-row-label">hand style</span>
            <select
              className="drawer-select"
              value={handStyle}
              tabIndex={open ? 0 : -1}
              onChange={(e) => onHandStyle(e.target.value as HandStyle)}
            >
              {HAND_STYLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {handStatus.state === 'loading' && <p className="drawer-note">starting webcam &amp; MediaPipe…</p>}
          {handStatus.state === 'active' && (
            <p className="drawer-note">
              tracking {handStatus.hands} {handStatus.hands === 1 ? 'hand' : 'hands'} · pinch thumb + index to click &amp; drag
            </p>
          )}
          {handStatus.state === 'error' && <p className="drawer-note error">{handStatus.error}</p>}
        </section>

        {(spotifyReady || import.meta.env.DEV) && (
          <section className="drawer-section drawer-divider">
            <div className="drawer-section-head">
              <h3 className="drawer-label">spotify</h3>
              {spotifyIn ? (
                <button
                  type="button"
                  className="drawer-link"
                  tabIndex={open ? 0 : -1}
                  onClick={() => {
                    spotifyLogout()
                    onSpotifyOut()
                  }}
                >
                  sign out
                </button>
              ) : (
                spotifyReady && (
                  <button
                    type="button"
                    className="drawer-link"
                    tabIndex={open ? 0 : -1}
                    onClick={() => void beginSpotifyLogin()}
                  >
                    connect
                  </button>
                )
              )}
            </div>

            {spotifyIn ? (
              <>
                <p className="sp-status">
                  <span className="sp-dot" aria-hidden />
                  <span>{spotifyProfile ? spotifyProfile.name : 'connected'}</span>
                </p>
                {spotifyProfile && !spotifyProfile.premium && (
                  <p className="drawer-note">playlist import ready · full playback needs Premium</p>
                )}
              </>
            ) : spotifyReady ? (
              <p className="drawer-note">sign in to import full playlists and albums</p>
            ) : (
              <p className="drawer-note">set VITE_SPOTIFY_CLIENT_ID in .env.local to enable sign-in</p>
            )}
          </section>
        )}

        {view === '2d' && (
          <section className="drawer-section drawer-divider">
            <div className="drawer-section-head">
              <h3 className="drawer-label">desk</h3>
              {propsOn && (
                <div className="drawer-mini-actions">
                  <button
                    type="button"
                    className="drawer-link"
                    tabIndex={open ? 0 : -1}
                    disabled={props.length === 0}
                    onClick={onScatterProps}
                  >
                    scatter
                  </button>
                  <button
                    type="button"
                    className="drawer-link"
                    tabIndex={open ? 0 : -1}
                    disabled={props.length === 0}
                    onClick={onClearProps}
                  >
                    clear
                  </button>
                </div>
              )}
            </div>

            <label className="drawer-toggle flush">
              <span className="drawer-row-label">desk items</span>
              <input
                type="checkbox"
                checked={propsOn}
                tabIndex={open ? 0 : -1}
                onChange={(e) => onPropsOn(e.target.checked)}
              />
              <span className="drawer-switch" aria-hidden />
            </label>

            {propsOn && (
              <>
                <div className="prop-picker">
                  {PROP_CATALOG.map((p) => {
                    const on = activeProps.has(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        tabIndex={open ? 0 : -1}
                        className={`prop-chip ${on ? 'on' : ''}`}
                        onClick={() => onToggleProp(p.id)}
                      >
                        <img src={p.image} alt="" aria-hidden />
                        <span>{p.label}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="drawer-note">drag to move · drag ↻ or scroll to rotate · drop on a spinning CD</p>
              </>
            )}
          </section>
        )}
      </aside>
    </>
  )
}
