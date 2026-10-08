import type { Db, SqlValue } from '../server/db.ts';

/** The game's database on Cloudflare: the Durable Object's own SQLite storage, behind the same interface as node:sqlite. */
export function durableDb(sql: SqlStorage): Db {
  const bind = (params: SqlValue[]) => params.map((p) => (typeof p === 'bigint' ? Number(p) : p)) as SqlStorageValue[];
  return {
    exec(query) {
      sql.exec(query);
    },
    prepare(query) {
      return {
        run: (...params) => sql.exec(query, ...bind(params)).rowsWritten,
        get: (...params) => sql.exec(query, ...bind(params)).toArray()[0],
        all: (...params) => sql.exec(query, ...bind(params)).toArray(),
      };
    },
  };
}
