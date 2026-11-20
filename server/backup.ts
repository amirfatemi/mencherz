import type { Db, SqlValue } from './db.ts';

// Backups of everything worth keeping (accounts, games, the computer players' and dragon's records), as gzipped JSON
// kept as assets of a draft release of the project's GitHub repository: drafts are seen only by those who can push,
// and an asset is no commit, so it starts no deploy. Sessions and pairing codes are left out: after a restore,
// everyone signs in again.

/** The tables a backup holds, in the order they're restored. */
const TABLES = ['users', 'npc_stats', 'games'] as const;
type Table = (typeof TABLES)[number];

export interface BackupData {
  format: 'mencherz-backup';
  version: 1;
  /** When it was taken (ms since 1970). */
  at: number;
  tables: Record<Table, Record<string, SqlValue>[]>;
}

export interface BackupConfig {
  /** A GitHub token that can write the repository's contents (releases). */
  token: string;
  /** owner/name of the repository. */
  repo: string;
  /** How many backups to keep; older ones are deleted. */
  keep: number;
}

/** A backup on GitHub. */
export interface BackupFile {
  id: number;
  name: string;
  size: number;
  createdAt: string;
}

/** Every row of the tables a backup holds. Cached game reports are left out: they're worked out again. */
export function exportData(db: Db): BackupData {
  const tables = {} as BackupData['tables'];
  for (const t of TABLES) {
    const rows = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, SqlValue>[];
    tables[t] = rows.map((row) => {
      const out: Record<string, SqlValue> = {};
      for (const [k, v] of Object.entries(row)) if (!(t === 'games' && k === 'summary')) out[k] = v;
      return out;
    });
  }
  return { format: 'mencherz-backup', version: 1, at: Date.now(), tables };
}

/** Replaces the database's accounts, games and records with a backup's, and signs everyone out. */
export function importData(db: Db, data: BackupData, transaction: <T>(fn: () => T) => T = (fn) => fn()): void {
  if (data?.format !== 'mencherz-backup' || data.version !== 1) throw new Error('Not a Mencherz backup');
  transaction(() => {
    for (const t of ['sessions', 'pair_codes', ...[...TABLES].reverse()]) db.exec(`DELETE FROM ${t}`);
    for (const t of TABLES) {
      for (const row of data.tables[t] ?? []) {
        const cols = Object.keys(row);
        db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
      }
    }
  });
}

// ---------- a backup file is the data as JSON, gzipped ----------

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function pack(data: BackupData): Promise<Uint8Array> {
  return pipe(new TextEncoder().encode(JSON.stringify(data)), new CompressionStream('gzip'));
}

export async function unpack(file: Uint8Array): Promise<BackupData> {
  if (file[0] !== 0x1f || file[1] !== 0x8b) throw new Error('Not a Mencherz backup file');
  return JSON.parse(new TextDecoder().decode(await pipe(file, new DecompressionStream('gzip'))));
}

// ---------- GitHub: one draft release holds the backups as assets ----------

const RELEASE_TAG = 'database-backups';

interface Release {
  id: number;
  tag_name: string;
  draft: boolean;
  upload_url: string;
  assets: { id: number; name: string; size: number; created_at: string }[];
}

function github(cfg: BackupConfig, fetcher: typeof fetch) {
  const headers = {
    authorization: `Bearer ${cfg.token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'mencherz-backup',
  };
  const call = async (url: string, init: RequestInit = {}) => {
    const res = await fetcher(url.startsWith('http') ? url : `https://api.github.com/repos/${cfg.repo}${url}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string>) },
    });
    if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${url.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  };
  /** The draft release the backups go in, made the first time. */
  const release = async (): Promise<Release> => {
    const all = (await (await call('/releases?per_page=100')).json()) as Release[];
    const found = all.find((r) => r.tag_name === RELEASE_TAG && r.draft);
    if (found) return found;
    const body = { tag_name: RELEASE_TAG, name: 'Database backups', draft: true, body: 'Monthly backups of the live game database (gzipped JSON), made by the server. Never publish this release: they hold every account.' };
    return (await (await call('/releases', { method: 'POST', body: JSON.stringify(body) })).json()) as Release;
  };
  return { call, release };
}

const newestFirst = (r: Release): BackupFile[] =>
  r.assets.map((a) => ({ id: a.id, name: a.name, size: a.size, createdAt: a.created_at })).sort((a, b) => b.name.localeCompare(a.name));

/** The backups on GitHub, newest first. */
export async function listBackups(cfg: BackupConfig, fetcher: typeof fetch = fetch): Promise<BackupFile[]> {
  return newestFirst(await github(cfg, fetcher).release());
}

/** Takes a backup, puts it on GitHub, and deletes the oldest beyond `keep`. */
export async function backUp(db: Db, cfg: BackupConfig, fetcher: typeof fetch = fetch, label = 'monthly'): Promise<BackupFile> {
  const bytes = await pack(exportData(db));
  const gh = github(cfg, fetcher);
  const rel = await gh.release();
  const name = `mencherz-${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.json.gz`;
  const upload = rel.upload_url.replace(/\{.*\}$/, '') + `?name=${encodeURIComponent(name)}`;
  const asset = (await (await gh.call(upload, { method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream' } })).json()) as Release['assets'][number];
  for (const old of newestFirst(rel).filter((a) => a.name !== name).slice(Math.max(0, cfg.keep - 1))) {
    await gh.call(`/releases/assets/${old.id}`, { method: 'DELETE' });
  }
  return { id: asset.id, name: asset.name, size: asset.size, createdAt: asset.created_at };
}

/** A backup from GitHub, opened. */
export async function fetchBackup(cfg: BackupConfig, name: string, fetcher: typeof fetch = fetch): Promise<BackupData> {
  const gh = github(cfg, fetcher);
  const file = newestFirst(await gh.release()).find((f) => f.name === name);
  if (!file) throw new Error(`No backup called ${name}`);
  // GitHub answers with a redirect to the file's storage, which must be fetched without the GitHub token.
  const url = `https://api.github.com/repos/${cfg.repo}/releases/assets/${file.id}`;
  let res = await fetcher(url, {
    redirect: 'manual',
    headers: { authorization: `Bearer ${cfg.token}`, accept: 'application/octet-stream', 'user-agent': 'mencherz-backup', 'x-github-api-version': '2022-11-28' },
  });
  const location = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && location) res = await fetcher(location);
  if (!res.ok) throw new Error(`GitHub download of ${name}: ${res.status}`);
  return unpack(new Uint8Array(await res.arrayBuffer()));
}
