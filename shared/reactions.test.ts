import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FLIGHT_CROSSES, GOAL, HANGAR, TRACK_LAST, trackIndex, type Seat } from './board.ts';
import { HURT_FROM, REACTIONS, REACTION_BY_ID, reactionsFor } from './reactions.ts';
import { DEFAULT_RULES, applyMove, applyRoll, createGame, type GameState } from './rules.ts';

function game(): GameState {
  return createGame([0, 1, 2, 3], DEFAULT_RULES, 0);
}

function at(g: GameState, seat: Seat, positions: number[]): GameState {
  g.pieces[seat] = [...positions, HANGAR, HANGAR, HANGAR, HANGAR].slice(0, 4);
  return g;
}

function sameSquare(ofSeat: Seat, pos: number, seat: Seat): number {
  const idx = trackIndex(ofSeat, pos);
  for (let p = 1; p <= TRACK_LAST; p++) if (trackIndex(seat, p) === idx) return p;
  throw new Error(`seat ${seat} never visits that square`);
}

function moveEvent(g: GameState, dice: number) {
  Object.assign(g, { phase: 'move', dice, movable: [0] });
  return applyMove(g, 0).event;
}

const first = () => 0;
const groups = (list: { seat: Seat; id: string }[]) => list.map((r) => [r.seat, REACTION_BY_ID.get(r.id)!.group]);

describe('reactions', () => {
  test('knocking out a piece past halfway: the hitter is happy, the victim is not', () => {
    const g = at(game(), 0, [40]);
    at(g, 1, [sameSquare(0, 42, 1)]);
    assert.ok(g.pieces[1][0] >= HURT_FROM);
    assert.deepEqual(groups(reactionsFor(moveEvent(g, 2), first)), [
      [0, 'happy'],
      [1, 'sad'],
    ]);
  });

  test('an early knock-out sets nothing off', () => {
    const g = at(game(), 0, [20]);
    at(g, 1, [sameSquare(0, 22, 1)]);
    assert.ok(g.pieces[1][0] < HURT_FROM);
    assert.deepEqual(reactionsFor(moveEvent(g, 2), first), []);
  });

  test('a flight over a home column counts as a late knock-out', () => {
    const g = at(game(), 0, [15]);
    at(g, 2, [FLIGHT_CROSSES]);
    assert.deepEqual(groups(reactionsFor(moveEvent(g, 3), first)), [
      [0, 'happy'],
      [2, 'sad'],
    ]);
  });

  test('a piece reaching the centre is happy', () => {
    const g = at(game(), 0, [GOAL - 2]);
    assert.deepEqual(groups(reactionsFor(moveEvent(g, 2), first)), [[0, 'happy']]);
  });

  test('three sixes in a row are sad', () => {
    // No magic boxes here, so the game starts at the first roll.
    const fresh = () => createGame([0, 1], { ...DEFAULT_RULES, magicBoxes: false }, 0);
    let g = at(fresh(), 0, [10]);
    for (let i = 0; i < 2; i++) g = applyMove(applyRoll(g, 6).state, 0).state;
    const third = applyRoll(g, 6).event;
    assert.equal(third.outcome, 'penalty');
    assert.deepEqual(groups(reactionsFor(third, first)), [[0, 'sad']]);
    assert.deepEqual(reactionsFor(applyRoll(fresh(), 3).event, first), [], 'an ordinary roll is not');
  });

  test('any GIF of the group can come up', () => {
    const ev = moveEvent(at(game(), 0, [GOAL - 2]), 2);
    const happy = REACTIONS.filter((r) => r.group === 'happy').map((r) => r.id);
    const seen = happy.map((_, i) => reactionsFor(ev, () => i)[0].id);
    assert.deepEqual(seen, happy);
  });

  test('the catalogue has both groups and no repeats', () => {
    assert.equal(REACTION_BY_ID.size, REACTIONS.length);
    assert.ok(REACTIONS.some((r) => r.group === 'happy') && REACTIONS.some((r) => r.group === 'sad'));
    for (const r of REACTIONS) assert.match(r.src, /^https:\/\//);
  });
});
