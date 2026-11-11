import { ABSOLUTE, BOARD_SIZE, GOAL, HANGAR, HANGAR_CENTERS, HOME_CELLS, HOME_FIRST, TAKEOFF, TAKEOFF_CELLS, TRACK_CELLS, piecePoint, rotatePoint, type Point, type Seat } from '../../shared/board.ts';
import { CHARM, DRAGON_PATH, HERO, HERO_START, charmOf } from '../../shared/rules.ts';

export const CELL = 40;
export const BOARD_PX = CELL * BOARD_SIZE;

/** Where the dragon stands, in board grid units, at this point along its route. */
export function dragonPoint(at: number): Point {
  const cell = DRAGON_PATH[((at % DRAGON_PATH.length) + DRAGON_PATH.length) % DRAGON_PATH.length];
  return 'square' in cell ? TRACK_CELLS[cell.square] : HOME_CELLS[cell.seat][cell.pos - HOME_FIRST];
}

/** Where a piece stands at `pos`; a hero's positions are absolute track squares, or HERO_START (its takeoff spot). */
export function movePoint(seat: Seat, piece: number, pos: number): Point {
  // A charmed piece moves on its own colour's track, whoever moves it.
  if (piece >= CHARM) {
    const c = charmOf(piece);
    return piecePoint(c.seat, c.piece, pos);
  }
  if (piece < HERO) return piecePoint(seat, piece, pos);
  if (pos === HANGAR) return HANGAR_CENTERS[seat];
  return pos === HERO_START ? TAKEOFF_CELLS[seat] : TRACK_CELLS[pos];
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
  const next = pos === TAKEOFF ? 1 : pos >= ABSOLUTE ? ABSOLUTE + ((pos - ABSOLUTE + 1) % TRACK_CELLS.length) : pos + 1;
  return heading(here, piecePoint(seat, piece, next));
}

/** Interpolates between two angles along the shorter way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}
