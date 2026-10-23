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
- **Reaction GIFs:** a GIF pops up over a player's hangar for 8 seconds.
  - Happy ones show when your piece gets home, when you knock out or bomb a piece past the middle of its route, or on a double kill or more.
  - Sad ones show when that happens to your piece, after three sixes, and after three turns in a row with nothing out of the hangar.
  - Opening a magic box always shows one: happy for a vest or an empty box, sad for a bomb, ice or lost points.
  - Each game deals them like a shuffled deck: no GIF comes back until every GIF of its group has been shown, and a new round never opens with the one that closed the last.
  - The GIFs are Giphy links in `shared/reactions.ts`, and each game can turn them off.
- **A roll that can't be played** stays on the dice until the next roll. In a game with a computer player, the next player waits 5 seconds first, so everyone sees it before a bot rolls over it; among people the next player can roll straight away.
- **Turn timer:** off, or 10–90 s. When time runs out, the move is made for the player. The host can **pause** the game, which stops the clock and all turns, bots included, and resume it later.
- **Absent players:** a player who closes the tab has their turns played for them, so the others can carry on. A game where no human is present pauses.
- **Auto-save:** every change is written to SQLite, and games survive a server restart. Leaving mid-game hands your seat to a computer player.
- **Game clock:** the scoreboard shows the time played (pauses left out), and the results the whole game's length.
- **End-of-game report:** with the results come the game's highlights (player of the match, top hunter, biggest hit, longest kill streak, demolition expert, frequent flyer, six machine, unluckiest) and the medals each person won.
- **Medals and titles** (`shared/awards.ts`): in games that count, players win medals for good (Rocket, Hunter, Triple kill, Sniper, Demolisher, Untouchable, Dragon slayer, Phoenix), shown on the leaderboard and the Settings page. A title comes with total points: Rookie, Pilot (150), Captain (500), Ace (1200), Legend (2500).
- **Cinematic moments 🎬:** the board shakes when a super bomb goes off; double kills, knocked-out kings and revenge play in slow motion with a short banner. A game setting, like the GIFs.
- **Sounds:** short sounds for the dice, steps, jumps, flights, knock-outs, bombs, boxes, pieces home and wins, made with the Web Audio API (no files). The 🔊 button turns them off.
- **Version:** the top bar (and the sign-in page) shows the version, build date and commit, e.g. `v1.0.0 · 2026-10-23 · 5d3749c`.
- **Full screen:** the ⛶ button in the top bar fills the screen with the game. On an iPad or phone, *Add to Home Screen* installs it as an app that always opens full screen (iPhones only allow full screen this way).
- **Stats:** points, games played, wins, hits made and taken, and minutes played per user, on the leaderboard (sortable by any of them) and on the Settings page. A game counts only if at least two people played it (`RANKED_MIN_PEOPLE` in `shared/scoring.ts`), so games against computers alone are practice.

### Rules (defaults are the classic ones)

1. Each player starts with four planes in the hangar. A **6** launches one to the takeoff spot, and a 6 also gives another roll.
2. Planes go clockwise around the 52-square track, whose squares are coloured in rotation.
3. **Colour jump:** landing on your own colour jumps you 4 squares ahead to the next square of your colour.
4. **Flight:** landing on your colour's ✈ square flies you 12 squares ahead along the dashed line. A plane sitting on the home-column square the flight crosses (the opponent's third home square) is sent back to its hangar. You get at most one jump and one flight per move, in either order (jump → fly, or fly → jump).
5. **Capture:** ending on an opponent sends it back to its hangar. This is checked at every landing point in a jump/flight chain. A knock-out ends the move on that square: no jump or flight follows it, even from your own colour or your ✈ square. Knocking out the piece on the crossed home square doesn't stop a flight, since the plane flies over it. Your own planes stack.
6. After a full lap, planes turn at the arrow into their home column. An overshoot bounces back from the centre.
7. **Three sixes** in a row: every piece not yet in the centre goes back to the hangar.
8. **Bomb 💣:** after that penalty, the same player drops a bomb on any empty track square (home columns can't be bombed). The next piece to land there goes back to its hangar, whoever it belongs to. Passing over a bomb is safe. The bomb's owner scores as for a knock-out.
9. **Magic box 🎁:** before the first roll, everyone hides one box on a track square, in turn order. Any piece landing on it opens it, the owner's included, and one of these happens at random:
   - a bomb, which sends the piece home and scores for the box's owner
   - a protective vest 🦺: the player puts it on one of their pieces, in the hangar or out, and it stays on that piece (knock-outs included) until it stops a bomb
   - +20 points
   - −10 points
   - ice 🧊, which locks the piece on that square (no jump or flight from it) until its owner's next turn is over. Other pieces can still knock it out.

   What was inside shows on a card for 3 seconds while the game waits.
10. **Walls 🧱:** two or more pieces of one colour on a track square make a wall. Other colours can't pass it by stepping or with a colour jump (a move that would is not allowed, and a colour jump that would just doesn't happen). Flights ✈ and bridges go over it. Landing exactly on a wall knocks out every piece in it, each scored. Your own pieces pass your own walls.
11. **Kings 👑:** each colour's first piece wears a crown. Knocking out a king counts ×1.5. A king knocking others out scores like any piece: only losing it costs more.
12. **Power square ⚡:** one track square moves to a random free square every 5 rounds (never a flight square). It's painted purple with a gold sparkle: nobody's colour, so nobody jumps from it. A number on it shows the rounds left before it moves. Ending a move on it lets you pick:
    - **Heaven bridge 🌈:** you pick a free start square; the bridge leads 10 squares ahead. The first piece to land on its start, yours included, is carried there, and the bridge is gone. It does nothing for a piece whose route turns home before its end. On the board a bridge shows only its two ends: its icon in a solid ring at the start, smaller in a dashed ring at the end.
    - **Hell bridge 🔥:** the same, but 20 squares back (or to the piece's takeoff spot, if it hasn't come that far).
    - **Magic box 🎁:** hide a new magic box on any free square. Whoever lands on it first opens it, you included.
    - **Safe square 🛡:** pick a track square (not a home column), even one your piece stands on. For 2 rounds your pieces there can't be knocked out; others can still land there and share it.
    - **Ambush 🏹 (شبیخون, once called the Sirat bridge):** pick another player. For 5 rounds a second flight line crosses their home column. The corner square holding the ✈ that flies over it is two triangles of two colours, and the second colour now flies too, from its triangle to the square of its colour on the far side (if that doesn't take it past its own turn home). Every flight over the column knocks out every piece in it, not only the middle one.

    - **Super bomb 💥:** put a big bomb on a free track square. The first piece to land on it blows up, and so does every piece within 3 squares ahead or behind, whatever its colour, the owner's included. Home columns are out of reach; a vest or the piece's own safe square saves it. The owner scores each opponent piece blown up as a knock-out.

    The heaven bridge, hell bridge, ambush and super bomb can each be picked once a game: whoever picks one first uses it up for everyone. Magic boxes and safe squares can be picked any number of times.

    A bridge ends the move where it puts the piece down. Bombs, boxes and bridges can't go on the power square.
13. **Surprise events 🌪:** every 6 rounds one happens at random, announced with a banner and a sound: a storm (no flights, 1 round), gold rain (pieces reaching the centre score double, 2 rounds), an earthquake (every bomb jumps to another free square), a dark night (knock-outs score double, 2 rounds) or fog (magic boxes hidden, 1 round).
14. **Bounty on the leader 🎯:** whoever leads on points (alone) gets a MOST WANTED poster by their hangar. Knocking out one of their pieces, bombs included, pays the bounty on top: it starts at 5, grows by 3 each time their turn comes round in the lead (up to 30), and starts again at 5 once claimed.
15. **Dragon 🐉:** every 5 rounds a dragon appears on a free square for 2 rounds. It belongs to nobody and moves with every roll, as far as the dice says. Any piece where it stops is eaten (back to the hangar), unless on its own safe square. A piece that lands on the dragon slays it for 40 points.
16. The game goes on until only one player is left without all four planes in the centre. By default the most points wins (see below). In the classic race, the first player home wins.

### Points

By default the game is scored, so knocking pieces out pays as well as racing:

| | Points |
| --- | --- |
| The first player to bring all four pieces home | 100 |
| A piece reaches the centre | 20 |
| Knock out a piece in the first half of its track (squares 1–25) | 4 |
| …between halfway and the last 15% (26–42) | 6 |
| …in the last 15% (43–50) | 8 |
| Fly over a piece in its home column (only the opposite player's flight can) | 20 |
| **Revenge:** knock out whoever last knocked out one of yours | ×1.5 (once per knock-out received) |
| **Double kill:** a piece's second knock-out since it left the hangar | ×1.5 |
| **Triple kill** and later: its third knock-out and each one after | ×2 |
| **King:** knock out a king | ×1.5 |
| A magic box that gives points | +20 |
| A magic box that takes points | −10 |

Bonuses multiply, and a single knock-out is capped at 100.

The numbers are kept small, with 100 the biggest award. They were balanced with bot games played to third place: knock-outs make up about a fifth of all points. They have come down twice: from 10/15/20/40, when a busy hunter could collect close to the first-home bonus before anyone finished, and the three track values from 5/7/10 to 4/6/8 (with the bonus for hitting with the king dropped) after a game where the runner-up out-scored the first player home.

The game goes on after the first player finishes, until third place is decided (only one player left). Places go by points, with ties broken by pieces home and then finishing order, so finishing first nearly always decides the winner, and knock-outs settle the places behind.

The values live in `shared/scoring.ts`. The scoreboard next to the board replaces the game log. For each player it shows pieces home (🏁), hits made (💥, bombs and magic-box bombs included) and hits taken (🤕).

The full rules and scoring are also in the game, in Persian, under **📖 آموزش**.

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
- Power square (on or off)
- Walls (on or off)
- Kings (on or off)
- Surprise events, bounty on the leader, dragon (each on or off)
- Cinematic moments (on or off)
- Reaction GIFs (on or off)
- Home: bounce back on overshoot / exact roll needed
- Colour jumps (on or off)
- Flights (on or off)
- Flight knock-out (on or off)
- Extra roll after a capture (on or off)
- Play on until third place is decided (default), or stop at the first player home

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
