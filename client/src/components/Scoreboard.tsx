import type { CSSProperties } from 'react';
import { COLOR_HEX, PIECES_PER_SEAT, type Seat } from '../../../shared/board.ts';
import type { SeatView } from '../../../shared/protocol.ts';
import type { GameEvent, GameState } from '../../../shared/rules.ts';
import { EARLY_UNTIL, LATE_FROM, POINTS, REVENGE } from '../../../shared/scoring.ts';
import { describe, seatName } from '../events.ts';

export const MEDALS = ['🥇', '🥈', '🥉', '4th'];

interface Props {
  game: GameState;
  seats: SeatView[];
  events: GameEvent[];
  mySeat: number;
  over: boolean;
  userId: number;
  spectators: number;
}

/** Small marks after a name: computer, played at someone's device, away, wearing a vest. */
function Marks({ s, vests, userId }: { s: SeatView; vests: number; userId: number }) {
  return (
    <>
      {s.kind === 'bot' && (
        <span className="mark" title={s.left ? 'Left the game — a computer plays' : `Computer · ${s.botLevel}`}>
          🤖
        </span>
      )}
      {s.kind === 'human' && s.controllerId !== undefined && (
        <span className="mark" title={s.controllerId === userId ? 'Plays on this device' : `Plays on ${s.controllerName}'s device`}>
          📱
        </span>
      )}
      {s.kind === 'human' && !s.online && (
        <span className="mark" title="Away — their turns are played for them">
          💤
        </span>
      )}
      {vests > 0 && (
        <span className="mark" title="A protective vest stops the next bomb">
          🦺{vests > 1 ? `×${vests}` : ''}
        </span>
      )}
    </>
  );
}

export function Scoreboard({ game, seats, events, mySeat, over, userId, spectators }: Props) {
  const rows: Seat[] =
    over && game.standings.length
      ? game.standings
      : [...game.active].sort((a, b) => game.stats[b].points - game.stats[a].points);
  const last = events.at(-1);
  // Who just scored: the mover, and the owner of a bomb that went off.
  const gains = new Map<Seat, number>();
  if (last?.type === 'move') {
    if (last.points || last.bonus) gains.set(last.seat, last.points + (last.bonus ?? 0));
    for (const hit of [last.bombed, last.box]) {
      if (hit?.points) gains.set(hit.owner, (gains.get(hit.owner) ?? 0) + hit.points);
    }
  }

  return (
    <section className="card scoreboard">
      <div className="scoreboard-head">
        <h3>Scoreboard</h3>
        <span className="muted small">
          {game.rules.winBy === 'points' ? 'Most points wins' : 'First home wins'}
          {spectators > 0 && ` · 👀 ${spectators}`}
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th aria-label="Place">#</th>
            <th>Player</th>
            <th title="Pieces home">🏁</th>
            <th title="Hits made: opponent pieces knocked out">💥</th>
            <th title="Hits taken: own pieces knocked out">🤕</th>
            <th className="num">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((seat, i) => {
            const st = game.stats[seat];
            return (
              <tr
                key={seat}
                className={`${seat === game.turn && !over ? 'current' : ''}${seat === mySeat ? ' me' : ''}`}
                style={{ '--seat': COLOR_HEX[seat] } as CSSProperties}
              >
                <td className="place">{over && game.standings.length ? MEDALS[i] : i + 1}</td>
                <td className="who">
                  <span className="swatch" />
                  <span className="who-name">{seatName(seats, seat)}</span>
                  <Marks s={seats[seat]} vests={game.vests?.[seat] ?? 0} userId={userId} />
                </td>
                <td>
                  {st.home}/{PIECES_PER_SEAT}
                </td>
                <td>{st.captures}</td>
                <td>{st.lost}</td>
                <td className="num">
                  <span key={st.points} className="points">
                    {st.points}
                  </span>
                  {gains.has(seat) && (
                    <span key={game.seq} className={`gain${gains.get(seat)! < 0 ? ' loss' : ''}`}>
                      {gains.get(seat)! < 0 ? `−${-gains.get(seat)!}` : `+${gains.get(seat)}`}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="score-key">🏁 pieces home · 💥 hits made · 🤕 hits taken</p>
      <p className="last-move" style={last ? ({ '--seat': COLOR_HEX[last.seat] } as CSSProperties) : undefined}>
        {last ? describe(last, seats) : `${seatName(seats, game.turn)} goes first.`}
      </p>
      <details className="points-legend">
        <summary>How points work</summary>
        <ul>
          <li>
            🏁 A piece reaches the centre: <b>+{POINTS.home}</b>
          </li>
          <li>
            🏆 First to bring all four home: <b>+{POINTS.firstHome}</b>
          </li>
          <li>
            💥 Knock out a piece in the first half of its route (squares 1–{EARLY_UNTIL}): <b>+{POINTS.captureEarly}</b>
          </li>
          <li>
            💥 …further along (squares {EARLY_UNTIL + 1}–{LATE_FROM - 1}): <b>+{POINTS.captureMid}</b>
          </li>
          <li>
            💥 …in the last 15% before its home column: <b>+{POINTS.captureLate}</b>
          </li>
          <li>
            ✈ Fly over a piece in its home column (only the player opposite can): <b>+{POINTS.captureHomeColumn}</b>
          </li>
          <li>💣 Someone lands on your bomb, or on the bomb in your magic box: the same as knocking that piece out</li>
          <li>
            ⚔️ Revenge: knocking out whoever last knocked out one of yours counts <b>×{REVENGE}</b>
          </li>
          <li>
            🎁 A magic box that takes points: <b>−{POINTS.boxPenalty}</b>
          </li>
        </ul>
      </details>
    </section>
  );
}
