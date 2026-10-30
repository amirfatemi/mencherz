import { COLOR_HEX, type Seat } from '../../../shared/board.ts';
import { HERO_KINDS, type Hero, type HeroKind } from '../../../shared/rules.ts';
import { HERO_LOOK } from '../heroes.ts';

/** The heroes' backgrounds, one gradient per kind (fixed ids, so nothing needs repainting when a hero changes). */
export function HeroDefs() {
  return (
    <>
      {HERO_KINDS.map((k) => (
        <radialGradient key={k} id={`hero-bg-${k}`} cx="0.38" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor={HERO_LOOK[k].light} />
          <stop offset="1" stopColor={HERO_LOOK[k].deep} />
        </radialGradient>
      ))}
      <radialGradient id="hero-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.55" stopColor="#fff59d" stopOpacity="0.9" />
        <stop offset="1" stopColor="#fff59d" stopOpacity="0" />
      </radialGradient>
    </>
  );
}

/** A hero's round medal, centred on 0,0: the character on its colours, with what it carries at the side. */
export function HeroMedal({ kind, r }: { kind: HeroKind; r: number }) {
  const look = HERO_LOOK[kind];
  return (
    <g className={`hero-medal ${kind}`}>
      <circle r={r} fill={`url(#hero-bg-${kind})`} stroke={look.deep} strokeWidth={r * 0.08} />
      <ellipse cx={-r * 0.28} cy={-r * 0.45} rx={r * 0.42} ry={r * 0.2} fill="rgba(255,255,255,0.45)" />
      <text className="hero-face" textAnchor="middle" dominantBaseline="central" y={r * 0.06} fontSize={r * 1.15}>
        {look.face}
      </text>
      <g transform={`translate(${r * 0.66} ${r * 0.62})`}>
        <circle r={r * 0.38} fill="#fff" stroke={look.deep} strokeWidth={r * 0.06} />
        <text textAnchor="middle" dominantBaseline="central" fontSize={r * 0.46}>
          {look.badge}
        </text>
      </g>
    </g>
  );
}

/** A hero's portrait for its card: the medal on a burst of light. */
export function HeroPortrait({ kind, size = 120 }: { kind: HeroKind; size?: number }) {
  const look = HERO_LOOK[kind];
  return (
    <svg className="hero-portrait" viewBox="-60 -60 120 120" width={size} height={size} aria-hidden>
      <defs>
        <HeroDefs />
      </defs>
      <g className="hero-rays">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M0 0 L-6 -58 L6 -58 Z" fill={look.light} opacity={0.55} transform={`rotate(${i * 30})`} />
        ))}
      </g>
      <circle r={50} fill="url(#hero-glow)" />
      <HeroMedal kind={kind} r={40} />
    </svg>
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

/** A hero on the board: its medal ringed in its player's colour, with the squares it has left. */
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
      {movable && <circle className="hero-ring" r={r + 7} fill="none" stroke="#ffeb3b" strokeWidth={3} />}
      <circle r={r + 3.5} fill="#fff" stroke={COLOR_HEX[seat]} strokeWidth={4} />
      <HeroMedal kind={hero.kind} r={r} />
      {hero.frozen > 0 && (
        <g pointerEvents="none">
          <circle r={r + 3} fill="rgba(129, 212, 250, 0.5)" />
          <text textAnchor="middle" dominantBaseline="central" fontSize={r * 0.8}>
            ❄️
          </text>
        </g>
      )}
      <g transform={`translate(${r * 0.8} ${-r * 0.85})`}>
        <circle r={r * 0.42} fill={look.deep} stroke="#fff" strokeWidth={2} />
        <text textAnchor="middle" dy="0.35em" fontSize={r * (hero.left > 9 ? 0.4 : 0.5)} fontWeight={700} fill="#fff">
          {hero.left}
        </text>
      </g>
      {hero.vests > 0 && (
        <text x={-r * 0.9} y={-r * 0.7} textAnchor="middle" dominantBaseline="central" fontSize={r * 0.6}>
          🦺
        </text>
      )}
    </g>
  );
}
