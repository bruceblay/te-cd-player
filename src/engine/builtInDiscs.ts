/*
 * Discs that ship with the app. A link disc reads its tracks when it's picked;
 * an audio disc plays files shipped in public/discs.
 */
import { resolveLink, type Compilation, type Item } from './compilation'

type BuiltIn = { id: string; title: string; color: string } & (
  | { url: string }
  /** audio shipped in public/discs, in play order */
  | { audio: [path: string, title: string, seconds: number][] }
)

export const BUILT_IN_DISCS: BuiltIn[] = [
  { id: 'builtin:oil-and-cotton', title: 'oil and cotton', color: '#ff5a1f', url: 'https://www.youtube.com/playlist?list=PLFBFAAB01A2CF4DB6' },
  { id: 'builtin:uli', title: 'ULI', color: '#1d1d1f', url: 'https://soundcloud.com/meltingseason/sets/uli' },
  {
    id: 'builtin:untitled',
    title: 'Untitled',
    color: '#22468c',
    audio: [
      ['/discs/untitled/01.m4a', '1', 443],
      ['/discs/untitled/02.m4a', '2', 331],
      ['/discs/untitled/03.m4a', '3', 185],
      ['/discs/untitled/04.m4a', '4', 480],
      ['/discs/untitled/05.m4a', '5', 483],
      ['/discs/untitled/06.m4a', '6', 220],
    ],
  },
  {
    // Rill World's engine (rill-world/src/Field.h) rendered offline, two minutes a bank, shaken
    // every 30 s for a new recording; the recordings are CC0 (rill-world/docs/SOURCES.md)
    id: 'builtin:field-recordings',
    title: 'Field Recordings',
    color: '#ece6d6',
    audio: [
      ['/discs/field-recordings/01.m4a', 'Rain', 120],
      ['/discs/field-recordings/02.m4a', 'Birds', 120],
      ['/discs/field-recordings/03.m4a', 'Insects', 120],
      ['/discs/field-recordings/04.m4a', 'Ocean', 120],
      ['/discs/field-recordings/05.m4a', 'Cave', 120],
    ],
  },
]

/** a built-in disc as a draft */
export async function openBuiltIn(d: BuiltIn, mount: HTMLElement): Promise<Compilation> {
  if ('url' in d) return { title: d.title, color: d.color, items: (await resolveLink(d.url, mount)).items }
  const stamp = Date.now().toString(36)
  const items: Item[] = d.audio.map(([file, title, duration], i) => ({ kind: 'local', key: `${d.id}:${i}:${stamp}`, file, title, duration }))
  return { title: d.title, color: d.color, items }
}
