import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameRecord, HistoryPage } from '../shared/protocol.ts';
import { initSchema } from './db.ts';
import { createHistory } from './history.ts';
import { openSqlite } from './sqlite.ts';

/** A finished game's saved report: who won, how long it took, and whether it counted. */
function record(code: string, winner: string, minutes: number, ranked = true, stopped = false): GameRecord {
  const players = [winner, 'other'].map((name, i) => ({
    seat: i as 0 | 1,
    name,
    kind: 'human' as const,
    left: false,
    place: stopped ? null : i + 1,
    points: 10 - i,
    home: 0,
    captures: 0,
    lost: 0,
    medals: [],
  }));
  return { code, name: code, hostName: winner, startedAt: 0, finishedAt: minutes * 60000, playedMs: minutes * 60000, ranked, stopped, winBy: 'points', players, awards: [] };
}

test('the history leaves practice games out, and pages five at a time by winner and length', () => {
  const db = openSqlite(':memory:');
  initSchema(db);
  const save = db.prepare("INSERT INTO games (code, status, data, summary, created_at, updated_at) VALUES (?, 'finished', '{}', ?, 0, ?)");
  const games = [
    record('A1', 'amir', 20),
    record('A2', 'amir', 45),
    record('A3', 'amir', 90),
    record('M1', 'mom', 25),
    record('M2', 'mom', 50),
    record('M3', 'mom', 75),
    record('P1', 'amir', 10, false),
    record('S1', 'amir', 40, true, true),
  ];
  // Saved in that order, the last one newest.
  games.forEach((g, i) => save.run(g.code, JSON.stringify(g), i + 1));
  const history = createHistory(db);
  const get = (query: string) => history.handle(new Request(`http://x/api/history${query}`)) as HistoryPage;

  const first = get('');
  assert.deepEqual(first.games.map((g) => g.code), ['S1', 'M3', 'M2', 'M1', 'A3'], 'newest first, no practice game');
  assert.deepEqual([first.page, first.pages, first.total, first.winners], [1, 2, 7, ['amir', 'mom']]);
  assert.deepEqual(get('?page=2').games.map((g) => g.code), ['A2', 'A1']);
  assert.equal(get('?page=9').page, 2, 'past the end shows the last page');

  assert.deepEqual(get('?winner=mom').games.map((g) => g.code), ['M3', 'M2', 'M1']);
  assert.deepEqual(get('?winner=amir').games.map((g) => g.code), ['A3', 'A2', 'A1'], 'a stopped game has no winner');
  assert.deepEqual(get('?length=short').games.map((g) => g.code), ['M1', 'A1']);
  assert.deepEqual(get('?length=medium').games.map((g) => g.code), ['S1', 'M2', 'A2']);
  assert.deepEqual(get('?length=long&winner=amir').games.map((g) => g.code), ['A3']);
  assert.deepEqual(get('?winner=nobody').total, 0);
  db.close();
});
