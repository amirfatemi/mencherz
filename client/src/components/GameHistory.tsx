import { useEffect, useState, type CSSProperties } from 'react';
import { MEDAL_BY_ID } from '../../../shared/awards.ts';
import { COLOR_HEX } from '../../../shared/board.ts';
import { GAME_LENGTHS, type GameLength, type GameRecord, type HistoryPage } from '../../../shared/protocol.ts';
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
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

const LENGTH_LABELS: Record<GameLength, string> = { short: 'Under 30 min', medium: '30–60 min', long: 'Over 60 min' };

/** Every finished game that counted, newest first, five to a page, by winner and length; picking one opens its report. */
export function GameHistory({ me }: { me: string }) {
  const [data, setData] = useState<HistoryPage | null>(null);
  const [page, setPage] = useState(1);
  const [winner, setWinner] = useState('');
  const [length, setLength] = useState<GameLength | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<GameRecord | null>(null);

  useEffect(() => {
    setLoading(true);
    const query = new URLSearchParams({ page: String(page), ...(winner ? { winner } : {}), ...(length ? { length } : {}) });
    api<HistoryPage>(`/history?${query}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, winner, length]);
  const games = data?.games ?? null;
  const filtered = !!winner || !!length;

  return (
    <section className="card history">
      <h2>🗂 Game history</h2>
      <p className="muted small">
        Every finished game that counted (practice games against computers alone aren't listed). Tap one to see when it was played, who was
        there, and its end-of-game report.
      </p>
      <div className="history-filters">
        <label>
          <span>🥇 Winner</span>
          <select
            value={winner}
            onChange={(e) => {
              setWinner(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Anyone</option>
            {(data?.winners ?? []).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>⏱ Length</span>
          <select
            value={length}
            onChange={(e) => {
              setLength(e.target.value as GameLength | '');
              setPage(1);
            }}
          >
            <option value="">Any length</option>
            {GAME_LENGTHS.map((l) => (
              <option key={l} value={l}>
                {LENGTH_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <div className="error small">{error}</div>}
      {!games ? (
        !error && <p className="muted">Loading…</p>
      ) : games.length === 0 ? (
        <p className="muted">{filtered ? 'No games match these filters.' : 'No finished games yet.'}</p>
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
      {data && data.total > 0 && (
        <div className="history-pager">
          <button className="btn ghost small" disabled={loading || data.page <= 1} onClick={() => setPage(data.page - 1)}>
            ‹ Newer
          </button>
          <span className="muted small">
            Page {data.page} of {data.pages} · {data.total} {data.total === 1 ? 'game' : 'games'}
          </span>
          <button className="btn ghost small" disabled={loading || data.page >= data.pages} onClick={() => setPage(data.page + 1)}>
            Older ›
          </button>
        </div>
      )}
      {open && <GameReport game={open} me={me} onClose={() => setOpen(null)} />}
    </section>
  );
}
