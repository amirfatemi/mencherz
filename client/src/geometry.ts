import { BOARD_SIZE, GOAL, HANGAR, TAKEOFF, piecePoint, rotatePoint, type Point, type Seat } from '../../shared/board.ts';

export const CELL = 40;
export const BOARD_PX = CELL * BOARD_SIZE;

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
