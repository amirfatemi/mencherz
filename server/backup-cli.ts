// Opens a backup file (downloaded from the "Database backups" draft release on GitHub) with the backup key:
//
//   BACKUP_KEY=... node server/backup-cli.ts json   <file.mzb> [out.json]   everything in it, as JSON
//   BACKUP_KEY=... node server/backup-cli.ts sqlite <file.mzb> <out.db>     a database to run the server on locally
//
// For the second, start the server on it with DB_PATH=<out.db> npm start.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { decrypt, importData } from './backup.ts';
import { initSchema } from './db.ts';
import { openSqlite } from './sqlite.ts';

const [what, file, out] = process.argv.slice(2);
const key = process.env.BACKUP_KEY;
if (!key || !file || (what !== 'json' && what !== 'sqlite') || (what === 'sqlite' && !out)) {
  console.error('Usage: BACKUP_KEY=... node server/backup-cli.ts json <file.mzb> [out.json] | sqlite <file.mzb> <out.db>');
  process.exit(1);
}
const data = await decrypt(new Uint8Array(readFileSync(file)), key);
const counts = Object.entries(data.tables).map(([t, rows]) => `${rows.length} ${t}`).join(', ');
if (what === 'json') {
  const json = JSON.stringify(data, null, 2);
  if (out) writeFileSync(out, json);
  else console.log(json);
} else {
  if (existsSync(out)) {
    console.error(`${out} exists already; pick a new file`);
    process.exit(1);
  }
  const db = openSqlite(out);
  initSchema(db);
  importData(db, data);
  db.close();
}
console.error(`Backup from ${new Date(data.at).toISOString()}: ${counts}${out ? ` → ${out}` : ''}`);
