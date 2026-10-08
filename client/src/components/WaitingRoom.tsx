import { useState, type CSSProperties, type FormEvent } from 'react';
import type { BotLevel } from '../../../shared/ai.ts';
import { COLOR_HEX, COLOR_NAMES, type Seat } from '../../../shared/board.ts';
import { peopleIn, type PublicUser, type RoomSettings, type RoomView, type SeatView } from '../../../shared/protocol.ts';
import { RANKED_MIN_PEOPLE } from '../../../shared/scoring.ts';
import { navigate } from '../router.ts';
import { call } from '../socket.ts';
import { Modal } from './Modal.tsx';
import { SettingsForm } from './SettingsForm.tsx';

// Seats laid out like the hangars on the board: yellow top-left, blue top-right, red bottom-left, green bottom-right.
const GRID_ORDER: Seat[] = [0, 1, 3, 2];

/** Seats a registered player at this device. They prove it's them with the code from their settings. */
function AddLocalDialog({ view, seat, onClose }: { view: RoomView; seat: Seat; onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    call('room:addLocal', { code: view.code, seat, username: username.trim(), pairCode: code })
      .then(onClose)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <Modal title={`Add a player on this device · ${COLOR_NAMES[seat]}`} onClose={onClose}>
      <form className="add-local" onSubmit={submit}>
        <p className="muted">
          On their own phone they open <b>Settings → Play on someone else's device</b> and tap <b>Get a code</b>. Enter their username and the
          6-digit code here. Their points and wins go on their own record.
        </p>
        <label className="field">
          <span>Their username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={20} autoFocus />
        </label>
        <label className="field">
          <span>One-time code</span>
          <input
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
          />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || username.trim().length < 3 || code.length !== 6}>
            Add player
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SeatCard({ view, seat, s, user, isHost, mySeat, onError, onAddLocal }: {
  view: RoomView;
  seat: Seat;
  s: SeatView;
  user: PublicUser;
  isHost: boolean;
  mySeat: number;
  onError: (msg: string) => void;
  onAddLocal: () => void;
}) {
  const act = (req: { action: 'take' } | { action: 'open' } | { action: 'close' } | { action: 'bot'; botLevel: BotLevel }) =>
    call('room:seat', { code: view.code, seat, ...req }).catch((e: Error) => onError(e.message));
  const isMe = s.kind === 'human' && s.userId === user.id;
  const isMyGuest = s.kind === 'human' && s.controllerId === user.id && !isMe;

  let body;
  if (s.kind === 'human') {
    body = (
      <>
        <div className="seat-who">
          <span className="avatar" style={{ background: COLOR_HEX[seat] }}>
            {s.name?.[0]?.toUpperCase()}
          </span>
          <span className="seat-name">{s.name}</span>
          <span className={`dot ${s.online ? 'on' : 'off'}`} title={s.online ? 'Here' : 'Not here'} />
        </div>
        <div className="seat-tags">
          {s.userId === view.hostId && <span className="pill">Host</span>}
          {isMe && <span className="pill accent">You</span>}
          {s.controllerId !== undefined && <span className="pill">📱 {isMyGuest ? 'on this device' : `on ${s.controllerName}'s device`}</span>}
        </div>
      </>
    );
  } else if (s.kind === 'bot') {
    body = (
      <div className="seat-who">
        <span className="avatar bot" style={{ background: COLOR_HEX[seat] }}>
          🤖
        </span>
        <span className="seat-name">Computer</span>
        {isHost ? (
          <select value={s.botLevel} onChange={(e) => act({ action: 'bot', botLevel: e.target.value as BotLevel })} aria-label="Computer level">
            <option value="easy">easy</option>
            <option value="normal">normal</option>
            <option value="hard">hard</option>
          </select>
        ) : (
          <span className="pill">{s.botLevel}</span>
        )}
      </div>
    );
  } else {
    body = <div className="seat-empty">{s.kind === 'open' ? 'Open seat' : 'Nobody'}</div>;
  }

  return (
    <div className={`seat-card ${s.kind}`} style={{ '--seat': COLOR_HEX[seat] } as CSSProperties}>
      <div className="seat-color">{COLOR_NAMES[seat]}</div>
      {body}
      <div className="seat-actions">
        {s.kind === 'open' && mySeat !== seat && (
          <button className="btn small primary" onClick={() => act({ action: 'take' })}>
            Sit here
          </button>
        )}
        {s.kind === 'open' && mySeat !== -1 && (
          <button className="btn small secondary" onClick={onAddLocal}>
            📱 Add player here
          </button>
        )}
        {isMyGuest && !isHost && (
          <button className="btn small ghost" onClick={() => act({ action: 'open' })}>
            Remove
          </button>
        )}
        {isHost && !isMe && (
          <>
            {s.kind !== 'bot' && (
              <button className="btn small ghost" onClick={() => act({ action: 'bot', botLevel: 'normal' })}>
                + Computer
              </button>
            )}
            {s.kind !== 'open' && (
              <button className="btn small ghost" onClick={() => act({ action: 'open' })}>
                {s.kind === 'human' ? 'Remove' : 'Open'}
              </button>
            )}
            {s.kind !== 'closed' && s.kind !== 'human' && (
              <button className="btn small ghost" onClick={() => act({ action: 'close' })}>
                Close
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function WaitingRoom({ view, user }: { view: RoomView; user: PublicUser }) {
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<RoomSettings | null>(null);
  const [addingTo, setAddingTo] = useState<Seat | null>(null);
  const isHost = view.hostId === user.id;
  const mySeat = view.seats.findIndex((s) => s.kind === 'human' && s.userId === user.id);
  const players = view.seats.filter((s) => s.kind === 'human' || s.kind === 'bot').length;
  const host = view.seats.find((s) => s.userId === view.hostId);
  const link = `${location.origin}/g/${view.code}`;

  const copy = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: view.settings.name, text: 'Join my Aeroplane Chess game', url: link });
      } else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* user cancelled */
    }
  };

  const start = () => call('room:start', { code: view.code }).catch((e: Error) => setError(e.message));
  const leave = () => call('room:leave', { code: view.code }).finally(() => navigate('/'));
  const save = () =>
    editing &&
    call('room:settings', { code: view.code, settings: editing })
      .then(() => setEditing(null))
      .catch((e: Error) => setError(e.message));

  return (
    <div className="waiting">
      <section className="card waiting-head">
        <div>
          <div className="eyebrow">Waiting room</div>
          <h1>{view.settings.name}</h1>
          <p className="muted">
            {isHost
              ? 'Share the link, fill the seats with friends or computers, then start. Playing together on this device? Use “📱 Add player here” on a seat.'
              : `Waiting for ${host?.name ?? 'the host'} to start the game.`}
          </p>
        </div>
        <div className="invite">
          <div className="invite-code" aria-label="Game code">
            {view.code}
          </div>
          <button className="btn secondary" onClick={copy}>
            {copied ? 'Link copied ✓' : 'Copy invite link'}
          </button>
        </div>
      </section>

      <div className="seat-grid">
        {GRID_ORDER.map((seat) => (
          <SeatCard
            key={seat}
            view={view}
            seat={seat}
            s={view.seats[seat]}
            user={user}
            isHost={isHost}
            mySeat={mySeat}
            onError={setError}
            onAddLocal={() => setAddingTo(seat)}
          />
        ))}
      </div>

      <section className="card waiting-foot">
        {view.spectators > 0 && (
          <div className="rule-chips">
            <span className="pill">👀 {view.spectators} watching</span>
          </div>
        )}
        {peopleIn(view.seats) < RANKED_MIN_PEOPLE && (
          <p className="muted small">With only one person playing, this game won't count on the leaderboard.</p>
        )}
        {error && <div className="error">{error}</div>}
        <div className="waiting-actions">
          <button className="btn ghost" onClick={leave}>
            Leave
          </button>
          {isHost && (
            <button className="btn ghost" onClick={() => setEditing(view.settings)}>
              Settings
            </button>
          )}
          {isHost ? (
            <button className="btn primary big" disabled={players < 2} onClick={start}>
              Start game · {players} players
            </button>
          ) : mySeat === -1 ? (
            <span className="muted">All seats are taken — you're watching.</span>
          ) : null}
        </div>
      </section>

      {addingTo !== null && <AddLocalDialog view={view} seat={addingTo} onClose={() => setAddingTo(null)} />}

      {editing && (
        <Modal title="Game settings" onClose={() => setEditing(null)}>
          <SettingsForm value={editing} onChange={setEditing} />
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={save}>
              Save
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
