import { memo, useEffect, useMemo, useState } from 'react';
import {
  BOARD_SIZE,
  CENTER,
  COLOR_DARK,
  COLOR_HEX,
  COLOR_LIGHT,
  FLIGHT_FROM,
  FLIGHT_TO,
  GOAL,
  GOAL_TRIANGLES,
  HANGAR,
  HANGARS,
  HANGAR_CENTERS,
  HANGAR_SLOTS,
  HOME,
  SEATS,
  TAKEOFF_SQUARES,
  TRACK,
  TRACK_LAST,
  piecePoint,
  rotatePoint,
  rotateShape,
  trackColor,
  trackIndex,
  type Point,
  type Seat,
  type Shape,
} from '../../../shared/board.ts';
import type { SeatView } from '../../../shared/protocol.ts';
import { REACTION_BY_ID } from '../../../shared/reactions.ts';
import { POINTS } from '../../../shared/scoring.ts';
import { planMove, type GameState } from '../../../shared/rules.ts';
import { shade } from '../color.ts';
import { BOARD_PX, CELL, heading, restHeading, toPx } from '../geometry.ts';
import type { ActiveReaction, AnimFrame, Popup } from '../useRoomStream.ts';
import { PLANE_PATH, Piece, PieceDefs, type PieceStyle } from './Piece.tsx';
import { ReactionArt } from './Reaction.tsx';

const PIECE_SIZE = CELL * 0.42;
/** Without hover, the first tap on a piece shows its move and the second makes it. */
export const TOUCH = typeof matchMedia === 'function' && !matchMedia('(hover: hover)').matches;
const SPOT_R = CELL * 0.34;
const px = (p: Point) => ({ x: p.x * CELL, y: p.y * CELL });

function ShapeEl({ s, fill, stroke, strokeWidth = 1.5, inset = 0, rx = 7 }: { s: Shape; fill: string; stroke?: string; strokeWidth?: number; inset?: number; rx?: number }) {
  if (s.kind === 'rect') {
    return (
      <rect
        x={s.x0 * CELL + inset}
        y={s.y0 * CELL + inset}
        width={(s.x1 - s.x0) * CELL - inset * 2}
        height={(s.y1 - s.y0) * CELL - inset * 2}
        rx={rx}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }
  return (
    <polygon
      points={s.pts.map((p) => `${p.x * CELL},${p.y * CELL}`).join(' ')}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
  );
}

function Spot({ at, r = SPOT_R }: { at: Point; r?: number }) {
  const p = px(at);
  return <circle cx={p.x} cy={p.y} r={r} fill="url(#spot)" stroke="rgba(0,0,0,0.14)" strokeWidth={1} />;
}

function Chevron({ at, angle, color, size = 6, width = 2.6 }: { at: Point; angle: number; color: string; size?: number; width?: number }) {
  const p = px(at);
  return (
    <path
      d={`M${-size} ${size * 0.45}L0 ${-size * 0.55}L${size} ${size * 0.45}`}
      transform={`translate(${p.x} ${p.y}) rotate(${angle})`}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function Defs() {
  return (
    <defs>
      <radialGradient id="spot" cx="0.4" cy="0.35" r="0.7">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.7" stopColor="#f6f6f6" />
        <stop offset="1" stopColor="#dedede" />
      </radialGradient>
      <radialGradient id="hub" cx="0.4" cy="0.35" r="0.75">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#e3e3e3" />
      </radialGradient>
      {COLOR_HEX.map((c, s) => (
        <g key={s}>
          <linearGradient id={`sq-${s}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={shade(c, 0.28)} />
            <stop offset="0.55" stopColor={c} />
            <stop offset="1" stopColor={shade(c, -0.12)} />
          </linearGradient>
          <linearGradient id={`hangar-${s}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={shade(c, 0.22)} />
            <stop offset="1" stopColor={shade(c, -0.14)} />
          </linearGradient>
          <linearGradient id={`panel-${s}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={shade(c, 0.42)} />
            <stop offset="1" stopColor={shade(c, 0.6)} />
          </linearGradient>
        </g>
      ))}
      <filter id="lift" x="-10%" y="-10%" width="120%" height="125%">
        <feDropShadow dx="0" dy="1.6" stdDeviation="1.1" floodColor="#5a4320" floodOpacity="0.28" />
      </filter>
      <linearGradient id="box-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#b388ff" />
        <stop offset="1" stopColor="#7c4dff" />
      </linearGradient>
      <linearGradient id="box-lid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d1c4e9" />
        <stop offset="1" stopColor="#9575cd" />
      </linearGradient>
      <radialGradient id="bomb-body" cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#6b6b6b" />
        <stop offset="0.45" stopColor="#2b2b2b" />
        <stop offset="1" stopColor="#080808" />
      </radialGradient>
      <filter id="piece-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="1.2" floodOpacity="0.32" />
      </filter>
      <PieceDefs />
    </defs>
  );
}

/** The printed board, drawn already rotated so the light always comes from the top. */
const BoardBase = memo(function BoardBase({ rot, active, turn }: { rot: number; active: Seat[]; turn: Seat | null }) {
  const R = (p: Point) => rotatePoint(p, rot);
  const RS = (s: Shape) => rotateShape(s, rot);
  const center = RS(CENTER);
  const mid = BOARD_PX / 2;

  return (
    <g>
      <rect width={BOARD_PX} height={BOARD_PX} rx={22} fill="#f6eedd" />
      <rect x={3} y={3} width={BOARD_PX - 6} height={BOARD_PX - 6} rx={20} fill="none" stroke="#e4d5b6" strokeWidth={2} />

      {SEATS.map((s) => {
        const h = RS(HANGARS[s]);
        if (h.kind !== 'rect') return null;
        const on = active.includes(s);
        return (
          <g key={s} opacity={on ? 1 : 0.45}>
            {turn === s && <ShapeEl s={h} fill="none" stroke={COLOR_HEX[s]} strokeWidth={10} inset={2} rx={20} />}
            <g filter="url(#lift)">
              <ShapeEl s={h} fill={`url(#hangar-${s})`} stroke={COLOR_DARK[s]} strokeWidth={2} inset={CELL * 0.06} rx={18} />
            </g>
            <ShapeEl s={h} fill={`url(#panel-${s})`} stroke={shade(COLOR_DARK[s], 0.2)} strokeWidth={1.5} inset={CELL * 0.5} rx={12} />
            {HANGAR_SLOTS[s].map((slot, j) => {
              const p = px(R(slot));
              return <circle key={j} cx={p.x} cy={p.y} r={CELL * 0.4} fill="rgba(255,255,255,0.45)" stroke="#fff" strokeWidth={2.5} />;
            })}
            {turn === s && <ShapeEl s={h} fill="none" stroke="#fff" strokeWidth={3} inset={CELL * 0.06} rx={18} />}
          </g>
        );
      })}

      <g filter="url(#lift)">
        {TRACK.map((sq, i) => (
          <ShapeEl key={i} s={RS(sq.shape)} fill={`url(#sq-${trackColor(i)})`} stroke={shade(COLOR_DARK[trackColor(i)], -0.1)} strokeWidth={1.2} inset={0.6} />
        ))}
        {SEATS.map((s) =>
          HOME[s].map((sq, k) => (
            <ShapeEl key={`${s}-${k}`} s={RS(sq.shape)} fill={`url(#sq-${s})`} stroke={shade(COLOR_DARK[s], -0.1)} strokeWidth={1.2} inset={0.6} />
          )),
        )}
        {SEATS.map((s) => (
          <ShapeEl key={s} s={RS(TAKEOFF_SQUARES[s].shape)} fill={shade(COLOR_LIGHT[s], 0.45)} stroke={shade(COLOR_HEX[s], 0.2)} strokeWidth={1.2} inset={0.6} />
        ))}
        {center.kind === 'rect' &&
          SEATS.map((s) => (
            <polygon
              key={s}
              points={GOAL_TRIANGLES[s].map((p) => `${R(p).x * CELL},${R(p).y * CELL}`).join(' ')}
              fill={`url(#sq-${s})`}
              stroke="#fff"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
          ))}
      </g>

      {TRACK.map((sq, i) => (
        <Spot key={i} at={R(sq.spot)} r={sq.shape.kind === 'tri' ? SPOT_R * 0.9 : SPOT_R} />
      ))}
      {SEATS.map((s) => HOME[s].map((sq, k) => <Spot key={`${s}-${k}`} at={R(sq.spot)} r={SPOT_R * 0.88} />))}
      <circle cx={mid} cy={mid} r={CELL * 0.55} fill="url(#hub)" stroke="rgba(0,0,0,0.12)" strokeWidth={1.5} filter="url(#lift)" />

      {SEATS.map((s) => {
        const takeoff = R(TAKEOFF_SQUARES[s].spot);
        const first = R(TRACK[trackIndex(s, 1)].spot);
        const tip = R(TRACK[trackIndex(s, TRACK_LAST)].spot);
        const h1 = R(HOME[s][0].spot);
        const from = R(TRACK[trackIndex(s, FLIGHT_FROM)].spot);
        const to = R(TRACK[trackIndex(s, FLIGHT_TO)].spot);
        const a = px(from);
        const b = px(to);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        const trim = CELL * 0.5;
        const fly = heading(from, to);
        const t = px(takeoff);
        return (
          <g key={s}>
            <circle cx={t.x} cy={t.y} r={SPOT_R * 0.95} fill="#fff" stroke={COLOR_HEX[s]} strokeWidth={2.5} strokeDasharray="4 3" />
            <Chevron at={takeoff} angle={heading(takeoff, first)} color={COLOR_HEX[s]} size={5} />
            <Chevron at={tip} angle={heading(tip, h1)} color={COLOR_HEX[s]} size={6.5} width={3} />
            <line
              x1={a.x + ux * trim}
              y1={a.y + uy * trim}
              x2={b.x - ux * trim}
              y2={b.y - uy * trim}
              stroke={COLOR_HEX[s]}
              strokeWidth={3}
              strokeDasharray="2 7"
              strokeLinecap="round"
              opacity={0.9}
            />
            {[0.3, 0.5, 0.7].map((f) => (
              <Chevron key={f} at={{ x: (a.x + (b.x - a.x) * f) / CELL, y: (a.y + (b.y - a.y) * f) / CELL }} angle={fly} color={COLOR_DARK[s]} size={4.5} width={2.4} />
            ))}
            <path d={PLANE_PATH} transform={`translate(${a.x} ${a.y}) rotate(${fly}) scale(${CELL * 0.22})`} fill={COLOR_DARK[s]} />
          </g>
        );
      })}
    </g>
  );
});

/** A cartoon bomb, ringed in its owner's colour. */
function BombIcon({ x, y, owner, ghost }: { x: number; y: number; owner: Seat; ghost?: boolean }) {
  const r = CELL * 0.27;
  return (
    <g className={ghost ? 'bomb ghost' : 'bomb'} transform={`translate(${x} ${y})`} pointerEvents="none">
      <g className="bomb-body">
        <circle r={r + 3} fill="#fff" stroke={COLOR_HEX[owner]} strokeWidth={3} />
        <rect x={-r * 0.32} y={-r * 1.18} width={r * 0.64} height={r * 0.4} rx={1.5} fill="#444" />
        <circle r={r} fill="url(#bomb-body)" />
        <ellipse cx={-r * 0.35} cy={-r * 0.38} rx={r * 0.3} ry={r * 0.2} fill="rgba(255,255,255,0.5)" />
        <path d={`M0 ${-r * 1.15} q${r * 0.3} ${-r * 0.55} ${r * 0.85} ${-r * 0.45}`} fill="none" stroke="#a1887f" strokeWidth={2} strokeLinecap="round" />
        <circle className="bomb-spark" cx={r * 0.85} cy={-r * 1.6} r={3} fill="#ffca28" stroke="#ff6f00" strokeWidth={1} />
      </g>
    </g>
  );
}

/** A wrapped present with a question mark: its owner's colour on the ribbon. */
function BoxIcon({ x, y, owner, ghost }: { x: number; y: number; owner: Seat; ghost?: boolean }) {
  const w = CELL * 0.5;
  const c = COLOR_HEX[owner];
  return (
    <g className={ghost ? 'magic-box ghost' : 'magic-box'} transform={`translate(${x} ${y})`} pointerEvents="none">
      <g className="magic-box-body">
        <rect x={-w / 2} y={-w * 0.32} width={w} height={w * 0.78} rx={3} fill="url(#box-body)" stroke="#5e35b1" strokeWidth={1.5} />
        <rect x={-w * 0.58} y={-w * 0.52} width={w * 1.16} height={w * 0.3} rx={3} fill="url(#box-lid)" stroke="#5e35b1" strokeWidth={1.5} />
        <rect x={-w * 0.1} y={-w * 0.52} width={w * 0.2} height={w * 0.98} fill={c} />
        <path d={`M0 ${-w * 0.52} c${-w * 0.35} ${-w * 0.45} ${-w * 0.55} ${-w * 0.05} 0 0 c${w * 0.55} ${-w * 0.05} ${w * 0.35} ${-w * 0.45} 0 0`} fill="none" stroke={c} strokeWidth={3} strokeLinejoin="round" />
        <text y={w * 0.32} className="magic-box-mark" textAnchor="middle">
          ?
        </text>
      </g>
    </g>
  );
}

interface BoardProps {
  game: GameState;
  seats: SeatView[];
  anim: AnimFrame | null;
  /** Pieces the viewer may move right now. */
  movable: number[];
  pieceStyle: PieceStyle;
  popups: Popup[];
  reactions: ActiveReaction[];
  /** Squares the viewer may drop a bomb or hide a magic box on right now. */
  targets: number[];
  targetKind: 'bomb' | 'box';
  onMove: (piece: number) => void;
  onTarget: (square: number) => void;
}

interface Item {
  key: string;
  seat: Seat;
  pieces: number[];
  x: number;
  y: number;
  angle: number;
  scale: number;
  lift: number;
  spin: number;
  animated: boolean;
}

const pct = (v: number) => `${(v / BOARD_SIZE) * 100}%`;

/** Reaction GIFs sit on top of the board over their seat's hangar, as large as fits without cropping. */
function ReactionLayer({ reactions, rot }: { reactions: ActiveReaction[]; rot: number }) {
  return (
    <>
      {reactions.map((r) => {
        const h = rotateShape(HANGARS[r.seat], rot);
        const gif = REACTION_BY_ID.get(r.id);
        if (h.kind !== 'rect' || !gif) return null;
        const box = h.x1 - h.x0 - 0.12;
        const w = gif.w >= gif.h ? box : (box * gif.w) / gif.h;
        const ht = gif.w >= gif.h ? (box * gif.h) / gif.w : box;
        const cx = (h.x0 + h.x1) / 2;
        const cy = (h.y0 + h.y1) / 2;
        return (
          <div
            key={r.key}
            className="reaction-bubble"
            style={{ left: pct(cx - w / 2), top: pct(cy - ht / 2), width: pct(w), height: pct(ht), borderColor: COLOR_HEX[r.seat] }}
          >
            <ReactionArt id={r.id} />
          </div>
        );
      })}
    </>
  );
}

export function Board({ game, seats, anim, movable, pieceStyle, popups, reactions, targets, targetKind, onMove, onTarget }: BoardProps) {
  // Everyone sees the board the same way round (yellow top-left, red bottom-left), on every device.
  const rot = 0;
  const [hover, setHover] = useState<number | null>(null);
  const [bombHover, setBombHover] = useState<number | null>(null);
  const hovered = hover !== null && movable.includes(hover) ? hover : null;
  useEffect(() => {
    setHover(null);
    setBombHover(null);
  }, [game.seq]);

  const preview = useMemo(
    () => (hovered !== null && game.dice ? planMove(game, game.turn, hovered, game.dice) : null),
    [game, hovered],
  );

  // Planes of one colour on one square are drawn as a single piece with a count, so one leaving never shifts the other.
  const items = useMemo(() => {
    const out: Item[] = [];
    const groups = new Map<string, Item>();
    for (const seat of game.active) {
      game.pieces[seat].forEach((pos, piece) => {
        const o = anim?.pieces.get(`${seat}:${piece}`);
        if (o) {
          const p = toPx(o, rot);
          out.push({ key: `${seat}:${piece}:moving`, seat, pieces: [piece], x: p.x, y: p.y, angle: o.angle + rot * 90, scale: o.scale, lift: o.lift, spin: o.spin, animated: true });
          return;
        }
        const p = toPx(piecePoint(seat, piece, pos), rot);
        const base = { seat, x: p.x, y: p.y, angle: restHeading(seat, piece, pos) + rot * 90, scale: 1, lift: 0, spin: 0, animated: false };
        if (pos === HANGAR) {
          out.push({ ...base, key: `${seat}:hangar:${piece}`, pieces: [piece] });
          return;
        }
        const gk = `${seat}:at:${pos}`;
        const g = groups.get(gk);
        if (g) g.pieces.push(piece);
        else {
          const item = { ...base, key: gk, pieces: [piece] };
          groups.set(gk, item);
          out.push(item);
        }
      });
    }
    const canMove = (it: Item) => !it.animated && it.seat === game.turn && it.pieces.some((p) => movable.includes(p));
    return out.sort((a, b) => Number(a.animated) - Number(b.animated) || Number(canMove(a)) - Number(canMove(b)) || a.y - b.y);
  }, [game, anim, rot, movable]);

  const labels = SEATS.map((s) => {
    const c = toPx(HANGAR_CENTERS[s], rot);
    const off = CELL * 1.53;
    return { s, x: c.x, y: c.y < BOARD_PX / 2 ? c.y - off : c.y + off };
  });

  return (
    <div className="board-stack">
      <svg className="board" viewBox={`0 0 ${BOARD_PX} ${BOARD_PX}`} role="img" aria-label="Game board">
        <Defs />
        <BoardBase rot={rot} active={game.active} turn={game.phase === 'over' ? null : game.turn} />

        {labels.map(({ s, x, y }) => {
          if (!game.active.includes(s)) return null;
          const seat = seats[s];
          const rank = game.standings.indexOf(s);
          const medal = game.phase === 'over' && rank >= 0 ? `${['🥇', '🥈', '🥉', '4th'][rank]} ` : '';
          const name = seat?.name ?? (seat?.kind === 'bot' ? `Bot · ${seat.botLevel}` : '');
          return (
            <text key={s} x={x} y={y} className="hangar-label" textAnchor="middle" dominantBaseline="central">
              {medal}
              {name.length > 13 ? `${name.slice(0, 12)}…` : name}
              {seat?.kind === 'bot' && !seat.left ? ' 🤖' : ''}
              {game.vests?.[s] ? ` 🦺${game.vests[s] > 1 ? `×${game.vests[s]}` : ''}` : ''}
            </text>
          );
        })}

        {preview && (
          <g className="preview" pointerEvents="none">
            {preview.path.map((step, i) => {
              const p = toPx(piecePoint(preview.seat, preview.piece, step.pos), rot);
              const big = step.kind !== 'step' && step.kind !== 'bounce';
              return <circle key={i} cx={p.x} cy={p.y} r={big ? 7 : 4.5} fill={COLOR_DARK[preview.seat]} stroke="#fff" strokeWidth={1.5} />;
            })}
            {preview.captures.map((c) => {
              const p = toPx(piecePoint(c.seat, c.piece, c.from), rot);
              return (
                <g key={`${c.seat}:${c.piece}`}>
                  <circle cx={p.x} cy={p.y} r={CELL * 0.5} fill="none" stroke="#d50000" strokeWidth={4} className="threat" />
                  <text x={p.x} y={p.y - CELL * 0.75} className="preview-points" textAnchor="middle">
                    {c.revenge ? '⚔️ ' : ''}+{c.points}
                  </text>
                </g>
              );
            })}
            {preview.box &&
              (() => {
                const b = toPx(TRACK[preview.box.square].spot, rot);
                return (
                  <text x={b.x} y={b.y - CELL * 0.8} className="preview-points mystery" textAnchor="middle">
                    🎁 ?
                  </text>
                );
              })()}
            {preview.bombed?.saved &&
              (() => {
                const b = toPx(TRACK[preview.bombed.square].spot, rot);
                return (
                  <text x={b.x} y={b.y - CELL * 0.8} className="preview-points" textAnchor="middle">
                    🦺 safe
                  </text>
                );
              })()}
            {(() => {
              if (preview.bombed && !preview.bombed.saved) {
                const b = toPx(TRACK[preview.bombed.square].spot, rot);
                return (
                  <>
                    <circle cx={b.x} cy={b.y} r={CELL * 0.55} fill="none" stroke="#d50000" strokeWidth={4} className="threat" />
                    <text x={b.x} y={b.y - CELL * 0.8} className="preview-points danger" textAnchor="middle">
                      💣 back to hangar
                    </text>
                  </>
                );
              }
              const p = toPx(piecePoint(preview.seat, preview.piece, preview.to), rot);
              return (
                <>
                  {preview.to === GOAL && (
                    <text x={p.x} y={p.y - CELL * 0.85} className="preview-points" textAnchor="middle">
                      +{POINTS.home}
                    </text>
                  )}
                  <Piece
                    seat={preview.seat}
                    style={pieceStyle}
                    x={p.x}
                    y={p.y}
                    angle={restHeading(preview.seat, preview.piece, preview.to) + rot * 90}
                    size={PIECE_SIZE}
                    ghost
                  />
                </>
              );
            })()}
          </g>
        )}

        {(game.boxes ?? []).map((b) => {
          const p = toPx(TRACK[b.square].spot, rot);
          return <BoxIcon key={`box${b.square}`} x={p.x} y={p.y} owner={b.owner} />;
        })}
        {game.bombs.map((b) => {
          const p = toPx(TRACK[b.square].spot, rot);
          return <BombIcon key={b.square} x={p.x} y={p.y} owner={b.owner} />;
        })}

        <g filter="url(#piece-shadow)">
          {items.map((it) => {
            const mover = !it.animated && it.seat === game.turn ? it.pieces.find((p) => movable.includes(p)) : undefined;
            const canMove = mover !== undefined;
            return (
              <Piece
                key={it.key}
                id={it.pieces.map((p) => `${it.seat}:${p}`).join(' ')}
                seat={it.seat}
                style={pieceStyle}
                x={it.x}
                y={it.y}
                angle={it.angle}
                scale={it.scale}
                lift={it.lift}
                spin={it.spin}
                size={PIECE_SIZE}
                count={it.pieces.length}
                movable={canMove}
                onClick={canMove ? () => (TOUCH && hovered !== mover ? setHover(mover) : onMove(mover)) : undefined}
                onHover={canMove && !TOUCH ? (on) => setHover(on ? mover : null) : undefined}
                label={canMove ? `Move piece ${mover + 1}${it.pieces.length > 1 ? ` (${it.pieces.length} here)` : ''}` : undefined}
              />
            );
          })}
        </g>

        {targets.length > 0 && (
          <g className={`bomb-targets ${targetKind}`}>
            {targets.map((sq) => (
              <g
                key={sq}
                className={`bomb-target${bombHover === sq ? ' on' : ''}`}
                onClick={() => (TOUCH && bombHover !== sq ? setBombHover(sq) : onTarget(sq))}
                onPointerEnter={TOUCH ? undefined : () => setBombHover(sq)}
                onPointerLeave={TOUCH ? undefined : () => setBombHover((h) => (h === sq ? null : h))}
                role="button"
                aria-label={`${targetKind === 'box' ? 'Hide the magic box' : 'Drop the bomb'} on square ${sq + 1}`}
              >
                <ShapeEl
                  s={rotateShape(TRACK[sq].shape, rot)}
                  fill="rgba(255,255,255,0.01)"
                  stroke={targetKind === 'box' ? '#7c4dff' : '#d50000'}
                  strokeWidth={2}
                  inset={2.5}
                  rx={6}
                />
              </g>
            ))}
            {bombHover !== null &&
              (() => {
                const p = toPx(TRACK[bombHover].spot, rot);
                return targetKind === 'box' ? (
                  <BoxIcon x={p.x} y={p.y} owner={game.turn} ghost />
                ) : (
                  <BombIcon x={p.x} y={p.y} owner={game.turn} ghost />
                );
              })()}
          </g>
        )}

        {popups.map((pop) => {
          const p = toPx(pop, rot);
          return (
            <text key={pop.id} x={p.x} y={p.y - CELL * 0.4} className="score-pop" textAnchor="middle" fill={COLOR_HEX[pop.seat]} pointerEvents="none">
              {pop.text}
            </text>
          );
        })}

        {anim?.effects.map((e, i) => {
          const p = toPx(e, rot);
          return (
            <g key={i} transform={`translate(${p.x} ${p.y}) scale(${0.6 + e.t * 1.2})`} opacity={1 - e.t} pointerEvents="none">
              <path d="M0-20 5-7 19-10 9 1 17 14 3 8 0 21-4 8-17 14-9 1-19-10-5-7Z" fill="#ffca28" stroke="#ff6f00" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
      <ReactionLayer reactions={reactions} rot={rot} />
    </div>
  );
}
