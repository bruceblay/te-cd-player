import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { DISC_COLORS, resolveFiles, resolveLink, type Compilation, type Item } from '../engine/compilation'
import { listDiscs, openDisc, saveDisc, type DiscListing } from '../engine/savedDiscs'
import type { Deck } from '../engine/deck'
import { parseSpotify } from '../sources/spotify'
import { spotifyConfigured, spotifyLogout } from '../sources/spotifyAuth'
import { isSoundCloud } from '../sources/soundcloud'
import { parseYouTube } from '../sources/youtube'

export interface BurnDialogHandle {
  open(): void
}

const COLOR_NAMES: Record<string, string> = {
  '#22468c': 'blue',
  '#ff5a1f': 'orange',
  '#1d1d1f': 'black',
  '#c9cbd0': 'silver',
  '#ece6d6': 'cream',
}
const SOURCE: Record<Item['kind'], string> = { youtube: 'youtube', soundcloud: 'soundcloud', spotify: 'spotify', local: 'file' }
const time = (d?: number) => (d && d > 0 ? `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}` : '')
const sourceOf = (url: string) => (parseYouTube(url) ? 'YouTube' : isSoundCloud(url) ? 'SoundCloud' : parseSpotify(url) ? 'Spotify' : null)

/**
 * Burn a disc: name it, pick its colour, add tracks from links and files, drag
 * them into order. Opens on the current disc so it can be edited.
 */
export const BurnDialog = forwardRef<
  BurnDialogHandle,
  { deck: Deck; mount: () => HTMLElement | null; spotifyIn: boolean; onSpotifyOut(): void }
>(function BurnDialog({ deck, mount, spotifyIn, onSpotifyOut }, ref) {
  const dlg = useRef<HTMLDialogElement>(null)
  const linkInput = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<Compilation>({ title: '', color: DISC_COLORS[0], items: [] })
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const [saved, setSaved] = useState<DiscListing[]>([])
  const [saving, setSaving] = useState(false)
  const [savedSnapshot, setSavedSnapshot] = useState<Compilation | null>(null)
  const session = useRef(0)

  const save = async () => {
    const token = session.current
    setSaving(true)
    setProblem(null)
    try {
      const disc = await saveDisc(draft)
      if (token !== session.current) return
      setDraft(d => d === draft ? disc : { ...d, savedId: disc.savedId })
      setSavedSnapshot(disc)
      const rows = await listDiscs()
      if (token === session.current) setSaved(rows)
    } catch {
      if (token === session.current) setProblem('couldn’t save this disc in this browser')
    } finally {
      if (token === session.current) setSaving(false)
    }
  }

  const restore = async (id: string) => {
    const token = session.current
    setBusy(true)
    setProblem(null)
    try {
      const disc = await openDisc(id)
      if (token !== session.current) return
      setDraft(disc)
      setUrl('')
      setSavedSnapshot(null)
    } catch {
      if (token === session.current) setProblem('couldn’t open this disc')
    } finally {
      if (token === session.current) setBusy(false)
    }
  }

  useImperativeHandle(ref, () => ({
    open() {
      const token = ++session.current
      setBusy(false)
      setSaving(false)
      setSavedSnapshot(null)
      setSaved([])
      void listDiscs().then(rows => { if (token === session.current) setSaved(rows) }).catch(() => {})
      const c = deck.compilation
      setDraft(c ? { ...c, items: c.items.slice() } : { title: '', color: DISC_COLORS[0], items: [] })
      setUrl('')
      setProblem(null)
      dlg.current?.showModal()
      // the first control would otherwise take focus (the esc button)
      linkInput.current?.focus()
    },
  }))

  const add = (title: string, items: Item[]) =>
    setDraft((d) => ({ ...d, title: d.title || (d.items.length ? d.title : title), items: [...d.items, ...items] }))

  const addLink = async () => {
    const token = session.current
    const link = url.trim()
    const m = mount()
    if (!link || !m || busy) return
    setBusy(true)
    setProblem(null)
    try {
      const r = await resolveLink(link, m)
      if (token !== session.current) return
      add(r.title, r.items)
      setUrl('')
    } catch (e) {
      if (token !== session.current) return
      setProblem(e instanceof Error && e.message === 'login' ? 'signing in to Spotify…' : 'can’t add this link')
    } finally {
      if (token === session.current) {
        setBusy(false)
        linkInput.current?.focus()
      }
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setDraft((d) => {
      const from = d.items.findIndex((i) => i.key === active.id)
      const to = d.items.findIndex((i) => i.key === over.id)
      return { ...d, items: arrayMove(d.items, from, to) }
    })
  }

  const burn = () => {
    if (!draft.items.length) return
    dlg.current?.close()
    void deck.loadDisc({ ...draft, title: draft.title.trim() || 'untitled' })
  }

  const detected = sourceOf(url.trim())
  const linkError = problem ?? (url.trim() && !detected ? 'unsupported link' : '')
  const width = Math.max(2, String(draft.items.length).length)

  return (
    <dialog ref={dlg} className="lid burn" onClose={() => { session.current++ }} onClick={(e) => e.target === dlg.current && dlg.current?.close()}>
      <header className="lid-head">
        <h2>burn disc</h2>
        {saved.length > 0 && (
          <select className="saved-discs" aria-label="open saved disc" value="" disabled={busy || saving}
            onChange={e => void restore(e.target.value)}>
            <option value="" disabled>saved discs</option>
            {saved.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        )}
        <button type="button" className="lid-close" onClick={() => dlg.current?.close()}>
          esc
        </button>
      </header>

      <input
        className="lid-input burn-title"
        value={draft.title}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        placeholder="disc name"
        aria-label="disc name"
        spellCheck={false}
        autoComplete="off"
      />
      <div className="burn-colors" role="radiogroup" aria-label="disc colour">
        {DISC_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={draft.color === c}
            aria-label={COLOR_NAMES[c]}
            className={draft.color === c ? 'on' : ''}
            style={{ ['--c' as string]: c }}
            onClick={() => setDraft((d) => ({ ...d, color: c }))}
          />
        ))}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={draft.items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
          <ol className="burn-list" aria-label="tracks">
            {draft.items.map((it, i) => (
              <Row
                key={it.key}
                item={it}
                n={String(i + 1).padStart(width, '0')}
                onRemove={() => setDraft((d) => ({ ...d, items: d.items.filter((x) => x.key !== it.key) }))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <form
        className="burn-add"
        onSubmit={(e) => {
          e.preventDefault()
          void addLink()
        }}
      >
        <input
          ref={linkInput}
          className="lid-input burn-link"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            setProblem(null)
          }}
          placeholder="YouTube, SoundCloud or Spotify link"
          aria-label="link"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="lid-text" disabled={!detected || busy}>
          {busy ? 'adding…' : 'add'}
        </button>
      </form>
      <div role="status">
        {linkError && <p className="lid-error">{linkError}</p>}
      </div>
      {detected === 'Spotify' && !spotifyIn && (
        <p className="lid-note">
          {spotifyConfigured()
            ? 'Adding this link opens Spotify sign-in. Premium required.'
            : 'Adds one track using the Spotify embed.'}
        </p>
      )}

      <footer className="lid-actions">
        <div className="lid-local">
          <label className="lid-text">
            files
            <input
              type="file"
              accept="audio/*,video/mp4,.mp4"
              multiple
              onChange={(e) => {
                if (e.target.files?.length) {
                  const r = resolveFiles([...e.target.files])
                  add(r.title, r.items)
                }
                e.target.value = ''
              }}
            />
          </label>
          <label className="lid-text">
            folder
            <input
              type="file"
              multiple
              {...({ webkitdirectory: '' } as object)}
              onChange={(e) => {
                if (e.target.files?.length) {
                  const r = resolveFiles([...e.target.files])
                  add(r.title, r.items)
                }
                e.target.value = ''
              }}
            />
          </label>
          {draft.items.length > 0 && (
            <button type="button" className="lid-text muted" onClick={() => setDraft((d) => ({ ...d, savedId: undefined, items: [] }))}>
              clear
            </button>
          )}
          {deck.compilation && (
            <button type="button" className="lid-text muted" onClick={() => (deck.eject(), dlg.current?.close())}>
              eject
            </button>
          )}
          {spotifyIn && (
            <button type="button" className="lid-text muted" onClick={() => (spotifyLogout(), onSpotifyOut())}>
              sign out of spotify
            </button>
          )}
        </div>
        <div className="disc-actions">
          <button type="button" className="lid-text" disabled={saving || busy || !draft.items.length} onClick={() => void save()}>
            {saving ? 'saving…' : savedSnapshot === draft ? 'saved' : 'save disc'}
          </button>
          <button type="button" className="lid-primary" disabled={saving || busy || !draft.items.length} onClick={burn}>
            burn
          </button>
        </div>
      </footer>
    </dialog>
  )
})

function Row({ item, n, onRemove }: { item: Item; n: string; onRemove(): void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key })
  return (
    <li
      ref={setNodeRef}
      className={`burn-row ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform && { ...transform, x: 0 }), transition }}
    >
      <button type="button" className="burn-grip" aria-label={`move ${item.title}`} {...attributes} {...listeners}>
        <svg viewBox="0 0 6 10" aria-hidden>
          <circle cx="1.2" cy="1.5" r="0.9" />
          <circle cx="4.8" cy="1.5" r="0.9" />
          <circle cx="1.2" cy="5" r="0.9" />
          <circle cx="4.8" cy="5" r="0.9" />
          <circle cx="1.2" cy="8.5" r="0.9" />
          <circle cx="4.8" cy="8.5" r="0.9" />
        </svg>
      </button>
      <span className="burn-n">{n}</span>
      <span className="burn-t">{item.title}</span>
      <span className="burn-s">{SOURCE[item.kind]}</span>
      <span className="burn-d">{time(item.duration)}</span>
      <button type="button" className="burn-x" aria-label={`remove ${item.title}`} onClick={onRemove}>
        ×
      </button>
    </li>
  )
}
