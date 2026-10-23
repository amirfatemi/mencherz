import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { gameAwards, medalsWon, titleFor } from './awards.ts';
import { GOAL, HANGAR, trackIndex } from './board.ts';
import { DEFAULT_RULES, applyMove, createGame, newStats, type GameState } from './rules.ts';

function finished(): GameState {
  const g = createGame([0, 1, 2], { ...DEFAULT_RULES, magicBoxes: false, powerSquares: false });
  g.phase = 'over';
  g.standings = [1, 0, 2];
  g.ranking = [1, 0, 2];
  g.pieces[1] = [GOAL, GOAL, GOAL, GOAL];
  g.stats[0] = { ...newStats(), points: 90, captures: 9, lost: 2, bestHit: 31, bestStreak: 3, sixes: 5 };
  g.stats[1] = { ...newStats(), points: 150, home: 4, captures: 3, lost: 0, bestHit: 12, bombKills: 3, flights: 2 };
  g.stats[2] = { ...newStats(), points: 20, captures: 0, lost: 7, bestHit: 0 };
  return g;
}

describe('end-of-game report', () => {
  test('each highlight goes to whoever has the most of it; nobody gets one for nothing', () => {
    const byId = Object.fromEntries(gameAwards(finished()).map((a) => [a.id, [a.seat, a.detail]]));
    assert.deepEqual(byId, {
      mvp: [1, '150 points'],
      hunter: [0, '9 knock-outs'],
      bigHit: [0, '+31 in one go'],
      spree: [0, 'Triple kill'],
      bomber: [1, 'blew up 3'],
      flyer: [1, '2 flights'],
      sixes: [0, '5 sixes'],
      unlucky: [2, 'knocked out 7 times'],
    });
    const quiet = finished();
    quiet.stats = quiet.stats.map((st) => ({ ...st, bombKills: 0, flights: 0, bestStreak: 1 }));
    const ids = gameAwards(quiet).map((a) => a.id);
    assert.ok(!ids.includes('bomber') && !ids.includes('flyer') && !ids.includes('spree'));
  });
});

describe('medals and titles', () => {
  test('medals for what a seat did this game', () => {
    const g = finished();
    assert.deepEqual(
      medalsWon(g, 0).map((m) => m.id),
      ['hunter', 'spree', 'sniper'],
    );
    assert.deepEqual(
      medalsWon(g, 1).map((m) => m.id),
      ['rocket', 'demolisher', 'untouchable'],
    );
    assert.deepEqual(medalsWon(g, 2), [], 'knocked out a lot, but not in the top two');
    g.standings = [1, 2, 0];
    assert.deepEqual(
      medalsWon(g, 2).map((m) => m.id),
      ['phoenix'],
    );
  });

  test('titles follow total points', () => {
    assert.equal(titleFor(0).name, 'Rookie');
    assert.equal(titleFor(149).name, 'Rookie');
    assert.equal(titleFor(150).name, 'Pilot');
    assert.equal(titleFor(2600).name, 'Legend');
  });

  test("a bomb's owner is credited for what it blew up", () => {
    const g = createGame([0, 1], { ...DEFAULT_RULES, magicBoxes: false, powerSquares: false, kings: false });
    g.pieces[1] = [30, HANGAR, HANGAR, HANGAR];
    g.bombs = [{ square: trackIndex(1, 32), owner: 0 }];
    Object.assign(g, { turn: 1, phase: 'move', dice: 2, movable: [0] });
    const { state } = applyMove(g, 0);
    assert.equal(state.stats[0].bombKills, 1);
    assert.ok(state.stats[0].bestHit > 0);
  });
});
