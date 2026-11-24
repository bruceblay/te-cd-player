/*
 * Discs that ship with the app. A link disc reads its tracks when it's picked;
 * a Spotify disc carries its track list, since reading a playlist needs sign-in.
 * Headphone Wonders is open.spotify.com/playlist/5l7bwyW028wXXcrdKXsq9q; refresh
 * its list here when the playlist changes.
 */
import { spotifyConfigured, spotifyToken } from '../sources/spotifyAuth'
import { resolveLink, type Compilation, type Item } from './compilation'

type BuiltIn = { id: string; title: string; color: string } & (
  | { url: string }
  | { spotify: [id: string, title: string, seconds: number][] }
  /** audio shipped in public/discs, in play order */
  | { audio: [path: string, title: string, seconds: number][] }
)

export const BUILT_IN_DISCS: BuiltIn[] = [
  { id: 'builtin:oil-and-cotton', title: 'oil and cotton', color: '#ff5a1f', url: 'https://www.youtube.com/playlist?list=PLFBFAAB01A2CF4DB6' },
  { id: 'builtin:uli', title: 'ULI', color: '#1d1d1f', url: 'https://soundcloud.com/meltingseason/sets/uli' },
  {
    id: 'builtin:untitled',
    title: 'Untitled',
    color: '#c9cbd0',
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
    id: 'builtin:headphone-wonders',
    title: 'Headphone Wonders',
    color: '#22468c',
    spotify: [
      ["7udpRbgR2XK5eWWd7rNkMb", "Toys 2 — Oneohtrix Point Never", 279],
      ["2NOa1O7ExfvdaWCmoeDXIV", "One Of These Days - Remastered 2011 — Paul McCartney", 219],
      ["2oG6xNfAeVb9NuKxPLQZBL", "Bern Rhythm — Teebs", 155],
      ["4wTVwkvN1YHr7EWvsYSv35", "Bewley In White — Bibio", 268],
      ["70uvwyfbdqyWIm35cjQ2kR", "Butterfly — Scott Walker", 99],
      ["0rKpBGL06RpLS04oXZV5bx", "This Gentle Hearts Like Shot Bird’s Fallen — Silver Mt. Zion", 347],
      ["6meQ5z5YcJiWy9FPbp78EF", "Cobwebs — Animal Collective", 257],
      ["28uw4OAJ9pr9b0d7vG7wRl", "Broken Mirrors — Chromatics", 424],
      ["5aGBxL5lJpopDPd8VW9xYp", "Copenhagen — Scott Walker", 139],
      ["0Z8RLj7eJlH3iVzoDeU6mM", "Ionia - Jlin Rework — Ben Frost, Jlin", 211],
      ["47BZsV7H3BcnbW7iufupKG", "Dark Side of Religion — Sensations Fix", 209],
      ["5FnMDgSBuTYWQ5Zye4Wgft", "Arisen My Senses - Lanark Artefax Remix — Björk, Lanark Artefax", 312],
      ["7ItSYeBzvWAh3wBFAs28oW", "Sunspot — SUUNS", 276],
      ["5G54EXkOheyrrT3CDM07Mm", "Chrome Country — Oneohtrix Point Never", 305],
      ["3VTWsyxSgdcehWykD8DmFO", "When Mothers of Salem — Bruce Haack", 362],
      ["67o6cRwDvwMlccYzLXAvpv", "Why? 왜? — Mid-Air Thief", 281],
      ["2hac4yOfxASpIs7Vql7cNB", "Routine — Skee Mask", 345],
      ["2WCSO50h7xpXH7xSrLa7vv", "Exchange Groove — Shuta Hasunuma", 331],
      ["6X27YYcX4iCsfNTgOFHVXe", "KFRMX — Shuta Hasunuma", 245],
      ["1WLoQrhi3a616vWStmZD0M", "Ether — Thomas Vaquié", 383],
      ["0kivrll22IelG23U1yPatT", "Norrin Radd Dreaming — Oliver Coates", 328],
      ["4GEJH68nOC81ZeiWgImVwi", "Shroom Music — Quasimoto, Madlib", 181],
      ["39st76aWhCQWjEcTlUreB0", "Spiral — Anthony Naples", 202],
      ["4WmEIvOQ6CMkqT0WTlYzDM", "Reflects — Aoki Takamasa, Ichiro Yamaguchi", 1124],
      ["0Jb4ZNkcOLkl98RHt5H0pq", "I Set My Face to the Hillside — Tortoise", 369],
      ["2m81cX2IJDdFByuiLSEjEv", "鉄鎖 — Mid-Air Thief", 308],
      ["0HqJY6UqSXB6UW28LJF9yV", "Absolute — Animal Hospital", 932],
      ["4LSsUcegXzd8gvKE4Vvdz0", "Gore — Black Dice", 252],
      ["2ofkCRh0tfXyj3ZaEn3EYB", "Orban — Matmos", 312],
      ["0p19IZNZf5GTa5KKnrTkbV", "History of Man — Amanaz", 179],
      ["2QRL40KZ6RlmYifkmhcuGl", "Love And Freedom — Keith mlevhu", 202],
      ["65zC2VZYjJkRYM17g6SJQ4", "Kyanite — Jlin", 266],
      ["04e69TYNuhhueuAwv7meCk", "What Went Down - Haxan Cloak Remix — Foals, Haxan Cloak", 337],
      ["0XLjSQWYkZQOjyOcMe11cV", "Dead Communication — Current Value, DR, Lockjaw", 345],
      ["6aKFAhG7hCy71wLDMKjP5G", "In The Rain — The Dramatics", 209],
      ["0lNE4AAu6pmXKpaYnBv8pW", "Gone for a Wander — Domenique Dumont", 193],
      ["0T8rGG9QR9DjrbEoNsB3p5", "One — Kelly Lee Owens", 234],
      ["5yKfyF3ZZjbCjc9tUMrLg5", "Never Ending Game - Panda Bear Remix — Angel Du$t, Panda Bear", 203],
      ["4Wrd7TpAgRmlUtcbpJCW3T", "flight fm — Joy Orbison", 248],
      ["67ZQwqO01WefJVLacPVZHJ", "Baby — Bobby McFerrin", 182],
      ["3upu9XAG4V8KYFUic2z93E", "EYE Mix 1 — OOIOO", 335],
      ["7mi7KaqAzRFMsm3ppqUwKK", "Welcome Rain In Banana Grove — Gene Menger", 464],
      ["2zuUCXL686oQHt9DTW0YWD", "Descarga — Totem Uruguay", 248],
      ["7A346qNsYSIeTbfUKWNARL", "10101 — James Holden", 365],
      ["7h79P3lVvDEmbpWyVniS4U", "Idontknow - 7\" Version — Jamie xx", 224],
      ["0WAEGVylZjbe2mQ6Or6HxY", "Cannock Chase — Labi Siffre", 247],
      ["1OuzVyUyUQc2QmNCd5wsys", "If I Drink This Potion — Yetsuby", 137],
      ["2gG3ivmsfylVXLyIJvLXyN", "Journey In Satchidananda — Alice Coltrane, Pharoah Sanders", 396],
      ["3Wgm9FhrruO71VDFA6kxgj", "Driving — Grouper", 228],
      ["0hEQzOexeeU2ckT1SL6rVk", "Plop — 亜門", 204],
      ["4d3tD1TkRrMmCT0dm19iy1", "Interlude II — Laraaji", 86],
      ["0FrniERH2hj80rIMX94FN5", "Recursion — Jega", 266],
      ["6f7DItjLEJTjCdLLcbfO8S", "Inertia — Jega", 351],
      ["3cPtZw0oqMEkKlGSF0SLkc", "Hammond Song — The Roches", 345],
    ],
  },
]

/** a built-in disc as a draft; Spotify tracks use the full player when signed in, else the public embed */
export async function openBuiltIn(d: BuiltIn, mount: HTMLElement): Promise<Compilation> {
  if ('url' in d) return { title: d.title, color: d.color, items: (await resolveLink(d.url, mount)).items }
  const stamp = Date.now().toString(36)
  if ('audio' in d) {
    const items: Item[] = d.audio.map(([file, title, duration], i) => ({ kind: 'local', key: `${d.id}:${i}:${stamp}`, file, title, duration }))
    return { title: d.title, color: d.color, items }
  }
  const embed = !(spotifyConfigured() && (await spotifyToken()))
  const items: Item[] = d.spotify.map(([id, title, duration], i) => ({
    kind: 'spotify',
    key: `${d.id}:${i}:${stamp}`,
    uri: `spotify:track:${id}`,
    title,
    duration,
    ...(embed ? { embed: true } : {}),
  }))
  return { title: d.title, color: d.color, items }
}
