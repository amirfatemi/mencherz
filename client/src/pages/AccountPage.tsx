import { useEffect, useState, type FormEvent } from 'react';
import { MEDALS, TITLES, titleFor } from '../../../shared/awards.ts';
import type { PairCode, PublicUser } from '../../../shared/protocol.ts';
import { api } from '../api.ts';
import { navigate } from '../router.ts';
import { getSocket } from '../socket.ts';

function RecordCard({ user }: { user: PublicUser }) {
  const rate = user.gamesPlayed ? Math.round((user.wins / user.gamesPlayed) * 100) : 0;
  const average = user.gamesPlayed ? user.points / user.gamesPlayed : 0;
  return (
    <section className="card">
      <h2>Your record</h2>
      <div className="stat-tiles">
        <div className="stat-tile">
          <b>{user.points.toLocaleString()}</b>
          <span>⭐ points</span>
        </div>
        <div className="stat-tile">
          <b>{user.gamesPlayed}</b>
          <span>🎲 games</span>
        </div>
        <div className="stat-tile">
          <b>{user.wins}</b>
          <span>🏆 wins</span>
        </div>
        <div className="stat-tile">
          <b>{average.toLocaleString(undefined, { maximumFractionDigits: 1 })}</b>
          <span>⌀ points a game</span>
        </div>
        <div className="stat-tile">
          <b>{rate}%</b>
          <span>win rate</span>
        </div>
      </div>
    </section>
  );
}

function MedalsCard({ user }: { user: PublicUser }) {
  const title = titleFor(user.points);
  const next = TITLES.find((t) => t.from > user.points);
  return (
    <section className="card">
      <h2>
        {title.icon} {title.name}
      </h2>
      <p className="muted small">
        {next ? `${next.from - user.points} more points to ${next.icon} ${next.name}.` : 'The highest title there is.'} Titles and medals come from
        games with at least two people.
      </p>
      <ul className="medal-grid">
        {MEDALS.map((m) => {
          const n = user.medals?.[m.id] ?? 0;
          return (
            <li key={m.id} className={n ? 'won' : ''} title={m.how}>
              <span className="medal-icon">{m.icon}</span>
              <b>{m.name}</b>
              <span className="muted small">{m.how}</span>
              <span className="medal-count">{n ? `×${n}` : 'not yet'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PairCodeCard({ user }: { user: PublicUser }) {
  const [code, setCode] = useState<PairCode | null>(null);
  const [paired, setPaired] = useState<{ by: string; game: string; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [code]);

  useEffect(() => {
    const s = getSocket();
    const onPaired = (info: { by: string; game: string; code: string }) => {
      setPaired(info);
      setCode(null);
    };
    s.on('account:paired', onPaired);
    return () => {
      s.off('account:paired', onPaired);
    };
  }, []);

  const left = code ? Math.max(0, code.expiresAt - now) : 0;
  useEffect(() => {
    if (code && left === 0) setCode(null);
  }, [code, left]);

  const get = () => {
    setError(null);
    setPaired(null);
    api<PairCode>('/pair-code', {})
      .then((c) => {
        setCode(c);
        setNow(Date.now());
      })
      .catch((e: Error) => setError(e.message));
  };

  const mins = Math.floor(left / 60000);
  const secs = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');

  return (
    <section className="card pair-card">
      <h2>📱 Play on someone else's device</h2>
      <p className="muted">
        Playing on a friend's tablet? Tap <b>Get a code</b> and read it to them. On their screen they pick a seat, tap <b>📱 Add player here</b>, and
        enter your username <b>{user.username}</b> with the code. The game then counts for you: points, games and wins.
      </p>
      {code ? (
        <div className="pair-code-box">
          <div className="pair-code" aria-label="Your one-time code">
            {code.code.slice(0, 3)} {code.code.slice(3)}
          </div>
          <div className="muted small">
            Works once · expires in {mins}:{secs}
          </div>
          <button className="btn ghost small" onClick={get}>
            New code
          </button>
        </div>
      ) : (
        <button className="btn primary" onClick={get}>
          Get a code
        </button>
      )}
      {paired && (
        <div className="success">
          ✓ {paired.by} added you to “{paired.game}”.{' '}
          <button className="link" onClick={() => navigate(`/g/${paired.code}`)}>
            Watch it here
          </button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </section>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const mismatch = again.length > 0 && again !== password;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== again) return;
    setBusy(true);
    setError(null);
    setDone(false);
    api('/password', { current, password })
      .then(() => {
        setDone(true);
        setCurrent('');
        setPassword('');
        setAgain('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <section className="card">
      <h2>🔑 Change password</h2>
      <form className="password-form" onSubmit={submit}>
        <label className="field">
          <span>Current password</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label className="field">
          <span>New password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} maxLength={128} autoComplete="new-password" required />
        </label>
        <label className="field">
          <span>New password again</span>
          <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
        </label>
        {mismatch && <div className="error small">The two new passwords don't match.</div>}
        {error && <div className="error small">{error}</div>}
        {done && <div className="success">✓ Password changed. Your other devices have been signed out.</div>}
        <button className="btn primary" disabled={busy || !current || password.length < 6 || password !== again}>
          Change password
        </button>
      </form>
    </section>
  );
}

export function AccountPage({ user, onVisible }: { user: PublicUser; onVisible: () => void }) {
  useEffect(onVisible, [onVisible]);
  return (
    <div className="account">
      <div className="account-head">
        <h1>Settings</h1>
        <button className="btn ghost small" onClick={() => navigate('/')}>
          ← Lobby
        </button>
      </div>
      <RecordCard user={user} />
      <MedalsCard user={user} />
      <PairCodeCard user={user} />
      <PasswordCard />
    </div>
  );
}
