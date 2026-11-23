# Status (2026-11-23)

## Working
- BC-1 faceplate from TE's top-view diagram; transport, numpad, cues, repeat, jog, varispeed, sync/tap, rip, battery, simulated BT.
- Burned discs: tracks from YouTube, SoundCloud, Spotify and local files on one disc, drag to reorder, printed solid-colour disc with the track list. Playback switches players between tracks; varispeed / meters / ripping follow each track's source.
- K.O.-sidekick mixer (`m`): EQ (DJ/studio/param), compressor, pan, cue bus, six effects, tempo, FX sequencer, lock, serial mode, settings. Full processing on local files; streams get fader/gain cut/volume/power/siren.
- Patch cable (Verlet rope) from BC-1 OUTPUT to sidekick CH1/CH2/AUX; pulling a plug silences the deck.

## Not yet checked by eye
- Burn dialog and printed disc: verified by code (adding, reordering, burning, numpad jumps across sources) but not yet reviewed visually.
- Force pad "dish" look and the static knob shading: reviewed once at 3x zoom.

## Left to do
- Second BC-1 deck for sidekick CH 2.
- Web MIDI has no way to connect since the USB port was removed (code is still in `src/engine/midi.ts`).
- Cable: state isn't remembered across reloads; a dropped loose plug can end up at the window edge.
- Spotify full-control path (client ID + Premium) is untested; signing in from the burn dialog leaves the page and loses the draft.
- SoundCloud sets: tracks past the first five only get titles once they've played.
- YouTube's player now runs off-screen; YouTube's embed terms want it visible. Fine for personal use, revisit before publishing.
- Cue markers aren't remembered for discs that contain local files.
- Sidekick details TE doesn't document (compressor type names, parametric EQ behaviour, parallel FX routing) are educated guesses.
