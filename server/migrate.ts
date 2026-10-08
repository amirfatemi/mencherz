import { GOAL, HANGAR, LAYOUT_VERSION, SEATS, TAKEOFF, type Seat } from '../shared/board.ts';
import { DEFAULT_RULES, legalPieces, standingsOf, type GameState } from '../shared/rules.ts';
import { POINTS } from '../shared/scoring.ts';

/** Brings a saved game up to date: board numbering first, then fields added since it was saved. */
export function upgradeGame(game: GameState): GameState {
  const g = migrateGame(game);
  g.rules = { ...DEFAULT_RULES, ...g.rules };
  // Games from before scoring: credit the pieces already home; earlier knock-outs weren't recorded.
  g.stats ??= SEATS.map((s) => {
    const home = g.pieces[s].filter((p) => p === GOAL).length;
    return { points: home * POINTS.home, home, captures: 0, lost: 0 };
  });
  g.bombs ??= [];
  g.boxes ??= [];
  g.vests ??= SEATS.map(() => 0);
  g.lastHitBy ??= SEATS.map(() => null);
  g.standings ??= g.phase === 'over' && g.ranking.length ? standingsOf(g) : [];
  return g;
}

// Each step keeps every piece on the same physical square.
const STEPS: Record<number, (p: number) => number> = {
  // Layout 1 had track 1..52, home 53..57 and goal 58, entering three squares later. Planes on the
  // first three old squares now sit before the entry, so they go back to takeoff.
  1: (p) => (p === HANGAR || p === TAKEOFF ? p : p >= 58 ? 55 : p <= 3 ? TAKEOFF : p - 3),
  // Layout 2 entered one square later (track 1..49, home 50..54, goal 55).
  2: (p) => (p <= TAKEOFF ? p : p + 1),
};

/** Moves a saved game from an older board numbering to the current one. */
export function migrateGame(game: GameState): GameState {
  let layout = game.layout ?? 1;
  if (layout === LAYOUT_VERSION) return game;
  let pieces = game.pieces;
  for (; layout < LAYOUT_VERSION; layout++) pieces = pieces.map((row) => row.map(STEPS[layout]));
  const g: GameState = { ...game, layout: LAYOUT_VERSION, pieces };
  if (g.phase === 'move' && g.dice !== null) {
    g.movable = legalPieces(g, g.turn as Seat, g.dice);
    if (!g.movable.length) Object.assign(g, { phase: 'roll', dice: null });
  }
  return g;
}
