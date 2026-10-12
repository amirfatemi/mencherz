import { COLOR_NAMES, GOAL, TAKEOFF, type Seat } from '../../shared/board.ts';
import type { SeatView } from '../../shared/protocol.ts';
import type { GameEvent } from '../../shared/rules.ts';
import { POINTS, killStreakName } from '../../shared/scoring.ts';

export function seatName(seats: SeatView[], seat: Seat): string {
  const s = seats[seat];
  if (s?.name) return s.name;
  if (s?.kind === 'bot') return `${COLOR_NAMES[seat]} bot`;
  return COLOR_NAMES[seat];
}

export function describe(ev: GameEvent, seats: SeatView[]): string {
  const who = seatName(seats, ev.seat);
  if (ev.type === 'roll') {
    switch (ev.outcome) {
      case 'pass':
        return `${who} rolled ${ev.dice} — no move`;
      case 'again':
        return `${who} rolled 6 — no move, rolls again`;
      case 'forfeit':
        return `${who} rolled a third 6 — turn over`;
      case 'penalty':
        return `${who} rolled a third 6 — pieces sent back to the hangar!${ev.bomb ? ' 💣 Bomb time.' : ''}`;
      default:
        return `${who} rolled ${ev.dice}`;
    }
  }
  if (ev.type === 'bomb') return `${who} dropped a bomb 💣`;
  if (ev.type === 'box') return `${who} hid a magic box 🎁`;
  if (ev.type === 'power') {
    return ev.choice === 'box' ? `${who} picked a magic box 🎁` : `${who} picked a ${ev.choice} bridge ${ev.choice === 'heaven' ? '🌈' : '🔥'}`;
  }
  if (ev.type === 'bridge') return `${who} built a ${ev.kind} bridge ${ev.kind === 'heaven' ? '🌈 +10' : '🔥 −20'}`;
  if (ev.to === TAKEOFF) return `${who} launched a plane ✈`;
  const bits = [`${who} moved ${ev.dice}`];
  for (const step of ev.path) {
    if (step.kind === 'jump') bits.push('jumped');
    if (step.kind === 'fly') bits.push('took the shortcut ✈');
  }
  for (const c of ev.captures) {
    const extras = [c.king && "👑 a king", c.byKing && '👑 by the king', c.revenge && '⚔️ revenge', killStreakName(c.streak ?? 1)].filter(Boolean);
    bits.push(`sent ${seatName(seats, c.seat)} back 💥 +${c.points}${extras.length ? ` (${extras.join(', ')})` : ''}`);
  }
  if (ev.bombed) {
    const b = ev.bombed;
    const whose = b.owner === ev.seat ? 'their own' : `${seatName(seats, b.owner)}'s`;
    if (b.saved) bits.push(`stepped on ${whose} bomb — the vest saved it 🦺`);
    else bits.push(b.owner === ev.seat ? 'stepped on their own bomb 💣' : `stepped on ${whose} bomb 💣 +${b.points} for ${seatName(seats, b.owner)}`);
  }
  if (ev.box?.outcome) {
    const own = ev.box.owner === ev.seat;
    const owner = seatName(seats, ev.box.owner);
    const inside = {
      bomb: ev.box.saved ? 'a bomb, but the vest saved it 🦺' : `a bomb! 💣${ev.box.points ? ` +${ev.box.points} for ${owner}` : ''}`,
      vest: 'a protective vest 🦺',
      plus: `+${POINTS.boxBonus} points 💰`,
      minus: `−${POINTS.boxPenalty} points`,
      freeze: 'ice 🧊 — that piece sits out a turn',
    }[ev.box.outcome] ?? 'nothing';
    bits.push(`opened ${own ? 'their own' : `${owner}'s`} magic box 🎁: ${inside}`);
  }
  if (ev.bridge) {
    const whose = ev.bridge.owner === ev.seat ? 'their own' : `${seatName(seats, ev.bridge.owner)}'s`;
    bits.push(ev.bridge.kind === 'heaven' ? `crossed ${whose} heaven bridge 🌈 +10` : `fell through ${whose} hell bridge 🔥`);
  }
  if (ev.power) bits.push('landed on a power square ⚡');
  if (ev.to === GOAL) bits.push(`piece home 🏁 +${POINTS.home}`);
  let text = bits.join(' · ');
  if (ev.seatFinished) text += ev.bonus ? ` — ${who} brought all pieces home first! 🏆 +${ev.bonus}` : ` — ${who} brought all pieces home!`;
  return text;
}
