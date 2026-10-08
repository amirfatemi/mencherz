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

/** The two side faces shown next to each top face, as on a real die (opposite faces add up to 7). */
const SIDES: Record<number, [number, number]> = {
  1: [2, 3],
  2: [6, 3],
  3: [1, 5],
  4: [5, 1],
  5: [3, 6],
  6: [4, 2],
};

// Isometric cube: each face is a 100x100 square mapped onto one rhombus of a hexagon of radius R.
const R = 50;
const C = 0.866 * R;
const FACES = {
  top: `matrix(${C / 100} ${R / 200} ${-C / 100} ${R / 200} 0 ${-R})`,
  left: `matrix(${C / 100} ${R / 200} 0 ${R / 100} ${-C} ${-R / 2})`,
  right: `matrix(${C / 100} ${-R / 200} 0 ${R / 100} 0 0)`,
};
const HEX = `0,${-R} ${C},${-R / 2} ${C},${R / 2} 0,${R} ${-C},${R / 2} ${-C},${-R / 2}`;

function Face({ n, side, rim }: { n: number; side: keyof typeof FACES; rim: string }) {
  const big = n === 1;
  return (
    <g transform={FACES[side]}>
      <rect x={1.5} y={1.5} width={97} height={97} rx={14} fill={`url(#die-${side})`} />
      {PIPS[n].map(([cx, cy]) => {
        const x = 24 + cx * 26;
        const y = 24 + cy * 26;
        const r = big ? 17 : 11.2;
        return (
          <g key={`${cx}${cy}`}>
            {/* A sunken pip: a dark rim on the upper edge, a glossy white bead, and a spot of light. */}
            <circle cx={x} cy={y} r={r + 1.8} fill="rgba(255,255,255,0.35)" />
            <circle cx={x - 0.6} cy={y - 0.8} r={r + 0.6} fill={rim} />
            <circle cx={x} cy={y} r={r} fill="url(#die-pip)" />
            <ellipse cx={x - r * 0.25} cy={y - r * 0.36} rx={r * 0.4} ry={r * 0.22} fill="rgba(255,255,255,0.8)" />
          </g>
        );
      })}
    </g>
  );
}

interface Props {
  value: number | null;
  rolling: boolean;
  color: string;
  canRoll: boolean;
  onRoll?: () => void;
}

export function Dice({ value, rolling, color, canRoll, onRoll }: Props) {
  const [face, setFace] = useState(value ?? 6);
  const [landed, setLanded] = useState(0);

  useEffect(() => {
    if (!rolling) {
      if (value) setFace(value);
      setLanded((n) => n + 1);
      return;
    }
    const t = setInterval(() => setFace((f) => ((f + 1 + Math.floor(Math.random() * 5)) % 6) + 1), 70);
    return () => clearInterval(t);
  }, [rolling, value]);

  const [left, right] = SIDES[face];
  return (
    <button
      type="button"
      className={`dice${rolling ? ' rolling' : ''}${canRoll ? ' can-roll' : ''}${value === null && !rolling ? ' idle' : ''}`}
      style={{ '--dice-color': color } as CSSProperties}
      onClick={canRoll ? onRoll : undefined}
      disabled={!canRoll}
      aria-label={canRoll ? 'Roll the dice' : value ? `Dice shows ${value}` : 'Dice'}
    >
      <svg viewBox="-56 -58 112 122" aria-hidden>
        <defs>
          {/* The dice takes the colour of whoever rolls: lit from the top, darker on the right. */}
          <linearGradient id="die-top" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={shade(color, 0.42)} />
            <stop offset="1" stopColor={shade(color, 0.16)} />
          </linearGradient>
          <linearGradient id="die-left" x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stopColor={shade(color, 0.18)} />
            <stop offset="1" stopColor={shade(color, -0.1)} />
          </linearGradient>
          <linearGradient id="die-right" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={shade(color, -0.02)} />
            <stop offset="1" stopColor={shade(color, -0.3)} />
          </linearGradient>
          <radialGradient id="die-pip" cx="0.4" cy="0.32" r="0.75">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#f2f3f5" />
            <stop offset="1" stopColor="#c4c8d0" />
          </radialGradient>
        </defs>
        <ellipse className="dice-shadow" cx={0} cy={R + 4} rx={C * 0.95} ry={7} fill="rgba(0,0,0,0.22)" />
        <g key={landed} className="dice-body">
          {/* The rounded body behind the faces fills the seams so the edges look bevelled. */}
          <polygon points={HEX} fill={shade(color, -0.22)} stroke={shade(color, -0.22)} strokeWidth={7} strokeLinejoin="round" />
          <Face n={face} side="top" rim={shade(color, -0.55)} />
          <Face n={left} side="left" rim={shade(color, -0.55)} />
          <Face n={right} side="right" rim={shade(color, -0.55)} />
          <path d={`M${-C + 4} ${-R / 2 + 2} L0 -2 L${C - 4} ${-R / 2 + 2}`} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={2} strokeLinecap="round" />
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
