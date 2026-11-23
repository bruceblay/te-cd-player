import { memo, useId } from 'react'
import cdMark from '../assets/compact-disc.svg'
import teMark from '../assets/te-wordmark.png'
import { U } from './controls'

/*
 * Everything drawn into the top plate, in the units of TE's 370 x 511 top-view
 * diagram: screw bosses, finger holes, the exposed laser mechanism, the index
 * window, the Compact Disc mark and the edge jacks. Static, so memoised.
 */

const PW = 370
const PH = 511

const SCREWS: [number, number][] = [
  [9, 25], [26, 25], [9, 42], [26, 42],
  [345, 25], [362, 25], [345, 42], [362, 42],
  [9, 109], [362, 109],
]

// mechanism cutout, traced from the diagram and the photo (corners softened)
const MECH =
  'M90 212 Q87 212 87 209 V143 Q87 141 88.5 139.5 L103.5 124.5 Q105 123 107 123 H159 Q162 123 162 120 V89 Q162 86 165 86 H232 Q234 86 235.5 87.5 L251 103 Q252.5 104.5 252.5 106.5 V145.6 A35 35 0 0 1 237 212 Z'

export const PlateArt = memo(function PlateArt() {
  const id = useId()
  return (
    <svg className="plate-art" viewBox={`0 0 ${PW} ${PH}`} width={PW * U} height={PH * U} aria-hidden>
      <defs>
        <radialGradient id={id + '-boss'} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#e6e6e2" />
          <stop offset="0.7" stopColor="#c4c4bf" />
          <stop offset="1" stopColor="#a9a9a4" />
        </radialGradient>
        <linearGradient id={id + '-mech'} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#47484b" />
          <stop offset="1" stopColor="#36373a" />
        </linearGradient>
        <linearGradient id={id + '-sled'} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#24296a" />
          <stop offset="0.55" stopColor="#323a8c" />
          <stop offset="1" stopColor="#1d2257" />
        </linearGradient>
        <radialGradient id={id + '-lens'} cx="45%" cy="40%" r="60%">
          <stop offset="0" stopColor="#c9ccd6" />
          <stop offset="0.35" stopColor="#6b7080" />
          <stop offset="1" stopColor="#2b2d33" />
        </radialGradient>
        <linearGradient id={id + '-window'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#060606" />
          <stop offset="1" stopColor="#151515" />
        </linearGradient>
      </defs>

      {SCREWS.map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <circle r="5.2" fill="#000" opacity="0.12" transform="translate(0.5 0.8)" />
          <circle r="5" fill={`url(#${id}-boss)`} stroke="#9c9c97" strokeWidth="0.35" />
          <circle r="2.6" fill="#6d6d69" />
          <path d="M-1.6 -0.9 L0 -1.85 L1.6 -0.9 V0.9 L0 1.85 L-1.6 0.9 Z" fill="#4a4a47" />
        </g>
      ))}


      {/* laser mechanism */}
      <path d={MECH} fill="#000" opacity="0.25" transform="translate(0 0.8)" />
      <path d={MECH} fill={`url(#${id}-mech)`} stroke="#a9a9a4" strokeWidth="0.7" />
      <rect x={106} y={134} width={3.4} height={3.4} rx={0.5} fill="#151517" />
      <rect x={229} y={117} width={1.6} height={8} rx={0.6} fill="#1f2022" />
      <rect x={245} y={129} width={1.6} height={8} rx={0.6} fill="#1f2022" />
      <rect x={213} y={135} width={2.6} height={2.6} rx={0.4} fill="#1f2022" />
      <image href={teMark} x={165} y={150} width={35} height={13} />
      <rect x={89.5} y={171.5} width={68} height={18} rx={0.6} fill="#1b1c1f" />
      <rect x={90.5} y={172.5} width={66} height={16} fill={`url(#${id}-sled)`} />
      <rect x={157.5} y={169.5} width={46} height={22} rx={1} fill="#1d1e21" />
      <rect x={161} y={172} width={14} height={17} rx={1} fill="#5a5d66" />
      <rect x={186} y={172} width={14} height={17} rx={1} fill="#4a4d55" />
      <circle cx={180.5} cy={180.5} r={7} fill="#3a3c43" />
      <circle cx={180.5} cy={180.5} r={4.6} fill={`url(#${id}-lens)`} />
      <text x={96} y={199.5} className="mech-warn">CLASS 1 LASER: NEVER TOUCH THE LENS</text>
      <text x={96} y={203.5} className="mech-warn">NEVER LOOK DIRECTLY INTO THE LENS</text>
      <circle cx={167.5} cy={200.6} r={1.2} fill="#d8d8d8" />
      <line x1={169.5} y1={200.6} x2={178} y2={200.6} stroke="#8a8b8e" strokeWidth="0.35" />

      {/* index window */}
      <rect x={219} y={236} width={34} height={17} rx={1} fill={`url(#${id}-window)`} stroke="#9b9b96" strokeWidth="0.4" />

      {/* Compact Disc Digital Audio mark */}
      <image href={cdMark} x={302} y={169} width={36} height={24} />

      {/* jacks along the edges */}
      <rect x={27} y={0} width={12} height={1.6} fill="#2b2c2e" />
      <rect x={112} y={0} width={12} height={1.6} fill="#2b2c2e" />
      <rect x={229} y={0} width={14} height={1.6} fill="#2b2c2e" />
      <path d="M273 511 A8 8 0 0 1 289 511 Z" fill="#2b2c2e" />
    </svg>
  )
})

/** the turntable under the disc; spins with it and shows through the clear hub */
export function Turntable({ x, y, r, spin }: { x: number; y: number; r: number; spin: boolean }) {
  const id = useId()
  const ticks = [-30, 90, 210]
  return (
    <svg
      className="turntable"
      viewBox="-40 -40 80 80"
      style={{ left: (x - r) * U, top: (y - r) * U, width: r * 2 * U, height: r * 2 * U }}
      aria-hidden
    >
      <defs>
        <path id={id + '-tt-ring'} d="M0 -26 A26 26 0 1 1 -0.01 -26" />
        <radialGradient id={id + '-tt'} cx="45%" cy="40%" r="65%">
          <stop offset="0" stopColor="#2e2f32" />
          <stop offset="1" stopColor="#151517" />
        </radialGradient>
      </defs>
      <circle r="36" fill="#000" opacity="0.3" transform="translate(0.8 1.4)" />
      {/* only this group turns: the svg box itself never rotates */}
      <g className={`tt-spin ${spin ? 'spin' : ''}`}>
      <circle r="35" fill={`url(#${id}-tt)`} stroke="#55565a" strokeWidth="0.6" />
      <circle r="31.5" fill="none" stroke="#2a2b2e" strokeWidth="0.8" />
      <text className="tt-print">
        <textPath href={'#' + id + '-tt-ring'} startOffset="2%">
          DIGITAL VARISPEED
        </textPath>
      </text>
      <text className="tt-print">
        <textPath href={'#' + id + '-tt-ring'} startOffset="52%">
          BC-1 · 44.1 KHZ
        </textPath>
      </text>
      {ticks.map((a) => (
        <path key={a} d="M0 -20.5 L1.6 -17.5 H-1.6 Z" fill="#e8e8e6" transform={`rotate(${a})`} />
      ))}
      <circle r="13" fill="#1b1c1e" stroke="#3b3c40" strokeWidth="0.6" />
      <circle r="6.4" fill="#2a2b2e" />
      {[0, 72, 144, 216, 288].map((a) => (
        <circle key={a} cx="0" cy="-9.3" r="1.25" fill="#0b0b0c" transform={`rotate(${a})`} />
      ))}
      <circle r="2.2" fill="#0b0b0c" />
      </g>
    </svg>
  )
}
