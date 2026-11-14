import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GOAL, HANGAR, HOME_FIRST, TAKEOFF, TRACK_LEN, trackIndex, type Seat } from '../shared/board.ts';
import { DEFAULT_RULES, LAUNCH, createGame, type GameState } from '../shared/rules.ts';
import { migrateGame, upgradeGame } from './migrate.ts';

test('layout 2 saves keep every piece on the same square', () => {
  // Layout 2 entered the track one square later: seat-relative square p was absolute (p + 2 + 13 * seat) % 52.
  const old = createGame([0, 1, 2, 3], DEFAULT_RULES);
  old.layout = 2;
  old.pieces = [
    [HANGAR, TAKEOFF, 1, 49],
    [17, 50, 54, 55],
    [24, 30, 42, HANGAR],
    [5, 9, 13, TAKEOFF],
  ];
  const g = migrateGame(old);
  assert.equal(g.layout, 3);
  g.pieces.forEach((row, s) =>
    row.forEach((p, j) => {
      const was = old.pieces[s][j];
      if (was <= TAKEOFF) return assert.equal(p, was);
      if (was === 55) return assert.equal(p, GOAL);
      if (was >= 50) return assert.equal(p, HOME_FIRST + (was - 50));
      assert.equal(trackIndex(s as Seat, p), (was + 2 + 13 * s) % TRACK_LEN);
    }),
  );
});

test('a saved game, paused or not, comes back under the rules of this version: no stale moves, new fields filled in', () => {
  const old = createGame([0, 1], { ...DEFAULT_RULES, heroes: true });
  Object.assign(old, { phase: 'move', turn: 0, dice: 6, heroTeams: [['archer', 'wizard', 'death'], ['thief', 'frost', 'rider'], [], []] });
  // Saved before heroes rested: it offered the archer, which this version says is still resting.
  old.movable = [0, 1, 2, 3, LAUNCH, LAUNCH + 1, LAUNCH + 2];
  const saved = JSON.parse(JSON.stringify(old)) as Record<string, unknown>;
  delete saved.heroRest;
  delete saved.dragonStats;
  (saved as { heroRest?: unknown }).heroRest = [{ archer: old.turnNo + 10 }, {}, {}, {}];
  const g = upgradeGame(saved as unknown as GameState);
  assert.deepEqual(g.movable, [0, 1, 2, 3, LAUNCH + 1, LAUNCH + 2]);
  assert.deepEqual(g.dragonStats, { points: 0, captures: 0, slain: 0 });
  // One whose only move is gone rolls again instead of waiting for a move nobody can make.
  const stuck = JSON.parse(JSON.stringify({ ...old, movable: [LAUNCH], heroRest: [{ archer: old.turnNo + 10, wizard: old.turnNo + 10, death: old.turnNo + 10 }, {}, {}, {}] }));
  stuck.pieces[0] = [GOAL, GOAL, GOAL, GOAL];
  const back = upgradeGame(stuck);
  assert.deepEqual([back.phase, back.dice, back.movable], ['roll', null, []]);
});
