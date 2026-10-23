import { useEffect, useState, type CSSProperties } from 'react';
import { MEDAL_BY_ID } from '../../../shared/awards.ts';
import { COLOR_HEX } from '../../../shared/board.ts';
import type { GameRecord, HistoryPage } from '../../../shared/protocol.ts';
import { api } from '../api.ts';
import { formatDuration } from '../duration.ts';
import { Modal } from './Modal.tsx';
import { MEDALS as PLACES } from './Scoreboard.tsx';

const when = (ts: number) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const clock = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { timeStyle: 'short' });

/** One finished game's end-of-game report: who played, the final table, the highlights and the medals won. */
function GameReport({ game, me, onClose }: { game: GameRecord; me: string; onClose: () => void }) {
  const nameOf = new Map(game.players.map((p) => [p.seat, p.name]));
  const medalled = game.players.filter((p) => p.medals.length);
  return (
    <Modal title={game.name} onClose={onClose}>
      <p className="history-meta">
        🗓 {when(game.startedAt)} → {new Date(game.startedAt).toDateString() === new Date(game.finishedAt).toDateString() ? clock(game.finishedAt) : when(game.finishedAt)}
        <br />⏱ {formatDuration(game.playedMs)} · host {game.hostName} · {game.winBy === 'points' ? 'most points wins' : 'first home wins'} · code {game.code}
      </p>
      <ol className="results">
        {game.players.map((p) => (
          <li key={p.seat} style={{ '--seat': COLOR_HEX[p.seat] } as CSSProperties}>
            <span className="medal">{p.place ? PLACES[p.place - 1] : '–'}</span>
            <span className="swatch" />
            <span className="results-name">
              {p.name}
              {p.kind === 'bot' ? ` 🤖${p.botLevel ? ` · ${p.botLevel}` : ''}` : ''}
            </span>
            {p.name === me && p.kind === 'human' && <span className="pill accent">You</span>}
            {p.left && <span className="pill">left</span>}
            <span className="results-detail">
              🏁 {p.home} · 💥 {p.captures} · 🤕 {p.lost}
            </span>
            <span className="results-points">{p.points}</span>
          </li>
        ))}
      </ol>
      {game.awards.length > 0 && (
        <>
          <h3 className="report-head">Highlights</h3>
          <ul className="awards">
            {game.awards.map((a) => (
              <li key={a.id} style={{ '--seat': COLOR_HEX[a.seat] } as CSSProperties}>
                <span className="award-icon">{a.icon}</span>
                <span className="award-text">
                  <b>{a.title}</b>
                  <span>
                    <span className="swatch" /> {nameOf.get(a.seat)} · {a.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {medalled.length > 0 && (
        <>
          <h3 className="report-head">Medals won 🏅</h3>
          <ul className="new-medals">
            {medalled.map((p) => (
              <li key={p.seat}>
                <b>{p.name}</b>:{' '}
                {p.medals.map((id) => {
                  const m = MEDAL_BY_ID.get(id);
                  return m ? (
                    <span key={id} className="pill" title={m.how}>
                      {m.icon} {m.name}
                    </span>
                  ) : null;
                })}
              </li>
            ))}
          </ul>
        </>
      )}
      {game.stopped && <p className="muted">Everyone left, so the game was stopped.</p>}
      {!game.ranked && <p className="muted small">Practice game: with only one person playing, it didn't count on the leaderboard.</p>}
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

/** Every finished game, newest first, a page at a time; picking one opens its report. */
export function GameHistory({ me }: { me: string }) {
  const [games, setGames] = useState<GameRecord[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<GameRecord | null>(null);

  const load = (before: number | null) => {
    setLoading(true);
    api<HistoryPage>(`/history${before ? `?before=${before}` : ''}`)
      .then((page) => {
        setGames((list) => (before && list ? [...list, ...page.games] : page.games));
        setNext(page.next);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(null), []);

  return (
    <section className="card history">
      <h2>🗂 Game history</h2>
      <p className="muted small">Every finished game. Tap one to see when it was played, who was there, and its end-of-game report.</p>
      {error && <div className="error small">{error}</div>}
      {!games ? (
        !error && <p className="muted">Loading…</p>
      ) : games.length === 0 ? (
        <p className="muted">No finished games yet.</p>
      ) : (
        <ul className="history-list">
          {games.map((g) => {
            const winner = g.stopped ? null : g.players[0];
            return (
              <li key={g.code}>
                <button className="history-row" onClick={() => setOpen(g)}>
                  <span className="history-when">{when(g.finishedAt)}</span>
                  <span className="history-main">
                    <span className="history-name">
                      {g.name}
                      {!g.ranked && <span className="pill">practice</span>}
                      {g.stopped && <span className="pill">stopped</span>}
                    </span>
                    <span className="history-players">
                      {g.players.map((p) => (
                        <span key={p.seat} className="history-player" style={{ '--seat': COLOR_HEX[p.seat] } as CSSProperties}>
                          <span className="swatch" />
                          {p === winner ? '🥇 ' : ''}
                          {p.name}
                          {p.kind === 'bot' ? ' 🤖' : ''} <b>{p.points}</b>
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="history-time">⏱ {formatDuration(g.playedMs)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {next !== null && (
        <button className="btn ghost small history-more" disabled={loading} onClick={() => load(next)}>
          {loading ? 'Loading…' : 'Show older games'}
        </button>
      )}
      {open && <GameReport game={open} me={me} onClose={() => setOpen(null)} />}
    </section>
  );
}
