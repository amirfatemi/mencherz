import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FLIGHT_CROSSES, GOAL, HANGAR, TRACK_LAST, trackIndex, type Seat } from './board.ts';
import { HURT_FROM, REACTIONS, REACTION_BY_ID, drawReaction, reactionsFor, type ReactionDeck, type ReactionGroup } from './reactions.ts';
import { DEFAULT_RULES, STUCK_TURNS, applyMove, applyRoll, createGame, type GameState } from './rules.ts';

function game(): GameState {
  return createGame([0, 1, 2, 3], { ...DEFAULT_RULES, powerSquares: false, kings: false, events: false, bounty: false, dragon: false }, 0);
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

const first = (group: ReactionGroup) => REACTIONS.find((r) => r.group === group)!.id;
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
    const fresh = () => createGame([0, 1], { ...DEFAULT_RULES, magicBoxes: false, powerSquares: false, events: false, bounty: false, dragon: false }, 0);
    let g = at(fresh(), 0, [10]);
    for (let i = 0; i < 2; i++) g = applyMove(applyRoll(g, 6).state, 0).state;
    const third = applyRoll(g, 6).event;
    assert.equal(third.outcome, 'penalty');
    assert.deepEqual(groups(reactionsFor(third, first)), [[0, 'sad']]);
    assert.deepEqual(reactionsFor(applyRoll(fresh(), 3).event, first), [], 'an ordinary roll is not');
  });

  test('three lost turns in a row with everything in the hangar are sad', () => {
    let g = createGame([0, 1], { ...DEFAULT_RULES, magicBoxes: false, powerSquares: false, events: false, bounty: false, dragon: false }, 0);
    const moods: string[][] = [];
    for (let turn = 1; turn <= 2 * STUCK_TURNS; turn++) {
      const r = applyRoll(g, 3);
      assert.equal(r.event.outcome, 'pass');
      if (r.event.seat === 0) moods.push(reactionsFor(r.event, first).map((x) => REACTION_BY_ID.get(x.id)!.group));
      g = r.state;
    }
    assert.deepEqual(moods, [[], [], ['sad']], 'only on the third');
  });

  test('a double kill makes the hitter happy, even early in the route', () => {
    const g = at(game(), 0, [20]);
    at(g, 1, [sameSquare(0, 22, 1)]);
    g.kills[0][0] = 1;
    const ev = moveEvent(g, 2);
    assert.equal(ev.captures[0].streak, 2);
    assert.deepEqual(groups(reactionsFor(ev, first)), [[0, 'happy']]);
  });

  test('GIFs come round like a shuffled deck: none repeats until all of its group have shown', () => {
    const deck: ReactionDeck = {};
    let seed = 7;
    const rand = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
    for (const group of ['happy', 'sad'] as const) {
      const all = REACTIONS.filter((r) => r.group === group).map((r) => r.id);
      let closed: string | undefined;
      for (let round = 0; round < 5; round++) {
        const drawn = all.map(() => drawReaction(deck, group, rand));
        assert.deepEqual([...drawn].sort(), [...all].sort(), `round ${round}: every ${group} GIF once`);
        assert.notEqual(drawn[0], closed, 'a new round never opens with the GIF that closed the last');
        closed = drawn.at(-1);
      }
    }
  });

  test('the catalogue has both groups and no repeats', () => {
    assert.equal(REACTION_BY_ID.size, REACTIONS.length);
    assert.ok(REACTIONS.some((r) => r.group === 'happy') && REACTIONS.some((r) => r.group === 'sad'));
    for (const r of REACTIONS) assert.match(r.src, /^https:\/\//);
  });
});
