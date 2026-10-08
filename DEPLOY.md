# Deploying to Cloudflare Workers

**Live:** https://mencherz.shahvar.cloud
**Worker:** `mencherz`. Fallback URL: https://mencherz.amir-fatemi-amin.workers.dev

## How it runs

Cloudflare serves the built web app (`dist/client`) as static assets from its edge network.

Only `/api/*` and the `/ws` game socket run the Worker (`assets.run_worker_first`). The Worker hands both to one Durable Object, `GameHub`.

`GameHub` runs the same game server as the Node version (`server/core.ts`):
- accounts, sessions, saved games and the leaderboard live in the object's own SQLite storage
- every player's WebSocket connects to it
- bot moves and turn clocks run on its timers

One object for all games is plenty at this scale, and it keeps lobby, rooms and accounts in one place.

**Why this fits the Free plan:**
- Static assets are free and unlimited.
- Durable Objects with SQLite storage are available on the Workers Free plan. The `[[migrations]]` block in `wrangler.toml` creates `GameHub` with `new_sqlite_classes`.
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

This is how the shahvar site deploys. Connecting a repository can only be done in the dashboard.

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

## Changing the Durable Object

- To rename or add Durable Object classes, add a new `[[migrations]]` entry with the next tag.
- Never edit `v1`.
- Deleting a class (`deleted_classes`) erases its data.
