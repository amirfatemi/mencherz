// The SQL the server needs, kept to what both node:sqlite (local) and a Durable Object's SQLite
// storage (Cloudflare) can do: synchronous statements, no PRAGMAs, no explicit transactions.

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface Statement {
  run(...params: SqlValue[]): unknown;
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}

export interface Db {
  exec(sql: string): void;
  prepare(sql: string): Statement;
}

export function initSchema(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      games_played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      total_points INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    -- One-time codes that let a player be seated at someone else's device.
    CREATE TABLE IF NOT EXISTS pair_codes (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS games (
      code TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  addColumns(db, 'users', {
    total_points: 'INTEGER NOT NULL DEFAULT 0',
    total_captures: 'INTEGER NOT NULL DEFAULT 0',
    total_lost: 'INTEGER NOT NULL DEFAULT 0',
    total_minutes: 'INTEGER NOT NULL DEFAULT 0',
    // Medal id → how many times won, as JSON.
    medals: "TEXT NOT NULL DEFAULT '{}'",
    // 'pending' until an admin approves a new account, 'active', or 'disabled' by an admin. Accounts from
    // before approvals existed are active.
    status: "TEXT NOT NULL DEFAULT 'active'",
  });
  // A finished game's report for the game history (a GameRecord as JSON), worked out the first time it's asked for.
  addColumns(db, 'games', { summary: 'TEXT' });
  db.exec('CREATE INDEX IF NOT EXISTS games_by_status ON games (status, updated_at)');
}

/** Adds columns that databases created by older versions lack. */
function addColumns(db: Db, table: string, columns: Record<string, string>) {
  for (const [name, type] of Object.entries(columns)) {
    try {
      db.prepare(`SELECT ${name} FROM ${table} LIMIT 0`).all();
    } catch {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}
