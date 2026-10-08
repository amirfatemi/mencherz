// Board geometry, laid out like Battle Ludo: small hangars in the corners and a 52-square
// track that winds around them, with deep rectangular squares and triangle squares at the
// corners. Coordinates are in grid units on a BOARD_SIZE x BOARD_SIZE board; one track
// square is 1 unit long and DEPTH units deep.
//
// Piece positions are relative to the owning seat:
//   -1        hangar
//    0        takeoff spot (launched, not yet on the track)
//    1..50    track. 1 is the triangle sharing the takeoff's corner square, 50 the arrow square that turns home.
//   51..55    home column H1..H5
//   56        goal (centre)
//
// The track is coloured in rotation, so every seat owns positions 2, 6, 10, ..., 50. Landing on
// one jumps to the next (+4). Position 18 is the seat's flight square: it flies 12 squares to 30,
// across H3 of the opposite seat's home column.

export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

// Seat 0 sits top-left, then clockwise.
export const COLOR_NAMES = ['Yellow', 'Blue', 'Green', 'Red'] as const;
export const COLOR_HEX = ['#f9b912', '#1e7fe0', '#2fa84a', '#e8352e'] as const;
export const COLOR_LIGHT = ['#ffe28a', '#9fcbff', '#9fe0a4', '#ff9a8f'] as const;
export const COLOR_DARK = ['#b97a00', '#0b4fa3', '#17702c', '#a3180f'] as const;

export const PIECES_PER_SEAT = 4;
export const TRACK_LEN = 52;
export const ARM_LEN = 13;
/** Seat s joins the track at absolute square 13 * s + ENTRY_OFFSET. */
export const ENTRY_OFFSET = 2;

export const HANGAR = -1;
export const TAKEOFF = 0;
export const TRACK_FIRST = 1;
export const TRACK_LAST = 50;
export const HOME_FIRST = 51;
export const HOME_LAST = 55;
export const GOAL = 56;

export const JUMP_DISTANCE = 4;
export const FLIGHT_FROM = 18;
export const FLIGHT_DISTANCE = 12;
export const FLIGHT_TO = FLIGHT_FROM + FLIGHT_DISTANCE;
export const FLIGHT_CROSSES = HOME_FIRST + 2;

/** Bumped whenever position numbering changes, so saved games can be migrated. */
export const LAYOUT_VERSION = 3;

const DEPTH = 1.6;
const HANGAR_SIZE = DEPTH + 2;
export const BOARD_SIZE = 4 * DEPTH + 9;
const MID = BOARD_SIZE / 2;
const CENTER_HALF = 1.5;

export interface Point {
  x: number;
  y: number;
}

export type Shape =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'tri'; pts: [Point, Point, Point] };

export interface Square {
  shape: Shape;
  /** Where a piece stands. */
  spot: Point;
}

export function isOnTrack(pos: number): boolean {
  return pos >= TRACK_FIRST && pos <= TRACK_LAST;
}

export function isOwnColor(pos: number): boolean {
  return isOnTrack(pos) && pos % 4 === 2;
}

/** Absolute track index (0..51) for a seat-relative track position. */
export function trackIndex(seat: Seat, pos: number): number {
  return (pos - 1 + ARM_LEN * seat + ENTRY_OFFSET) % TRACK_LEN;
}

/** Seat whose colour a track square has. */
export function trackColor(index: number): Seat {
  return (((index % 4) + 1) % 4) as Seat;
}

/** Seat whose home column this seat's flight crosses. */
export function flightCrossedSeat(seat: Seat): Seat {
  return ((seat + 2) % 4) as Seat;
}

export function rotatePoint(p: Point, times: number): Point {
  let { x, y } = p;
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) [x, y] = [BOARD_SIZE - y, x];
  return { x, y };
}

export function rotateShape(s: Shape, times: number): Shape {
  if (s.kind === 'tri') return { kind: 'tri', pts: s.pts.map((p) => rotatePoint(p, times)) as [Point, Point, Point] };
  const a = rotatePoint({ x: s.x0, y: s.y0 }, times);
  const b = rotatePoint({ x: s.x1, y: s.y1 }, times);
  return { kind: 'rect', x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

const rect = (x0: number, y0: number, x1: number, y1: number): Shape => ({ kind: 'rect', x0, y0, x1, y1 });
const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): Shape => ({
  kind: 'tri',
  pts: [{ x: ax, y: ay }, { x: bx, y: by }, { x: cx, y: cy }],
});

function spotOf(s: Shape): Point {
  if (s.kind === 'rect') return { x: (s.x0 + s.x1) / 2, y: (s.y0 + s.y1) / 2 };
  const [a, b, c] = s.pts;
  const la = Math.hypot(b.x - c.x, b.y - c.y);
  const lb = Math.hypot(a.x - c.x, a.y - c.y);
  const lc = Math.hypot(a.x - b.x, a.y - b.y);
  const sum = la + lb + lc;
  return { x: (la * a.x + lb * b.x + lc * c.x) / sum, y: (la * a.y + lb * b.y + lc * c.y) / sum };
}

const square = (shape: Shape): Square => ({ shape, spot: spotOf(shape) });
const rotateSquare = (s: Square, times: number): Square => ({ shape: rotateShape(s.shape, times), spot: rotatePoint(s.spot, times) });

const H = HANGAR_SIZE;
const D = DEPTH;

// Top-left quarter, clockwise from just after the left arm's arrow square up to the top arm's
// arrow square: up the left edge, right under the hangar, through the inner corner, up beside
// the hangar, then along the top edge.
const QUARTER: Shape[] = [
  rect(0, H + D + 1, D, H + D + 2),
  rect(0, H + D, D, H + D + 1),
  tri(D, H, D, H + D, 0, H + D),
  rect(D, H, D + 1, H + D),
  rect(D + 1, H, H, H + D),
  tri(H, H, H, H + D, H + D, H + D),
  tri(H, H, H + D, H, H + D, H + D),
  rect(H, H - 1, H + D, H),
  rect(H, H - 2, H + D, H - 1),
  tri(H, D, H + D, D, H + D, 0),
  rect(H + D, 0, H + D + 1, D),
  rect(H + D + 1, 0, H + D + 2, D),
  rect(H + D + 2, 0, H + D + 3, D),
];

export const TRACK: Square[] = Array.from({ length: TRACK_LEN }, (_, i) =>
  rotateSquare(square(QUARTER[i % ARM_LEN]), Math.floor(i / ARM_LEN)),
);
export const TRACK_CELLS: Point[] = TRACK.map((s) => s.spot);

// Seat 1's home column runs down the top arm; the others are rotations of it.
const HOME_STEP = (MID - CENTER_HALF - D) / 5;
const TOP_HOME: Square[] = [0, 1, 2, 3, 4].map((k) =>
  square(rect(MID - 0.5, D + k * HOME_STEP, MID + 0.5, D + (k + 1) * HOME_STEP)),
);
export const HOME: Square[][] = SEATS.map((s) => TOP_HOME.map((sq) => rotateSquare(sq, s - 1)));
export const HOME_CELLS: Point[][] = HOME.map((col) => col.map((s) => s.spot));

export const TAKEOFF_SQUARES: Square[] = SEATS.map((s) => rotateSquare(square(tri(0, H, D, H, 0, H + D)), s));
export const TAKEOFF_CELLS: Point[] = TAKEOFF_SQUARES.map((s) => s.spot);

/** The unused halves of the top-left corner squares, drawn as board. */
export const DECOR: Shape[] = SEATS.map((s) => rotateShape(tri(H, 0, H + D, 0, H, D), s));

export const HANGARS: Shape[] = SEATS.map((s) => rotateShape(rect(0, 0, H, H), s));
export const HANGAR_CENTERS: Point[] = SEATS.map((s) => rotatePoint({ x: H / 2, y: H / 2 }, s));
const SLOT_GAP = 0.74;
export const HANGAR_SLOTS: Point[][] = SEATS.map((s) =>
  [
    { x: H / 2 - SLOT_GAP, y: H / 2 - SLOT_GAP },
    { x: H / 2 + SLOT_GAP, y: H / 2 - SLOT_GAP },
    { x: H / 2 - SLOT_GAP, y: H / 2 + SLOT_GAP },
    { x: H / 2 + SLOT_GAP, y: H / 2 + SLOT_GAP },
  ].map((p) => rotatePoint(p, s)),
);

const c0 = MID - CENTER_HALF;
const c1 = MID + CENTER_HALF;
export const CENTER: Shape = rect(c0, c0, c1, c1);
/** Each seat's triangle in the centre, pointing at its home column. */
export const GOAL_TRIANGLES: Point[][] = SEATS.map((s) =>
  [{ x: c0, y: c0 }, { x: c1, y: c0 }, { x: MID, y: MID }].map((p) => rotatePoint(p, s - 1)),
);
export const GOAL_CELLS: Point[] = GOAL_TRIANGLES.map((t) => spotOf({ kind: 'tri', pts: t as [Point, Point, Point] }));

/** Board point for a piece, in grid units. */
export function piecePoint(seat: Seat, piece: number, pos: number): Point {
  if (pos === HANGAR) return HANGAR_SLOTS[seat][piece];
  if (pos === TAKEOFF) return TAKEOFF_CELLS[seat];
  if (isOnTrack(pos)) return TRACK_CELLS[trackIndex(seat, pos)];
  if (pos >= HOME_FIRST && pos <= HOME_LAST) return HOME_CELLS[seat][pos - HOME_FIRST];
  return GOAL_CELLS[seat];
}
