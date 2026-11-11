import { ABSOLUTE, GOAL, HANGAR, LAYOUT_VERSION, SEATS, TAKEOFF, TRACK_FIRST, TRACK_LAST, trackIndex, type Seat } from '../shared/board.ts';
import { DEFAULT_RULES, DRAGON_FIRST_ROUNDS, DRAGON_PATH, HERO_KINDS, HERO_TEAM, EVENT_EVERY_ROUNDS, legalPieces, newStats, perPiece, standingsOf, type GameState } from '../shared/rules.ts';
import { POINTS } from '../shared/scoring.ts';

/** Brings a saved game up to date: board numbering first, then fields added since it was saved. */
export function upgradeGame(game: GameState): GameState {
  const g = migrateGame(game);
  g.rules = { ...DEFAULT_RULES, ...g.rules };
  // Games from before scoring: credit the pieces already home; earlier knock-outs weren't recorded.
  g.stats ??= SEATS.map((s) => {
    const home = g.pieces[s].filter((p) => p === GOAL).length;
    return { ...newStats(), points: home * POINTS.home, home };
  });
  // Stats added later for the end-of-game report start at zero.
  g.stats = g.stats.map((st) => ({ ...newStats(), ...st }));
  g.bombs ??= [];
  g.boxes ??= [];
  // Vests used to belong to the whole seat; each now goes on a piece, the one furthest along.
  const seatVests = (g as GameState & { vests?: number[] }).vests;
  if (!g.vested) {
    g.vested = perPiece();
    SEATS.forEach((seat) => {
      const n = seatVests?.[seat] ?? 0;
      if (!n) return;
      const order = g.pieces[seat].map((p, j) => [p, j]).filter(([p]) => p !== GOAL).sort((a, b) => b[0] - a[0]);
      if (order.length) g.vested[seat][order[0][1]] += n;
    });
  }
  delete (g as GameState & { vests?: number[] }).vests;
  g.powerAfterVest ??= false;
  g.lastHitBy ??= SEATS.map(() => null);
  g.frozen ??= perPiece();
  g.kills ??= perPiece();
  // Older games get their power squares on the next turn.
  // Older games get their power square on the next turn; games from when there were two keep one.
  g.power = (g.power ?? []).slice(0, 1);
  g.powerMovesAt ??= 0;
  g.bridges ??= [];
  g.powerThen ??= null;
  g.placing ??= null;
  g.safe ??= [];
  // The Sirat bridge was renamed the ambush.
  const renamed = g as GameState & { sirat?: GameState['ambush'] };
  g.ambush ??= renamed.sirat ?? null;
  delete renamed.sirat;
  g.usedPowers = (g.usedPowers ?? []).map((c) => ((c as string) === 'sirat' ? 'ambush' : c));
  // Events and the dragon start their count from now in older games.
  g.event ??= null;
  g.eventAt ??= g.turnNo + EVENT_EVERY_ROUNDS * g.active.length;
  g.bounty ??= null;
  g.dragon ??= null;
  g.dragonAt ??= g.turnNo + DRAGON_FIRST_ROUNDS * g.active.length;
  // A king no longer slays the dragon for good, and a slain or exploded one is back two turns later, not
  // twenty rounds: one that has come before comes again now.
  const gone = g as GameState & { dragonGone?: boolean };
  if ('dragonGone' in gone) {
    const seen = !!g.dragonBlast || g.stats.some((st) => (st.dragons ?? 0) > 0);
    if (!g.dragon && seen) g.dragonAt = Math.min(g.dragonAt, g.turnNo);
    delete gone.dragonGone;
  }
  g.dragonBlast ??= null;
  // A dragon that stayed a set time (and before that, saved by square) starts its lap where it is.
  const oldDragon = g.dragon as unknown as { square?: number; at?: number; moved?: number; six?: boolean; sixes?: number } | null;
  if (oldDragon && oldDragon.moved === undefined) {
    const at = oldDragon.at ?? DRAGON_PATH.findIndex((c) => 'square' in c && c.square === oldDragon.square);
    g.dragon = { at: Math.max(0, at), moved: 0, sixes: 0 };
  } else if (oldDragon && oldDragon.sixes === undefined) {
    g.dragon = { at: oldDragon.at!, moved: oldDragon.moved!, sixes: oldDragon.six ? 1 : 0 };
  }
  g.heroes ??= SEATS.map(() => null);
  g.heroEnding ??= null;
  g.heroBlast ??= null;
  g.charmed ??= [];
  // Charmed pieces used to keep their own colour's numbering; now they stand on absolute squares while charmed.
  for (const c of g.charmed) {
    const pos = g.pieces[c.seat][c.piece];
    if (pos >= TRACK_FIRST && pos <= TRACK_LAST) g.pieces[c.seat][c.piece] = ABSOLUTE + trackIndex(c.seat, pos);
  }
  // Heroes used to be earned one at a time; now each player has a team picked at the start. Games already under
  // way get the heroes each player had had, filled up from the top of the list, and play on without a pick.
  const earned = g as GameState & { heroesUsed?: GameState['heroTeams'][number][]; heroPicks?: unknown; heroMilestones?: unknown; heroAt?: unknown; sixPenalties?: unknown };
  if (!g.heroTeams) {
    g.heroTeams = SEATS.map((s) => {
      if (!g.rules.heroes) return [];
      const team = [...new Set(earned.heroesUsed?.[s] ?? [])].slice(0, HERO_TEAM);
      for (const k of HERO_KINDS) if (team.length < HERO_TEAM && !team.includes(k)) team.push(k);
      return team;
    });
    if (g.phase === 'hero') Object.assign(g, { phase: 'roll', dice: null, movable: [] });
  }
  delete earned.heroesUsed;
  delete earned.heroPicks;
  delete earned.heroMilestones;
  delete earned.heroAt;
  delete earned.sixPenalties;
  for (const h of g.heroes) if (h) delete (h as typeof h & { guards?: number }).guards;
  // Roll-again cards were dropped: the phase that placed bridges also places boxes now, and a roll that
  // waited for a card or a pass is simply rolled again.
  const old = g as Omit<GameState, 'phase'> & { rerolls?: unknown; preRoll?: unknown; phase: string };
  delete old.rerolls;
  delete old.preRoll;
  if (old.phase === 'bridge') old.phase = 'place';
  if (g.phase === 'move' && !g.movable.length) Object.assign(g, { phase: 'roll', dice: null });
  g.stuck ??= SEATS.map(() => 0);
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
