import { useCallback, useEffect, useState } from 'react';
import type { PublicUser } from '../../shared/protocol.ts';
import { api } from './api.ts';
import { Logo } from './components/Logo.tsx';
import { AccountPage } from './pages/AccountPage.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { AuthPage } from './pages/AuthPage.tsx';
import { LobbyPage } from './pages/LobbyPage.tsx';
import { RoomPage } from './pages/RoomPage.tsx';
import { navigate, usePath } from './router.ts';
import { closeSocket, getSocket } from './socket.ts';

export function App() {
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);
  const [online, setOnline] = useState(true);
  const path = usePath();

  const refreshUser = useCallback(() => {
    api<PublicUser>('/me')
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(refreshUser, [refreshUser]);

  useEffect(() => {
    if (!user) return;
    const s = getSocket();
    const onError = (err: Error) => {
      setOnline(false);
      if (err.message === 'unauthorized') {
        closeSocket();
        setUser(null);
      }
    };
    const onConnect = () => setOnline(true);
    const onDisconnect = () => setOnline(false);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onError);
    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onError);
    };
  }, [user]);

  const logout = async () => {
    await api('/logout', {}).catch(() => {});
    closeSocket();
    setUser(null);
    navigate('/', true);
  };

  if (user === undefined) {
    return (
      <div className="splash">
        <Logo />
      </div>
    );
  }
  if (!user) return <AuthPage onSignedIn={setUser} />;

  const room = path.match(/^\/g\/([A-Za-z0-9]{4,8})\/?$/);
  const settings = /^\/settings\/?$/.test(path);
  const admin = /^\/admin\/?$/.test(path);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('/')} aria-label="Lobby">
          <Logo small />
        </button>
        <div className="topbar-right">
          {!online && <span className="pill warn">Reconnecting…</span>}
          {user.isAdmin && (
            <button className="btn ghost small" onClick={() => navigate('/admin')}>
              Admin
            </button>
          )}
          <button
            className="user-chip"
            title={`${user.points} points · ${user.gamesPlayed} games · ${user.wins} wins — settings`}
            onClick={() => navigate('/settings')}
          >
            <span className="avatar">{user.username[0].toUpperCase()}</span>
            <span className="user-name">{user.username}</span>
            <span className="user-stats">
              ⭐ {user.points} · 🏆 {user.wins}
            </span>
            <span className="user-gear" aria-label="Settings">
              ⚙
            </span>
          </button>
          <button className="btn ghost small" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <main>
        {room ? (
          <RoomPage key={room[1].toUpperCase()} code={room[1].toUpperCase()} user={user} />
        ) : settings ? (
          <AccountPage user={user} onVisible={refreshUser} />
        ) : admin ? (
          <AdminPage user={user} />
        ) : (
          <LobbyPage user={user} onVisible={refreshUser} />
        )}
      </main>
    </div>
  );
}
