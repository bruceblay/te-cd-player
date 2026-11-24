import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import lidPrint from '../assets/sidekick-lid-print.svg'
import { SETTINGS, type Mixer, type MixerState } from '../engine/mixer'
import { FX_TYPES } from '../engine/sidekickFx'
import { Jog, Key, Print, U, capturePointer, pos, u } from './controls'

/*
 * EP-136 K.O.-sidekick, laid out in the units of TE's hardware-overview drawing
 * (plate = 202 x 552; 88 x 240 mm). Scaled so it matches the BC-1 at real size.
 */
const PW = 202
const PH = 552
const COL = [19, 74] // channel columns
const RIGHT = 147 // right-hand column

type Ch = 0 | 1

export function Sidekick({ mixer, s }: { mixer: Mixer; s: MixerState }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(1)
  // measured before first paint, so the faceplate never shows at full size for a frame
  useLayoutEffect(() => {
    const el = wrap.current!
    const fit = () => setK(el.clientWidth / u(PW))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const knob = (c: Ch) => mixer.gainKnob(c)

  return (
    <div className="sidekick-wrap" data-flip="sidekick" ref={wrap}>
      <div className="sidekick" style={{ width: u(PW), height: u(PH), ['--k' as string]: k, ['--u' as string]: `${U}px` }}>
        {/* ---------- top edge band ---------- */}
        <div className="sk-band" style={pos(0, 0, PW, 19)}>
          <span className="sk-band-out" style={{ width: u(37) }}>OUTPUT</span>
          <span className="sk-band-in" style={{ width: u(73) }}>
            <i>AUX</i>
            <i className="sk-input">
              <small className="ch1">CH 1</small>
              <small className="ch2">CH 2</small>
              INPUT
            </i>
          </span>
          <span className="sk-band-usb" style={{ width: u(36) }}>USB</span>
          <span className="sk-band-pwr" style={{ width: u(56) }}>
            <label className={`sk-power ${s.power ? 'on' : ''}`} title="power">
              <input type="checkbox" checked={s.power} onChange={(e) => mixer.setPower(e.target.checked)} aria-label="mixer power" />
              <svg viewBox="0 0 10 10" aria-hidden>
                <path d="M3.2 3.4 A3 3 0 1 0 6.8 3.4 M5 1.8 V5" />
              </svg>
              <span />
            </label>
          </span>
        </div>

        {/* patch points on the top edge, under the printed band */}
        <span className="jack-anchor" data-jack="sk-aux" style={pos(52, 0, 8, 1)} />
        <span className="jack-anchor" data-jack="sk-ch1" style={pos(74, 0, 8, 1)} />
        <span className="jack-anchor" data-jack="sk-ch2" style={pos(91, 0, 8, 1)} />

        {/* ---------- lid ---------- */}
        <div className="sk-lid" style={pos(0, 19, PW, 110)}>
          <img className="sk-lid-print" src={lidPrint} alt="K.O.–SIDEKICK ミキサー · 2 CH STEREO MIXER" draggable={false} />
          <span className="sk-screw" style={pos(4, 6, 9, 9)} />
          <span className="sk-screw" style={pos(189, 6, 9, 9)} />
          <span className="sk-screw" style={pos(4, 96, 9, 9)} />
          {/* looks like the other three; it's the system button */}
          <button className="sk-screw sk-system" style={pos(189, 96, 9, 9)} onClick={() => mixer.systemPress()} title="system settings" aria-label="system settings" />
        </div>

        {/* ---------- channel strips ---------- */}
        {([0, 1] as Ch[]).map((c) => {
          const x = COL[c]
          const ch = s.ch[c]
          const g = knob(c)
          return (
            <Fragment key={c}>
              <Print x={x} y={138.5} w={37} className="center">GAIN</Print>
              <SkKnob x={x} y={147} color="orange" value={g.value} min={g.min} max={g.max} label={`gain ${c + 1}`} onChange={g.set} onTap={() => mixer.gainTap(c)} />
              <Print x={x} y={193.5} w={37} className="center">HIGH</Print>
              <SkKnob x={x} y={202} color="white" pointer value={ch.eq.high} min={-1} max={1} label={`eq high ${c + 1}`} onChange={(v) => mixer.setEq(c, 'high', v)} onReset={() => mixer.setEq(c, 'high', 0)} />
              <Print x={x} y={248.5} w={37} className="center">MID</Print>
              <SkKnob x={x} y={257} color="grey" pointer value={ch.eq.mid} min={-1} max={1} label={`eq mid ${c + 1}`} onChange={(v) => mixer.setEq(c, 'mid', v)} onReset={() => mixer.setEq(c, 'mid', 0)} />
              <Print x={x} y={303.5} w={37} className="center">LOW</Print>
              <SkKnob x={x} y={312} color="black" pointer value={ch.eq.low} min={-1} max={1} label={`eq low ${c + 1}`} onChange={(v) => mixer.setEq(c, 'low', v)} onReset={() => mixer.setEq(c, 'low', 0)} />
              <Key x={x} y={367} w={37} h={18} className={`sk-key dark ${ch.cue ? 'lit' : ''}`} title={`cue ${c + 1}`} onDown={() => mixer.cueDown(c)} onUp={() => mixer.cueUp(c)}>
                <span className="sk-legend">CUE</span>
              </Key>
              <Print x={x + 4} y={399} className="sk-num">{c === 0 ? 'I' : '2'}</Print>
              <Fader x={x + 18.5} y={400} h={80} value={ch.fader} onChange={(v) => mixer.setFader(c, v)} label={`fader ${c + 1}`} />
              <Key x={x} y={495} w={37} h={18} className={`sk-key grey ${s.focus === c || s.focus === 'both' ? 'focus' : ''}`} title={`fx ${c + 1}`} onDown={() => mixer.fxDown(c)} onUp={() => mixer.fxUp(c)}>
                <span className="sk-legend">FX</span>
              </Key>
            </Fragment>
          )
        })}

        {/* ---------- right column ---------- */}
        <div className="sk-lcd" style={pos(RIGHT, 147, 36, 73)}>
          <Lcd mixer={mixer} s={s} />
        </div>
        <ForcePad x={RIGHT} y={257} d={37} value={s.pad} onMod={(stick, pad, lock) => mixer.setMod(stick, pad, lock)} />
        <svg className="sk-bracket" style={pos(136, 272, 12, 106)} viewBox="0 0 12 106" aria-hidden>
          <path d="M11 3 H4 V102 H11" />
        </svg>
        <Print x={RIGHT} y={303.5} w={37} className="center">VOLUME</Print>
        <SkKnob x={RIGHT} y={312} color="white" value={s.master} min={0} max={1} label="main volume" onChange={(v) => mixer.setMaster(v)} />
        <Print x={RIGHT} y={358.5} w={37} className="center">–&nbsp;&nbsp;MOD&nbsp;&nbsp;+</Print>
        <Jog label="mod" x={RIGHT} y={367} w={37} h={18} value={s.stick} onChange={(v) => mixer.setStick(v)} />
        <Print x={RIGHT} y={431.5} w={37} className="center">PHONES</Print>
        <SkKnob x={RIGHT} y={440} color="grey" value={s.phones} min={0} max={1} label="phones volume" onChange={(v) => mixer.setPhones(v)} />
        <Key x={RIGHT} y={495} w={37} h={18} className={`sk-key light ${s.selectHeld ? 'lit' : ''}`} title="select (click to latch, or hold)" onDown={() => mixer.selectDown()} onUp={() => mixer.selectUp()}>
          <span className="sk-legend">SELECT</span>
        </Key>
      </div>
    </div>
  )
}

/**
 * Two-tier knob as on the sidekick: a flat base disc and a smaller raised cap of
 * the same colour. EQ knobs carry a pointer tab on the base; the others show none
 * (turn with SELECT held, or watch the screen). Drag up/down only while pressed.
 */
function SkKnob({
  x,
  y,
  color,
  pointer = false,
  value,
  min,
  max,
  onChange,
  onTap,
  onReset,
  label,
}: {
  x: number
  y: number
  color: 'orange' | 'white' | 'grey' | 'black'
  pointer?: boolean
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  onTap?: () => void
  onReset?: () => void
  label: string
}) {
  const drag = useRef<{ y: number; v: number; moved: boolean } | null>(null)
  const angle = -140 + ((value - min) / (max - min)) * 280
  return (
    <div
      className={`sk-knob ${color}`}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      style={pos(x, y, 37, 37)}
      onPointerDown={(e) => {
        capturePointer(e.currentTarget, e.pointerId)
        drag.current = { y: e.clientY, v: value, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        if (!(e.buttons & 1)) {
          drag.current = null
          return
        }
        if (!onTap || Math.abs(d.y - e.clientY) > 3) d.moved = true
        if (!d.moved) return
        const k = e.shiftKey ? 0.1 : 0.5
        onChange(Math.min(max, Math.max(min, d.v + (d.y - e.clientY) * k * ((max - min) / 100))))
      }}
      onPointerUp={() => {
        if (drag.current && !drag.current.moved) onTap?.()
        drag.current = null
      }}
      onPointerCancel={() => (drag.current = null)}
      onLostPointerCapture={() => (drag.current = null)}
      onDoubleClick={onReset}
    >
      {/* the shadow and lighting stay put; only the base (and its pointer tab) turns */}
      <span className="sk-knob-shade" />
      <span className="sk-knob-base" style={{ transform: `rotate(${angle}deg)` }}>
        {pointer && <i />}
      </span>
      <span className="sk-knob-rim" />
      <span className="sk-knob-cap" />
    </div>
  )
}

/** vertical slide fader: drag the cap or anywhere on the track */
function Fader({ x, y, h, value, onChange, label }: { x: number; y: number; h: number; value: number; onChange: (v: number) => void; label: string }) {
  const track = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; v: number } | null>(null)
  const travel = h - 4
  return (
    <div className="sk-fader" style={pos(x - 9, y - 9, 18, h + 18)}>
      <div className="sk-fader-slot" style={{ left: u(6.5), top: u(9), width: u(5), height: u(h) }} ref={track} />
      <span className="sk-fader-tick" style={{ top: u(9 + h / 2) }} />
      <div
        className="sk-fader-cap"
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={value}
        style={{ width: u(18), height: u(18), top: u(9 + 2 + (1 - value) * travel - 9) }}
        onPointerDown={(e) => {
          capturePointer(e.currentTarget, e.pointerId)
          drag.current = { y: e.clientY, v: value }
        }}
        onPointerMove={(e) => {
          if (!drag.current || !(e.buttons & 1)) return
          const px = track.current!.getBoundingClientRect().height * (travel / h)
          onChange(drag.current.v + (drag.current.y - e.clientY) / px)
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
    </div>
  )
}

/**
 * Force pad. Pens and touchscreens send real pressure; with a mouse, a press
 * starts at medium pressure, dragging up/down changes pressure, and dragging
 * left/right drives MOD so both FX axes can be played one-handed. Right-drag
 * locks the effect on release.
 */
function ForcePad({
  x,
  y,
  d,
  value,
  onMod,
}: {
  x: number
  y: number
  d: number
  value: number
  onMod: (stick: number, pad: number, lockOnRelease?: boolean) => void
}) {
  const start = useRef<{ x: number; y: number; lock: boolean } | null>(null)
  const real = (e: React.PointerEvent) => e.pointerType !== 'mouse' && e.pressure > 0 && e.pressure !== 0.5
  const padOf = (e: React.PointerEvent) =>
    real(e) ? e.pressure : Math.max(0.05, Math.min(1, 0.6 + (start.current!.y - e.clientY) / 80))
  const stickOf = (e: React.PointerEvent) => Math.max(-1, Math.min(1, (e.clientX - start.current!.x) / 60))
  return (
    <div
      className={`sk-pad ${value > 0.01 ? 'down' : ''}`}
      style={pos(x, y, d, d)}
      role="slider"
      aria-label="force pad"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={value}
      title="force pad (up/down: pressure · left/right: mod · right-drag: lock)"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.button !== 2) return
        capturePointer(e.currentTarget, e.pointerId)
        start.current = { x: e.clientX, y: e.clientY, lock: e.button === 2 }
        onMod(0, padOf(e))
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        onMod(stickOf(e), padOf(e))
      }}
      onPointerUp={() => {
        if (!start.current) return
        const lock = start.current.lock
        start.current = null
        onMod(0, 0, lock)
      }}
      onPointerCancel={() => {
        start.current = null
        onMod(0, 0)
      }}
    >
    </div>
  )
}

/* ------------------------------------------------------------ LCD */

const FX_SHORT: Record<string, string> = { filter: 'FILTER', delay: 'DELAY', tape: 'TAPE', loop: 'LOOP', tremolo: 'TREMOLO', siren: 'SIREN' }

function Lcd({ mixer, s }: { mixer: Mixer; s: MixerState }) {
  const lastWheel = useRef(0)
  // 36 x 73 plate units; drawn in a 72 x 146 grid so the pixel font sits on whole units
  return (
    <svg
      className="lcd"
      viewBox="0 0 72 146"
      aria-label="mixer screen"
      role="img"
      onWheel={(e) => {
        if (!s.power || (s.screen !== 'fx' && s.screen !== 'main')) return
        const now = performance.now()
        if (now - lastWheel.current < 140 || Math.abs(e.deltaY) < 4) return
        lastWheel.current = now
        mixer.stepFx(e.deltaY > 0 ? 1 : -1)
      }}
    >
      <defs>
        <pattern id="lcd-dots" width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" className="grid" />
        </pattern>
      </defs>
      <rect width="72" height="146" className="lcd-bg" />
      {s.power && <rect width="72" height="146" fill="url(#lcd-dots)" />}
      {s.power && <Screen mixer={mixer} s={s} />}
    </svg>
  )
}

function Bar({ x, y, w, h, v, vertical = true }: { x: number; y: number; w: number; h: number; v: number; vertical?: boolean }) {
  const n = vertical ? Math.floor(h / 3) : Math.floor(w / 3)
  const lit = Math.round(Math.max(0, Math.min(1, v)) * n)
  return (
    <g>
      {Array.from({ length: n }, (_, i) =>
        vertical ? (
          <rect key={i} x={x} y={y + h - (i + 1) * 3 + 1} width={w} height={2} className={i < lit ? 'on' : 'dim'} />
        ) : (
          <rect key={i} x={x + i * 3} y={y} width={2} height={h} className={i < lit ? 'on' : 'dim'} />
        ),
      )}
    </g>
  )
}

function Tag({ x, y, text, on, w = 30, onClick }: { x: number; y: number; text: string; on: boolean; w?: number; onClick?: () => void }) {
  return (
    <g className={onClick ? 'lcd-btn' : undefined} onClick={onClick}>
      <rect x={x} y={y} width={w} height={11} className={on ? 'on' : 'frame'} />
      <text x={x + w / 2} y={y + 8.5} textAnchor="middle" className={on ? 'ink' : 'txt'}>
        {text}
      </text>
    </g>
  )
}

function MiniTag({
  x,
  y,
  w,
  text,
  state,
  onClick,
  title,
}: {
  x: number
  y: number
  w: number
  text: string
  state: 'off' | 'armed' | 'on'
  onClick: () => void
  title: string
}) {
  return (
    <g className="lcd-btn" onClick={onClick}>
      <title>{title}</title>
      <rect x={x} y={y} width={w} height={10} className={state === 'on' ? 'on' : state === 'armed' ? 'frame' : 'dimframe'} />
      <text x={x + w / 2} y={y + 7.2} textAnchor="middle" className={state === 'on' ? 'mini ink' : state === 'armed' ? 'mini' : 'dimtxt'}>
        {text}
      </text>
    </g>
  )
}

function Screen({ mixer, s }: { mixer: Mixer; s: MixerState }) {
  const focusCh = s.focus === 'both' ? 0 : s.focus
  const ch = s.ch[s.screenCh]
  const title = (t: string) => (
    <text x="36" y="12" textAnchor="middle" className="txt">
      {t}
    </text>
  )

  let body: React.ReactNode
  if (s.screen === 'settings') {
    const values = [s.eqStyle.toUpperCase(), s.tempoSource.toUpperCase(), s.cueOut ? (s.cueOutputs.find((o) => o.id === s.cueOut)?.label ?? 'DEV').slice(0, 7).toUpperCase() : s.cueOutputs.length ? 'OFF' : 'ALLOW?']
    body = (
      <>
        {title('SYSTEM')}
        {SETTINGS.map((item, i) => (
          <g key={item} className="lcd-btn" onClick={() => mixer.selectSetting(i)}>
            <rect x="2" y={24 + i * 30} width="68" height="26" className={i === s.settingsIndex ? 'frame' : 'hit'} />
            <text x="6" y={34 + i * 30} className="txt">
              {item}
            </text>
            <text x="66" y={46 + i * 30} textAnchor="end" className="big">
              {values[i]}
            </text>
          </g>
        ))}
        <text x="36" y="140" textAnchor="middle" className="dimtxt">
          CLICK / STICK
        </text>
      </>
    )
  } else if (s.screen === 'fx') {
    body = (
      <>
        {title(`FX ${s.screenCh + 1}`)}
        {FX_TYPES.map((t, i) => (
          <g key={t} className="lcd-btn" onClick={() => mixer.selectFx(t)}>
            <rect x="2" y={20 + i * 18} width="68" height="15" className={t === ch.fx ? 'on' : 'hit'} />
            <text x="36" y={31 + i * 18} textAnchor="middle" className={t === ch.fx ? 'ink' : 'txt'}>
              {FX_SHORT[t]}
            </text>
          </g>
        ))}
        <text x="36" y="140" textAnchor="middle" className="dimtxt">
          CLICK / MOD
        </text>
      </>
    )
  } else if (s.screen === 'comp') {
    body = (
      <>
        {title(`COMP ${s.screenCh + 1}`)}
        <text x="36" y="58" textAnchor="middle" className="huge">
          {Math.round(ch.comp * 100)}
        </text>
        <Bar x={6} y={70} w={60} h={8} v={ch.comp} vertical={false} />
        <text x="36" y="104" textAnchor="middle" className="big">
          {ch.compType.toUpperCase()}
        </text>
        <text x="36" y="140" textAnchor="middle" className="dimtxt">
          SEL+TURN: TYPE
        </text>
      </>
    )
  } else if (s.screen === 'channel') {
    const pan = Math.round(ch.pan * 50)
    body = (
      <>
        {title(`CH ${s.screenCh + 1}`)}
        <text x="6" y="34" className="txt">
          GAIN
        </text>
        <text x="66" y="52" textAnchor="end" className="big">
          {(ch.gain > 0 ? '+' : '') + ch.gain.toFixed(1)}
        </text>
        <text x="6" y="78" className="txt">
          PAN
        </text>
        <text x="66" y="96" textAnchor="end" className="big">
          {pan === 0 ? 'C' : pan < 0 ? `L${-pan}` : `R${pan}`}
        </text>
        <rect x="6" y="104" width="60" height="6" className="frame" />
        <rect x={36 + ch.pan * 28 - 2} y="104" width="4" height="6" className="on" />
        <text x="36" y="140" textAnchor="middle" className="dimtxt">
          SEL+TURN: PAN
        </text>
      </>
    )
  } else if (s.screen === 'tempo') {
    body = (
      <>
        {title('TEMPO')}
        {s.ch.map((c, i) => (
          <g key={i}>
            <text x="6" y={38 + i * 40} className="txt">
              CH{i + 1} {c.tracking ? 'AUTO' : 'TAP'}
            </text>
            <text x="66" y={58 + i * 40} textAnchor="end" className="big">
              {c.bpm.toFixed(1)}
            </text>
          </g>
        ))}
        <text x="36" y="128" textAnchor="middle" className="txt">
          SYNC {s.tempoSource.toUpperCase()}
        </text>
        <text x="36" y="140" textAnchor="middle" className="dimtxt">
          TAP / HOLD CUE
        </text>
      </>
    )
  } else if (s.screen === 'level') {
    body = (
      <>
        {title(`CH ${s.screenCh + 1}`)}
        <text x="36" y="80" textAnchor="middle" className="huge">
          {Math.round(ch.fader * 100)}
        </text>
        <text x="36" y="100" textAnchor="middle" className="txt">
          LEVEL
        </text>
      </>
    )
  } else {
    // main, as on the unit: CUE tags, a big readout, meters, the effect, FX tags
    const fx = s.ch[focusCh].fx
    const held = s.locked || s.seq === 'play'
    body = (
      <>
        <Tag x={3} y={3} w={31} text="CUE" on={s.ch[0].cue} />
        <Tag x={38} y={3} w={31} text="CUE" on={s.ch[1].cue} />
        <text x="36" y="34" textAnchor="middle" className="huge">
          {String(Math.round(s.ch[focusCh].bpm)).padStart(3, '0')}
        </text>
        {s.mainCue && (
          <text x="69" y="22" textAnchor="end" className="dimtxt">
            MC
          </text>
        )}
        <Bar x={8} y={40} w={4} h={57} v={s.ch[0].meter[0]} />
        <Bar x={14} y={40} w={4} h={57} v={s.ch[0].meter[1]} />
        <Bar x={26} y={40} w={9} h={57} v={s.masterMeter[0]} />
        <Bar x={37} y={40} w={9} h={57} v={s.masterMeter[1]} />
        <Bar x={54} y={40} w={4} h={57} v={s.ch[1].meter[0]} />
        <Bar x={60} y={40} w={4} h={57} v={s.ch[1].meter[1]} />
        <path d={`M2 ${92 - s.pad * 50} l4 3 l-4 3 z`} className="on" />
        <g className="lcd-btn" onClick={() => mixer.openFxMenu()}>
          <title>click to pick effect (or scroll)</title>
          <rect x="2" y="100" width="68" height="14" className="hit" />
          <text x="36" y="111" textAnchor="middle" className="big">
            {s.focus === 'both' ? `${FX_SHORT[s.ch[0].fx].slice(0, 3)}+${FX_SHORT[s.ch[1].fx].slice(0, 3)}` : FX_SHORT[fx]}
          </text>
        </g>
        <MiniTag
          x={3}
          y={117}
          w={23}
          text={s.seq === 'rec' ? 'REC' : s.seq === 'play' ? 'SEQ' : 'LOCK'}
          state={held || s.seq === 'rec' ? 'on' : s.lockArmed ? 'armed' : 'off'}
          onClick={() => mixer.toggleLock()}
          title={held ? 'click to release lock / sequence' : s.lockArmed ? 'lock armed: drag pad to freeze' : 'arm FX lock (next pad drag freezes on release)'}
        />
        <MiniTag
          x={28}
          y={117}
          w={16}
          text="1+2"
          state={s.focus === 'both' ? 'on' : 'off'}
          onClick={() => mixer.toggleBothFx()}
          title="drive both channels' FX together"
        />
        <MiniTag
          x={46}
          y={117}
          w={23}
          text="SER"
          state={s.serial ? 'on' : 'off'}
          onClick={() => mixer.toggleSerial()}
          title="serial FX mode (main mix through FX 1 then FX 2)"
        />
        <Tag x={3} y={131} w={31} text="FX" on={s.focus === 0 || s.focus === 'both'} onClick={() => mixer.focusFx(0)} />
        <Tag x={38} y={131} w={31} text="FX" on={s.focus === 1 || s.focus === 'both'} onClick={() => mixer.focusFx(1)} />
      </>
    )
  }

  return (
    <g>
      {body}
      {s.message && (
        <g>
          <rect x="2" y="58" width="68" height="26" className="on" />
          <text x="36" y="75" textAnchor="middle" className="ink">
            {s.message}
          </text>
        </g>
      )}
    </g>
  )
}
