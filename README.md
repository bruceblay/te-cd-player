# te-cd-player

A browser model of the teenage engineering EP/BC-1 CD player, with YouTube,
SoundCloud, Spotify and local files as "discs". Behaviour follows the
[BC-1 guide](https://teenage.engineering/guides/bc-1).

```bash
npm install
npm run dev   # open http://localhost:5178 (YouTube blocks some videos on 127.0.0.1)
```

## Discs

Click the disc (or press `o`) to paste a link or pick files. A YouTube video plays on the spinning disc itself; other sources print their cover art from the clear hub to the rim. With no disc you see the laser mechanism and turntable. Press `?` for the keyboard map.

| Source | Loads | Varispeed | Level | VU | Rip | Auto BPM |
| --- | --- | --- | --- | --- | --- | --- |
| YouTube | video or playlist | 5 % steps, pitch held (YouTube's own speed control) | yes | animated | no | no (tap) |
| SoundCloud | track or set | no | yes | animated | no | no (tap) |
| Spotify (client ID) | track, album, playlist | no | yes | animated | no | no (tap) |
| Spotify (no client ID) | one track per disc, via the embed | no | no | animated | no | no (tap) |
| Local files / folder | files or a folder (folders become INDEX) | true varispeed: pitch follows speed, 0.1 % steps | yes | real | WAV, 44.1 kHz 16-bit | yes |

Streaming audio plays inside cross-origin players, so the page can't measure
or record it. That is why the VU is animated, ripping is local-only, BPM
comes from tap tempo for streams, and true varispeed (pitch moving with speed,
as on the hardware) only works on local files.

### Spotify setup

Without setup, Spotify links use the public embed (full tracks if you're signed
in to Spotify in the browser, 30 s previews otherwise). For full deck control:

1. Create an app at developer.spotify.com/dashboard with the Web Playback SDK and Web API.
2. Add `http://127.0.0.1:5178/` as a redirect URI.
3. Copy `.env.example` to `.env.local` and set `VITE_SPOTIFY_CLIENT_ID`.

Playback through the SDK needs Spotify Premium.

## Panel

| Control | Action |
| --- | --- |
| power switch | on / off. Powered off + PLAY shows battery on the VU (uses your laptop battery when the browser exposes it) |
| PLAY / STOP | play-pause; stop, stop again returns to track 1 |
| ◀◀ ▶▶ | previous (restarts track if past 3 s) / next |
| JOG | drag sideways: 2×, 4×, 8× scrub with distance |
| VARISPEED | 50–150 %, drag up/down, double-click resets |
| LEVEL | output level (BT volume while connected), drag up/down |
| numpad + T | type a track; T cycles track → min → sec; ENTER plays from there; C cancels |
| CUE 1–3 | set while playing, press to jump, hold to clear. Remembered for the last 40 discs (not for local files, like MP3 discs) |
| BT | hold: scan and pair; press: connect / disconnect (simulated radio) |
| ENTER + ▶▶ | repeat: one / all / off |
| ENTER + PLAY | start sync (auto BPM on local files); while syncing, tap tempo |
| ENTER + STOP | tap tempo, or stop sync when not tapping |
| ENTER + ◀◀ | rip the playing track; STOP ends it and downloads a WAV |
| ENTER + BT | broadcast (Auracast) mode, red LED |

The deck auto-sleeps after 5 minutes without playback; PLAY or the switch wakes it.

Keyboard: space play, `x` stop, ←/→ skip, `,` `.` jog (shift for 8×), digits, `t`,
enter, esc, `q` `w` `e` cues, `b` bluetooth, `o` load disc, `p` power. The knobs only turn by dragging.

## Code

- `src/engine/deck.ts`: one BC-1 (state machine, every panel behaviour). Self-contained so a second deck and a mixer can sit beside it.
- `src/sources/*`: one adapter per source behind the `Source` interface in `src/engine/types.ts`.
- `src/ui/*`: faceplate, seven-segment displays, knobs, jog. Positions use the units of teenage engineering's top-view diagram in the BC-1 guide (plate = 370 x 511).
