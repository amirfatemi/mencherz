import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GOAL, HANGAR, HOME_FIRST, TAKEOFF, TRACK_LEN, trackIndex, type Seat } from '../shared/board.ts';
import { DEFAULT_RULES, createGame } from '../shared/rules.ts';
import { migrateGame } from './migrate.ts';

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
