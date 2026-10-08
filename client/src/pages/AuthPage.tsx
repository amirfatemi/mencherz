import { useState, type FormEvent } from 'react';
import type { PublicUser } from '../../../shared/protocol.ts';
import { api } from '../api.ts';
import { Logo } from '../components/Logo.tsx';

export function AuthPage({ onSignedIn }: { onSignedIn: (u: PublicUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'register' && password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      onSignedIn(await api<PublicUser>(mode === 'login' ? '/login' : '/register', { username, password }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const invite = location.pathname.match(/^\/g\/([A-Za-z0-9]+)/)?.[1];

  return (
    <div className="auth">
      <div className="auth-hero">
        <Logo />
        <p>Race your four planes home. Roll, jump on your colour, fly the shortcuts and knock your friends back to the hangar.</p>
      </div>
      <form className="card auth-card" onSubmit={submit}>
        {invite && (
          <div className="notice">
            You've been invited to game <b>{invite.toUpperCase()}</b>. Sign in or create an account to join.
          </div>
        )}
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Sign in
          </button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
            Create account
          </button>
        </div>
        <label className="field">
          <span>Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_\-]+"
            title="Letters, numbers, _ and -"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            maxLength={128}
          />
        </label>
        {mode === 'register' && (
          <label className="field">
            <span>Repeat password</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </label>
        )}
        {error && <div className="error">{error}</div>}
        <button className="btn primary block" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
