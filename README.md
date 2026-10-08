# Mencherz ✈ — Aeroplane Chess online

A browser version of **Aeroplane Chess** (Flying Chess, the game behind *Battle Ludo*), built to be played online with friends. Players sign up with a username and password, create a game, and share an invite link or code. Others join, and empty seats can be filled with computer players.

**Live:** https://mencherz.shahvar.cloud. It runs on Cloudflare Workers with a Durable Object; see [DEPLOY.md](DEPLOY.md).

The same game server runs in two places:
- on **Node** (below), for local play and tests, and for Docker
- on **Cloudflare**, in a Durable Object (`worker/index.ts`)

## Run it

Requires **Node.js 22.18 or newer**. The server runs TypeScript directly with Node's built-in type stripping and stores data in Node's built-in SQLite.

```bash
npm install
npm run dev          # API on :3000, web app with hot reload on http://localhost:5173
```

Production:

```bash
npm run build        # builds the web app into dist/client
npm start            # serves the app and the API on http://localhost:3000
```

Docker:

```bash
docker build -t mencherz .
docker run -p 3000:3000 -v mencherz-data:/data mencherz
```

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `data/mencherz.db` | SQLite file (users, sessions, saved games) |
| `COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy, so rate limiting sees real client IPs |
| `ALLOWED_ORIGINS` | – | Comma-separated extra origins allowed to open a game socket. The server's own host is always allowed. |
| `ADMINS` | – | Comma-separated usernames that are admins. On Cloudflare, it is set in `wrangler.toml` `[vars]`. |

Behind a reverse proxy, forward WebSocket upgrades for `/ws` and keep the original `Host` header.

Cloudflare, locally and live:

```bash
npm run cf:dev       # builds, then runs the Worker and its Durable Object on http://localhost:8787
npm run deploy       # builds, then deploys to Cloudflare (needs `wrangler login` or CLOUDFLARE_API_TOKEN)
```

## What's in the game

- **Accounts:** username + password (scrypt-hashed), with sessions in an httpOnly cookie.
  - Signing in and signing up ask a small sum ("What is 3 + 5?"). Each sum works once.
  - **Admins** (named in `ADMINS`) get an Admin page. It lists every player and can set a new password for any of them, which signs that player out everywhere.
- **Lobby:**
  - Create an online game, or play together on one device. Any seat can be a computer player.
  - Join by code or invite link.
  - A list of open public games, which can be joined, or watched once they're in progress.
  - "Your games", which lets you resume any game and flags the ones where it's your turn.
  - A leaderboard of every player's total points, games and wins.
- **Waiting room:** four seats (Red, Blue, Green, Yellow). The host sets each seat to *open*, *computer (easy / normal / hard)* or *nobody*, and can remove players, change settings and start the game. Players can switch to any free seat.
- **Game:**
  - The server decides every roll and move. Everyone sees the board the same way round: yellow top-left, blue top-right, green bottom-right, red bottom-left.
  - The dice takes the colour of whoever is rolling.
  - Animations for rolls, steps, jumps, flights and captures.
  - Hovering a plane previews its move and which planes it would knock out.
  - Players always make their own move, even when only one is possible.
  - Pieces are glossy pawns or airplanes; switch with the toggle under the player list. Two or more pieces of one colour on a square show as one piece with a count.
  - On touch screens, the first tap on a piece shows its move and the second tap makes it.
- **Playing on one device:** in the waiting room, any seated player can tap **📱 Add player here** on an open seat and enter another player's username and one-time code. That player gets the code from **Settings → Play on someone else's device** on their own phone. It has 6 digits, works once, expires after 10 minutes and is burnt after 5 wrong tries. The seat is then played from the adding player's device, while the points, games and wins go on the seated player's own record.
- **Reaction GIFs:** a random GIF pops up over a player's hangar for 5 seconds. Happy ones show when your piece gets home, or when you knock out or bomb a piece past the middle of its route. Sad ones show when that happens to your piece. Opening a magic box always shows one: happy for a vest or an empty box, sad for a bomb or lost points. The GIFs are Giphy links in `shared/reactions.ts`, and each game can turn them off.
- **Turn timer:** off, or 10–90 s. When time runs out, the move is made for the player. The host can **pause** the game, which stops the clock and all turns, bots included, and resume it later.
- **Absent players:** a player who closes the tab has their turns played for them, so the others can carry on. A game where no human is present pauses.
- **Auto-save:** every change is written to SQLite, and games survive a server restart. Leaving mid-game hands your seat to a computer player.
- **Stats:** points, games played and wins per user, on the leaderboard and on the Settings page. A game counts only if at least two people played it (`RANKED_MIN_PEOPLE` in `shared/scoring.ts`), so games against computers alone are practice.

### Rules (defaults are the classic ones)

1. Each player starts with four planes in the hangar. A **6** launches one to the takeoff spot, and a 6 also gives another roll.
2. Planes go clockwise around the 52-square track, whose squares are coloured in rotation.
3. **Colour jump:** landing on your own colour jumps you 4 squares ahead to the next square of your colour.
4. **Flight:** landing on your colour's ✈ square flies you 12 squares ahead along the dashed line. A plane sitting on the home-column square the flight crosses (the opponent's third home square) is sent back to its hangar. You get at most one jump and one flight per move, in either order (jump → fly, or fly → jump).
5. **Capture:** ending on an opponent sends it back to its hangar. This is checked at every landing point in a jump/flight chain. Your own planes stack.
6. After a full lap, planes turn at the arrow into their home column. An overshoot bounces back from the centre.
7. **Three sixes** in a row: every piece not yet in the centre goes back to the hangar.
8. **Bomb 💣:** after that penalty, the same player drops a bomb on any empty track square (home columns can't be bombed). The next piece to land there goes back to its hangar, whoever it belongs to. Passing over a bomb is safe. The bomb's owner scores as for a knock-out.
9. **Magic box 🎁:** before the first roll, everyone hides one box on a track square, in turn order. Any piece landing on it opens it, the owner's included, and one of these happens at random:
   - a bomb, which sends the piece home and scores for the box's owner
   - a protective vest 🦺, which stops the next bomb that player lands on
   - nothing
   - −10 points

   What was inside shows on a card for 3 seconds while the game waits.
10. The game ends when a player has all four planes in the centre. By default the most points wins (see below); in the classic race, that first player wins.

### Points

By default the game is scored, so knocking pieces out matters as much as racing:

| | Points |
| --- | --- |
| A piece reaches the centre | 100 |
| Knock out a piece in the first half of its track (squares 1–25) | 20 |
| …between halfway and the last 15% (26–42) | 25 |
| …in the last 15% (43–50) | 30 |
| Fly over a piece in its home column (only the opposite player's flight can) | 70 |

The game still ends when the first player has all four pieces home. Places then go by points, with ties broken by pieces home and then finishing order, so a hunter can beat the first player home. The values live in `shared/scoring.ts`. The scoreboard next to the board replaces the game log.

**Difficulty** (per game) sets how mean the dice is:

| Difficulty | Dice |
| --- | --- |
| Normal | Fair. |
| Hard | A roll that would be a third six, or that would let a piece land on a bomb, is 2.5× as likely as any other face. |
| Easy | Those same rolls are half as likely. |

The weights live in `shared/dice.ts`.

**House rules** (set per game):
- How to win: most points / first to bring all four home (classic race)
- Difficulty: easy / normal / hard
- Launch on a 6 / on a 5 or 6 / on any even number
- Extra roll on a 6 (on or off)
- Three sixes: all pieces go back / the planes moved on the sixes go back / the turn just ends / nothing happens
- Bombs after a three-sixes penalty (on or off)
- Magic boxes (on or off)
- Reaction GIFs (on or off)
- Home: bounce back on overshoot / exact roll needed
- Colour jumps (on or off)
- Flights (on or off)
- Flight knock-out (on or off)
- Extra roll after a capture (on or off)
- Stop at the first winner, or play on until every place is decided

## Code layout

```
shared/     game logic, used by both server and browser
  board.ts    board geometry and position numbering
  rules.ts    pure rules engine: createGame / planMove / applyRoll / applyMove
  ai.ts       computer players (easy = mostly random, normal = greedy, hard = greedy + danger avoidance), bomb and box placement.
              Bots knock a piece out whenever they can; failing that, they bring a piece home if they can.
  dice.ts     dice weights per difficulty
  reactions.ts reaction GIFs and when they show
  timing.ts   animation lengths (the server waits for them before a bot moves)
  protocol.ts socket events and view types
  wire.ts     the WebSocket frames (a small Socket.IO-like protocol: events and acks)
  socket-client.ts  reconnecting client for it, used by the browser and the tests
server/     the game server, independent of where it runs
  core.ts     puts it together: /api requests and /ws connections
  hub.ts      rooms, broadcasts and acks over plain WebSockets
  auth.ts     sign-up/in, sessions, login rate limit, one-time codes, leaderboard
  rooms.ts    lobby, seats, turn flow, bots, timers, persistence
  db.ts       SQLite schema, behind an interface both runtimes implement
  app.ts, index.ts, sqlite.ts   the Node runtime: Express for the client, `ws`, node:sqlite
worker/     the Cloudflare runtime: static assets, plus a Durable Object (MencherzHub) running server/core.ts on its SQLite storage
client/     React + SVG (Vite)
  src/components/Board.tsx   board, planes, move preview
  src/useRoomStream.ts       joins a room and plays its updates in order, with animations
```

The board follows Battle Ludo's layout. Each hangar sits in a corner, and the track winds around it with deep rectangular squares and triangle squares at the corners. A flight goes from one inner corner to the next.

Positions are seat-relative (`shared/board.ts`):
- `-1` hangar
- `0` takeoff
- `1–50` track. Square 1 is the triangle sharing the takeoff's corner square, so a 1 from takeoff lands right next to it. Your colour's squares are 2, 6, 10, …, 50, the ✈ square is 18, and the arrow square into your home column is 50.
- `51–55` home column
- `56` centre

Saved games from earlier board numberings are converted when the server loads them (`server/migrate.ts`).

## Tests

```bash
npm test             # rules engine + full online games over real sockets (incl. a server restart)
npm run typecheck
```
