import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { backUp, exportData, fetchBackup, importData, listBackups, pack, unpack, type BackupConfig } from './backup.ts';
import { createGameServer } from './core.ts';
import { initSchema } from './db.ts';
import { openSqlite } from './sqlite.ts';

const CFG: BackupConfig = { token: 't0ken', repo: 'someone/game', keep: 3 };

/** Just enough of GitHub's releases API: one repository's releases, their assets, and downloads by redirect. */
function fakeGitHub() {
  const releases: { id: number; tag_name: string; draft: boolean; upload_url: string; assets: { id: number; name: string; size: number; created_at: string; bytes: Uint8Array }[] }[] = [];
  const seen: string[] = [];
  let ids = 100;
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const auth = new Headers(init.headers).get('authorization');
    seen.push(`${method} ${url.pathname}`);
    if (url.host === 'storage.example') {
      // The signed storage link: GitHub's token must not come along.
      assert.equal(auth, null);
      const asset = releases.flatMap((r) => r.assets).find((a) => a.id === Number(url.pathname.slice(1)))!;
      return new Response(asset.bytes as Uint8Array<ArrayBuffer>);
    }
    assert.equal(auth, 'Bearer t0ken');
    if (url.host === 'uploads.github.com') {
      const rel = releases.find((r) => url.pathname.includes(`/releases/${r.id}/`))!;
      const bytes = new Uint8Array(init.body as Uint8Array);
      const asset = { id: ids++, name: url.searchParams.get('name')!, size: bytes.length, created_at: new Date().toISOString(), bytes };
      rel.assets.push(asset);
      return Response.json(asset);
    }
    const path = url.pathname.replace('/repos/someone/game', '');
    if (path === '/releases' && method === 'GET') return Response.json(releases);
    if (path === '/releases' && method === 'POST') {
      const body = JSON.parse(String(init.body));
      const id = ids++;
      const rel = { id, tag_name: body.tag_name, draft: body.draft, upload_url: `https://uploads.github.com/repos/someone/game/releases/${id}/assets{?name,label}`, assets: [] };
      releases.push(rel);
      return Response.json(rel, { status: 201 });
    }
    const assetId = Number(path.match(/^\/releases\/assets\/(\d+)$/)?.[1]);
    if (assetId && method === 'DELETE') {
      for (const r of releases) r.assets = r.assets.filter((a) => a.id !== assetId);
      return new Response(null, { status: 204 });
    }
    if (assetId) return new Response(null, { status: 302, headers: { location: `https://storage.example/${assetId}` } });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetcher, releases, seen };
}

function filledDb() {
  const db = openSqlite(':memory:');
  initSchema(db);
  db.prepare("INSERT INTO users (id, username, password_hash, created_at, total_points, status) VALUES (1, 'amir', 'hash1', 1, 120, 'active'), (2, 'mom', 'hash2', 2, 80, 'active')").run();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('s', 1, 9999999999999)").run();
  db.prepare("INSERT INTO games (code, status, data, summary, created_at, updated_at) VALUES ('ABCDE', 'finished', '{\"paused\":true}', 'old report', 5, 6)").run();
  db.prepare("INSERT INTO npc_stats (id, games_played, total_points) VALUES ('bot:ares', 3, 300), ('dragon', 3, 90)").run();
  return db;
}

test('a backup is gzipped JSON, and puts back accounts, games and records, signing everyone out', async () => {
  const from = filledDb();
  const data = exportData(from);
  assert.deepEqual(data.tables.games, [{ code: 'ABCDE', status: 'finished', data: '{"paused":true}', created_at: 5, updated_at: 6 }], 'no cached report');
  const file = await pack(data);
  assert.deepEqual(JSON.parse(gunzipSync(file).toString()), data, 'any unzip tool opens it');
  assert.deepEqual(await unpack(file), data);
  await assert.rejects(unpack(new TextEncoder().encode('{}')), /Not a Mencherz backup/);

  const to = filledDb();
  to.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (3, 'newer', 'hash3', 3)").run();
  importData(to, await unpack(file));
  assert.deepEqual(to.prepare('SELECT id, username, password_hash, total_points FROM users ORDER BY id').all().map((r) => ({ ...(r as object) })), [
    { id: 1, username: 'amir', password_hash: 'hash1', total_points: 120 },
    { id: 2, username: 'mom', password_hash: 'hash2', total_points: 80 },
  ]);
  assert.equal((to.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n, 0, 'everyone signs in again');
  assert.equal((to.prepare("SELECT data FROM games WHERE code = 'ABCDE'").get() as { data: string }).data, '{"paused":true}');
  assert.deepEqual(to.prepare('SELECT id, total_points FROM npc_stats ORDER BY id').all().map((r) => ({ ...(r as object) })), [
    { id: 'bot:ares', total_points: 300 },
    { id: 'dragon', total_points: 90 },
  ]);
  assert.throws(() => importData(to, { format: 'other' } as never), /Not a Mencherz backup/);
});

test('backups go to one draft release on GitHub, keeping the newest few', async () => {
  const gh = fakeGitHub();
  const db = filledDb();
  const names: string[] = [];
  for (let i = 0; i < 5; i++) {
    names.push((await backUp(db, CFG, gh.fetcher, `n${i}`)).name);
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(gh.releases.length, 1, 'made once');
  assert.deepEqual([gh.releases[0].tag_name, gh.releases[0].draft], ['database-backups', true]);
  const list = await listBackups(CFG, gh.fetcher);
  assert.deepEqual(list.map((f) => f.name), names.slice(2).reverse(), 'the newest three, newest first');
  assert.ok(list.every((f) => /^mencherz-\d{4}-\d\d-\d\dT[\d-]+Z-n\d\.json\.gz$/.test(f.name)));
  const back = await fetchBackup(CFG, list[0].name, gh.fetcher);
  assert.equal(back.tables.users.length, 2);
  await assert.rejects(fetchBackup(CFG, 'nope.json.gz', gh.fetcher), /No backup called/);
});

test('an admin can take a backup and restore one; the server starts over on it', async () => {
  const gh = fakeGitHub();
  const db = filledDb();
  let restarted = 0;
  const server = createGameServer({ db, secureCookies: false, admins: ['boss'], backup: CFG, fetcher: gh.fetcher, restart: () => restarted++ });
  const api = (path: string, init: RequestInit = {}) => server.api(new Request(`http://x/api${path}`, init), '127.0.0.1');
  const signUp = async (username: string) => {
    const c = (await (await api('/captcha')).json()) as { id: string; question: string };
    const [a, b] = c.question.split('+').map(Number);
    const res = await api('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'secret123', captchaId: c.id, captchaAnswer: String(a + b) }) });
    return res.headers.get('set-cookie')!.split(';')[0];
  };
  const player = await signUp('player');
  assert.equal((await api('/admin/backup', { method: 'POST', headers: { cookie: player } })).status, 403);
  const boss = await signUp('boss');
  const as = (init: RequestInit = {}) => ({ ...init, headers: { cookie: boss, 'content-type': 'application/json' } });
  const made = (await (await api('/admin/backup', as({ method: 'POST' }))).json()) as { name: string };
  assert.match(made.name, /-manual\.json\.gz$/);
  // Later someone is wiped out; the backup brings them back.
  db.prepare("DELETE FROM users WHERE username = 'mom'").run();
  const res = await api('/admin/restore', as({ method: 'POST', body: JSON.stringify({ name: made.name }) }));
  assert.equal(res.status, 200, await res.clone().text());
  assert.ok(db.prepare("SELECT 1 FROM users WHERE username = 'mom'").get(), 'back');
  // Everyone is signed out by a restore, the admin too.
  assert.equal((await api('/admin/backups', as())).status, 401);
  const list = await listBackups(CFG, gh.fetcher);
  assert.ok(list.some((f) => f.name.endsWith('-before-restore.json.gz')), 'what was there is kept too');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(restarted, 1);
  server.shutdown();
});
