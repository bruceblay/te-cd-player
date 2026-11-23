# te-cd-player

A browser model of the teenage engineering EP/BC-1 CD player, with YouTube,
SoundCloud, Spotify and local files as "discs". Behaviour follows the
[BC-1 guide](https://teenage.engineering/guides/bc-1).

```bash
npm install
npm run dev   # open http://localhost:5178 (YouTube blocks some videos on 127.0.0.1)
```

## Discs

Click the disc (or press `o`) to **burn a disc**: name it, pick its colour, add tracks from YouTube, SoundCloud and Spotify links and local files (one disc can mix them), drag them into order, and burn. The disc is printed with its title and track list, numbered as the TRACK display counts them, so the numpad can jump to any track. Clicking the disc again opens it for editing. **Save disc** keeps a copy in this browser, including the local audio. On either deck, choose it from **saved discs** and press **burn** to load it. Press `?` for the keyboard map.

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
| CUE 1–3 | set while playing, press to jump, hold to clear. Remembered for the last 40 discs (save local compilations before burning to remember their cues) |
| BT | hold: scan and pair; press: connect / disconnect (simulated radio) |
| ENTER + ▶▶ | repeat: one / all / off |
| ENTER + PLAY | start sync (auto BPM on local files); while syncing, tap tempo |
| ENTER + STOP | tap tempo, or stop sync when not tapping |
| ENTER + ◀◀ | rip the playing track; STOP ends it and downloads a WAV |
| ENTER + BT | broadcast (Auracast) mode, red LED |

The deck auto-sleeps after 5 minutes without playback; PLAY or the switch wakes it.

Keyboard: space play, `x` stop, ←/→ skip, `,` `.` jog (shift for 8×), digits, `t`,
enter, esc, `q` `w` `e` cues, `b` bluetooth, `o` load disc, `p` power. The knobs only turn by dragging.

## K.O.-sidekick mixer (optional)

Press `m` to switch between a solo deck and the two-deck Sidekick rig. The left and right decks start on channels 1 and 2 respectively.

A patch cable runs from the BC-1's OUTPUT to the sidekick's CH 1 input. Drag either plug out to unplug it (the deck goes silent), and drop the mixer end on CH 1, CH 2 or AUX (AUX skips the channel strip).

The EQ, compressor, pan, gain boost, cue and effects process **local files only**: streaming audio stays inside its own player, out of reach. A streaming deck still follows its fader, gain cut, main volume and power, through the player's volume, and the siren (which makes its own sound) works over anything.

| Control | Action |
| --- | --- |
| GAIN | trim, ±24 dB. Click: compressor (turn = amount, SELECT + turn = glue / punch / limit). SELECT + click: gain and pan (SELECT + turn = pan) |
| HIGH / MID / LOW | EQ. Style is set in system settings: DJ (isolator: full left kills the band), studio (±12 dB), param (±15 dB, narrower mid). Double-click resets |
| CUE | sends the channel, before its FX and fader, to the cue output. Both CUEs: main mix to cue. Cue output device is chosen in system settings |
| fader | channel level. SELECT + fader shows the value |
| FX | click to open that channel’s effect menu, then drag MOD to choose an effect. Click the same FX button again to return to the previous screen. Hold both FX: drive both effects. SELECT + both FX: serial mode (main mix through FX 1 then FX 2) |
| MOD stick, force pad | play the effect (see below). With a mouse, a pad press starts at medium pressure and dragging up presses harder; pens and touchscreens send real pressure |
| SELECT | while playing an effect: lock it. Hold SELECT and play MOD / pad: record a looping FX sequence (rounded to whole beats); moving MOD or pad again stops it |
| SELECT + CUE | tempo screen: tap CUE for tap tempo, hold CUE for auto BPM (local files) |
| system button (lid, lower right) | settings: MOD steps through EQ style, tempo source, cue output; pad or SELECT changes the value |
| VOLUME, PHONES | main and cue levels |

Effects: **filter** (MOD: low-pass left, high-pass right; pad: resonance and noise), **delay** (MOD: 1/32 to 2/1; pad: amount), **tape** (MOD: rewind / fast-forward the last few seconds; pad: wow and flutter), **loop** (pad: repeat the last N beats; MOD: N), **tremolo** (MOD: rate; pad: depth), **siren** (MOD: tone; pad: play). All of them sync to the channel's tempo.

## Code

- `src/engine/deck.ts`: one BC-1 (state machine, every panel behaviour). Self-contained so a second deck and a mixer can sit beside it.
- `src/sources/*`: one adapter per source behind the `Source` interface in `src/engine/types.ts`.
- `src/engine/mixer.ts`, `sidekickFx.ts`, `sidekickWorklet.ts`: the sidekick's audio graph, its six effects, and the sample-level tape and loop processors.
- `src/ui/*`: faceplate, seven-segment displays, knobs, jog. Positions use the units of teenage engineering's top-view diagram in the BC-1 guide (plate = 370 x 511).
