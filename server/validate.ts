import { BOT_LEVELS, type BotLevel } from '../shared/ai.ts';
import type { RoomSettings, SeatSetup } from '../shared/protocol.ts';
import { DEFAULT_RULES, type Rules } from '../shared/rules.ts';

export class InputError extends Error {}

const TURN_SECONDS = [0, 10, 15, 20, 30, 45, 60, 90];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

export function parseRules(input: unknown): Rules {
  const r = isObj(input) ? input : {};
  const d = DEFAULT_RULES;
  return {
    launchOn: oneOf(r.launchOn, ['six', 'fiveSix', 'even'], d.launchOn),
    bonusRollOnSix: bool(r.bonusRollOnSix, d.bonusRollOnSix),
    threeSixes: oneOf(r.threeSixes, ['off', 'forfeit', 'penalty', 'hangar'], d.threeSixes),
    bombs: bool(r.bombs, d.bombs),
    difficulty: oneOf(r.difficulty, ['easy', 'normal', 'hard'], d.difficulty),
    magicBoxes: bool(r.magicBoxes, d.magicBoxes),
    finish: oneOf(r.finish, ['bounce', 'exact'], d.finish),
    jumps: bool(r.jumps, d.jumps),
    flights: bool(r.flights, d.flights),
    flightCapture: bool(r.flightCapture, d.flightCapture),
    bonusRollOnCapture: bool(r.bonusRollOnCapture, d.bonusRollOnCapture),
    playUntil: oneOf(r.playUntil, ['winner', 'all'], d.playUntil),
    winBy: oneOf(r.winBy, ['points', 'race'], d.winBy),
  };
}

export function parseSettings(input: unknown, fallbackName: string): RoomSettings {
  const s = isObj(input) ? input : {};
  const raw = typeof s.name === 'string' ? s.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  const turnSeconds = TURN_SECONDS.includes(s.turnSeconds as number) ? (s.turnSeconds as number) : 30;
  return {
    name: raw || fallbackName,
    isPublic: bool(s.isPublic, true),
    turnSeconds,
    gifs: bool(s.gifs, true),
    rules: parseRules(s.rules),
  };
}

export function parseBotLevel(v: unknown): BotLevel {
  return oneOf(v, BOT_LEVELS, 'normal');
}

export function parseSeats(input: unknown): SeatSetup[] {
  if (!Array.isArray(input) || input.length !== 4) throw new InputError('Four seats expected');
  const seats: SeatSetup[] = input.map((raw) => {
    const kind = isObj(raw) ? raw.kind : undefined;
    if (kind === 'host') return { kind: 'host' };
    if (kind === 'bot') return { kind: 'bot', botLevel: parseBotLevel((raw as Record<string, unknown>).botLevel) };
    if (kind === 'open') return { kind: 'open' };
    return { kind: 'closed' };
  });
  if (seats.filter((s) => s.kind === 'host').length !== 1) throw new InputError('Pick one seat for yourself');
  if (seats.filter((s) => s.kind !== 'closed').length < 2) throw new InputError('A game needs at least two seats');
  return seats;
}

export function parseUsername(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{3,20}$/.test(v.trim())) throw new InputError('Enter their username');
  return v.trim();
}

export function parsePairCode(v: unknown): string {
  const code = typeof v === 'string' ? v.replace(/\D/g, '') : '';
  if (code.length !== 6) throw new InputError('The code has 6 digits');
  return code;
}

export function parseCode(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9]{4,8}$/.test(v.trim())) throw new InputError('Invalid game code');
  return v.trim().toUpperCase();
}
