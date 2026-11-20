# Deploying to Cloudflare Workers

**Live:** https://mencherz.shahvar.cloud
**Worker:** `mencherz`. Fallback URL: https://mencherz.amir-fatemi-amin.workers.dev

## How it runs

Cloudflare serves the built web app (`dist/client`) as static assets from its edge network.

Only `/api/*` and the `/ws` game socket run the Worker (`assets.run_worker_first`). The Worker hands both to one Durable Object, `MencherzHub`.

`MencherzHub` runs the same game server as the Node version (`server/core.ts`):
- accounts, sessions, saved games and the leaderboard live in the object's own SQLite storage
- every player's WebSocket connects to it
- bot moves and turn clocks run on its timers

One object for all games is plenty at this scale, and it keeps lobby, rooms and accounts in one place.

**Why this fits the Free plan:**
- Static assets are free and unlimited.
- Durable Objects with SQLite storage are available on the Workers Free plan. The `[[migrations]]` block in `wrangler.toml` creates the class with `new_sqlite_classes`.
- A Durable Object request may use up to 30 s of CPU, so password hashing (scrypt) and the game logic fit easily.

## Verification status

Checked before this doc was written:

| Check | Result |
|---|---|
| `npm test` (Node runtime, same game server) | ✅ 67 tests |
| `npm run typecheck` (server, client, worker) | ✅ |
| `wrangler dev`: sign up, sockets, a 40-move game with a bot, magic boxes, one-time code | ✅ |
| `wrangler dev` restart: the game is restored from Durable Object storage | ✅ |
| `wrangler deploy` | ✅ version `f7e3fb9d` |
| Live: `/api/health`, SPA routes (`/g/…`, `/settings`), TLS on the custom domain | ✅ |
| Live: the same game test over `wss://mencherz.shahvar.cloud/ws`; a bad session and a foreign origin are refused | ✅ |
| Live: the browser client signs up, starts a game, hides a box, rolls, with no console errors | ✅ |
| `/assets/*` caching (`public/_headers`) | ✅ `max-age=31536000, immutable` |

## Option A: connect GitHub (deploy on every push)

**Connected on 2026-10-08:** every push to `main` builds and deploys. This is how the shahvar site deploys too. The steps below are for reference; connecting a repository can only be done in the dashboard.

1. In the Cloudflare dashboard, open **Workers & Pages** → **mencherz** → **Settings** → **Build** → **Connect**. Pick the GitHub repo `amirfatemi/mencherz`.

2. Build settings:

   | Field | Value |
   |---|---|
   | Production branch | `main` |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | *(leave empty)* |

   Cloudflare reads everything else from `wrangler.toml`.

   The Node version comes from `.nvmrc`, which is `24`. Wrangler needs Node 22 or newer, and Vite 8 needs 20.19 or newer.

3. **Save.** Every push to `main` then builds and deploys, and pull requests get preview URLs.

Deploys keep the Durable Object's data: games and accounts survive.

## Option B: deploy from your machine

```bash
npx wrangler login     # or export CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
npm run deploy         # builds, then deploys
```

To watch the live logs:

```bash
npx wrangler tail mencherz
```

## Custom domain

`mencherz.shahvar.cloud` is attached by the `[[routes]]` block in `wrangler.toml` (`custom_domain = true`). Cloudflare created the DNS record and issues and renews the TLS certificate.

Do **not** add a DNS record for it by hand.

## Data

The live site has its own data, in the Durable Object. It starts empty: accounts from a local `data/mencherz.db` are not copied over.

`npm run cf:dev` keeps its local data under `.wrangler/state`.

## Backups

On the 1st of every month at 02:30 UTC (06:00 in Tehran) the Worker's schedule (`[triggers]` in `wrangler.toml`) has the Durable Object back up every account, game and leaderboard record, as gzipped JSON, uploaded as an asset of a **draft** release, "Database backups", in the GitHub repository named by `BACKUP_REPO`. The newest `BACKUP_KEEP` (12, a year's worth) are kept. A draft release is seen only by people who can push to the repository, and an uploaded asset is no commit, so it starts no deploy. The backups aren't encrypted (they hold every account, with its password hash), so **never publish that release**. Sessions and pairing codes are left out: after a restore everyone signs in again.

Set it up once (backups are skipped until the token exists):

1. On GitHub, create a fine-grained personal access token: **Settings → Developer settings → Fine-grained tokens**, repository access **Only select repositories → mencherz**, permission **Contents: Read and write**. Give it an expiry date you'll remember to renew.
2. Add it as a Worker secret (the command asks for the value):

   ```sh
   set -a; . ~/.cloudflare.env; set +a
   npx wrangler secret put GITHUB_TOKEN
   ```

3. Check it works: **Admin → Backups → Back up now**. The backup appears in the list and under the repository's **Releases** (as a draft).

**Restoring:** **Admin → Backups → Restore** on the backup to go back to. The server first backs up what's there (a `before-restore` backup), then replaces all accounts, games and records with the backup's, and starts over on it. Everyone signs in again.

**Reading a backup on your machine:** download it from the draft release. It's gzipped JSON, so any unzip tool opens it; or:

```sh
node server/backup-cli.ts sqlite mencherz-….json.gz copy.db    # then DB_PATH=copy.db npm start
node server/backup-cli.ts json   mencherz-….json.gz backup.json
```

The Node server takes the same settings from its environment (`GITHUB_TOKEN`, `BACKUP_REPO`, `BACKUP_KEEP`), for **Back up now** and restores; it has no schedule of its own.

## Admins

`ADMINS` in `wrangler.toml` `[vars]` names the admin accounts; it is currently `amir`. An admin sees **Admin** in the top bar: every player, and a **Reset password** button for each.

## Wiping all data

Use a Durable Object migration (see `wrangler.toml`). Add a new `[[migrations]]` tag that deletes the current class and creates one under a new name, then point the `HUB` binding and the exported class at the new name.

Cloudflare deletes the old class's objects and all their storage. The new class starts empty and runs the new code right away. This is how the reset of 2026-10-08 was done: `GameHub` was deleted, `MencherzHub` created.

A plain redeploy keeps the data. A running object may also keep serving the previous code until its connections close, so a migration is the dependable way to switch at once.

## Changing the Durable Object

- To rename or add Durable Object classes, add a new `[[migrations]]` entry with the next tag.
- Never edit `v1`.
- Deleting a class (`deleted_classes`) erases its data.
