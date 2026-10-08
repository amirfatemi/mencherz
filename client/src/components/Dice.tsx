import { useEffect, useState, type CSSProperties } from 'react';
import { shade } from '../color.ts';

// Pip spots on a 100x100 face, as columns/rows 0..2.
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

interface Props {
  /** The face to show; null shows a blank face, waiting for a roll. */
  value: number | null;
  rolling: boolean;
  color: string;
  canRoll: boolean;
  onRoll?: () => void;
}

/** A flat, glossy die in the roller's colour with white pips. */
export function Dice({ value, rolling, color, canRoll, onRoll }: Props) {
  const [face, setFace] = useState<number | null>(value);
  const [landed, setLanded] = useState(0);

  useEffect(() => {
    if (!rolling) {
      setFace(value);
      if (value !== null) setLanded((n) => n + 1);
      return;
    }
    const t = setInterval(() => setFace((f) => (((f ?? 1) + Math.floor(Math.random() * 5)) % 6) + 1), 70);
    return () => clearInterval(t);
  }, [rolling, value]);

  const edge = shade(color, -0.35);
  return (
    <button
      type="button"
      className={`dice flat${rolling ? ' rolling' : ''}${canRoll ? ' can-roll' : ''}`}
      style={{ '--dice-color': color } as CSSProperties}
      onClick={canRoll ? onRoll : undefined}
      disabled={!canRoll}
      aria-label={canRoll ? 'Roll the dice' : face ? `Dice shows ${face}` : 'Dice'}
    >
      <svg viewBox="0 0 100 104" aria-hidden>
        <defs>
          <linearGradient id="die-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={shade(color, 0.3)} />
            <stop offset="0.55" stopColor={color} />
            <stop offset="1" stopColor={shade(color, -0.12)} />
          </linearGradient>
          <radialGradient id="die-pip" cx="0.4" cy="0.32" r="0.75">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.6" stopColor="#f1f2f5" />
            <stop offset="1" stopColor="#c9ccd4" />
          </radialGradient>
        </defs>
        <ellipse className="dice-shadow" cx={50} cy={99} rx={38} ry={4.5} fill="rgba(0,0,0,0.18)" />
        <g key={landed} className="dice-body">
          {/* The darker slab below gives the face some thickness; the band on top is the shine. */}
          <rect x={5} y={9} width={90} height={88} rx={22} fill={edge} />
          <rect x={5} y={3} width={90} height={88} rx={22} fill="url(#die-face)" stroke={edge} strokeWidth={1.5} />
          <rect x={13} y={8} width={74} height={30} rx={14} fill="rgba(255,255,255,0.22)" />
          {face !== null &&
            PIPS[face].map(([cx, cy]) => {
              const x = 26 + cx * 24;
              const y = 23 + cy * 24;
              const r = face === 1 ? 12 : 8.6;
              return (
                <g key={`${cx}${cy}`}>
                  <circle cx={x - 0.5} cy={y - 0.8} r={r + 1.2} fill={shade(color, -0.5)} />
                  <circle cx={x} cy={y} r={r} fill="url(#die-pip)" />
                  <ellipse cx={x - r * 0.25} cy={y - r * 0.36} rx={r * 0.38} ry={r * 0.22} fill="rgba(255,255,255,0.9)" />
                </g>
              );
            })}
        </g>
      </svg>
    </button>
  );
}

/** Shown instead of the dice after three sixes, while the player places their bomb. */
export function BombBadge({ color }: { color: string }) {
  return (
    <div className="dice bomb-badge" style={{ '--dice-color': color } as CSSProperties} role="img" aria-label="Bomb time">
      <svg viewBox="-56 -58 112 122" aria-hidden>
        <defs>
          <radialGradient id="badge-bomb" cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#6b6b6b" />
            <stop offset="0.45" stopColor="#2b2b2b" />
            <stop offset="1" stopColor="#080808" />
          </radialGradient>
        </defs>
        <ellipse cx={0} cy={54} rx={34} ry={6} fill="rgba(0,0,0,0.22)" />
        <g className="bomb-badge-body">
          <circle cx={0} cy={10} r={42} fill="#fff" stroke={color} strokeWidth={6} />
          <rect x={-10} y={-38} width={20} height={12} rx={3} fill="#444" />
          <circle cx={0} cy={10} r={34} fill="url(#badge-bomb)" />
          <ellipse cx={-12} cy={-4} rx={10} ry={6} fill="rgba(255,255,255,0.45)" />
          <path d="M0 -38 q10 -18 26 -14" fill="none" stroke="#a1887f" strokeWidth={4} strokeLinecap="round" />
          <circle className="bomb-spark" cx={27} cy={-52} r={7} fill="#ffca28" stroke="#ff6f00" strokeWidth={2} />
        </g>
      </svg>
    </div>
  );
}

/** Shown instead of the dice before the first roll, while everyone hides their magic box. */
export function BoxBadge({ color }: { color: string }) {
  return (
    <div className="dice box-badge" style={{ '--dice-color': color } as CSSProperties} role="img" aria-label="Magic box">
      <svg viewBox="-56 -58 112 122" aria-hidden>
        <defs>
          <linearGradient id="badge-box" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b388ff" />
            <stop offset="1" stopColor="#6a3de8" />
          </linearGradient>
          <linearGradient id="badge-lid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d9ccff" />
            <stop offset="1" stopColor="#9a7cf0" />
          </linearGradient>
        </defs>
        <ellipse cx={0} cy={54} rx={38} ry={6} fill="rgba(0,0,0,0.22)" />
        <g className="box-badge-body">
          <rect x={-36} y={-10} width={72} height={60} rx={8} fill="url(#badge-box)" stroke="#4527a0" strokeWidth={2.5} />
          <rect x={-44} y={-28} width={88} height={22} rx={7} fill="url(#badge-lid)" stroke="#4527a0" strokeWidth={2.5} />
          <rect x={-8} y={-28} width={16} height={78} fill={color} stroke={shade(color, -0.35)} strokeWidth={1.5} />
          <path d="M0 -28 c-26 -32 -44 -4 0 0 c44 -4 26 -32 0 0" fill={color} stroke={shade(color, -0.35)} strokeWidth={2} strokeLinejoin="round" />
          <text y={36} textAnchor="middle" className="box-badge-mark">
            ?
          </text>
        </g>
      </svg>
    </div>
  );
}
