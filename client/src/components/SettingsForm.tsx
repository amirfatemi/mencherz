import type { RoomSettings } from '../../../shared/protocol.ts';
import type { Rules } from '../../../shared/rules.ts';

export const TURN_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90];

interface Props {
  value: RoomSettings;
  onChange: (s: RoomSettings) => void;
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`toggle${disabled ? ' disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
      <span className="toggle-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function SettingsForm({ value, onChange }: Props) {
  const rules = value.rules;
  const setRules = (patch: Partial<Rules>) => onChange({ ...value, rules: { ...rules, ...patch } });

  return (
    <div className="settings-form">
      <label className="field">
        <span>Game name</span>
        <input value={value.name} maxLength={40} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Who can find it</span>
          <select value={value.isPublic ? 'public' : 'private'} onChange={(e) => onChange({ ...value, isPublic: e.target.value === 'public' })}>
            <option value="public">Public — listed in the lobby</option>
            <option value="private">Private — invite link only</option>
          </select>
        </label>
        <label className="field">
          <span>Turn timer</span>
          <select value={value.turnSeconds} onChange={(e) => onChange({ ...value, turnSeconds: Number(e.target.value) })}>
            {TURN_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? 'No limit' : `${s} seconds`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span>How to win</span>
          <select value={rules.winBy} onChange={(e) => setRules({ winBy: e.target.value as Rules['winBy'] })}>
            <option value="points">Most points — 100 per piece home, 20–70 per knock-out</option>
            <option value="race">First to bring all four pieces home (classic)</option>
          </select>
        </label>
        <label className="field">
          <span>Difficulty</span>
          <select value={rules.difficulty} onChange={(e) => setRules({ difficulty: e.target.value as Rules['difficulty'] })}>
            <option value="easy">Easy — a kind dice: third sixes and bomb landings are rarer</option>
            <option value="normal">Normal — a fair dice</option>
            <option value="hard">Hard — a mean dice: third sixes and bomb landings come up more</option>
          </select>
        </label>
      </div>

      <Toggle
        label="Reaction GIFs"
        hint="A happy or angry GIF pops up over a player's hangar when their piece gets home, or when a piece past halfway is knocked out"
        checked={value.gifs}
        onChange={(v) => onChange({ ...value, gifs: v })}
      />

      <details className="house-rules">
        <summary>House rules</summary>
        <div className="field-row">
          <label className="field">
            <span>Launch a plane on</span>
            <select value={rules.launchOn} onChange={(e) => setRules({ launchOn: e.target.value as Rules['launchOn'] })}>
              <option value="six">A 6 only (classic)</option>
              <option value="fiveSix">A 5 or a 6</option>
              <option value="even">Any even number</option>
            </select>
          </label>
          <label className="field">
            <span>Reaching the centre</span>
            <select value={rules.finish} onChange={(e) => setRules({ finish: e.target.value as Rules['finish'] })}>
              <option value="bounce">Overshoot bounces back (classic)</option>
              <option value="exact">Exact roll needed</option>
            </select>
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Three sixes in a row</span>
            <select value={rules.threeSixes} disabled={!rules.bonusRollOnSix} onChange={(e) => setRules({ threeSixes: e.target.value as Rules['threeSixes'] })}>
              <option value="hangar">Every piece not yet home goes back to the hangar</option>
              <option value="penalty">Planes moved on the sixes go back (classic)</option>
              <option value="forfeit">Turn ends</option>
              <option value="off">Nothing happens</option>
            </select>
          </label>
          <label className="field">
            <span>The game ends</span>
            <select value={rules.playUntil} onChange={(e) => setRules({ playUntil: e.target.value as Rules['playUntil'] })}>
              <option value="winner">When the first player has all pieces home</option>
              <option value="all">When everyone has all pieces home</option>
            </select>
          </label>
        </div>
        <Toggle label="A 6 gives another roll" checked={rules.bonusRollOnSix} onChange={(v) => setRules({ bonusRollOnSix: v })} />
        <Toggle
          label="Magic boxes 🎁"
          hint="Before the first roll everyone hides a box. Another player landing on it gets a bomb, a protective vest, nothing, or −10 points."
          checked={rules.magicBoxes}
          onChange={(v) => setRules({ magicBoxes: v })}
        />
        <Toggle
          label="Bombs 💣"
          hint="Whoever is sent back by three sixes drops a bomb on any empty track square. The next piece to land there goes back to its hangar."
          checked={rules.bombs}
          disabled={!rules.bonusRollOnSix || rules.threeSixes === 'off' || rules.threeSixes === 'forfeit'}
          onChange={(v) => setRules({ bombs: v })}
        />
        <Toggle label="Colour jumps" hint="Landing on your colour jumps to the next square of it" checked={rules.jumps} onChange={(v) => setRules({ jumps: v })} />
        <Toggle label="Flight shortcuts" hint="Landing on your ✈ square flies across the board" checked={rules.flights} onChange={(v) => setRules({ flights: v })} />
        <Toggle
          label="Flights knock out planes below"
          hint="A plane on the home square the flight crosses goes back to its hangar"
          checked={rules.flightCapture}
          disabled={!rules.flights}
          onChange={(v) => setRules({ flightCapture: v })}
        />
        <Toggle label="Capturing gives another roll" checked={rules.bonusRollOnCapture} onChange={(v) => setRules({ bonusRollOnCapture: v })} />
      </details>
    </div>
  );
}
