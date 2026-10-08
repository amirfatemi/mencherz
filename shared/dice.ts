import { legalPieces, planMove, type GameState, type Rules } from './rules.ts';

/**
 * How strongly the dice leans towards trouble at each difficulty: the weight of a roll that would be a
 * third six, or that would let a piece land on a bomb. 1 is a fair dice.
 */
export const MEANNESS: Record<Rules['difficulty'], number> = { easy: 0.5, normal: 1, hard: 2.5 };

/** Relative chance of each face 1..6 for the player about to roll. */
export function rollWeights(state: GameState): number[] {
  const weights = [1, 1, 1, 1, 1, 1];
  const mean = MEANNESS[state.rules.difficulty] ?? 1;
  if (mean === 1 || state.phase !== 'roll') return weights;
  const { rules, turn } = state;
  const thirdSix = state.sixStreak === 2 && rules.bonusRollOnSix && rules.threeSixes !== 'off';
  for (let d = 1; d <= 6; d++) {
    if (d === 6 && thirdSix) {
      weights[5] *= mean;
      continue;
    }
    const blown = (j: number) => {
      const b = planMove(state, turn, j, d)?.bombed;
      return !!b && !b.saved;
    };
    if (state.bombs.length && legalPieces(state, turn, d).some(blown)) {
      weights[d - 1] *= mean;
    }
  }
  return weights;
}

/** Rolls with the given face weights. `rand(n)` gives an integer in [0, n). */
export function rollWeighted(weights: number[], rand: (n: number) => number): number {
  const scaled = weights.map((w) => Math.max(0, Math.round(w * 100)));
  let r = rand(scaled.reduce((a, b) => a + b, 0));
  for (let i = 0; i < scaled.length; i++) {
    if (r < scaled[i]) return i + 1;
    r -= scaled[i];
  }
  return 6;
}
