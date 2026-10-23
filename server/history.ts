import { gameAwards, medalsWon } from '../shared/awards.ts';
import { COLOR_NAMES, type Seat } from '../shared/board.ts';
import { peopleIn, type GameRecord, type HistoryPage, type SeatView } from '../shared/protocol.ts';
import { RANKED_MIN_PEOPLE } from '../shared/scoring.ts';
import type { Db } from './db.ts';
import { upgradeGame } from './migrate.ts';

const PAGE = 20;

interface Row {
  code: string;
  data: string;
  summary: string | null;
  created_at: number;
  updated_at: number;
}

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
        name: s.name ?? `${COLOR_NAMES[seat]} bot`,
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

/** Every finished game, newest first, a page at a time. Each report is worked out once and kept with the game. */
export function createHistory(db: Db) {
  const q = {
    page: db.prepare(
      "SELECT code, data, summary, created_at, updated_at FROM games WHERE status = 'finished' AND updated_at < ? ORDER BY updated_at DESC LIMIT ?",
    ),
    keep: db.prepare('UPDATE games SET summary = ? WHERE code = ?'),
  };

  function page(before: number): HistoryPage {
    const rows = q.page.all(before, PAGE) as unknown as Row[];
    const games: GameRecord[] = [];
    for (const row of rows) {
      let record: GameRecord | null;
      if (row.summary !== null) record = JSON.parse(row.summary);
      else {
        try {
          record = recordOf(row.code, row.data, row.created_at, row.updated_at);
        } catch (err) {
          console.error(`Can't read finished game ${row.code}:`, err);
          record = null;
        }
        q.keep.run(JSON.stringify(record), row.code);
      }
      if (record) games.push(record);
    }
    return { games, next: rows.length === PAGE ? rows[rows.length - 1].updated_at : null };
  }

  return {
    /** GET /api/history?before=<cursor> */
    handle(req: Request): HistoryPage {
      const before = Number(new URL(req.url).searchParams.get('before'));
      return page(Number.isFinite(before) && before > 0 ? before : Number.MAX_SAFE_INTEGER);
    },
  };
}
