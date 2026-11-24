# Status (2026-11-23)

## Working
- BC-1 faceplate from TE's top-view diagram; transport, numpad, cues, repeat, jog, varispeed, sync/tap, rip, battery, simulated BT.
- Burned discs: tracks from YouTube, SoundCloud, Spotify and local files on one disc, drag to reorder, printed solid-colour disc with the track list. Playback switches players between tracks; varispeed / meters / ripping follow each track's source.
- Saved discs are available to both decks in this browser. They retain local files, streaming references, artwork colour and track order. Saved local discs remember cues for the same track order.
- K.O.-sidekick mixer (`m`): EQ (DJ/studio/param), compressor, pan, cue bus, six effects, tempo, FX sequencer, lock, serial mode, settings. Full processing on local files; streams get fader/gain cut/volume/power/siren.
- Two independent BC-1 decks flank the Sidekick. Each has its own disc and transport; keyboard shortcuts follow the last deck clicked or focused.
- Patch cables default to left deck → CH 1 and right deck → CH 2. Either deck can be repatched to a free input, including AUX, and connections persist across reloads.
- Stream FX (Chrome/Edge desktop): turning a streaming channel's EQ, compressor, FX or cue with a click or key press asks to share the tab (wheel and MIDI moves can't open the prompt; a cancelled prompt isn't repeated this visit; menu → stream fx starts or stops it any time). It captures this tab's audio with `getDisplayMedia` (`preferCurrentTab`, `suppressLocalAudioPlayback`) so YouTube, SoundCloud and Spotify run through the Sidekick. A lone stream gets its channel strip (EQ, comp, pan, FX, fader, cue); two streams share one capture and get the main mix only. While captured, a lone stream's BC-1 VU and Sidekick channel meter are real, and the master meter is real for everything; shared streams keep the animated deck VUs. The capture includes anything the tab plays, so the processed mix and cue out play from a small same-origin pop-up (`public/stream-fx.html`). Pipeline verified in headless Chrome with fake audio output and a cross-origin test tone; not yet listened to with real YouTube/Spotify/SoundCloud playback.
- MIDI learn (menu → midi): connect a controller, click any deck or mixer control in 2D or 3D, move a hardware CC, note or pitch bend to bind it. Mappings persist; with none saved, CC 23-26 on channel 1 drive deck 1 play/stop/next/prev as in the BC-1 manual. Tested with simulated messages only, not a physical controller.

## Visual checks
- Burn dialog and printed disc reviewed in Chrome at desktop size. Space on the focused Burn button loaded an orange one-track YouTube disc; printed disc lettering was subsequently enlarged and widened for desktop legibility.
- Force pad "dish" look and the static knob shading: reviewed once at 3x zoom.

## Left to do
- MIDI clock out (`src/engine/midi.ts`) still has no way to connect since the USB port was removed; MIDI input now goes through MIDI learn.
- Spotify full-control path (client ID + Premium) is untested; signing in from the burn dialog leaves the page and loses the draft.
- SoundCloud sets: tracks past the first five only get titles once they've played.
- Sidekick details TE doesn't document (compressor type names, parametric EQ behaviour, parallel FX routing) are educated guesses.

## Feature notes (planned)
- **Spotify auth**: Full Spotify OAuth flow (including preserving in-progress burn drafts across auth redirect, or popup-based sign-in).
- **Full playlist imports**: Import full playlists cleanly from **Spotify**, **YouTube**, and **SoundCloud** directly into a burned disc (all tracks, titles, and durations).
