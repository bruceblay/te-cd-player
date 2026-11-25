import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { DISC_COLORS, resolveFiles, resolveLink, type Compilation, type Item } from '../engine/compilation'
import { BUILT_IN_DISCS, openBuiltIn } from '../engine/builtInDiscs'
import { track } from '../analytics'
import { deleteDisc, listDiscs, openDisc, saveDisc, type DiscListing } from '../engine/savedDiscs'
import type { Deck } from '../engine/deck'
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
const SOURCE: Record<Item['kind'], string> = { youtube: 'youtube', soundcloud: 'soundcloud', local: 'file' }
const time = (d?: number) => (d && d > 0 ? `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}` : '')

function describeLink(raw: string): { source: 'YouTube' | 'SoundCloud'; isCollection: boolean } | null {
  const yt = parseYouTube(raw)
  if (yt) return { source: 'YouTube', isCollection: !!yt.list }
  if (isSoundCloud(raw)) return { source: 'SoundCloud', isCollection: raw.includes('/sets/') }
  return null
}

const isSpotify = (raw: string) => /(^|\/\/|\.)spotify\.com\/|^spotify:/i.test(raw)

function formatLinkError(err: unknown): string {
  const msg = err instanceof Error ? err.message : ''
  if (msg === 'empty') return 'no playable tracks found in that link'
  return 'can’t add this link'
}

/**
 * Make a disc: name it, pick its colour, add tracks or import playlists from
 * YouTube, SoundCloud and local files, drag them into order, and load.
 */
export const BurnDialog = forwardRef<
  BurnDialogHandle,
  {
    deck: Deck
    mount: () => HTMLElement | null
  }
>(function BurnDialog({ deck, mount }, ref) {
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
      track('disc_saved')
      if (token !== session.current) return
      setDraft((d) => (d === draft ? disc : { ...d, savedId: disc.savedId }))
      setSavedSnapshot(disc)
      const rows = await listDiscs()
      if (token === session.current) setSaved(rows)
    } catch {
      if (token === session.current) setProblem('couldn’t save this disc in this browser')
    } finally {
      if (token === session.current) setSaving(false)
    }
  }

  // deleting asks twice: the first click arms it for this disc
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null)
  const remove = async () => {
    const id = draft.savedId
    if (!id) return
    if (deleteArmed !== id) return setDeleteArmed(id)
    const token = session.current
    setDeleteArmed(null)
    setProblem(null)
    try {
      await deleteDisc(id)
      track('disc_deleted')
      if (token !== session.current) return
      // keep the tracks on screen, just no longer tied to a saved copy
      setDraft((d) => (d.savedId === id ? { ...d, savedId: undefined } : d))
      setSavedSnapshot(null)
      const rows = await listDiscs()
      if (token === session.current) setSaved(rows)
    } catch {
      if (token === session.current) setProblem('couldn’t delete this disc')
    }
  }

  const restore = async (id: string) => {
    const token = session.current
    setBusy(true)
    setProblem(null)
    try {
      const builtIn = BUILT_IN_DISCS.find((d) => d.id === id)
      const m = mount()
      if (builtIn && !m) return
      if (builtIn) track('builtin_disc', { disc: builtIn.title })
      const disc = builtIn ? await openBuiltIn(builtIn, m!) : await openDisc(id)
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
      setProblem(formatLinkError(e))
    } finally {
      if (token === session.current) {
        setBusy(false)
        linkInput.current?.focus()
      }
    }
  }

  useImperativeHandle(ref, () => ({
    open() {
      const token = ++session.current
      setBusy(false)
      setSaving(false)
      setSavedSnapshot(null)
      setDeleteArmed(null)
      setSaved([])
      void listDiscs()
        .then((rows) => {
          if (token === session.current) setSaved(rows)
        })
        .catch(() => {})
      const c = deck.compilation
      const nextDraft = c ? { ...c, items: c.items.slice() } : { title: '', color: DISC_COLORS[0], items: [] }
      setDraft(nextDraft)
      setUrl('')
      setProblem(null)
      dlg.current?.showModal()
      requestAnimationFrame(() => linkInput.current?.focus())
    },
  }))

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

  // eject empties the deck and leaves the dialog open on a blank disc, ready for the next one
  const ejectAndStartOver = () => {
    deck.eject()
    const blank = { title: '', color: DISC_COLORS[0], items: [] }
    setDraft(blank)
    setSavedSnapshot(null)
    setUrl('')
    setProblem(null)
    requestAnimationFrame(() => linkInput.current?.focus())
  }

  const loadIntoDeck = () => {
    if (!draft.items.length) return
    dlg.current?.close()
    // which sources people mix: e.g. "youtube" or "local+soundcloud"
    track('disc_loaded', { sources: [...new Set(draft.items.map((i) => i.kind))].sort().join('+'), tracks: draft.items.length })
    void deck.loadDisc({ ...draft, title: draft.title.trim() || 'untitled' })
  }

  const detected = describeLink(url.trim())
  const linkError =
    problem ?? (url.trim() && !detected ? (isSpotify(url.trim()) ? 'Spotify links aren’t supported' : 'unsupported link') : '')
  const width = Math.max(2, String(draft.items.length).length)

  return (
    <dialog ref={dlg} className="lid burn" onClose={() => { session.current++ }} onClick={(e) => e.target === dlg.current && dlg.current?.close()}>
      <header className="lid-head">
        <h2>make disc</h2>
        <select
          className="saved-discs"
          aria-label="open saved disc"
          value=""
          disabled={busy || saving}
          onChange={(e) => void restore(e.target.value)}
        >
          <option value="" disabled>
            saved discs
          </option>
          {[...BUILT_IN_DISCS, ...saved].map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <button type="button" className="lid-close" aria-label="close" onClick={() => dlg.current?.close()}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" /></svg>
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
          placeholder="YouTube or SoundCloud link / playlist"
          aria-label="link"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="lid-text" disabled={!detected || busy}>
          {busy ? (detected?.isCollection ? 'importing…' : 'adding…') : detected?.isCollection ? 'import' : 'add'}
        </button>
      </form>
      <div role="status">
        {linkError && <p className="lid-error">{linkError}</p>}
      </div>

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
          {draft.savedId && saved.some((d) => d.id === draft.savedId) && (
            <button type="button" className="lid-text muted" disabled={saving || busy} onClick={() => void remove()}>
              {deleteArmed === draft.savedId ? 'really delete?' : 'delete'}
            </button>
          )}
          {deck.compilation && (
            <button type="button" className="lid-text muted" onClick={ejectAndStartOver}>
              eject
            </button>
          )}
        </div>
        <div className="disc-actions">
          <button type="button" className="lid-text" disabled={saving || busy || !draft.items.length} onClick={() => void save()}>
            {saving ? 'saving…' : savedSnapshot === draft ? 'saved' : 'save'}
          </button>
          <button type="button" className="lid-primary" disabled={saving || busy || !draft.items.length} onClick={loadIntoDeck}>
            load
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
