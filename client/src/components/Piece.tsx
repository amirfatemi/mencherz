import { memo } from 'react';
import { COLOR_DARK, COLOR_HEX, type Seat } from '../../../shared/board.ts';
import { shade } from '../color.ts';

/** Top-down airplane pointing up, spanning roughly -1..1. */
export const PLANE_PATH =
  'M0-1C.12-1 .15-.85.15-.7L.15-.25.95.15.95.32.15.1.12.6.42.8.42.93 0 .85-.42.93-.42.8-.12.6-.15.1-.95.32-.95.15-.15-.25-.15-.7C-.15-.85-.12-1 0-1Z';

export type PieceStyle = 'pawn' | 'plane';

/** Gradients the pawns use; render once inside the board's <defs>. */
export function PieceDefs() {
  return (
    <>
      {COLOR_HEX.map((c, s) => (
        <g key={s}>
          <linearGradient id={`pawn-body-${s}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={COLOR_DARK[s]} />
            <stop offset="0.35" stopColor={c} />
            <stop offset="0.55" stopColor={shade(c, 0.45)} />
            <stop offset="1" stopColor={COLOR_DARK[s]} />
          </linearGradient>
          <radialGradient id={`pawn-head-${s}`} cx="0.36" cy="0.32" r="0.75">
            <stop offset="0" stopColor={shade(c, 0.65)} />
            <stop offset="0.45" stopColor={c} />
            <stop offset="1" stopColor={COLOR_DARK[s]} />
          </radialGradient>
        </g>
      ))}
    </>
  );
}

interface Props {
  /** "seat:piece", exposed as data-key. */
  id?: string;
  seat: Seat;
  style: PieceStyle;
  x: number;
  y: number;
  /** Plane heading in degrees (0 = nose up); pawns ignore it. */
  angle: number;
  scale?: number;
  /** 0..1, how high the piece is hopping. */
  lift?: number;
  /** Extra rotation while being knocked out. */
  spin?: number;
  size: number;
  count?: number;
  movable?: boolean;
  ghost?: boolean;
  onClick?: () => void;
  onHover?: (on: boolean) => void;
  label?: string;
}

function Pawn({ seat, ghost }: { seat: Seat; ghost?: boolean }) {
  return (
    <g opacity={ghost ? 0.45 : 1}>
      <ellipse cy={0.5} rx={0.82} ry={0.32} fill="#fff" stroke="rgba(0,0,0,0.18)" strokeWidth={0.06} />
      <path
        d="M-.6.44C-.62.12-.27-.02-.22-.42H.22C.27-.02.62.12.6.44C.4.6-.4.6-.6.44Z"
        fill={`url(#pawn-body-${seat})`}
        stroke={COLOR_DARK[seat]}
        strokeWidth={0.06}
        strokeDasharray={ghost ? '0.14 0.1' : undefined}
      />
      <ellipse cy={-0.43} rx={0.34} ry={0.11} fill={`url(#pawn-body-${seat})`} stroke={COLOR_DARK[seat]} strokeWidth={0.05} />
      <circle cy={-0.8} r={0.39} fill={`url(#pawn-head-${seat})`} stroke={COLOR_DARK[seat]} strokeWidth={0.05} />
      {!ghost && <ellipse cx={-0.13} cy={-0.95} rx={0.12} ry={0.08} fill="#fff" opacity={0.7} />}
    </g>
  );
}

function Plane({ seat, angle, ghost }: { seat: Seat; angle: number; ghost?: boolean }) {
  return (
    <g transform={`rotate(${angle})`}>
      {!ghost && <path d={PLANE_PATH} fill="none" stroke={COLOR_DARK[seat]} strokeWidth={0.36} strokeLinejoin="round" />}
      <path
        d={PLANE_PATH}
        fill={ghost ? 'none' : COLOR_HEX[seat]}
        stroke={ghost ? COLOR_DARK[seat] : '#fff'}
        strokeWidth={ghost ? 0.1 : 0.14}
        strokeLinejoin="round"
        strokeDasharray={ghost ? '0.18 0.12' : undefined}
      />
      {!ghost && <ellipse cy={-0.55} rx={0.07} ry={0.16} fill="#fff" opacity={0.85} />}
    </g>
  );
}

export const Piece = memo(function Piece({
  id,
  seat,
  style,
  x,
  y,
  angle,
  scale = 1,
  lift = 0,
  spin = 0,
  size,
  count = 1,
  movable,
  ghost,
  onClick,
  onHover,
  label,
}: Props) {
  const pawn = style === 'pawn';
  const rise = lift * size * (pawn ? 1.1 : 0.4);
  // Pawns hop rather than climb, so they barely grow and don't tumble.
  const grow = pawn ? 1 + (scale - 1) * 0.35 : scale;
  return (
    <g
      className={`piece${movable ? ' movable' : ''}${ghost ? ' ghost' : ''}`}
      data-key={id}
      transform={`translate(${x} ${y})`}
      onClick={onClick}
      onPointerEnter={onHover && (() => onHover(true))}
      onPointerLeave={onHover && (() => onHover(false))}
      role={onClick ? 'button' : undefined}
      aria-label={label}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick && ((e) => (e.key === 'Enter' || e.key === ' ') && onClick())}
    >
      {movable &&
        (pawn ? (
          <ellipse className="piece-ring" cy={size * 0.5} rx={size * 1.15} ry={size * 0.55} stroke={COLOR_HEX[seat]} />
        ) : (
          <circle className="piece-ring" r={size * 1.1} stroke={COLOR_HEX[seat]} />
        ))}
      {!ghost && (lift > 0.02 || scale > 1.05) && (
        <ellipse
          className="piece-shadow"
          cy={pawn ? size * 0.55 : size * 0.5 + rise}
          rx={size * 0.8 * (1 - lift * 0.3)}
          ry={size * 0.3 * (1 - lift * 0.3)}
        />
      )}
      <g transform={`translate(0 ${-rise}) rotate(${pawn ? 0 : spin}) scale(${size * grow})`}>
        {pawn ? <Pawn seat={seat} ghost={ghost} /> : <Plane seat={seat} angle={angle} ghost={ghost} />}
      </g>
      {count > 1 && (
        <g transform={`translate(${size * 0.85} ${-size * (pawn ? 1.15 : 0.85) - rise})`} className="piece-count">
          <circle r={size * 0.5} fill="#fff" stroke={COLOR_DARK[seat]} strokeWidth={2} />
          <text textAnchor="middle" dy="0.35em" fontSize={size * 0.68} fill={COLOR_DARK[seat]}>
            {count}
          </text>
        </g>
      )}
      {onClick && <circle r={size * 1.2} fill="transparent" />}
    </g>
  );
});
