import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db } from './db.ts';

/** The local database: a SQLite file through node:sqlite. Node only. */
export function openSqlite(path: string): Db & { close(): void } {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return db as unknown as Db & { close(): void };
}
