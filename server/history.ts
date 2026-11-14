import { gameAwards, medalsWon } from '../shared/awards.ts';
import { COLOR_NAMES, type Seat } from '../shared/board.ts';
import { BOT_NAMES, GAME_LENGTHS, HISTORY_PAGE, lengthOf, peopleIn, type GameLength, type GameRecord, type HistoryPage, type SeatView } from '../shared/protocol.ts';
import { RANKED_MIN_PEOPLE } from '../shared/scoring.ts';
import type { Db } from './db.ts';
import { upgradeGame } from './migrate.ts';

interface Row {
  code: string;
  summary: string | null;
  created_at: number;
  updated_at: number;
}

/** Who came first in a finished game: its winner's name, or null when everyone left and it was stopped. */
const winnerOf = (g: GameRecord) => (g.stopped ? null : (g.players.find((p) => p.place === 1)?.name ?? null));

/** A finished game's end-of-game report, from its saved room; null for one that has no game in it. */
export function recordOf(code: string, data: string, createdAt: number, updatedAt: number): GameRecord | null {
  const d = JSON.parse(data);
  if (!d.game) return null;
  const game = upgradeGame(d.game);
  const seats: SeatView[] = d.seats;
  const ranked = peopleIn(seats) >= RANKED_MIN_PEOPLE;
  const stopped = game.standings.length === 0;
  const order: Seat[] = stopped ? [...game.active].sort((a, b) => game.stats[b].points - game.stats[a].points) : game.standings;
  const startedAt = d.startedAt ?? createdAt;
  const finishedAt = d.finishedAt ?? updatedAt;
  return {
    code,
    name: d.settings?.name ?? code,
    hostName: seats.find((s) => s.userId === d.hostId)?.name ?? '—',
    startedAt,
    finishedAt,
    playedMs: Math.max(0, finishedAt - startedAt - (d.pausedMs ?? 0)),
    ranked,
    stopped,
    winBy: game.rules.winBy,
    players: order.map((seat, i) => {
      const s = seats[seat] ?? { kind: 'bot' };
      const st = game.stats[seat];
      // Someone who left is still a person who played; medals count only for those who stayed, as on the leaderboard.
      const person = s.userId !== undefined;
      return {
        seat,
        name: s.name ?? (s.kind === 'bot' ? BOT_NAMES[seat] : COLOR_NAMES[seat]),
        kind: person ? 'human' : 'bot',
        ...(person ? {} : { botLevel: s.botLevel }),
        left: !!s.left,
        place: stopped ? null : i + 1,
        points: st.points,
        home: st.home,
        captures: st.captures,
        lost: st.lost,
        medals: ranked && person && !s.left && !stopped ? medalsWon(game, seat).map((m) => m.id) : [],
      };
    }),
    awards: stopped ? [] : gameAwards(game),
  };
}

/**
 * The finished games that counted (practice games against computers alone are left out), newest first, a page of
 * HISTORY_PAGE at a time, by winner and by length. Each report is worked out once and kept with the game.
 */
export function createHistory(db: Db) {
  const q = {
    all: db.prepare("SELECT code, summary, created_at, updated_at FROM games WHERE status = 'finished' ORDER BY updated_at DESC"),
    data: db.prepare('SELECT data FROM games WHERE code = ?'),
    keep: db.prepare('UPDATE games SET summary = ? WHERE code = ?'),
  };

  function records(): GameRecord[] {
    const out: GameRecord[] = [];
    for (const row of q.all.all() as unknown as Row[]) {
      let record: GameRecord | null;
      if (row.summary !== null) record = JSON.parse(row.summary);
      else {
        try {
          const { data } = q.data.get(row.code) as { data: string };
          record = recordOf(row.code, data, row.created_at, row.updated_at);
        } catch (err) {
          console.error(`Can't read finished game ${row.code}:`, err);
          record = null;
        }
        q.keep.run(JSON.stringify(record), row.code);
      }
      if (record?.ranked) out.push(record);
    }
    return out;
  }

  function page(n: number, winner: string | null, length: GameLength | null): HistoryPage {
    const all = records();
    const winners = [...new Set(all.map(winnerOf).filter((w): w is string => w !== null))].sort((a, b) => a.localeCompare(b));
    const matching = all.filter((g) => (!winner || winnerOf(g) === winner) && (!length || lengthOf(g.playedMs) === length));
    const pages = Math.max(1, Math.ceil(matching.length / HISTORY_PAGE));
    const at = Math.min(Math.max(1, n), pages);
    return { games: matching.slice((at - 1) * HISTORY_PAGE, at * HISTORY_PAGE), page: at, pages, total: matching.length, winners };
  }

  return {
    /** GET /api/history?page=<from 1>&winner=<name>&length=<short|medium|long> */
    handle(req: Request): HistoryPage {
      const params = new URL(req.url).searchParams;
      const n = Number(params.get('page'));
      const length = params.get('length') as GameLength | null;
      return page(Number.isInteger(n) ? n : 1, params.get('winner') || null, length && GAME_LENGTHS.includes(length) ? length : null);
    },
  };
}
