// Opens a backup file (downloaded from the "Database backups" draft release on GitHub). It's gzipped JSON, so any
// unzip tool opens it too; this turns it into a database to run the server on:
//
//   node server/backup-cli.ts sqlite <file.json.gz> <out.db>     then DB_PATH=<out.db> npm start
//   node server/backup-cli.ts json   <file.json.gz> [out.json]   everything in it, as indented JSON
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { importData, unpack } from './backup.ts';
import { initSchema } from './db.ts';
import { openSqlite } from './sqlite.ts';

const [what, file, out] = process.argv.slice(2);
if (!file || (what !== 'json' && what !== 'sqlite') || (what === 'sqlite' && !out)) {
  console.error('Usage: node server/backup-cli.ts sqlite <file.json.gz> <out.db> | json <file.json.gz> [out.json]');
  process.exit(1);
}
const data = await unpack(new Uint8Array(readFileSync(file)));
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
