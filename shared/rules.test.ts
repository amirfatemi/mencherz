import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { chooseBomb, chooseBox, chooseMove, type BotLevel } from './ai.ts';
import {
  FLIGHT_CROSSES,
  FLIGHT_FROM,
  FLIGHT_TO,
  GOAL,
  HANGAR,
  HOME,
  HOME_FIRST,
  SEATS,
  TAKEOFF,
  TAKEOFF_CELLS,
  TRACK,
  TRACK_CELLS,
  TRACK_LAST,
  flightCrossedSeat,
  isOnTrack,
  isOwnColor,
  trackColor,
  trackIndex,
  type Seat,
} from './board.ts';
import { MEANNESS, rollWeighted, rollWeights } from './dice.ts';
import { REACTION_BY_ID, reactionsFor } from './reactions.ts';
import { BOX_REVEAL_MS, PASS_HOLD_MS, ROLL_MS, blastAt, boxOpenAt, eventDuration } from './timing.ts';
import { EARLY_UNTIL, LATE_FROM, POINTS, REVENGE, captureValue } from './scoring.ts';
import {
  DEFAULT_RULES,
  applyBomb,
  applyBox,
  applyMove,
  applyRoll,
  freeSquares,
  createGame,
  planMove,
  type GameState,
  type Rules,
} from './rules.ts';

// Magic boxes are off unless a test turns them on, so games start straight at the first roll.
function game(seats: Seat[] = [0, 1, 2, 3], rules: Partial<Rules> = {}): GameState {
  return createGame(seats, { ...DEFAULT_RULES, magicBoxes: false, ...rules });
}

function at(g: GameState, seat: Seat, positions: number[]): GameState {
  g.pieces[seat] = [...positions, HANGAR, HANGAR, HANGAR, HANGAR].slice(0, 4);
  return g;
}

/** Relative position for `seat` of the square that `ofSeat` sees at `pos`. */
function sameSquare(ofSeat: Seat, pos: number, seat: Seat): number {
  const idx = trackIndex(ofSeat, pos);
  for (let p = 1; p <= TRACK_LAST; p++) if (trackIndex(seat, p) === idx) return p;
  throw new Error(`seat ${seat} never visits that square`);
}

const inside = (p: { x: number; y: number }, sq: (typeof TRACK)[number]) =>
  sq.shape.kind === 'rect' && p.x >= sq.shape.x0 && p.x <= sq.shape.x1 && p.y >= sq.shape.y0 && p.y <= sq.shape.y1;

describe('board geometry', () => {
  test('track squares are unique and consecutive squares touch', () => {
    const keys = new Set(TRACK_CELLS.map((p) => `${p.x},${p.y}`));
    assert.equal(keys.size, 52);
    for (let i = 0; i < 52; i++) {
      const a = TRACK_CELLS[i];
      const b = TRACK_CELLS[(i + 1) % 52];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= 1.3, `gap after ${i}`);
    }
  });

  test('takeoff sits next to the first square, and the arrow square next to H1', () => {
    for (const s of SEATS) {
      const t = TAKEOFF_CELLS[s];
      const first = TRACK_CELLS[trackIndex(s, 1)];
      assert.ok(Math.hypot(t.x - first.x, t.y - first.y) < 1.8, `seat ${s} takeoff`);
      const tip = TRACK_CELLS[trackIndex(s, TRACK_LAST)];
      const h1 = HOME[s][0].spot;
      assert.ok(Math.hypot(tip.x - h1.x, tip.y - h1.y) < 1.4, `seat ${s} home entry`);
    }
  });

  test('every seat owns positions 1, 5, 9, ..., 49', () => {
    for (const s of SEATS) {
      for (let pos = 1; pos <= TRACK_LAST; pos++) {
        assert.equal(trackColor(trackIndex(s, pos)) === s, isOwnColor(pos), `seat ${s} pos ${pos}`);
      }
    }
  });

  test('each flight line crosses H3 of the opposite seat', () => {
    for (const s of SEATS) {
      const a = TRACK_CELLS[trackIndex(s, FLIGHT_FROM)];
      const b = TRACK_CELLS[trackIndex(s, FLIGHT_TO)];
      assert.ok(Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9, 'flight line is straight');
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      assert.ok(inside(mid, HOME[flightCrossedSeat(s)][FLIGHT_CROSSES - HOME_FIRST]), `seat ${s}`);
    }
  });
});

describe('launching', () => {
  test('default rules only launch on a six', () => {
    const g = game();
    assert.equal(planMove(g, 0, 0, 5), null);
    assert.deepEqual(planMove(g, 0, 0, 6)?.path, [{ pos: TAKEOFF, kind: 'launch' }]);
  });

  test('launch variants', () => {
    assert.ok(planMove(game([0, 1], { launchOn: 'fiveSix' }), 0, 0, 5));
    assert.ok(planMove(game([0, 1], { launchOn: 'even' }), 0, 0, 2));
    assert.equal(planMove(game([0, 1], { launchOn: 'even' }), 0, 0, 3), null);
  });

  test('no legal move passes the turn, after the roll has stayed up a while', () => {
    const { state, event } = applyRoll(game(), 3);
    assert.equal(event.outcome, 'pass');
    assert.equal(state.turn, 1);
    assert.equal(eventDuration(event), ROLL_MS + PASS_HOLD_MS, 'bots and timers wait for it too');
  });
});

describe('movement', () => {
  test('landing on own colour jumps four', () => {
    const plan = planMove(at(game(), 0, [TAKEOFF]), 0, 0, 6)!;
    assert.equal(plan.to, 10);
    assert.equal(plan.jumped, true);
    assert.deepEqual(plan.path.at(-1), { pos: 10, kind: 'jump' });
  });

  test('a 1 from takeoff goes to the triangle next to it; a 2 lands on your colour and jumps', () => {
    assert.equal(planMove(at(game(), 0, [TAKEOFF]), 0, 0, 1)!.to, 1);
    assert.equal(trackIndex(0, 1), 2, 'the half of the takeoff corner square');
    assert.equal(planMove(at(game(), 0, [TAKEOFF]), 0, 0, 2)!.to, 6);
  });

  test('landing on the flight square flies, then jumps', () => {
    const plan = planMove(at(game(), 0, [15]), 0, 0, 3)!;
    assert.equal(plan.flew, true);
    assert.equal(plan.jumped, true);
    assert.equal(plan.to, FLIGHT_TO + 4);
  });

  test('a jump onto the flight square flies but does not jump again', () => {
    const plan = planMove(at(game(), 0, [10]), 0, 0, 4)!;
    assert.deepEqual(
      plan.path.slice(-2).map((p) => p.kind),
      ['jump', 'fly'],
    );
    assert.equal(plan.to, FLIGHT_TO);
  });

  test('jumps and flights can be switched off', () => {
    const g = at(game([0, 1], { jumps: false, flights: false }), 0, [15]);
    assert.equal(planMove(g, 0, 0, 3)!.to, FLIGHT_FROM);
  });

  test('the arrow square does not jump', () => {
    const plan = planMove(at(game(), 0, [46]), 0, 0, 4)!;
    assert.equal(plan.to, TRACK_LAST);
    assert.equal(plan.jumped, false);
  });

  test('overshooting the goal bounces back', () => {
    const plan = planMove(at(game(), 0, [GOAL - 3]), 0, 0, 5)!;
    assert.equal(plan.to, GOAL - 2);
    assert.deepEqual(
      plan.path.map((p) => p.kind),
      ['step', 'step', 'step', 'bounce', 'bounce'],
    );
  });

  test('exact finish rule forbids overshooting', () => {
    assert.equal(planMove(at(game([0, 1], { finish: 'exact' }), 0, [GOAL - 3]), 0, 0, 5), null);
    assert.equal(planMove(at(game([0, 1], { finish: 'exact' }), 0, [GOAL - 3]), 0, 0, 3)!.to, GOAL);
  });
});

describe('captures', () => {
  test('landing on an opponent sends it home', () => {
    const g = at(game(), 0, [5]);
    at(g, 1, [sameSquare(0, 7, 1)]);
    g.phase = 'move';
    g.dice = 2;
    g.movable = [0];
    const { state, event } = applyMove(g, 0);
    assert.equal(event.captures.length, 1);
    assert.equal(state.pieces[1][0], HANGAR);
  });

  test('a knock-out on your colour stays there instead of jumping', () => {
    const g = at(game(), 0, [TAKEOFF]);
    at(g, 1, [sameSquare(0, 6, 1), sameSquare(0, 10, 1)]);
    const plan = planMove(g, 0, 0, 6)!;
    assert.equal(plan.to, 6);
    assert.equal(plan.jumped, false);
    assert.deepEqual(
      plan.captures.map((c) => [c.from, c.atStep]),
      [[sameSquare(0, 6, 1), 5]],
    );
  });

  test('a jump still knocks out the piece where it lands', () => {
    const g = at(game(), 0, [TAKEOFF]);
    at(g, 1, [sameSquare(0, 10, 1)]);
    const plan = planMove(g, 0, 0, 6)!;
    assert.equal(plan.to, 10);
    assert.deepEqual(
      plan.captures.map((c) => c.atStep),
      [6],
    );
  });

  test('a knock-out on the flight square stays there instead of flying', () => {
    const g = at(game(), 0, [15]);
    at(g, 1, [sameSquare(0, FLIGHT_FROM, 1)]);
    const plan = planMove(g, 0, 0, 3)!;
    assert.equal(plan.to, FLIGHT_FROM);
    assert.equal(plan.flew, false);
    assert.equal(plan.captures.length, 1);
  });

  test('a knock-out where a flight lands stops the jump after it', () => {
    const g = at(game(), 0, [15]);
    at(g, 1, [sameSquare(0, FLIGHT_TO, 1)]);
    const plan = planMove(g, 0, 0, 3)!;
    assert.equal(plan.flew, true);
    assert.equal(plan.jumped, false);
    assert.equal(plan.to, FLIGHT_TO);
    assert.equal(plan.captures.length, 1);
  });

  test('a flight knocks out the plane on the crossed home square', () => {
    const g = at(game(), 0, [15]);
    at(g, 2, [FLIGHT_CROSSES]);
    const plan = planMove(g, 0, 0, 3)!;
    assert.deepEqual(
      plan.captures.map((c) => [c.seat, c.byFlight]),
      [[2, true]],
    );
    g.rules.flightCapture = false;
    assert.equal(planMove(g, 0, 0, 3)!.captures.length, 0);
  });

  test('own planes stack instead of capturing', () => {
    const g = at(game(), 0, [5, 7]);
    assert.equal(planMove(g, 0, 0, 2)!.captures.length, 0);
  });
});

describe('turns', () => {
  test('a six gives another roll', () => {
    let g = at(game(), 0, [TAKEOFF]);
    g = applyRoll(g, 6).state;
    const { state, event } = applyMove(g, 0);
    assert.equal(event.extraRoll, true);
    assert.equal(state.turn, 0);
    assert.equal(state.phase, 'roll');
  });

  test('three sixes send the planes moved on them back', () => {
    let g = game([0, 1, 2, 3], { threeSixes: 'penalty', bombs: false });
    g = applyMove(applyRoll(g, 6).state, 0).state;
    g = applyMove(applyRoll(g, 6).state, 0).state;
    assert.equal(g.pieces[0][0], 10);
    const { state, event } = applyRoll(g, 6);
    assert.equal(event.outcome, 'penalty');
    assert.deepEqual(event.penalized, [{ piece: 0, from: 10 }]);
    assert.equal(state.pieces[0][0], HANGAR);
    assert.equal(state.turn, 1);
  });

  test('three sixes can just end the turn', () => {
    let g = game([0, 1], { threeSixes: 'forfeit' });
    g = applyMove(applyRoll(g, 6).state, 0).state;
    g = applyMove(applyRoll(g, 6).state, 0).state;
    const { state, event } = applyRoll(g, 6);
    assert.equal(event.outcome, 'forfeit');
    assert.equal(state.pieces[0][0], 10);
    assert.equal(state.turn, 1);
  });

  test('a six with no legal move rolls again', () => {
    const g = at(game([0, 1], { finish: 'exact' }), 0, [GOAL, GOAL, GOAL, GOAL - 3]);
    const { state, event } = applyRoll(g, 6);
    assert.equal(event.outcome, 'again');
    assert.equal(state.turn, 0);
    assert.equal(state.phase, 'roll');
  });

  test('bringing the last plane home wins', () => {
    let g = at(game([0, 2]), 0, [GOAL, GOAL, GOAL, GOAL - 3]);
    g = applyRoll(g, 3).state;
    const { state, event } = applyMove(g, 3);
    assert.equal(event.gameOver, true);
    assert.equal(state.phase, 'over');
    assert.deepEqual(state.ranking, [0, 2]);
  });

  test('play on for a full ranking', () => {
    let g = at(game([0, 1, 2], { playUntil: 'all' }), 0, [GOAL, GOAL, GOAL, GOAL - 3]);
    g = applyRoll(g, 3).state;
    const { state, event } = applyMove(g, 3);
    assert.equal(event.gameOver, false);
    assert.equal(state.turn, 1);
    assert.deepEqual(state.ranking, [0]);
  });
});

describe('bots', () => {
  function play(seats: Seat[], rules: Partial<Rules>, levels: BotLevel[], seed: number) {
    let x = seed;
    const rand = () => {
      x = (x * 1664525 + 1013904223) % 4294967296;
      return x / 4294967296;
    };
    let g = game(seats, rules);
    let actions = 0;
    while (g.phase !== 'over') {
      assert.ok(++actions < 20000, 'game did not finish');
      if (g.phase === 'roll') {
        g = applyRoll(g, 1 + Math.floor(rand() * 6)).state;
      } else if (g.phase === 'bomb') {
        g = applyBomb(g, chooseBomb(g, levels[g.turn], rand)).state;
      } else {
        g = applyMove(g, chooseMove(g, levels[g.turn], rand)).state;
      }
      const seen = new Map<number, Seat>();
      for (const s of g.active) {
        for (const p of g.pieces[s]) {
          assert.ok(p >= HANGAR && p <= GOAL);
          if (!isOnTrack(p)) continue;
          const idx = trackIndex(s, p);
          const owner = seen.get(idx);
          assert.ok(owner === undefined || owner === s, 'two colours share a square');
          seen.set(idx, s);
        }
      }
    }
    return g;
  }

  test('bot games always finish with legal positions', () => {
    for (let i = 0; i < 60; i++) {
      const g = play([0, 1, 2, 3], {}, ['easy', 'normal', 'hard', 'normal'], i + 1);
      assert.equal(g.ranking.length, 4);
    }
    for (let i = 0; i < 20; i++) {
      play([0, 2], { finish: 'exact', launchOn: 'even', playUntil: 'all', bonusRollOnCapture: true }, ['hard', 'easy', 'hard', 'easy'], 1000 + i);
    }
  });

  test('hard bots beat easy bots more often than not', () => {
    let hardWins = 0;
    for (let i = 0; i < 80; i++) {
      const g = play([0, 2], {}, ['hard', 'easy', 'easy', 'easy'], 500 + i);
      if (g.ranking[0] === 0) hardWins++;
    }
    assert.ok(hardWins > 44, `hard won ${hardWins}/80`);
  });
});

describe('points', () => {
  test('knock-outs are worth more the further the victim had come', () => {
    assert.equal(captureValue(1), POINTS.captureEarly);
    assert.equal(captureValue(EARLY_UNTIL), POINTS.captureEarly);
    assert.equal(captureValue(EARLY_UNTIL + 1), POINTS.captureMid);
    assert.equal(captureValue(LATE_FROM - 1), POINTS.captureMid);
    assert.equal(captureValue(LATE_FROM), POINTS.captureLate);
    assert.equal(captureValue(TRACK_LAST), POINTS.captureLate);
    assert.equal(captureValue(FLIGHT_CROSSES), POINTS.captureHomeColumn);
  });

  test('a move scores its knock-outs and tallies both sides', () => {
    const g = at(game(), 0, [5]);
    at(g, 1, [sameSquare(0, 7, 1)]);
    const victimPos = g.pieces[1][0];
    Object.assign(g, { phase: 'move', dice: 2, movable: [0] });
    const { state, event } = applyMove(g, 0);
    assert.equal(event.points, captureValue(victimPos));
    assert.deepEqual(state.stats[0], { points: captureValue(victimPos), home: 0, captures: 1, lost: 0 });
    assert.equal(state.stats[1].lost, 1);
  });

  test('a flight knocking out a piece in its home column is worth 70', () => {
    const g = at(game(), 0, [15]);
    at(g, 2, [FLIGHT_CROSSES]);
    assert.equal(planMove(g, 0, 0, 3)!.points, POINTS.captureHomeColumn);
  });

  test('the first to bring all four home gets the bonus; the next one does not', () => {
    const g = at(game([0, 1, 2], { playUntil: 'all' }), 0, [GOAL, GOAL, GOAL, GOAL - 2]);
    at(g, 1, [GOAL, GOAL, GOAL, GOAL - 2]);
    Object.assign(g, { phase: 'move', dice: 2, movable: [3] });
    const first = applyMove(g, 3);
    assert.equal(first.event.bonus, POINTS.firstHome);
    assert.equal(first.state.stats[0].points, POINTS.home + POINTS.firstHome);
    const s2 = first.state;
    Object.assign(s2, { turn: 1, phase: 'move', dice: 2, movable: [3] });
    const second = applyMove(s2, 3);
    assert.equal(second.event.seatFinished, true);
    assert.equal(second.event.bonus, 0);
    assert.equal(second.state.stats[1].points, POINTS.home);
  });

  test('a piece reaching the centre scores 100', () => {
    const g = at(game(), 0, [GOAL - 3]);
    Object.assign(g, { phase: 'move', dice: 3, movable: [0] });
    const { state, event } = applyMove(g, 0);
    assert.equal(event.points, POINTS.home);
    assert.equal(state.stats[0].home, 1);
  });

  test('by points, a big scorer beats the first player home, bonus and all', () => {
    let g = at(game([0, 2]), 0, [GOAL, GOAL, GOAL, GOAL - 3]);
    g.stats[0].points = 300;
    g.stats[2].points = 300 + POINTS.home + POINTS.firstHome + 50;
    g = applyRoll(g, 3).state;
    const { state } = applyMove(g, 3);
    assert.equal(state.phase, 'over');
    assert.deepEqual(state.ranking, [0, 2]);
    assert.deepEqual(state.standings, [2, 0]);
  });

  test('race mode keeps the finishing order', () => {
    let g = at(game([0, 2], { winBy: 'race' }), 0, [GOAL, GOAL, GOAL, GOAL - 3]);
    g.stats[2].points = 999;
    g = applyRoll(g, 3).state;
    assert.deepEqual(applyMove(g, 3).state.standings, [0, 2]);
  });

  test('bot games add up: points = 100 per piece home + knock-out values', () => {
    let x = 7;
    const rand = () => ((x = (x * 1664525 + 1013904223) % 4294967296), x / 4294967296);
    let g = game([0, 1, 2, 3], { playUntil: 'all' });
    const earned = [0, 0, 0, 0];
    while (g.phase !== 'over') {
      if (g.phase === 'roll') g = applyRoll(g, 1 + Math.floor(rand() * 6)).state;
      else if (g.phase === 'bomb') g = applyBomb(g, chooseBomb(g, 'hard', rand)).state;
      else {
        const r = applyMove(g, chooseMove(g, 'hard', rand));
        earned[r.event.seat] += r.event.captures.reduce((s, c) => s + c.points, 0);
        if (r.event.bombed) earned[r.event.bombed.owner] += r.event.bombed.points;
        g = r.state;
      }
    }
    for (const s of SEATS) {
      const bonus = s === g.ranking[0] ? POINTS.firstHome : 0;
      assert.equal(g.stats[s].points, g.stats[s].home * POINTS.home + earned[s] + bonus);
    }
    assert.equal(g.standings.length, 4);
    assert.ok(g.standings.every((s, i) => i === 0 || g.stats[g.standings[i - 1]].points >= g.stats[s].points));
  });
});

describe('three sixes and bombs', () => {
  function twoSixes(rules: Partial<Rules> = {}) {
    let g = at(game([0, 1], rules), 0, [10, GOAL, HOME_FIRST + 1]);
    g = applyMove(applyRoll(g, 6).state, 0).state;
    g = applyMove(applyRoll(g, 6).state, 0).state;
    return g;
  }

  test('by default a third six sends every piece not yet home back, then the player places a bomb', () => {
    const { state, event } = applyRoll(twoSixes(), 6);
    assert.equal(event.outcome, 'penalty');
    assert.equal(event.bomb, true);
    assert.deepEqual(state.pieces[0], [HANGAR, GOAL, HANGAR, HANGAR]);
    assert.equal(state.phase, 'bomb');
    assert.equal(state.turn, 0);
  });

  test('a bomb goes on an empty track square and the turn moves on', () => {
    const g = applyRoll(twoSixes(), 6).state;
    at(g, 1, [7]);
    const taken = trackIndex(1, 7);
    assert.ok(!freeSquares(g).includes(taken), 'not under a piece');
    assert.throws(() => applyBomb(g, taken), /empty track square/);
    assert.throws(() => applyBomb(g, 52), /empty track square/);
    const { state, event } = applyBomb(g, trackIndex(1, 9));
    assert.deepEqual(event, { type: 'bomb', seat: 0, square: trackIndex(1, 9) });
    assert.deepEqual(state.bombs, [{ square: trackIndex(1, 9), owner: 0 }]);
    assert.equal(state.turn, 1);
    assert.equal(state.phase, 'roll');
    assert.throws(() => applyBomb(state, trackIndex(1, 20)), /Not time/);
  });

  test('landing on a bomb sends the piece home and scores for the bomber', () => {
    const g = at(game([0, 1]), 1, [30, 10]);
    g.bombs = [{ square: trackIndex(1, 32), owner: 0 }];
    g.turn = 1;
    const passing = planMove(g, 1, 0, 3)!;
    assert.equal(passing.bombed, undefined, 'passing over is fine');
    Object.assign(g, { phase: 'move', dice: 2, movable: [0, 1] });
    const { state, event } = applyMove(g, 0);
    assert.equal(event.to, HANGAR);
    assert.deepEqual(event.bombed, { owner: 0, square: trackIndex(1, 32), pos: 32, atStep: 1, points: captureValue(32), saved: false, revenge: false });
    assert.equal(state.pieces[1][0], HANGAR);
    assert.deepEqual(state.bombs, []);
    assert.equal(state.stats[0].points, captureValue(32));
    assert.equal(state.stats[0].captures, 1);
    assert.equal(state.stats[1].lost, 1);
  });

  test('a colour jump onto a bomb blows up too', () => {
    const g = at(game([0, 1]), 0, [8]);
    g.bombs = [{ square: trackIndex(0, 14), owner: 1 }];
    const plan = planMove(g, 0, 0, 2)!;
    assert.deepEqual(plan.path.map((p) => p.kind), ['step', 'step', 'jump']);
    assert.equal(plan.bombed?.pos, 14);
    assert.equal(plan.to, HANGAR);
  });

  test('the dice is fair on normal and leans towards trouble on hard', () => {
    const g = twoSixes();
    assert.deepEqual(rollWeights(g), [1, 1, 1, 1, 1, 1]);
    g.rules.difficulty = 'hard';
    assert.deepEqual(rollWeights(g), [1, 1, 1, 1, 1, MEANNESS.hard]);
    g.rules.difficulty = 'easy';
    assert.deepEqual(rollWeights(g), [1, 1, 1, 1, 1, MEANNESS.easy]);

    const b = at(game([0, 1], { difficulty: 'hard' }), 0, [10]);
    b.bombs = [{ square: trackIndex(0, 13), owner: 1 }];
    assert.deepEqual(rollWeights(b), [1, 1, MEANNESS.hard, 1, 1, 1]);
  });

  test('weighted rolls follow the weights', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    const w = [1, 1, 1, 1, 1, 3];
    const total = 800;
    for (let r = 0; r < total; r++) counts[rollWeighted(w, () => r) - 1]++;
    assert.deepEqual(counts, [100, 100, 100, 100, 100, 300]);
  });

  test('bots drop bombs in front of opponents', () => {
    const g = applyRoll(twoSixes(), 6).state;
    at(g, 1, [20]);
    const sq = chooseBomb(g, 'hard', () => 0);
    assert.ok(freeSquares(g).includes(sq));
    const ahead = [1, 2, 3, 4, 5, 6].map((d) => trackIndex(1, 20 + d));
    assert.ok(ahead.includes(sq), `bomb at ${sq} should be in front of the piece`);
  });

  test('bot games with bombs on hard still finish', () => {
    for (let n = 0; n < 5; n++) {
      let g = createGame([0, 1, 2, 3], { ...DEFAULT_RULES, difficulty: 'hard' });
      let bombsPlaced = 0;
      for (let i = 0; i < 20000 && g.phase !== 'over'; i++) {
        if (g.phase === 'roll') g = applyRoll(g, rollWeighted(rollWeights(g), (k) => Math.floor(Math.random() * k))).state;
        else if (g.phase === 'box') g = applyBox(g, chooseBox(g, 'normal')).state;
        else if (g.phase === 'move') g = applyMove(g, chooseMove(g, 'normal')).state;
        else {
          g = applyBomb(g, chooseBomb(g, 'normal')).state;
          bombsPlaced++;
        }
      }
      assert.equal(g.phase, 'over');
      assert.ok(bombsPlaced >= 0);
    }
  });
});

describe('magic boxes', () => {
  const pick = (outcome: string) => () => ['bomb', 'vest', 'empty', 'minus'].indexOf(outcome);

  test('everyone hides a box in turn order before the first roll', () => {
    let g = createGame([0, 1, 3], DEFAULT_RULES, 1);
    assert.equal(g.phase, 'box');
    assert.equal(g.turn, 1);
    assert.throws(() => applyRoll(g, 6), /Not time to roll/);
    g = applyBox(g, 10).state;
    assert.equal(g.turn, 3);
    assert.throws(() => applyBox(g, 10), /empty track square/, 'one box per square');
    g = applyBox(g, 11).state;
    assert.equal(g.turn, 0);
    assert.equal(g.phase, 'box');
    g = applyBox(g, 12).state;
    assert.equal(g.phase, 'roll');
    assert.equal(g.turn, 1, 'the first player starts');
    assert.deepEqual(
      g.boxes.map((b) => b.owner),
      [1, 3, 0],
    );
    assert.throws(() => applyBox(g, 20), /Not time/);
  });

  function onBox(outcome: string) {
    const g = at(game([0, 1]), 0, [30, 5]);
    g.boxes = [{ square: trackIndex(0, 32), owner: 1 }];
    Object.assign(g, { phase: 'move', dice: 2, movable: [0, 1] });
    return applyMove(g, 0, pick(outcome));
  }

  test('a bomb inside sends the piece home and scores for the box owner', () => {
    const { state, event } = onBox('bomb');
    assert.equal(event.box?.outcome, 'bomb');
    assert.equal(event.to, HANGAR);
    assert.equal(state.pieces[0][0], HANGAR);
    assert.deepEqual(state.boxes, []);
    assert.equal(state.stats[1].points, captureValue(32));
    assert.equal(state.stats[0].lost, 1);
  });

  test('a vest stops the next bomb, then is used up', () => {
    const { state } = onBox('vest');
    assert.equal(state.pieces[0][0], 32);
    assert.deepEqual(state.vests, [1, 0, 0, 0]);
    state.bombs = [{ square: trackIndex(0, 35), owner: 1 }];
    Object.assign(state, { turn: 0, phase: 'move', dice: 3, movable: [0, 1] });
    const r = applyMove(state, 0);
    assert.equal(r.event.bombed?.saved, true);
    assert.equal(r.state.pieces[0][0], 35, 'the piece stays on the board');
    assert.deepEqual(r.state.vests, [0, 0, 0, 0]);
    assert.deepEqual(r.state.bombs, []);
    assert.equal(r.state.stats[1].points, 0, 'no points for a bomb the vest stopped');
  });

  test('an empty box does nothing; a points box takes 10', () => {
    const empty = onBox('empty');
    assert.equal(empty.state.pieces[0][0], 32);
    assert.equal(empty.state.stats[0].points, 0);
    assert.deepEqual(empty.state.boxes, [], 'opened boxes are gone');
    const minus = onBox('minus');
    assert.equal(minus.event.points, -POINTS.boxPenalty);
    assert.equal(minus.state.stats[0].points, -POINTS.boxPenalty);
  });

  test('a box opens for its owner too, with no points for blowing yourself up; passing over is safe', () => {
    const g = at(game([0, 1]), 0, [30, 5]);
    g.boxes = [
      { square: trackIndex(0, 32), owner: 0 },
      { square: trackIndex(0, 31), owner: 1 },
    ];
    Object.assign(g, { phase: 'move', dice: 2, movable: [0, 1] });
    const { state, event } = applyMove(g, 0, pick('bomb'));
    assert.equal(event.box?.owner, 0, 'its own box, not the one it passed');
    assert.equal(event.box?.points, 0);
    assert.equal(state.pieces[0][0], HANGAR);
    assert.deepEqual(state.boxes, [{ square: trackIndex(0, 31), owner: 1 }]);
    assert.equal(state.stats[0].points, 0);
    assert.equal(state.stats[0].captures, 0);
    assert.equal(state.stats[0].lost, 1);
  });

  test('a preview leaves the box closed', () => {
    const g = at(game([0, 1]), 0, [30]);
    g.boxes = [{ square: trackIndex(0, 32), owner: 1 }];
    const plan = planMove(g, 0, 0, 2)!;
    assert.ok(plan.box, 'the box is on the way');
    assert.equal(plan.box.outcome, undefined);
    assert.equal(plan.to, 32);
  });

  test('an opened box holds the move for its reveal and always gets a GIF', () => {
    const empty = onBox('empty').event;
    assert.equal(eventDuration(empty), boxOpenAt(empty) + BOX_REVEAL_MS);
    const bomb = onBox('bomb').event;
    assert.equal(blastAt(bomb), boxOpenAt(bomb) + BOX_REVEAL_MS, 'the bomb goes off after the reveal');
    const mood = (outcome: string) => reactionsFor(onBox(outcome).event, () => 0).map((r) => [r.seat, REACTION_BY_ID.get(r.id)!.group]);
    assert.deepEqual(mood('vest'), [[0, 'happy']]);
    assert.deepEqual(mood('empty'), [[0, 'happy']]);
    assert.deepEqual(mood('minus'), [[0, 'sad']]);
    assert.deepEqual(mood('bomb'), [
      [0, 'sad'],
      [1, 'happy'],
    ]);
  });

  test('bots hide boxes where opponents will pass', () => {
    const g = createGame([0, 2], DEFAULT_RULES, 0);
    const sq = chooseBox(g, 'hard', () => 0);
    const early = Array.from({ length: 12 }, (_, i) => trackIndex(2, i + 1));
    assert.ok(early.includes(sq), `box at ${sq} should be on the opponent's first stretch`);
  });
});

describe('bot priorities', () => {
  test('knocking a piece out comes before bringing one home', () => {
    for (const level of ['normal', 'hard'] as const) {
      const g = at(game([0, 2]), 0, [GOAL - 3, 9]);
      at(g, 2, [sameSquare(0, 12, 2)]);
      Object.assign(g, { phase: 'move', dice: 3, movable: [0, 1] });
      assert.equal(chooseMove(g, level, () => 0), 1, level);
    }
  });

  test('without a knock-out, bringing a piece home comes first', () => {
    const g = at(game([0, 2]), 0, [GOAL - 3, 9]);
    Object.assign(g, { phase: 'move', dice: 3, movable: [0, 1] });
    assert.equal(chooseMove(g, 'hard', () => 0), 0);
  });
});

describe('revenge and playing on', () => {
  /** Seat `hitter` knocks out the piece `victim` has at `pos` (their own numbering), with a 2. */
  function knockOut(g: GameState, hitter: Seat, victim: Seat, pos: number) {
    at(g, hitter, [sameSquare(victim, pos, hitter) - 2]);
    at(g, victim, [pos]);
    Object.assign(g, { turn: hitter, phase: 'move', dice: 2, movable: [0] });
    return applyMove(g, 0);
  }

  test('knocking out whoever last knocked you out counts 1.5 times, once', () => {
    let g = game([0, 2]);
    const first = knockOut(g, 2, 0, 30);
    assert.equal(first.event.captures[0].revenge, false);
    assert.deepEqual(first.state.lastHitBy, [2, null, null, null]);

    g = first.state;
    const back = knockOut(g, 0, 2, 30);
    assert.equal(back.event.captures[0].revenge, true);
    assert.equal(back.event.captures[0].points, Math.round(captureValue(30) * REVENGE));
    assert.deepEqual(back.state.lastHitBy, [null, null, 0, null], 'settled, and now 2 may take revenge');

    const again = knockOut(back.state, 0, 2, 30);
    assert.equal(again.event.captures[0].revenge, false, 'one revenge per knock-out received');
  });

  test('a bomb counts as a knock-out for revenge', () => {
    const g = at(game([0, 1]), 1, [30]);
    g.bombs = [{ square: trackIndex(1, 32), owner: 0 }];
    g.lastHitBy = [1, null, null, null];
    Object.assign(g, { turn: 1, phase: 'move', dice: 2, movable: [0] });
    const { event, state } = applyMove(g, 0);
    assert.equal(event.bombed?.revenge, true);
    assert.equal(event.bombed?.points, Math.round(captureValue(32) * REVENGE));
    assert.deepEqual(state.lastHitBy, [null, 0, null, null]);
  });

  test('by default the game goes on after the first player finishes, until only one is left', () => {
    let g = at(game([0, 1, 2]), 0, [GOAL, GOAL, GOAL, GOAL - 2]);
    Object.assign(g, { phase: 'move', dice: 2, movable: [3] });
    const r = applyMove(g, 3);
    assert.equal(r.event.seatFinished, true);
    assert.equal(r.state.phase, 'roll', 'still playing');
    assert.equal(r.state.turn, 1);
    g = at(r.state, 1, [GOAL, GOAL, GOAL, GOAL - 2]);
    Object.assign(g, { phase: 'move', dice: 2, movable: [3] });
    const second = applyMove(g, 3);
    assert.equal(second.state.phase, 'over', 'third place is decided');
    assert.deepEqual(second.state.ranking, [0, 1, 2]);
  });
});
