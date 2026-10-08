import { HANGAR } from './board.ts';
import type { Capture, GameEvent, MoveEvent, StepKind } from './rules.ts';

// Animation lengths in ms. The client plays them; the server waits for them before a bot acts.
export const STEP_MS: Record<StepKind, number> = {
  launch: 480,
  step: 200,
  bounce: 200,
  jump: 400,
  fly: 850,
};
export const ROLL_MS = 750;
export const CAPTURE_MS = 700;
/** A bomb or a magic box dropping onto its square. */
export const BOMB_MS = 700;
/** How long an opened magic box shows what was inside; the piece waits on the box meanwhile. */
export const BOX_REVEAL_MS = 3000;
/** A roll that can't be played stays on the dice this long before the next player goes. */
export const PASS_HOLD_MS = 5000;

export function eventDuration(event: GameEvent | null | undefined): number {
  if (!event) return 0;
  if (event.type === 'roll') {
    return ROLL_MS + (event.penalized.length ? CAPTURE_MS : 0) + (event.outcome === 'pass' ? PASS_HOLD_MS : 0);
  }
  if (event.type === 'bomb' || event.type === 'box') return BOMB_MS;
  let ms = settledAt(event);
  // Knocked-out pieces, or the mover itself after a bomb, fly back to the hangar.
  if (event.captures.length || event.to === HANGAR) ms += CAPTURE_MS;
  return ms;
}

/** When step `i` of a move's path ends, in ms from the start of the move. Steps after an opened box wait for its reveal. */
export function stepEnd(ev: MoveEvent, i: number): number {
  let t = ev.box?.outcome && i > ev.box.atStep ? BOX_REVEAL_MS : 0;
  for (let j = 0; j <= i && j < ev.path.length; j++) t += STEP_MS[ev.path[j].kind];
  return t;
}

/** When a knock-out happens, in ms from the start of the move: on landing, or halfway through a flight. */
export function captureAt(ev: MoveEvent, c: Capture): number {
  const i = Math.min(c.atStep, ev.path.length - 1);
  const end = stepEnd(ev, i);
  return c.byFlight ? end - STEP_MS[ev.path[i].kind] / 2 : end;
}

/** When the moving piece reaches the end of its path, in ms from the start of the move. */
export function arrivalAt(ev: MoveEvent): number {
  return stepEnd(ev, ev.path.length - 1);
}

/** When a magic box the move landed on opens. */
export function boxOpenAt(ev: MoveEvent): number {
  return ev.box ? stepEnd(ev, ev.box.atStep) : 0;
}

/** When the move is over, box reveal included (before any piece flies home). */
export function settledAt(ev: MoveEvent): number {
  return Math.max(arrivalAt(ev), ev.box?.outcome ? boxOpenAt(ev) + BOX_REVEAL_MS : 0);
}

/** When a bomb blows the mover up: on landing for a placed bomb, after the reveal for one in a box. */
export function blastAt(ev: MoveEvent): number {
  if (ev.bombed && !ev.bombed.saved) return stepEnd(ev, ev.bombed.atStep);
  return boxOpenAt(ev) + BOX_REVEAL_MS;
}
