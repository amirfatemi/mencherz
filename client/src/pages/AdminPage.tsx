import { useEffect, useState, type FormEvent } from 'react';
import type { AccountStatus, AdminUserRow, PublicUser } from '../../../shared/protocol.ts';
import { api } from '../api.ts';
import { Modal } from '../components/Modal.tsx';
import { navigate } from '../router.ts';

/** A password that's easy to read out: no 0/O or 1/l. */
function suggestPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function ResetDialog({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const [password, setPassword] = useState(suggestPassword);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    api('/admin/password', { userId: user.id, password })
      .then(() => setDone(true))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <Modal title={`New password for ${user.username}`} onClose={onClose}>
      {done ? (
        <>
          <p>
            <b>{user.username}</b>'s password is now:
          </p>
          <div className="pair-code admin-password">{password}</div>
          <p className="muted small">They have been signed out everywhere. Give them this password; they sign in with it as usual.</p>
          <div className="modal-actions">
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          <label className="field">
            <span>New password</span>
            <div className="admin-password-row">
              <input value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} maxLength={128} required autoComplete="off" spellCheck={false} />
              <button type="button" className="btn ghost small" onClick={() => setPassword(suggestPassword())}>
                New suggestion
              </button>
            </div>
          </label>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy || password.length < 6}>
              Set password
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

const STATUS_LABEL: Record<AccountStatus, string> = { pending: '⏳ Waiting', active: 'Active', disabled: '⛔ Disabled' };

interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
}

/**
 * The database's backups on GitHub (a draft release of the project's repository, encrypted): taken every month by
 * the server, or now; any can be put back, which first backs up what's there and signs everyone out.
 */
function Backups() {
  const [files, setFiles] = useState<BackupFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<BackupFile[]>('/admin/backups')
      .then((f) => {
        setFiles(f);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  const backUpNow = () => {
    setBusy(true);
    setNote(null);
    api<BackupFile>('/admin/backup', {})
      .then((f) => {
        setNote(`Backed up: ${f.name}`);
        return load();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const restore = (f: BackupFile) => {
    const when = new Date(f.createdAt).toLocaleString();
    if (!window.confirm(`Put back the backup from ${when}?\n\nEverything since then is replaced (a backup of it is taken first), every game in progress goes back to how it was, and everyone has to sign in again.`)) return;
    setBusy(true);
    setNote(null);
    api('/admin/restore', { name: f.name })
      .then(() => {
        setNote('Restored. The server is starting over on it; sign in again in a moment.');
        setTimeout(() => window.location.reload(), 3000);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <section className="card leaderboard admin-backups">
      <div className="admin-head">
        <h2>
          Backups {files && <span className="muted small">· {files.length}</span>}
        </h2>
        <button className="btn primary small" disabled={busy} onClick={backUpNow}>
          {busy ? 'Working…' : 'Back up now'}
        </button>
      </div>
      <p className="muted small">
        On the 1st of every month at 06:00 (Tehran) the server backs up all accounts, games and records, encrypted, to a draft release of the
        project's GitHub repository, keeping the last 12. Only someone with the backup key can open one.
      </p>
      {error && <div className="error">{error}</div>}
      {note && <div className="notice">{note}</div>}
      {!files ? (
        !error && <p className="muted">Loading…</p>
      ) : files.length === 0 ? (
        <p className="muted">No backups yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Taken</th>
              <th>Kind</th>
              <th className="num">Size</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.name}>
                <td>{new Date(f.createdAt).toLocaleString()}</td>
                <td>{f.name.replace(/^.*Z-|\.mzb$/g, '')}</td>
                <td className="num">{(f.size / 1024).toFixed(0)} KB</td>
                <td className="num admin-actions">
                  <button className="btn ghost small" disabled={busy} onClick={() => restore(f)}>
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function AdminPage({ user }: { user: PublicUser }) {
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<AdminUserRow | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const load = () =>
    api<AdminUserRow[]>('/admin/users')
      .then(setUsers)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    if (user.isAdmin) void load();
  }, [user.isAdmin]);

  /** Approves, disables or re-enables an account. */
  const setStatus = (u: AdminUserRow, status: 'active' | 'disabled') => {
    setBusy(u.id);
    setError(null);
    api('/admin/status', { userId: u.id, status })
      .then(load)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  if (!user.isAdmin) {
    return (
      <div className="center-card card">
        <h2>Admins only</h2>
        <button className="btn primary" onClick={() => navigate('/')}>
          Back to the lobby
        </button>
      </div>
    );
  }

  // New accounts waiting for approval come first.
  const shown = (users ?? [])
    .filter((u) => u.username.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
  const waiting = (users ?? []).filter((u) => u.status === 'pending').length;

  return (
    <div className="account">
      <div className="account-head">
        <h1>Admin</h1>
        <button className="btn ghost small" onClick={() => navigate('/')}>
          ← Lobby
        </button>
      </div>
      <section className="card leaderboard admin-users">
        <div className="admin-head">
          <h2>
            Players {users && <span className="muted small">· {users.length}</span>}
            {waiting > 0 && <span className="pill accent">{waiting} waiting for approval</span>}
          </h2>
          <input placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search players" />
        </div>
        <p className="muted small">
          New accounts wait here until you approve them; until then they can look around but can't create or join games. A disabled account
          can't either, until you enable it again.
        </p>
        {error && <div className="error">{error}</div>}
        {!users ? (
          <p className="muted">Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Status</th>
                <th>Joined</th>
                <th className="num">Games</th>
                <th className="num">Wins</th>
                <th className="num">Points</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} className={`${u.id === user.id ? 'me' : ''} status-${u.status}`}>
                  <td className="who">
                    {u.username}
                    {u.isAdmin && <span className="pill">admin</span>}
                  </td>
                  <td>
                    <span className={`pill account-status ${u.status}`}>{STATUS_LABEL[u.status]}</span>
                  </td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="num">{u.gamesPlayed}</td>
                  <td className="num">{u.wins}</td>
                  <td className="num">{u.points.toLocaleString()}</td>
                  <td className="num admin-actions">
                    {u.status === 'pending' && (
                      <button className="btn primary small" disabled={busy === u.id} onClick={() => setStatus(u, 'active')}>
                        Approve
                      </button>
                    )}
                    {u.status === 'disabled' && (
                      <button className="btn ghost small" disabled={busy === u.id} onClick={() => setStatus(u, 'active')}>
                        Enable
                      </button>
                    )}
                    {!u.isAdmin && u.status !== 'disabled' && (
                      <button className="btn danger small" disabled={busy === u.id} onClick={() => setStatus(u, 'disabled')}>
                        Disable
                      </button>
                    )}
                    <button className="btn ghost small" onClick={() => setResetting(u)}>
                      Reset password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <Backups />
      {resetting && <ResetDialog user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}
