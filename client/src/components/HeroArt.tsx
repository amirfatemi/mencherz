import { COLOR_HEX, type Seat } from '../../../shared/board.ts';
import { HERO_KINDS, type Hero, type HeroKind } from '../../../shared/rules.ts';
import { shade } from '../color.ts';
import benchFace from '../assets/heroes/bench.webp';
import { HERO_FACE, HERO_LOOK } from '../heroes.ts';

/** The heroes' rings and badges, one gradient each per kind (fixed ids, so nothing needs repainting when a hero changes). */
export function HeroDefs() {
  return (
    <>
      {HERO_KINDS.map((k) => (
        <linearGradient key={`ring${k}`} id={`hero-ring-${k}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(HERO_LOOK[k].ring, 0.35)} />
          <stop offset="0.5" stopColor={HERO_LOOK[k].ring} />
          <stop offset="1" stopColor={shade(HERO_LOOK[k].ring, -0.3)} />
        </linearGradient>
      ))}
      {HERO_KINDS.map((k) => (
        <radialGradient key={`badge${k}`} id={`hero-badge-${k}`} cx="0.4" cy="0.3" r="0.75">
          <stop offset="0" stopColor={shade(HERO_LOOK[k].ring, 0.15)} />
          <stop offset="1" stopColor={shade(HERO_LOOK[k].ring, -0.4)} />
        </radialGradient>
      ))}
      {HERO_KINDS.map((k) => (
        <radialGradient key={`face${k}`} id={`hero-face-${k}`} cx="0.45" cy="0.35" r="0.7">
          <stop offset="0" stopColor={HERO_LOOK[k].light} />
          <stop offset="1" stopColor={HERO_LOOK[k].deep} />
        </radialGradient>
      ))}
    </>
  );
}

/** Each hero's sign, drawn in white on its badge; `size` places it centred on 0,0 inside an SVG. */
export function HeroIcon({ kind, size }: { kind: HeroKind; size?: number }) {
  const line = { fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...(size ? { width: size, height: size, x: -size / 2, y: -size / 2 } : {})}>
      {kind === 'guardian' && (
        <>
          <path d="M12 2.5 19.5 5.4V11c0 4.9-3.1 8.6-7.5 10.4C7.6 19.6 4.5 15.9 4.5 11V5.4Z" {...line} fill="#fff" fillOpacity={0.18} />
          <path d="M12 3v18" {...line} />
        </>
      )}
      {kind === 'engineer' && (
        <>
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x={10.7} y={1.6} width={2.6} height={4.2} rx={0.8} fill="#fff" transform={`rotate(${i * 45} 12 12)`} />
          ))}
          <circle cx={12} cy={12} r={6.2} {...line} strokeWidth={2.6} />
          <circle cx={12} cy={12} r={2.2} fill="#fff" />
        </>
      )}
      {kind === 'archer' && (
        <g transform="rotate(-45 12 12)">
          <path d="M9 2.5c6 2.5 6 16.5 0 19" {...line} />
          <path d="M9 2.5v19" {...line} strokeWidth={1.1} />
          <path d="M3 12h17.5M20.5 12l-3-2.4M20.5 12l-3 2.4M3 12l-1.5-1.8M3 12l-1.5 1.8" {...line} />
        </g>
      )}
      {kind === 'frost' &&
        [0, 60, 120].map((a) => (
          <g key={a} transform={`rotate(${a} 12 12)`}>
            <path d="M12 2v20M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" {...line} />
          </g>
        ))}
      {kind === 'thief' && (
        <>
          <path d="M9 3.5h6l-1.6 3h-2.8Z" fill="#fff" />
          <path d="M10 6.5C5.5 8.5 4 12.5 4.5 16c.5 3.3 3.4 5 7.5 5s7-1.7 7.5-5c.5-3.5-1-7.5-5.5-9.5Z" {...line} fill="#fff" fillOpacity={0.18} />
          <text x={12} y={17.6} textAnchor="middle" fontSize={9} fontWeight={800} fill="#fff">
            $
          </text>
        </>
      )}
      {kind === 'wizard' && (
        <>
          <path d="M4 20.5 14.5 10" {...line} strokeWidth={2.6} />
          <path d="M17 2.5l1.2 2.8 3 .3-2.3 2 .7 2.9-2.6-1.5-2.6 1.5.7-2.9-2.3-2 3-.3Z" fill="#fff" />
          <path d="M6 6.5v2M5 7.5h2M19.5 15.5v2M18.5 16.5h2" {...line} strokeWidth={1.4} />
        </>
      )}
      {kind === 'death' && (
        <>
          <path d="M8 21.5 15.5 3" {...line} strokeWidth={2.2} />
          <path d="M14.8 4.6C10.5 3 5.6 4.3 3 8.2c3.2-1.6 7.4-1.6 10.7.3Z" fill="#fff" stroke="#fff" strokeWidth={1} strokeLinejoin="round" />
        </>
      )}
      {kind === 'rider' && (
        <path
          d="M12 2.5c.8 3.4 5.5 5.5 5.5 11a5.5 5.5 0 0 1-11 0c0-2.6 1.4-4.4 2.6-5.6.1 1.8.9 3 2 3.4-.4-3.3-.3-5.9.9-8.8Z"
          {...line}
          fill="#fff"
          fillOpacity={0.25}
        />
      )}
    </svg>
  );
}

/**
 * A hero's round medal, centred on 0,0: its portrait (radius r) in a glossy ring of its colour, with its sign on a
 * gold-rimmed badge at the bottom right.
 */
export function HeroMedal({ kind, r }: { kind: HeroKind; r: number }) {
  const face = HERO_FACE[kind];
  const look = HERO_LOOK[kind];
  return (
    <g className={`hero-medal ${kind}`}>
      <circle r={r * 1.24} fill="rgba(0,0,0,0.28)" />
      <circle r={r * 1.12} fill="none" stroke={`url(#hero-ring-${kind})`} strokeWidth={r * 0.24} />
      {face ? (
        <image href={face} x={-r} y={-r} width={r * 2} height={r * 2} />
      ) : (
        // No portrait yet: its emoji on its colours.
        <>
          <circle r={r} fill={`url(#hero-face-${kind})`} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={r * 1.15}>
            {look.face}
          </text>
        </>
      )}
      <circle r={r} fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth={r * 0.05} />
      <path d={`M${-r * 0.95} ${-r * 0.55}A${r * 1.12} ${r * 1.12} 0 0 1 ${r * 0.55} ${-r * 0.97}`} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={r * 0.07} strokeLinecap="round" />
      <g transform={`translate(${r * 0.8} ${r * 0.76})`}>
        <circle r={r * 0.44} fill={`url(#hero-badge-${kind})`} stroke="#f3c35a" strokeWidth={r * 0.1} />
        <HeroIcon kind={kind} size={r * 0.5} />
      </g>
    </g>
  );
}

interface TokenProps {
  hero: Hero;
  seat: Seat;
  x: number;
  y: number;
  r: number;
  movable?: boolean;
  onClick?: () => void;
  onHover?: (on: boolean) => void;
}

/**
 * A hero on the board: its medal, with the squares it has left on a badge at the top right, and a thin outer ring
 * in its player's colour, so it's clear whose it is.
 */
export function HeroToken({ hero, seat, x, y, r, movable, onClick, onHover }: TokenProps) {
  const look = HERO_LOOK[hero.kind];
  return (
    <g
      className={`hero-token${movable ? ' movable' : ''}${hero.frozen ? ' frozen' : ''}`}
      transform={`translate(${x} ${y})`}
      onClick={onClick}
      onPointerEnter={onHover ? () => onHover(true) : undefined}
      onPointerLeave={onHover ? () => onHover(false) : undefined}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? `Move the ${look.en}` : undefined}
      pointerEvents={onClick ? undefined : 'none'}
    >
      <title>{`${look.fa} · ${look.en} — ${hero.left} squares left`}</title>
      {movable && <circle className="hero-ring" r={r * 1.24 + 6} fill="none" stroke="#ffeb3b" strokeWidth={3} />}
      <circle r={r * 1.24 + 2} fill="none" stroke={COLOR_HEX[seat]} strokeWidth={3} />
      <HeroMedal kind={hero.kind} r={r} />
      {hero.frozen > 0 && (
        <g pointerEvents="none">
          <circle r={r * 1.2} fill="rgba(129, 212, 250, 0.55)" />
          <text textAnchor="middle" dominantBaseline="central" fontSize={r * 0.9}>
            ❄️
          </text>
        </g>
      )}
      <g transform={`translate(${r * 0.86} ${-r * 0.9})`}>
        <circle r={r * 0.5} fill={look.dark} stroke="#fff" strokeWidth={r * 0.09} />
        <text textAnchor="middle" dy="0.36em" fontSize={r * (hero.left > 9 ? 0.52 : 0.62)} fontWeight={800} fill="#fff">
          {hero.left}
        </text>
      </g>
      {hero.vests > 0 && (
        <text x={-r * 0.95} y={-r * 0.8} textAnchor="middle" dominantBaseline="central" fontSize={r * 0.7}>
          🦺
        </text>
      )}
    </g>
  );
}

interface BenchProps {
  x: number;
  y: number;
  r: number;
  movable?: boolean;
  onClick?: () => void;
}

/**
 * The fifth piece, waiting in its player's hangar while none of their heroes is out: a gold-ringed hero medal.
 * When the roll can launch it, it glows, and a tap shows their heroes to pick from.
 */
export function HeroBench({ x, y, r, movable, onClick }: BenchProps) {
  return (
    <g
      className={`hero-bench${movable ? ' movable' : ''}`}
      transform={`translate(${x} ${y})`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? 'Bring on a hero' : undefined}
      pointerEvents={onClick ? undefined : 'none'}
    >
      <title>{movable ? 'Bring on one of your heroes instead of a piece' : 'Your heroes: a roll that launches a piece can bring one on instead'}</title>
      {movable && <circle className="hero-ring" r={r * 1.24 + 5} fill="none" stroke="#ffeb3b" strokeWidth={3} />}
      <circle r={r * 1.22} fill="rgba(0,0,0,0.25)" />
      <image href={benchFace} x={-r * 1.24} y={-r * 1.24} width={r * 2.48} height={r * 2.48} />
    </g>
  );
}
