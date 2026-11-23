# Status (2026-11-23)

## Working
- BC-1 faceplate from TE's top-view diagram; transport, numpad, cues, repeat, jog, varispeed, sync/tap, rip, battery, simulated BT.
- Burned discs: tracks from YouTube, SoundCloud, Spotify and local files on one disc, drag to reorder, printed solid-colour disc with the track list. Playback switches players between tracks; varispeed / meters / ripping follow each track's source.
- Saved discs are available to both decks in this browser. They retain local files, streaming references, artwork colour and track order. Saved local discs remember cues for the same track order.
- K.O.-sidekick mixer (`m`): EQ (DJ/studio/param), compressor, pan, cue bus, six effects, tempo, FX sequencer, lock, serial mode, settings. Full processing on local files; streams get fader/gain cut/volume/power/siren.
- Two independent BC-1 decks flank the Sidekick. Each has its own disc and transport; keyboard shortcuts follow the last deck clicked or focused.
- Patch cables default to left deck → CH 1 and right deck → CH 2. Either deck can be repatched to a free input, including AUX.

## Visual checks
- Burn dialog and printed disc reviewed in Chrome at desktop size. Space on the focused Burn button loaded an orange one-track YouTube disc. The title, track number and duration appeared on the disc; the lettering is small at normal size.
- Force pad "dish" look and the static knob shading: reviewed once at 3x zoom.

## Left to do
- Web MIDI has no way to connect since the USB port was removed (code is still in `src/engine/midi.ts`).
- Cable connections reset on reload.
- Spotify full-control path (client ID + Premium) is untested; signing in from the burn dialog leaves the page and loses the draft.
- SoundCloud sets: tracks past the first five only get titles once they've played.
- YouTube's player now runs off-screen; YouTube's embed terms want it visible. Fine for personal use, revisit before publishing.
- Sidekick details TE doesn't document (compressor type names, parametric EQ behaviour, parallel FX routing) are educated guesses.
