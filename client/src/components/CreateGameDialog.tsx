import { useState } from 'react';
import type { BotLevel } from '../../../shared/ai.ts';
import { COLOR_HEX, COLOR_NAMES, SEATS } from '../../../shared/board.ts';
import type { PublicUser, RoomSettings, SeatSetup } from '../../../shared/protocol.ts';
import { DEFAULT_RULES } from '../../../shared/rules.ts';
import { navigate } from '../router.ts';
import { call } from '../socket.ts';
import { Modal } from './Modal.tsx';
import { SettingsForm } from './SettingsForm.tsx';

type Choice = 'host' | 'open' | 'closed' | `bot:${BotLevel}`;

export type CreateMode = 'online' | 'local';

const PRESETS: Record<CreateMode, Choice[]> = {
  online: ['host', 'open', 'open', 'open'],
  local: ['host', 'open', 'open', 'open'],
};

const TITLES: Record<CreateMode, string> = {
  online: 'Create an online game',
  local: 'Play together on this device',
};

const NAMES: Record<CreateMode, (u: string) => string> = {
  online: (u) => `${u}'s game`,
  local: (u) => `${u}'s table`,
};

function toSetup(c: Choice): SeatSetup {
  if (c.startsWith('bot:')) return { kind: 'bot', botLevel: c.slice(4) as BotLevel };
  return { kind: c as 'host' | 'open' | 'closed' };
}

export function CreateGameDialog({ mode, user, onClose }: { mode: CreateMode; user: PublicUser; onClose: () => void }) {
  const [seats, setSeats] = useState<Choice[]>(PRESETS[mode]);
  const [settings, setSettings] = useState<RoomSettings>({
    name: NAMES[mode](user.username),
    isPublic: mode === 'online',
    turnSeconds: mode === 'online' ? 30 : 0,
    gifs: true,
    rules: DEFAULT_RULES,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setSeat = (i: number, c: Choice) =>
    setSeats((prev) => prev.map((old, j) => (j === i ? c : c === 'host' && old === 'host' ? 'open' : old)));

  const filled = seats.filter((s) => s !== 'closed').length;
  const hasOpen = seats.includes('open');

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { code } = await call('room:create', { settings, seats: seats.map(toSetup), startNow: !hasOpen });
      navigate(`/g/${code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={TITLES[mode]} onClose={onClose}>
      {mode === 'local' && (
        <p className="muted dialog-intro">
          Everyone plays on this screen. Leave their seats open: in the next step you add each player with their username and a one-time code
          from their Settings, so their points and wins count for them. Empty seats can be computers.
        </p>
      )}
      <div className="seat-setup">
        {SEATS.map((s) => (
          <div className="seat-setup-row" key={s}>
            <span className="swatch" style={{ background: COLOR_HEX[s] }} />
            <span className="seat-setup-color">{COLOR_NAMES[s]}</span>
            <select value={seats[s]} onChange={(e) => setSeat(s, e.target.value as Choice)} aria-label={`${COLOR_NAMES[s]} seat`}>
              <option value="host">You</option>
              <option value="open">{mode === 'local' ? 'Player on this device — add next' : 'Open seat — a friend joins'}</option>
              <option value="bot:easy">Computer · easy</option>
              <option value="bot:normal">Computer · normal</option>
              <option value="bot:hard">Computer · hard</option>
              <option value="closed">Nobody</option>
            </select>
          </div>
        ))}
      </div>
      <SettingsForm value={settings} onChange={setSettings} />
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || filled < 2 || !seats.includes('host')} onClick={create}>
          {hasOpen ? 'Create game' : 'Start playing'}
        </button>
      </div>
    </Modal>
  );
}
