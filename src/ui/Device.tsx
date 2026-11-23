import { Fragment, useEffect, useRef, useState, type RefObject } from 'react'
import type { Deck, DeckState } from '../engine/deck'
import { readout } from '../engine/display'
import { Jog, Key, Knob, Led, Print, U, VU, pos, u } from './controls'
import { PlateArt, Turntable } from './PlateArt'
import { SevenSeg } from './SevenSeg'

// plate size in diagram units (teenage engineering's BC-1 top view)
const PW = 370
const PH = 511
// spindle centre and disc radius (120 mm disc)
const CX = 236.5
const CY = 177
const DISC_R = 123

const BT_LED: Record<DeckState['bt'], { color: string; on: boolean; blink?: boolean }> = {
  off: { color: '#3a6cff', on: false },
  scanning: { color: '#3a6cff', on: true, blink: true },
  connecting: { color: '#3a6cff', on: true },
  connected: { color: '#f4f4ff', on: true },
  broadcast: { color: '#ff2a1a', on: true },
}

const PAD: (number | 'T' | 'C')[][] = [
  [7, 8, 9],
  [4, 5, 6],
  [1, 2, 3],
  ['T', 0, 'C'],
]
const PAD_X = [17, 51, 84]
const PAD_Y = [236, 269, 303, 337]
const COL = [118, 169, 219, 270, 320] // big-key columns
const GROUPS = [118.5, 152, 185.5, 219] // TRACK INDEX MIN SEC

export function Device({
  deck,
  s,
  videoMount,
  onOpenLid,
}: {
  deck: Deck
  s: DeckState
  /** YouTube's player is created in here, so the video becomes the disc face */
  videoMount: RefObject<HTMLDivElement | null>
  onOpenLid: () => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(1)
  useEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => setK(el.clientWidth / u(PW)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const r = readout(s)
  const on = s.power === 'on'
  const vu: [number, number] = s.batteryCheck ? [s.battery, s.battery] : on ? s.vu : [0, 0]
  const spinning = on && s.transport === 'playing'
  const spinSecs = 1.6 / (s.vari / 100)
  const art = s.disc?.tracks[s.track]?.artwork ?? s.disc?.artwork
  // the cued YouTube player shows its own title card; cover it with the thumbnail until playback starts
  const video = s.disc?.kind === 'youtube' && s.transport !== 'stopped'
  const bt = BT_LED[on ? s.bt : 'off']

  return (
    <div className="device-wrap" ref={wrap}>
      <div
        className={`device ${on ? 'powered' : ''}`}
        style={{ width: u(PW), height: u(PH), transform: `scale(${k})`, ['--u' as string]: `${U}px` }}
      >
        <div className="plate" />
        <span className="hole" style={pos(143 - 25, 269 - 25, 50, 50)} />
        <span className="hole" style={pos(328.5 - 27.5, 84.5 - 27.5, 55, 55)} />
        <PlateArt />
        <Turntable x={CX} y={CY} r={40} spin={spinning} secs={spinSecs} />

        {/* ---------- top edge: ports, BT, power ---------- */}
        <Print x={22} y={4}>OUTPUT</Print>
        <Led x={63.5} y={5.6} {...bt} />
        <Print x={68.5} y={4}>BT</Print>
        <button
          className="edge-button bt"
          style={pos(71, -4.2, 9, 4.6)}
          title="bluetooth (hold to pair)"
          aria-label="bluetooth"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            deck.btDown()
          }}
          onPointerUp={() => deck.btUp()}
          onPointerCancel={() => deck.btUp()}
        />
        <Print x={104} y={4}>SYNC OUT</Print>
        <span className={`port-live ${s.sync.on ? 'on' : ''}`} style={pos(112, -1.2, 12, 1.4)} title="sync out (sent as MIDI clock over USB)" />
        <Print x={227} y={4}>DATA</Print>
        <Print x={280} y={4}>USB</Print>
        <Print x={327} y={4}>POWER</Print>
        <label className={`power-switch ${s.power !== 'off' ? 'on' : ''}`} style={pos(332, -7.5, 18, 7.5)} title="power">
          <input
            type="checkbox"
            checked={s.power !== 'off'}
            onChange={(e) => deck.powerSwitch(e.target.checked)}
            aria-label="power switch"
          />
          <span className="power-nub" style={{ width: u(10), height: u(6.5) }} />
        </label>

        {/* ---------- disc ---------- */}
        {s.disc && <span className="disc-shadow" style={pos(CX - DISC_R, CY - DISC_R, DISC_R * 2, DISC_R * 2)} />}
        {/* the disc box stays put and clips; only its printed face turns, so the
            rotating square's corners never poke out and jiggle the page's scrollbars */}
        <div
          className={`disc ${s.disc ? '' : 'empty'} ${art || s.disc?.kind === 'youtube' ? 'printed' : ''}`}
          style={pos(CX - DISC_R, CY - DISC_R, DISC_R * 2, DISC_R * 2)}
        >
          <div className={`disc-face ${spinning ? 'spin' : ''}`} style={{ animationDuration: `${spinSecs}s` }}>
            <div className="disc-video" ref={videoMount} />
            {art && <img src={art} alt="" draggable={false} className={video ? 'under' : ''} />}
          </div>
          <span className="disc-shine" />
          <span className="disc-hub" />
        </div>
        <button
          className="disc-hit"
          style={pos(CX - DISC_R, CY - DISC_R, DISC_R * 2, DISC_R * 2)}
          onClick={onOpenLid}
          aria-label={s.disc ? `disc: ${s.disc.title}. click to change disc` : 'load a disc'}
          title={s.disc ? s.disc.title : 'load a disc'}
        />

        {/* ---------- numpad ---------- */}
        {PAD.map((row, ri) =>
          row.map((v, ci) => (
            <Key
              key={`${ri}-${ci}`}
              x={PAD_X[ci]}
              y={PAD_Y[ri]}
              w={17}
              h={17}
              className="black small"
              title={v === 'T' ? 'time (track / min / sec)' : v === 'C' ? 'cancel' : String(v)}
              onDown={() => (v === 'T' ? deck.pressTime() : v === 'C' ? deck.pressCancel() : deck.pressDigit(v))}
            >
              {/* TE draws the one as a capital I */}
              <span className="legend center">{v === 1 ? 'I' : v}</span>
            </Key>
          )),
        )}
        <Key x={17} y={387} w={34} h={34} className="black" title="enter (hold for shift functions)" onDown={() => deck.enterDown()} onUp={() => deck.enterUp()}>
          <span className="legend top">ENTER</span>
        </Key>

        {/* ---------- displays ---------- */}
        <Print x={337} y={278.5} w={8} className="center">L</Print>
        <Print x={346} y={278.5} w={8} className="center">R</Print>
        <VU x={337} y={286} w={17} h={34} levels={vu} />

        {['TRACK', 'INDEX', 'MIN', 'SEC'].map((l, i) => (
          <Print key={l} x={GROUPS[i]} y={328} w={i === 3 ? 34 : 29.5} rule>
            {l}
          </Print>
        ))}
        <div className="window" style={pos(118, 337, 135, 17)}>
          {GROUPS.map((gx, i) => (
            <div key={i} className="seg-group" style={pos(gx - 118 + 1, 2.2, 26, 12.6)}>
              <SevenSeg
                text={r.main.slice(i * 3, i * 3 + 3)}
                blink={r.blink.slice(i * 3, i * 3 + 3)}
                dots={r.dots.slice(i * 3, i * 3 + 3)}
                label={['track', 'index', 'minutes', 'seconds'][i]}
              />
            </div>
          ))}
        </div>
        <Print x={270} y={328} w={34} rule>VARISPEED</Print>
        <div className="window" style={pos(270, 337, 34, 17)}>
          <div className="seg-group" style={pos(4, 2.2, 26, 12.6)}>
            <SevenSeg text={r.vari} label="varispeed" />
          </div>
        </div>
        <Print x={320} y={328} w={34} rule>LINE LEVEL</Print>
        <div className="window" style={pos(320, 337, 34, 17)}>
          <div className="seg-group" style={pos(4, 2.2, 26, 12.6)}>
            <SevenSeg text={r.line} label="line level" />
          </div>
        </div>

        {/* ---------- cue row ---------- */}
        {[0, 1, 2].map((i) => (
          <Fragment key={i}>
            <Led x={COL[i] + 6} y={377} color="#ff2a1a" on={on && !!s.cues[i]} />
            <Print x={COL[i] + 11} y={375.5}>CUE</Print>
            <Key
              x={COL[i]}
              y={387}
              w={34}
              h={34}
              className="grey"
              title={`cue ${i + 1} (hold to clear)`}
              onDown={() => deck.cueDown(i)}
              onUp={() => deck.cueUp(i)}
            >
              <span className="legend corner num">{i === 0 ? 'I' : i + 1}</span>
            </Key>
          </Fragment>
        ))}
        <Print x={COL[3]} y={375.5} w={34} className="center">VARISPEED</Print>
        <Knob
          x={COL[3]}
          y={387}
          size={34}
          cap={22}
          className="vari"
          value={s.varispeed}
          min={50}
          max={150}
          label="varispeed"
          onChange={(v) => deck.setVarispeed(v)}
          onReset={() => deck.setVarispeed(100)}
        />
        <Print x={COL[4]} y={375.5} w={34} className="center">LEVEL</Print>
        <Knob x={COL[4]} y={387} size={34} cap={17} className="level" value={s.level} min={0} max={100} label="level" onChange={(v) => deck.setLevel(v)} />

        {/* ---------- transport row ---------- */}
        <Jog x={COL[0]} y={438} w={34} h={17} value={s.jog} onChange={(v) => deck.setJog(v)} />
        <Print x={COL[0]} y={459} w={34} className="center">JOG</Print>
        <Key x={COL[1]} y={438} w={34} h={34} className="black" title="previous" onDown={() => deck.pressPrev()}>
          <svg viewBox="0 0 12 8" className="legend top glyph"><path d="M1.5 0v8M10.5 0 3 4l7.5 4z" /></svg>
        </Key>
        <Key x={COL[2]} y={438} w={34} h={34} className="black" title="next" onDown={() => deck.pressNext()}>
          <svg viewBox="0 0 12 8" className="legend top glyph"><path d="M10.5 0v8M1.5 0 9 4 1.5 8z" /></svg>
        </Key>
        <Key x={COL[3]} y={438} w={34} h={34} className="grey" title="stop" onDown={() => deck.pressStop()}>
          <span className="legend top">STOP</span>
        </Key>
        <Key x={COL[4]} y={438} w={34} h={34} className="blue" title="play" onDown={() => deck.pressPlay()}>
          <span className="legend top">PLAY</span>
        </Key>

        <Print x={267} y={496} w={28} className="center">PHONES</Print>
      </div>
    </div>
  )
}
