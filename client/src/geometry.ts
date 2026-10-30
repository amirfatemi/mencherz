import { BOARD_SIZE, GOAL, HANGAR, HOME_CELLS, HOME_FIRST, TAKEOFF, TRACK_CELLS, piecePoint, rotatePoint, type Point, type Seat } from '../../shared/board.ts';
import { DRAGON_PATH, HERO } from '../../shared/rules.ts';

export const CELL = 40;
export const BOARD_PX = CELL * BOARD_SIZE;

/** Where the dragon stands, in board grid units, at this point along its route. */
export function dragonPoint(at: number): Point {
  const cell = DRAGON_PATH[((at % DRAGON_PATH.length) + DRAGON_PATH.length) % DRAGON_PATH.length];
  return 'square' in cell ? TRACK_CELLS[cell.square] : HOME_CELLS[cell.seat][cell.pos - HOME_FIRST];
}

/** Where a piece stands at `pos`; a hero's positions are absolute track squares. */
export function movePoint(seat: Seat, piece: number, pos: number): Point {
  return piece >= HERO ? TRACK_CELLS[pos] : piecePoint(seat, piece, pos);
}

/** Board grid point → SVG pixels, rotated `rot` quarter turns clockwise. */
export function toPx(p: Point, rot: number): Point {
  const r = rotatePoint(p, rot);
  return { x: r.x * CELL, y: r.y * CELL };
}

/** Angle in degrees for a plane flying from a to b (0 = nose up). */
export function heading(a: Point, b: Point): number {
  if (a.x === b.x && a.y === b.y) return 0;
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
}

const CENTER: Point = { x: BOARD_SIZE / 2, y: BOARD_SIZE / 2 };

/** Direction a resting plane faces, in board coordinates. */
export function restHeading(seat: Seat, piece: number, pos: number): number {
  const here = piecePoint(seat, piece, pos);
  if (pos === HANGAR || pos === GOAL) return heading(here, CENTER);
  const next = pos === TAKEOFF ? 1 : pos + 1;
  return heading(here, piecePoint(seat, piece, next));
}

/** Interpolates between two angles along the shorter way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}
