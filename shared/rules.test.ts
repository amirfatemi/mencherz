import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { botAction, chooseBomb, chooseBox, chooseMove, type BotLevel } from './ai.ts';
import {
  FLIGHT_CROSSES,
  FLIGHT_FROM,
  FLIGHT_TO,
  GOAL,
  HANGAR,
  HOME,
  HOME_FIRST,
  HOME_LAST,
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
import { REACTIONS, REACTION_BY_ID, reactionsFor } from './reactions.ts';
import { BOX_REVEAL_MS, PASS_HOLD_MS, ROLL_MS, blastAt, boxOpenAt, eventDuration } from './timing.ts';
import { EARLY_UNTIL, KING, LATE_FROM, POINTS, REVENGE, captureValue, killStreakBonus } from './scoring.ts';
import {
  DEFAULT_RULES,
  applyBomb,
  applyBox,
  applyMove,
  applyPlace,
  applyPower,
  applyRoll,
  applyVest,
  distinctMoves,
  vestOptions,
  freeSquares,
  createGame,
  newStats,
  placeOptions,
  planMove,
  ambushStart,
  availablePowers,
  AMBUSH_ROUNDS,
  ONCE_POWERS,
  wallSquares,
  BOX_OUTCOMES,
  type BoxOutcome,
  type GameState,
  type Rules,
} from './rules.ts';

// Magic boxes are off unless a test turns them on, so games start straight at the first roll.
// Power squares are off too, so no move stops on one by chance, and so are kings, so piece 0 scores like
// any other; tests for those turn them on.
function game(seats: Seat[] = [0, 1, 2, 3], rules: Partial<Rules> = {}): GameState {
  return createGame(seats, { ...DEFAULT_RULES, magicBoxes: false, powerSquares: false, kings: false, ...rules });
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

const randInt = (n: number) => Math.floor(Math.random() * n);

/** Plays whatever the game is waiting for, as a bot would, with a weighted dice. */
function botStep(g: GameState, level: BotLevel) {
  const a = botAction(g, level)!;
  switch (a.type) {
    case 'roll':
      return applyRoll(g, rollWeighted(rollWeights(g), randInt), randInt);
    case 'move':
      return applyMove(g, a.piece, randInt);
    case 'bomb':
      return applyBomb(g, a.square, randInt);
    case 'box':
      return applyBox(g, a.square);
    case 'place':
      return applyPlace(g, a.square, randInt);
    case 'power':
      return applyPower(g, a.choice, randInt, a.over);
    case 'vest':
      return applyVest(g, a.piece, randInt);
  }
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
    assert.deepEqual(state.stats[0], { ...newStats(), points: captureValue(victimPos), captures: 1, bestHit: captureValue(victimPos), bestStreak: 1 });
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
    assert.deepEqual(event.bombed, { owner: 0, square: trackIndex(1, 32), pos: 32, atStep: 1, points: captureValue(32), saved: false, revenge: false, king: false });
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

  test('bot games with every rule on, bombs on hard, still finish', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 8; n++) {
      let g = createGame([0, 1, 2, 3], { ...DEFAULT_RULES, difficulty: 'hard' });
      for (let i = 0; i < 20000 && g.phase !== 'over'; i++) {
        seen.add(g.phase);
        g = botStep(g, 'normal').state;
      }
      assert.equal(g.phase, 'over');
    }
    for (const phase of ['box', 'roll', 'move', 'power', 'place']) assert.ok(seen.has(phase), `reached the ${phase} phase`);
  });
});

describe('magic boxes', () => {
  const pick = (outcome: BoxOutcome) => () => BOX_OUTCOMES.indexOf(outcome);

  test('everyone hides a box in turn order before the first roll', () => {
    let g = createGame([0, 1, 3], { ...DEFAULT_RULES, powerSquares: false }, 1);
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

  function onBox(outcome: BoxOutcome) {
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

  test('a vest goes on one piece of your choice, in the hangar or out, and stops its next bomb', () => {
    const { state } = onBox('vest');
    assert.equal(state.pieces[0][0], 32);
    assert.equal(state.phase, 'vest', 'the mover picks who wears it');
    assert.equal(state.turn, 0);
    assert.deepEqual(vestOptions(state), [0, 1, 2, 3]);
    assert.throws(() => applyMove(state, 0), /Not time/);
    const worn = applyVest(state, 1);
    assert.deepEqual(worn.event, { type: 'vest', seat: 0, piece: 1 });
    assert.deepEqual(worn.state.vested[0], [0, 1, 0, 0]);
    assert.equal(worn.state.turn, 1, 'then the turn passes as usual');
    const g = worn.state;
    g.bombs = [{ square: trackIndex(0, 35), owner: 1 }, { square: trackIndex(0, 8), owner: 1 }];
    Object.assign(g, { turn: 0, phase: 'move', dice: 3, movable: [0, 1] });
    assert.equal(planMove(g, 0, 0, 3)!.bombed?.saved, false, "the other piece isn't covered");
    const r = applyMove(g, 1);
    assert.equal(r.event.bombed?.saved, true);
    assert.equal(r.state.pieces[0][1], 8, 'the piece stays on the board');
    assert.deepEqual(r.state.vested[0], [0, 0, 0, 0], 'used up');
    assert.equal(r.state.stats[1].points, 0, 'no points for a bomb the vest stopped');
  });

  test('a vest stays on its piece through a knock-out', () => {
    const g = at(game([0, 1]), 0, [30]);
    g.vested[0][0] = 1;
    at(g, 1, [sameSquare(0, 28, 1)]);
    Object.assign(g, { turn: 1, phase: 'move', dice: 2, movable: [0] });
    const r = applyMove(g, 0);
    assert.equal(r.state.pieces[0][0], HANGAR);
    assert.equal(r.state.vested[0][0], 1);
  });

  test('a points box gives 20 or takes 10, and the piece stays put', () => {
    const plus = onBox('plus');
    assert.equal(plus.state.pieces[0][0], 32);
    assert.equal(plus.event.points, POINTS.boxBonus);
    assert.equal(plus.state.stats[0].points, POINTS.boxBonus);
    assert.deepEqual(plus.state.boxes, [], 'opened boxes are gone');
    const minus = onBox('minus');
    assert.equal(minus.event.points, -POINTS.boxPenalty);
    assert.equal(minus.state.stats[0].points, -POINTS.boxPenalty);
  });

  test('ice freezes the piece on the box, with no jump, until its next turn is over', () => {
    const g = at(game([0, 1]), 0, [30, 5]);
    assert.ok(isOwnColor(34));
    g.boxes = [{ square: trackIndex(0, 34), owner: 1 }];
    Object.assign(g, { phase: 'move', dice: 4, movable: [0, 1] });
    const r = applyMove(g, 0, pick('freeze'));
    assert.equal(r.event.box?.outcome, 'freeze');
    assert.equal(r.event.jumped, false, 'stuck on the box, no colour jump');
    assert.equal(r.state.pieces[0][0], 34);
    let s = applyRoll(r.state, 3).state;
    assert.equal(s.turn, 0, 'seat 1 had nothing to move');
    const frozenTurn = applyRoll(s, 2);
    assert.deepEqual(frozenTurn.event.movable, [1], 'the frozen piece sits out its next turn');
    assert.equal(planMove(frozenTurn.state, 0, 0, 2), null);
    s = applyMove(frozenTurn.state, 1).state;
    s = applyRoll(s, 3).state;
    assert.deepEqual(applyRoll(s, 2).event.movable, [0, 1], 'free again after that turn');
  });

  test('ice lasts through a bonus roll on a 6 as well', () => {
    const g = at(game([0, 1]), 0, [26, 5]);
    g.boxes = [{ square: trackIndex(0, 32), owner: 1 }];
    Object.assign(g, { phase: 'move', dice: 6, movable: [0, 1] });
    const r = applyMove(g, 0, pick('freeze'));
    assert.equal(r.state.turn, 0, 'a 6 rolls again');
    assert.deepEqual(applyRoll(r.state, 1).event.movable, [1]);
  });

  test('a frozen piece can still be knocked out, which frees it', () => {
    const { state } = onBox('freeze');
    assert.equal(state.frozen[0][0], 1);
    at(state, 1, [sameSquare(0, 29, 1)]);
    Object.assign(state, { phase: 'move', dice: 3, movable: [0] });
    const r = applyMove(state, 0);
    assert.deepEqual(
      r.event.captures.map((c) => [c.seat, c.piece]),
      [[0, 0]],
    );
    assert.equal(r.state.pieces[0][0], HANGAR);
    assert.equal(r.state.frozen[0][0], 0);
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
    const plus = onBox('plus').event;
    assert.equal(eventDuration(plus), boxOpenAt(plus) + BOX_REVEAL_MS);
    const bomb = onBox('bomb').event;
    assert.equal(blastAt(bomb), boxOpenAt(bomb) + BOX_REVEAL_MS, 'the bomb goes off after the reveal');
    const mood = (outcome: BoxOutcome) => reactionsFor(onBox(outcome).event, (group) => REACTIONS.find((r) => r.group === group)!.id).map((r) => [r.seat, REACTION_BY_ID.get(r.id)!.group]);
    assert.deepEqual(mood('vest'), [[0, 'happy']]);
    assert.deepEqual(mood('plus'), [[0, 'happy']]);
    assert.deepEqual(mood('minus'), [[0, 'sad']]);
    assert.deepEqual(mood('freeze'), [
      [0, 'sad'],
      [1, 'happy'],
    ]);
    assert.deepEqual(mood('bomb'), [
      [0, 'sad'],
      [1, 'happy'],
    ]);
  });

  test('bots hide boxes where opponents will pass', () => {
    const g = createGame([0, 2], { ...DEFAULT_RULES, powerSquares: false }, 0);
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

describe('walls', () => {
  // Seat 0's piece at 1; seat 1 has two pieces on seat 0's square 4.
  function walled() {
    const g = at(game([0, 1]), 0, [1]);
    const wall = sameSquare(0, 4, 1);
    at(g, 1, [wall, wall]);
    return g;
  }

  test('two pieces of one colour on a square make a wall', () => {
    assert.deepEqual(wallSquares(walled()), [trackIndex(0, 4)]);
  });

  test('other colours cannot pass a wall', () => {
    const g = walled();
    assert.equal(planMove(g, 0, 0, 5), null);
    assert.equal(planMove(g, 0, 0, 2)?.to, 3, 'stopping short is fine');
  });

  test('a colour jump cannot leap over a wall either', () => {
    const plan = planMove(walled(), 0, 0, 1)!;
    assert.ok(isOwnColor(2));
    assert.equal(plan.jumped, false);
    assert.equal(plan.to, 2);
  });

  test('landing on a wall knocks out both pieces, and scores both, the second as a double kill', () => {
    const g = walled();
    const plan = planMove(g, 0, 0, 3)!;
    const v = g.pieces[1][0];
    assert.deepEqual(
      plan.captures.map((c) => [c.seat, c.streak, c.points]),
      [
        [1, 1, captureValue(v)],
        [1, 2, Math.round(captureValue(v) * killStreakBonus(2))],
      ],
    );
  });

  test('your own wall does not block you, and walls can be switched off', () => {
    const own = at(game([0, 1]), 0, [1, 4, 4]);
    assert.equal(planMove(own, 0, 0, 5)?.to, 10, 'passes, then jumps from 6');
    const off = walled();
    off.rules.walls = false;
    assert.equal(planMove(off, 0, 0, 5)?.to, 10, 'passes, then jumps from 6');
  });
});

describe('kill streaks', () => {
  function hit(kills: number) {
    const g = at(game([0, 1]), 0, [20]);
    g.kills[0][0] = kills;
    at(g, 1, [sameSquare(0, 22, 1)]);
    Object.assign(g, { phase: 'move', dice: 2, movable: [0] });
    return { g, v: g.pieces[1][0], ...applyMove(g, 0) };
  }

  test("a piece's second knock-out counts 1.5 times, its third and later twice", () => {
    for (const [before, times] of [
      [0, 1],
      [1, 1.5],
      [2, 2],
      [5, 2],
    ]) {
      const { event, v } = hit(before);
      assert.equal(event.captures[0].streak, before + 1);
      assert.equal(event.captures[0].points, Math.round(captureValue(v) * times));
    }
  });

  test('the streak counts on, and ends for a piece that is knocked out', () => {
    const { state, g } = hit(1);
    assert.equal(state.kills[0][0], 2);
    g.kills[1][0] = 3;
    assert.equal(applyMove(g, 0).state.kills[1][0], 0);
  });
});

describe('kings', () => {
  const crowned = () => game([0, 1], { kings: true });
  function knock(hitter: number, victim: number) {
    const g = crowned();
    g.pieces[0] = [HANGAR, HANGAR, HANGAR, HANGAR];
    g.pieces[0][hitter] = 20;
    g.pieces[1][victim] = sameSquare(0, 22, 1);
    return { v: g.pieces[1][victim], plan: planMove(g, 0, hitter, 2)! };
  }

  test('knocking out a king counts 1.5 times; knocking out with one counts as usual', () => {
    for (const [hitter, victim, times] of [
      [1, 1, 1],
      [1, 0, KING],
      [0, 1, 1],
      [0, 0, KING],
    ]) {
      const { v, plan } = knock(hitter, victim);
      assert.equal(plan.captures[0].points, Math.round(captureValue(v) * times), `piece ${hitter} hits piece ${victim}`);
      assert.equal(plan.captures[0].king, victim === 0);
    }
  });

  test('a king sharing a square with its pieces is a move of its own', () => {
    const g = at(crowned(), 0, [20, 20, 20]);
    Object.assign(g, { phase: 'move', dice: 3, movable: [0, 1, 2] });
    assert.deepEqual(distinctMoves(g), [0, 1]);
    g.rules.kings = false;
    assert.deepEqual(distinctMoves(g), [0]);
  });

  test("a bomb's owner gets the king's bonus too", () => {
    const g = at(crowned(), 1, [30]);
    g.bombs = [{ square: trackIndex(1, 32), owner: 0 }];
    const plan = planMove(g, 1, 0, 2)!;
    assert.equal(plan.bombed?.king, true);
    assert.equal(plan.bombed?.points, Math.round(captureValue(32) * KING));
  });

  test('even the biggest knock-out, a revenge triple kill of a king in its home column, stays under the biggest award', () => {
    const g = at(crowned(), 0, [15]);
    at(g, 2, [FLIGHT_CROSSES]);
    g.active = [0, 1, 2];
    g.lastHitBy[0] = 2;
    g.kills[0][0] = 2;
    const c = planMove(g, 0, 0, 3)!.captures[0];
    assert.equal(c.points, Math.round(captureValue(FLIGHT_CROSSES) * REVENGE * KING * killStreakBonus(3)));
    assert.ok(c.points < POINTS.firstHome);
  });
});

describe('power squares and bridges', () => {
  const powered = (rand: (n: number) => number = () => 0) => createGame([0, 1], { ...DEFAULT_RULES, magicBoxes: false, kings: false }, 0, rand);

  test('there is one, and nothing else can go on it', () => {
    const g = powered();
    assert.equal(g.power.length, 1);
    assert.ok(!freeSquares(g).includes(g.power[0]));
  });

  test('they are nobody\'s colour: no colour jump from them, and never on a flight square', () => {
    const g = at(powered(), 0, [3]);
    assert.ok(isOwnColor(6));
    g.power = [trackIndex(0, 6)];
    const plan = planMove(g, 0, 0, 3)!;
    assert.equal(plan.jumped, false);
    assert.equal(plan.to, 6);
    assert.equal(plan.power, true);
    const flights = SEATS.map((seat) => trackIndex(seat, FLIGHT_FROM));
    for (let n = 0; n < 30; n++) {
      const fresh = createGame([0, 1, 2, 3], { ...DEFAULT_RULES, magicBoxes: false }, 0);
      assert.ok(!fresh.power.some((sq) => flights.includes(sq)));
    }
  });

  test('they move every five rounds', () => {
    let g = powered();
    const first = [...g.power];
    const last = (n: number) => n - 1;
    for (let turn = 1; turn < 10; turn++) g = applyRoll(g, 3, last).state;
    assert.deepEqual(g.power, first, 'not yet after nine turns of two players');
    g = applyRoll(g, 3, last).state;
    assert.notDeepEqual(g.power, first);
    assert.equal(g.power.length, 1);
  });

  function onPower(dice = 2) {
    const g = at(powered(), 0, [3]);
    g.power = [trackIndex(0, 3 + dice), trackIndex(0, 45)];
    Object.assign(g, { phase: 'move', dice, movable: [0] });
    return applyMove(g, 0);
  }

  test('ending a move on one asks for a power; the turn then carries on', () => {
    const { state, event } = onPower();
    assert.equal(event.power, true);
    assert.equal(state.phase, 'power');
    const box = applyPower(state, 'box').state;
    assert.equal(box.phase, 'place');
    const placed = applyPlace(box, trackIndex(1, 8));
    assert.deepEqual(placed.event, { type: 'box', seat: 0, square: trackIndex(1, 8) });
    assert.deepEqual(placed.state.boxes, [{ square: trackIndex(1, 8), owner: 0 }]);
    assert.equal(placed.state.turn, 1, 'a 2: the turn passes');
    const six = applyPlace(applyPower(onPower(6).state, 'box').state, trackIndex(1, 8)).state;
    assert.equal(six.turn, 0, 'a 6: roll again');
    assert.equal(six.phase, 'roll');
  });

  test('a box from a power square opens like any other, for its owner too', () => {
    const g = applyPlace(applyPower(onPower().state, 'box').state, trackIndex(0, 8)).state;
    Object.assign(g, { turn: 0, phase: 'move', dice: 3, movable: [0] });
    const r = applyMove(g, 0, () => BOX_OUTCOMES.indexOf('plus'));
    assert.equal(r.event.box?.owner, 0);
    assert.equal(r.event.points, POINTS.boxBonus);
  });

  test('a heaven bridge carries whoever lands on it 10 squares ahead, once', () => {
    let g = applyPower(onPower().state, 'heaven').state;
    assert.equal(g.phase, 'place');
    const square = trackIndex(1, 12);
    assert.ok(freeSquares(g).includes(square));
    g = applyPlace(g, square).state;
    assert.deepEqual(g.bridges, [{ square, to: trackIndex(1, 22), kind: 'heaven', owner: 0 }]);
    assert.equal(g.turn, 1);
    at(g, 1, [9]);
    Object.assign(g, { phase: 'move', dice: 3, movable: [0] });
    const r = applyMove(g, 0);
    assert.equal(r.event.bridge?.kind, 'heaven');
    assert.equal(r.event.path.at(-1)?.kind, 'bridge');
    assert.equal(r.state.pieces[1][0], 22);
    assert.deepEqual(r.state.bridges, [], 'used up');
  });

  test('a hell bridge sends back 20, or to the takeoff spot', () => {
    const g = at(powered(), 1, [27, 12]);
    g.bridges = [
      { square: trackIndex(1, 30), to: trackIndex(1, 10), kind: 'hell', owner: 0 },
      { square: trackIndex(1, 14), to: trackIndex(1, 46), kind: 'hell', owner: 0 },
    ];
    assert.equal(planMove(g, 1, 0, 3)!.to, 10);
    assert.equal(planMove(g, 1, 1, 2)!.to, TAKEOFF, 'not back past its start');
  });

  test('a heaven bridge does nothing for a piece about to turn home', () => {
    const g = at(powered(), 0, [44]);
    g.bridges = [{ square: trackIndex(0, 46), to: trackIndex(0, 56 % 52), kind: 'heaven', owner: 1 }];
    g.power = [];
    const plan = planMove(g, 0, 0, 2)!;
    assert.equal(plan.bridge, undefined);
    assert.equal(plan.to, 50, 'it jumps from its colour as usual');
  });
});

describe('safe squares and the ambush', () => {
  // Seat 0 is on the power square (its square 5) and picks a power.
  function power(seats: Seat[] = [0, 1]) {
    const g = at(game(seats, { powerSquares: true }), 0, [3, 20]);
    g.power = [trackIndex(0, 5)];
    Object.assign(g, { phase: 'move', dice: 2, movable: [0, 1] });
    return applyMove(g, 0).state;
  }

  test("a safe square keeps its owner's piece from being knocked out for two rounds", () => {
    let g = applyPower(power(), 'safe').state;
    assert.equal(g.phase, 'place');
    const square = trackIndex(0, 20);
    assert.ok(placeOptions(g).includes(square), 'it can go under your own piece');
    assert.ok(!placeOptions(g).includes(g.power[0]), 'not on the power square');
    g = applyPlace(g, square).state;
    assert.deepEqual(g.safe, [{ square, owner: 0, until: g.turnNo + 3 }]);
    at(g, 1, [sameSquare(0, 18, 1)]);
    Object.assign(g, { turn: 1, phase: 'move', dice: 2, movable: [0] });
    const r = applyMove(g, 0);
    assert.deepEqual(r.event.captures, [], 'the opponent lands, but hits nothing');
    assert.equal(r.state.pieces[0][1], 20);
    assert.equal(trackIndex(1, r.state.pieces[1][0]), square, 'both stand on it');
    assert.ok(!freeSquares(r.state).includes(square), 'nothing else can go there meanwhile');
  });

  test('a safe square protects only its owner, and lasts two rounds', () => {
    // Placed on seat 0's turn 1; nobody has anything to move after that, so every roll passes.
    let g = at(applyPlace(applyPower(power(), 'safe').state, trackIndex(0, 20)).state, 0, []);
    assert.equal(g.turn, 1);
    for (let turn = 0; turn < 2; turn++) g = applyRoll(g, 3).state;
    assert.equal(g.safe.length, 1, 'still there for the other player\'s second turn');
    g = applyRoll(g, 3).state;
    assert.equal(g.turn, 0);
    assert.deepEqual(g.safe, [], 'gone when its owner comes round the second time');
  });

  test('the ambush adds a second flight over a home column, and every flight over it knocks out the whole column', () => {
    const g = applyPower(power([0, 1, 2, 3]), 'ambush', undefined, 2).state;
    assert.deepEqual(g.ambush, { over: 2, owner: 0, until: 1 + AMBUSH_ROUNDS * 4 }, 'five rounds of four players from turn 1');
    at(g, 2, [HOME_FIRST, HOME_FIRST + 2, HOME_LAST]);
    // Yellow's flight crosses green's home column. Yellow's ✈ corner square is half red: red flies from that
    // triangle to the red square on the far side, over the same column.
    assert.equal(ambushStart(2), trackIndex(0, FLIGHT_FROM - 1));
    assert.equal(trackColor(ambushStart(2)), 3);
    assert.equal(trackColor(trackIndex(0, FLIGHT_FROM + 11)), 3);
    at(g, 3, [sameSquare(0, FLIGHT_FROM - 1, 3) - 2]);
    Object.assign(g, { turn: 3, phase: 'move', dice: 2, movable: [0] });
    const plan = planMove(g, 3, 0, 2)!;
    assert.equal(plan.flew, true);
    const landing = plan.path.find((step) => step.kind === 'fly')!.pos;
    assert.equal(trackIndex(3, landing), trackIndex(0, FLIGHT_FROM + 11), 'red to red');
    const blue = at(structuredClone(g), 1, [sameSquare(0, FLIGHT_FROM + 1, 1) - 2]);
    Object.assign(blue, { turn: 1 });
    assert.equal(planMove(blue, 1, 0, 2)!.flew, false, 'blue has no flight over it');
    assert.deepEqual(
      plan.captures.filter((c) => c.byFlight).map((c) => [c.seat, c.from]),
      [
        [2, HOME_FIRST],
        [2, HOME_FIRST + 2],
        [2, HOME_LAST],
      ],
    );
    const own = at(structuredClone(g), 0, [FLIGHT_FROM - 2]);
    Object.assign(own, { turn: 0 });
    assert.equal(planMove(own, 0, 0, 2)!.captures.length, 3, "yellow's own flight takes the whole column too");
    const green = at(structuredClone(g), 2, [sameSquare(0, FLIGHT_FROM, 2) - 2]);
    assert.equal(planMove(green, 2, 0, 2)!.flew, false, "green can't use the bridge over its own column");
  });

  test('the ambush needs another player still playing, and ends after five rounds', () => {
    assert.throws(() => applyPower(power(), 'ambush', undefined, 0), /another player/);
    let g = at(applyPower(power(), 'ambush', undefined, 1).state, 0, []);
    // Set on turn 1 of two players: it lasts until its owner comes round the fifth time, on turn 11.
    while (g.turnNo < 10) g = applyRoll(g, 3).state;
    assert.ok(g.ambush);
    g = applyRoll(g, 3).state;
    assert.equal(g.turnNo, 1 + AMBUSH_ROUNDS * 2);
    assert.equal(g.ambush, null);
  });
});

describe('once-a-game powers and the super bomb', () => {
  function power(seats: Seat[] = [0, 1, 2]) {
    const g = at(game(seats, { powerSquares: true }), 0, [3]);
    g.power = [trackIndex(0, 5)];
    Object.assign(g, { phase: 'move', dice: 2, movable: [0] });
    return applyMove(g, 0).state;
  }

  test('bridges, the ambush and the super bomb can be picked once a game; boxes and safe squares any time', () => {
    const g = applyPower(power(), 'heaven').state;
    assert.deepEqual(g.usedPowers, ['heaven']);
    const later = power();
    later.usedPowers = ['heaven', 'ambush'];
    assert.deepEqual(availablePowers(later), ['hell', 'box', 'safe', 'superBomb']);
    assert.throws(() => applyPower(later, 'heaven'), /already been used/);
    later.usedPowers = [...ONCE_POWERS];
    assert.deepEqual(availablePowers(later), ['box', 'safe']);
    assert.deepEqual(applyPower(later, 'box').state.usedPowers, ONCE_POWERS, 'a box never runs out');
  });

  test('a super bomb also blows up every piece within two squares, ahead or behind, the owner\'s too', () => {
    let g = applyPower(power(), 'superBomb').state;
    assert.equal(g.phase, 'place');
    const square = trackIndex(1, 20);
    g = applyPlace(g, square).state;
    assert.deepEqual(g.bombs, [{ square, owner: 0, super: true }]);
    // Blue steps on it from two behind, where a green piece also stands. Around it: yellow (the owner) one
    // ahead, blue two ahead, green three ahead.
    at(g, 1, [18, 22]);
    at(g, 2, [sameSquare(1, 18, 2), sameSquare(1, 23, 2)]);
    g.pieces[0] = [sameSquare(1, 21, 0), GOAL, GOAL, GOAL];
    Object.assign(g, { turn: 1, phase: 'move', dice: 2, movable: [0, 1] });
    const r = applyMove(g, 0);
    assert.deepEqual(
      r.event.bombed?.blast?.map((v) => [v.seat, v.piece, v.saved]).sort(),
      [
        [0, 0, false],
        [1, 1, false],
        [2, 0, false],
      ].sort(),
    );
    assert.equal(r.state.pieces[1][0], HANGAR, 'the piece that stepped on it');
    assert.equal(r.state.pieces[1][1], HANGAR, 'two ahead');
    assert.equal(r.state.pieces[2][0], HANGAR, 'two behind');
    assert.equal(r.state.pieces[0][0], HANGAR, "the owner's own piece one ahead");
    assert.equal(r.state.pieces[2][1], sameSquare(1, 23, 2), 'three ahead is out of reach');
    assert.deepEqual(r.state.bombs, []);
    assert.equal(
      r.state.stats[0].points,
      captureValue(20) + captureValue(22) + captureValue(sameSquare(1, 18, 2)),
      'the owner scores the others, not its own',
    );
  });

  test('a vest or a safe square keeps a piece out of the blast; home columns are out of reach', () => {
    const g = power([0, 1]);
    g.phase = 'move';
    g.bombs = [{ square: trackIndex(1, 20), owner: 0, super: true }];
    at(g, 1, [18, 21, 22]);
    g.pieces[0] = [sameSquare(1, 19, 0), GOAL, GOAL, HOME_FIRST];
    g.vested[1][1] = 1;
    g.safe = [{ square: trackIndex(1, 22), owner: 1, until: 99 }];
    Object.assign(g, { turn: 1, dice: 2, movable: [0, 1, 2] });
    const blast = planMove(g, 1, 0, 2)!.bombed!.blast!;
    assert.deepEqual(
      blast.map((v) => [v.seat, v.piece, v.saved]).sort(),
      [
        [0, 0, false],
        [1, 1, true],
      ].sort(),
    );
  });
});

describe('unplayable rolls', () => {
  test('without a bot, an unplayable roll is not held', () => {
    const { event } = applyRoll(game([0, 1]), 3);
    assert.equal(eventDuration(event), ROLL_MS + PASS_HOLD_MS);
    assert.equal(eventDuration(event, false), ROLL_MS);
  });
});
