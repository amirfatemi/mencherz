import type { PublicUser } from '../../../shared/protocol.ts';
import { GameView } from '../components/GameView.tsx';
import { WaitingRoom } from '../components/WaitingRoom.tsx';
import { navigate } from '../router.ts';
import { useRoomStream } from '../useRoomStream.ts';

export function RoomPage({ code, user }: { code: string; user: PublicUser }) {
  const stream = useRoomStream(code);

  if (stream.error) {
    return (
      <div className="center-card card">
        <h2>Can't open game {code}</h2>
        <p>{stream.error}</p>
        <button className="btn primary" onClick={() => navigate('/')}>
          Back to the lobby
        </button>
      </div>
    );
  }

  if (!stream.view) return <div className="center-card muted">Joining {code}…</div>;
  if (stream.view.status === 'waiting') return <WaitingRoom view={stream.view} user={user} />;
  return <GameView stream={stream} user={user} />;
}
