import { useSyncExternalStore } from 'react'
import { canCaptureTab, type CaptureRoute, type Mixer, type MixerState } from '../engine/mixer'

const noSub = () => () => {}
const noState = () => null

const ROUTE_TEXT: Record<CaptureRoute, string> = {
  '0': 'the stream on CH 1 runs through its strip',
  '1': 'the stream on CH 2 runs through its strip',
  aux: 'the stream on AUX runs through the main mix',
  sum: 'two streams share the capture, so they get the main mix only',
  none: 'waiting for a streaming disc',
}

/** Drawer section: run YouTube and SoundCloud through the mixer by capturing this tab. */
export function StreamFxSection({ mixer, open }: { mixer: Mixer | null; open: boolean }) {
  const s = useSyncExternalStore<MixerState | null>(mixer ? mixer.subscribe : noSub, mixer ? mixer.getState : noState)
  const tab = open ? 0 : -1
  const on = s?.streamFx === 'on'
  const supported = canCaptureTab()

  let note: string
  if (!supported) note = 'needs Chrome or Edge on a computer'
  else if (!mixer || !s) note = 'add the sidekick mixer to use this'
  else if (on) note = ROUTE_TEXT[s.captureRoute]
  else if (s.streamFxError) note = s.streamFxError
  else
    note =
      'run YouTube and SoundCloud through the mixer’s EQ, compressor and FX. Chrome asks to share this tab with its audio, and the sound then plays from a small window that stays open'

  return (
    <section className="drawer-section drawer-divider">
      <div className="drawer-section-head">
        <h3 className="drawer-label">stream fx</h3>
        {supported && mixer && s && (
          <div className="drawer-mini-actions">
            <button
              type="button"
              className="drawer-link"
              tabIndex={tab}
              disabled={s.streamFx === 'starting'}
              onClick={() => (on ? mixer.stopStreamFx() : void mixer.startStreamFx())}
            >
              {on ? 'stop' : s.streamFx === 'starting' ? 'starting…' : 'start'}
            </button>
          </div>
        )}
      </div>
      {on && (
        <p className="sp-status">
          <span className="sp-dot midi" aria-hidden />
          <span>capturing this tab</span>
        </p>
      )}
      <p className="drawer-note">{note}</p>
    </section>
  )
}
