/**
 * MIDI learn: bind any hardware CC, note or pitch bend to a control on the decks or the mixer.
 * Click a control while learning, move something on the controller, and the pair is saved.
 * Without saved mappings the BC-1's own MIDI spec is used (channel 1, CC 23-26).
 */
import type { Deck } from './deck'
import { track } from '../analytics'
import type { Mixer } from './mixer'

type Ch = 0 | 1

export type ControlKind = 'button' | 'range' | 'toggle'

export interface MidiControl {
  id: string
  label: string
  kind: ControlKind
  /** range: value at MIDI 0 and 127 */
  min?: number
  max?: number
  /** range: MIDI values this close to the middle snap to the centre (detents, springy sticks) */
  centre?: number
  set?: (v: number) => void
  down?: () => void
  up?: () => void
}

export interface MidiLearnState {
  supported: boolean
  connected: boolean
  devices: string[]
  learning: boolean
  /** control picked while learning, waiting for a MIDI message */
  target: string | null
  /** source key → control id */
  mappings: Record<string, string>
  /** the binding just made, for the learn hint */
  lastBound: { source: string; control: string } | null
  error: string | null
}

const MAP_KEY = 'bc1.midi.map'
const ON_KEY = 'bc1.midi.on'

/** the BC-1 manual: channel 1, CC 23 play, 24 stop, 25 next, 26 prev */
const DEFAULT_MAP: Record<string, string> = {
  'cc:0:23': 'd0.play',
  'cc:0:24': 'd0.stop',
  'cc:0:25': 'd0.next',
  'cc:0:26': 'd0.prev',
}

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MAP_KEY)
    if (raw) {
      const m = JSON.parse(raw) as unknown
      if (m && typeof m === 'object') return m as Record<string, string>
    }
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_MAP }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

/** "CC 21 · ch 1", "note C3 · ch 10", "bend · ch 2" */
export function describeSource(source: string): string {
  const [type, ch, num] = source.split(':')
  const chan = `ch ${Number(ch) + 1}`
  if (type === 'cc') return `CC ${num} · ${chan}`
  if (type === 'note') {
    const n = Number(num)
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    return `note ${names[n % 12]}${Math.floor(n / 12) - 1} · ${chan}`
  }
  return `bend · ${chan}`
}

export function buildControls(decks: readonly Deck[], deckCount: number, getMixer: () => Mixer | null): MidiControl[] {
  const out: MidiControl[] = []
  decks.slice(0, deckCount).forEach((deck, i) => {
    const p = `d${i}`
    const name = `deck ${i + 1}`
    out.push(
      { id: `${p}.play`, label: `${name} play`, kind: 'button', down: () => deck.pressPlay() },
      { id: `${p}.stop`, label: `${name} stop`, kind: 'button', down: () => deck.pressStop() },
      { id: `${p}.next`, label: `${name} next`, kind: 'button', down: () => deck.pressNext() },
      { id: `${p}.prev`, label: `${name} previous`, kind: 'button', down: () => deck.pressPrev() },
      { id: `${p}.enter`, label: `${name} enter`, kind: 'button', down: () => deck.enterDown(), up: () => deck.enterUp() },
      ...[0, 1, 2].map((c) => ({
        id: `${p}.cue-${c}`,
        label: `${name} cue ${c + 1}`,
        kind: 'button' as const,
        down: () => deck.cueDown(c),
        up: () => deck.cueUp(c),
      })),
      { id: `${p}.varispeed`, label: `${name} varispeed`, kind: 'range', min: 50, max: 150, centre: 0.006, set: (v) => deck.setVarispeed(v) },
      { id: `${p}.level`, label: `${name} level`, kind: 'range', min: 0, max: 100, set: (v) => deck.setLevel(v) },
      { id: `${p}.jog`, label: `${name} jog`, kind: 'range', min: -1, max: 1, centre: 0.06, set: (v) => deck.setJog(v) },
      {
        id: `${p}.power`,
        label: `${name} power`,
        kind: 'toggle',
        down: () => deck.powerSwitch(deck.getState().power === 'off'),
      },
    )
  })

  const mx = (fn: (m: Mixer) => void) => () => {
    const m = getMixer()
    if (m) fn(m)
  }
  const mxSet = (fn: (m: Mixer, v: number) => void) => (v: number) => {
    const m = getMixer()
    if (m) fn(m, v)
  }
  for (const c of [0, 1] as Ch[]) {
    const name = `ch ${c + 1}`
    out.push(
      // the gain knob turns whatever its screen says (gain, compressor, pan), as on the hardware
      { id: `mx.gain-${c}`, label: `${name} gain`, kind: 'range', min: 0, max: 1, set: mxSet((m, v) => {
        const k = m.gainKnob(c)
        k.set(k.min + v * (k.max - k.min))
      }) },
      { id: `mx.high-${c}`, label: `${name} eq high`, kind: 'range', min: -1, max: 1, centre: 0.006, set: mxSet((m, v) => m.setEq(c, 'high', v)) },
      { id: `mx.mid-${c}`, label: `${name} eq mid`, kind: 'range', min: -1, max: 1, centre: 0.006, set: mxSet((m, v) => m.setEq(c, 'mid', v)) },
      { id: `mx.low-${c}`, label: `${name} eq low`, kind: 'range', min: -1, max: 1, centre: 0.006, set: mxSet((m, v) => m.setEq(c, 'low', v)) },
      { id: `mx.fader-${c}`, label: `${name} fader`, kind: 'range', min: 0, max: 1, set: mxSet((m, v) => m.setFader(c, v)) },
      { id: `mx.cue-${c}`, label: `${name} cue`, kind: 'button', down: mx((m) => m.cueDown(c)), up: mx((m) => m.cueUp(c)) },
      { id: `mx.fx-${c}`, label: `${name} fx`, kind: 'button', down: mx((m) => m.fxDown(c)), up: mx((m) => m.fxUp(c)) },
    )
  }
  out.push(
    { id: 'mx.volume', label: 'mixer volume', kind: 'range', min: 0, max: 1, set: mxSet((m, v) => m.setMaster(v)) },
    { id: 'mx.phones', label: 'phones volume', kind: 'range', min: 0, max: 1, set: mxSet((m, v) => m.setPhones(v)) },
    { id: 'mx.mod', label: 'mod', kind: 'range', min: -1, max: 1, centre: 0.06, set: mxSet((m, v) => m.setStick(v)) },
    { id: 'mx.pad', label: 'force pad', kind: 'range', min: 0, max: 1, set: mxSet((m, v) => m.setPad(v)) },
    { id: 'mx.select', label: 'select', kind: 'button', down: mx((m) => m.selectDown()), up: mx((m) => m.selectUp()) },
    { id: 'mx.power', label: 'mixer power', kind: 'toggle', down: mx((m) => m.setPower(!m.getState().power)) },
  )
  return out
}

/* ---------- which control an on-screen element is ---------- */

const DECK_LABELS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^play$/, () => 'play'],
  [/^stop$/, () => 'stop'],
  [/^next$/, () => 'next'],
  [/^previous$/, () => 'prev'],
  [/^enter\b/, () => 'enter'],
  [/^cue (\d)\b/, (m) => `cue-${Number(m[1]) - 1}`],
  [/^varispeed$/, () => 'varispeed'],
  [/^level$/, () => 'level'],
  [/^jog$/, () => 'jog'],
  [/^power switch$/, () => 'power'],
]
const MIXER_LABELS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^gain (\d)$/, (m) => `gain-${Number(m[1]) - 1}`],
  [/^eq (high|mid|low) (\d)$/, (m) => `${m[1]}-${Number(m[2]) - 1}`],
  [/^fader (\d)$/, (m) => `fader-${Number(m[1]) - 1}`],
  [/^cue (\d)$/, (m) => `cue-${Number(m[1]) - 1}`],
  [/^fx (\d)$/, (m) => `fx-${Number(m[1]) - 1}`],
  [/^select\b/, () => 'select'],
  [/^main volume$/, () => 'volume'],
  [/^phones volume$/, () => 'phones'],
  [/^mod$/, () => 'mod'],
  [/^force pad\b/, () => 'pad'],
  [/^(mixer )?power$/, () => 'power'],
]

/** the control id for a 2D faceplate element (or one of its children), if it can be mapped */
export function controlIdForElement(el: Element | null): { id: string; el: Element } | null {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const label = (node.getAttribute('aria-label') || node.getAttribute('title') || '').trim().toLowerCase()
    if (label) {
      const deckWrap = node.closest<HTMLElement>('.device-wrap[data-deck]')
      const inMixer = !!node.closest('.sidekick-wrap')
      const table = deckWrap ? DECK_LABELS : inMixer ? MIXER_LABELS : null
      if (table) {
        for (const [re, fn] of table) {
          const m = label.match(re)
          if (m) return { id: deckWrap ? `d${deckWrap.dataset.deck}.${fn(m)}` : `mx.${fn(m)}`, el: node }
        }
      }
    }
    if (node.classList.contains('device-wrap') || node.classList.contains('sidekick-wrap')) break
  }
  return null
}

/** 3D: the keyIds the scene uses for its buttons → control suffixes */
export function controlIdFor3d(keyId: string | undefined, deckIndex: number | undefined): string | null {
  if (!keyId) return null
  if (keyId.startsWith('sk-')) {
    const k = keyId.slice(3)
    return /^(cue|fx)-[01]$|^select$/.test(k) ? `mx.${k}` : null
  }
  if (deckIndex === undefined) return null
  return /^(play|stop|next|prev|enter|cue-[012])$/.test(keyId) ? `d${deckIndex}.${keyId}` : null
}

/* ---------- the store ---------- */

export class MidiLearn {
  private access: MIDIAccess | null = null
  private controls = new Map<string, MidiControl>()
  private held = new Map<string, boolean>()
  private listeners = new Set<() => void>()
  private s: MidiLearnState = {
    supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
    connected: false,
    devices: [],
    learning: false,
    target: null,
    mappings: readMap(),
    lastBound: null,
    error: null,
  }

  getState = () => this.s
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private set(patch: Partial<MidiLearnState>) {
    this.s = { ...this.s, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  setControls(list: MidiControl[]) {
    this.controls = new Map(list.map((c) => [c.id, c]))
  }
  labelFor(id: string) {
    return this.controls.get(id)?.label ?? id
  }
  /** the MIDI source currently bound to a control */
  sourceFor(id: string) {
    return Object.keys(this.s.mappings).find((k) => this.s.mappings[k] === id) ?? null
  }

  /** reconnect on load if the user connected before (no prompt once permission is granted) */
  restore() {
    try {
      if (localStorage.getItem(ON_KEY) === '1') void this.connect()
    } catch {
      /* private mode */
    }
  }

  async connect() {
    if (!this.s.supported) {
      this.set({ error: 'Web MIDI is not available in this browser' })
      return false
    }
    try {
      this.access = await navigator.requestMIDIAccess()
    } catch {
      this.set({ error: 'MIDI access was blocked' })
      store(ON_KEY, null)
      return false
    }
    const bind = () => {
      const devices: string[] = []
      this.access!.inputs.forEach((input) => {
        devices.push(input.name || 'MIDI device')
        input.onmidimessage = (e) => this.handle(e.data)
      })
      this.set({ devices })
    }
    bind()
    this.access.onstatechange = bind
    store(ON_KEY, '1')
    this.set({ connected: true, error: null })
    return true
  }

  disconnect() {
    this.access?.inputs.forEach((i) => (i.onmidimessage = null))
    if (this.access) this.access.onstatechange = null
    this.access = null
    store(ON_KEY, null)
    this.set({ connected: false, devices: [], learning: false, target: null })
  }

  setLearning(on: boolean) {
    this.set({ learning: on, target: null, lastBound: null })
  }
  selectTarget(id: string | null) {
    this.set({ target: id, lastBound: null })
  }
  unmap(id: string) {
    const mappings = { ...this.s.mappings }
    for (const k of Object.keys(mappings)) if (mappings[k] === id) delete mappings[k]
    this.saveMap(mappings)
  }
  clearAll() {
    this.saveMap({})
  }
  private saveMap(mappings: Record<string, string>) {
    store(MAP_KEY, JSON.stringify(mappings))
    this.set({ mappings })
  }

  /** parse a message into a source key, a 0..1 value and whether it's a press */
  private handle(d: Uint8Array | null) {
    if (!d || d.length < 2) return
    const type = d[0] & 0xf0
    const ch = d[0] & 0x0f
    let source: string
    let value: number
    let pressed: boolean
    if (type === 0xb0 && d.length >= 3) {
      source = `cc:${ch}:${d[1]}`
      value = d[2] / 127
      pressed = d[2] >= 64
    } else if ((type === 0x90 || type === 0x80) && d.length >= 3) {
      source = `note:${ch}:${d[1]}`
      const on = type === 0x90 && d[2] > 0
      value = on ? d[2] / 127 : 0
      pressed = on
    } else if (type === 0xe0 && d.length >= 3) {
      source = `bend:${ch}`
      value = ((d[2] << 7) | d[1]) / 16383
      pressed = value > 0.5
    } else {
      return
    }

    if (this.s.learning) {
      const target = this.s.target
      // buttons on a controller send a release too; bind on the press so the release doesn't land elsewhere
      if (!target || (source.startsWith('note') && !pressed)) return
      const mappings = { ...this.s.mappings }
      for (const k of Object.keys(mappings)) if (mappings[k] === target) delete mappings[k]
      mappings[source] = target
      store(MAP_KEY, JSON.stringify(mappings))
      this.held.set(source, pressed)
      this.set({ mappings, target: null, lastBound: { source, control: target } })
      track('midi_mapped')
      return
    }

    const control = this.controls.get(this.s.mappings[source])
    if (!control) return
    if (control.kind === 'range') {
      const min = control.min ?? 0
      const max = control.max ?? 1
      let v = min + value * (max - min)
      if (control.centre !== undefined && Math.abs(value - 0.5) < control.centre) v = (min + max) / 2
      control.set?.(v)
      return
    }
    const was = this.held.get(source) ?? false
    this.held.set(source, pressed)
    if (pressed === was) return
    if (pressed) control.down?.()
    else if (control.kind === 'button') control.up?.()
  }
}

export const midiLearn = new MidiLearn()
