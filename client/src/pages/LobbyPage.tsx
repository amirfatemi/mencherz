import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MEDALS, titleFor } from '../../../shared/awards.ts';
import { LEADER_SORTS, type LeaderRow, type LeaderSort, type LobbyData, type PublicUser, type RoomSummary } from '../../../shared/protocol.ts';
import { api } from '../api.ts';
import { CreateGameDialog, type CreateMode } from '../components/CreateGameDialog.tsx';
import { HowToPlay } from '../components/HowToPlay.tsx';
import { navigate } from '../router.ts';
import { call, getSocket } from '../socket.ts';

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function RoomRow({ room }: { room: RoomSummary }) {
  const label = room.mine ? (room.status === 'finished' ? 'View' : 'Resume') : room.status === 'playing' ? 'Watch' : 'Join';
  return (
    <li className={`room-row${room.yourTurn ? ' your-turn' : ''}`}>
      <div className="room-row-main">
        <div className="room-row-title">
          {room.name}
          {room.yourTurn && <span className="pill accent">Your turn</span>}
          {room.paused && room.status === 'playing' && <span className="pill">⏸ Paused</span>}
          {!room.isPublic && <span className="pill">Private</span>}
        </div>
        <div className="room-row-meta">
          <span className={`status ${room.status}`}>{room.status === 'waiting' ? 'Waiting for players' : room.status === 'playing' ? 'In progress' : 'Finished'}</span>
          <span>
            {room.players}/{room.capacity} players
          </span>
          <span>host {room.hostName}</span>
          <span>{ago(room.updatedAt)}</span>
        </div>
      </div>
      <button className={`btn ${label === 'Join' || label === 'Resume' ? 'primary' : 'ghost'} small`} onClick={() => navigate(`/g/${room.code}`)}>
        {label}
      </button>
    </li>
  );
}

const SORT_COLUMNS: { sort: LeaderSort; label: string; title: string; value: (r: LeaderRow) => number }[] = [
  { sort: 'points', label: '⭐ Points', title: 'Total points', value: (r) => r.points },
  { sort: 'games', label: 'Games', title: 'Games played', value: (r) => r.gamesPlayed },
  { sort: 'wins', label: 'Wins', title: 'Games won', value: (r) => r.wins },
  { sort: 'captures', label: '💥', title: 'Hits made: opponent pieces knocked out, in all games', value: (r) => r.captures },
  { sort: 'lost', label: '🤕', title: 'Hits taken: own pieces knocked out, in all games', value: (r) => r.lost },
  { sort: 'minutes', label: '⏱', title: 'Minutes played, in all games', value: (r) => r.minutes },
];

function savedSort(): LeaderSort {
  try {
    const s = localStorage.getItem('mz.leaderSort') as LeaderSort | null;
    return s && LEADER_SORTS.includes(s) ? s : 'points';
  } catch {
    return 'points';
  }
}

function Leaderboard({ rows, me, sort, onSort }: { rows: LeaderRow[] | null; me: string; sort: LeaderSort; onSort: (s: LeaderSort) => void }) {
  return (
    <section className="card leaderboard">
      <h2>🏆 Leaderboard</h2>
      <p className="muted small">
        Totals over every game with at least two people (games against computers alone don't count). 💥 hits made · 🤕 hits taken · ⏱ minutes
        played. Tap a column to sort by it.
      </p>
      {!rows ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nobody has finished a game yet. Points from every finished game add up here.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th aria-label="Place">#</th>
              <th>Player</th>
              {SORT_COLUMNS.map((c) => (
                <th key={c.sort} className="num" aria-sort={sort === c.sort ? 'descending' : 'none'}>
                  <button className={`sort-head${sort === c.sort ? ' on' : ''}`} onClick={() => onSort(c.sort)} title={`${c.title} — sort by this`}>
                    {c.label}
                    {sort === c.sort ? ' ▾' : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.username} className={r.username === me ? 'me' : ''}>
                <td className="place">{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
                <td className="who">
                  <span title={titleFor(r.points).name}>{titleFor(r.points).icon}</span> {r.username}
                  <span className="leader-medals">
                    {MEDALS.filter((m) => r.medals?.[m.id]).map((m) => (
                      <span key={m.id} title={`${m.name}: ${m.how}`}>
                        {m.icon}
                        {r.medals[m.id] > 1 ? <sub>{r.medals[m.id]}</sub> : null}
                      </span>
                    ))}
                  </span>
                </td>
                {SORT_COLUMNS.map((c) => (
                  <td key={c.sort} className={`num${sort === c.sort ? ' points' : ''}`}>
                    {c.value(r).toLocaleString()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function LobbyPage({ user, onVisible }: { user: PublicUser; onVisible: () => void }) {
  const [data, setData] = useState<LobbyData | null>(null);
  const [leaders, setLeaders] = useState<LeaderRow[] | null>(null);
  const [sort, setSort] = useState<LeaderSort>(savedSort);
  const [dialog, setDialog] = useState<CreateMode | null>(null);
  const [code, setCode] = useState('');
  const [rules, setRules] = useState(false);

  const load = useCallback(() => {
    call('lobby:list').then(setData).catch(() => {});
    api<LeaderRow[]>(`/leaderboard?sort=${sort}`)
      .then(setLeaders)
      .catch(() => {});
  }, [sort]);
  const sortBy = (s: LeaderSort) => {
    setSort(s);
    try {
      localStorage.setItem('mz.leaderSort', s);
    } catch {
      /* private mode */
    }
  };

  useEffect(() => {
    onVisible();
    const s = getSocket();
    s.on('lobby:changed', load);
    s.on('connect', load);
    if (s.connected) load();
    return () => {
      s.off('lobby:changed', load);
      s.off('connect', load);
    };
  }, [load, onVisible]);

  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().replace(/^.*\/g\//, '').toUpperCase();
    if (c) navigate(`/g/${c}`);
  };

  const active = data?.mine.filter((r) => r.status !== 'finished') ?? [];
  const finished = data?.mine.filter((r) => r.status === 'finished') ?? [];

  return (
    <div className="lobby">
      <section className="hero card">
        <div className="hero-text">
          <h1>Hi {user.username} 👋</h1>
          <p>Launch on a six, jump on your colour, take the flight shortcuts, knock out the others and score the most points.</p>
        </div>
        <div className="hero-actions">
          <button className="btn primary big" onClick={() => setDialog('online')}>
            <span aria-hidden>🌍</span> Create online game
          </button>
          <button className="btn secondary big" onClick={() => setDialog('local')}>
            <span aria-hidden>📱</span> Play on one device
          </button>
          <form className="join-form" onSubmit={join}>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Game code, e.g. K7Q2X" aria-label="Game code" maxLength={60} />
            <button className="btn ghost" disabled={!code.trim()}>
              Join
            </button>
          </form>
          <button className="btn secondary big" onClick={() => setRules(true)}>
            <span aria-hidden>📖</span> آموزش بازی
          </button>
        </div>
      </section>

      <div className="lobby-grid">
        <section className="card">
          <h2>Your games</h2>
          {!data ? (
            <p className="muted">Loading…</p>
          ) : active.length === 0 ? (
            <p className="muted">No games in progress. Create one, or join a game below.</p>
          ) : (
            <ul className="room-list">
              {active.map((r) => (
                <RoomRow key={r.code} room={r} />
              ))}
            </ul>
          )}
          {finished.length > 0 && (
            <>
              <h3>Recently finished</h3>
              <ul className="room-list">
                {finished.map((r) => (
                  <RoomRow key={r.code} room={r} />
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card">
          <h2>Open games</h2>
          {!data ? (
            <p className="muted">Loading…</p>
          ) : data.open.length === 0 ? (
            <p className="muted">Nobody is waiting right now. Create a public game and share the link.</p>
          ) : (
            <ul className="room-list">
              {data.open.map((r) => (
                <RoomRow key={r.code} room={r} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <Leaderboard rows={leaders} me={user.username} sort={sort} onSort={sortBy} />

      {dialog && <CreateGameDialog mode={dialog} user={user} onClose={() => setDialog(null)} />}
      {rules && <HowToPlay onClose={() => setRules(false)} />}
    </div>
  );
}
