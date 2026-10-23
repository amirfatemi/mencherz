import { COLOR_NAMES, GOAL, TAKEOFF, type Seat } from '../../shared/board.ts';
import type { SeatView } from '../../shared/protocol.ts';
import type { GameEvent, RollEvent } from '../../shared/rules.ts';
import { POINTS, killStreakName } from '../../shared/scoring.ts';

export function seatName(seats: SeatView[], seat: Seat): string {
  const s = seats[seat];
  if (s?.name) return s.name;
  if (s?.kind === 'bot') return `${COLOR_NAMES[seat]} bot`;
  return COLOR_NAMES[seat];
}

/** What the dragon did with a roll: ate someone, left a bomb, or came round and exploded. */
function dragonText(ev: RollEvent, seats: SeatView[]): string {
  const d = ev.dragon;
  if (!d) return '';
  if (d.exploded) return ' · the dragon 🐉 came full circle and exploded 💥';
  const bits = d.eaten.length ? [`the dragon 🐉 ate ${d.eaten.map((e) => `${seatName(seats, e.seat)}'s piece`).join(' and ')}`] : [];
  if (d.bomb !== undefined) bits.push('two sixes: the dragon 🐉 left a bomb 💣');
  return bits.map((b) => ` · ${b}`).join('');
}

export function describe(ev: GameEvent, seats: SeatView[]): string {
  const who = seatName(seats, ev.seat);
  if (ev.type === 'roll') {
    switch (ev.outcome) {
      case 'pass':
        return `${who} rolled ${ev.dice} — no move${dragonText(ev, seats)}`;
      case 'again':
        return `${who} rolled 6 — no move, rolls again${dragonText(ev, seats)}`;
      case 'forfeit':
        return `${who} rolled a third 6 — turn over`;
      case 'penalty':
        return `${who} rolled a third 6 — pieces sent back to the hangar!${ev.bomb ? ' 💣 Bomb time.' : ''}`;
      default:
        return `${who} rolled ${ev.dice}${dragonText(ev, seats)}`;
    }
  }
  if (ev.type === 'bomb') return ev.super ? `${who} put down a super bomb 💥` : `${who} dropped a bomb 💣`;
  if (ev.type === 'box') return `${who} hid a magic box 🎁`;
  if (ev.type === 'power') {
    if (ev.choice === 'ambush') {
      return `${who} set an ambush 🏹 over ${ev.over === undefined ? 'a' : `${seatName(seats, ev.over)}'s`} home column — every flight over it knocks out the whole column`;
    }
    if (ev.choice === 'box') return `${who} picked a magic box 🎁`;
    if (ev.choice === 'safe') return `${who} picked a safe square 🛡`;
    if (ev.choice === 'superBomb') return `${who} picked the super bomb 💥`;
    return `${who} picked a ${ev.choice} bridge ${ev.choice === 'heaven' ? '🌈' : '🔥'}`;
  }
  if (ev.type === 'safe') return `${who} made a square safe 🛡 for two rounds`;
  if (ev.type === 'vest') return `${who} put the vest 🦺 on a piece`;
  if (ev.type === 'bridge') return `${who} built a ${ev.kind} bridge ${ev.kind === 'heaven' ? '🌈 +10' : '🔥 −20'}`;
  if (ev.to === TAKEOFF) return `${who} launched a plane ✈`;
  const bits = [`${who} moved ${ev.dice}`];
  for (const step of ev.path) {
    if (step.kind === 'jump') bits.push('jumped');
    if (step.kind === 'fly') bits.push('took the shortcut ✈');
  }
  for (const c of ev.captures) {
    const extras = [c.king && '👑 a king', c.revenge && '⚔️ revenge', killStreakName(c.streak ?? 1), c.bounty && `🎯 bounty +${c.bounty}`].filter(Boolean);
    bits.push(`sent ${seatName(seats, c.seat)} back 💥 +${c.points}${extras.length ? ` (${extras.join(', ')})` : ''}`);
  }
  if (ev.bombed) {
    const b = ev.bombed;
    const whose = b.owner === null ? "the dragon's" : b.owner === ev.seat ? 'their own' : `${seatName(seats, b.owner)}'s`;
    const kind = b.blast ? 'super bomb 💥' : 'bomb 💣';
    if (b.saved) bits.push(`stepped on ${whose} ${kind} — the vest saved it 🦺`);
    else if (b.owner === null || b.owner === ev.seat) bits.push(`stepped on ${whose} ${kind}`);
    else bits.push(`stepped on ${whose} ${kind} +${b.points} for ${seatName(seats, b.owner)}`);
    const caught = (b.blast ?? []).filter((v) => !v.saved);
    if (caught.length) bits.push(`the blast took ${caught.map((v) => seatName(seats, v.seat)).join(', ')} with it`);
  }
  if (ev.box?.outcome) {
    const own = ev.box.owner === ev.seat;
    const owner = seatName(seats, ev.box.owner);
    const inside = {
      bomb: ev.box.saved ? 'a bomb, but the vest saved it 🦺' : `a bomb! 💣${ev.box.points ? ` +${ev.box.points} for ${owner}` : ''}`,
      vest: 'a protective vest 🦺 for one piece',
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
  if (ev.dragon) bits.push(ev.dragon.king ? `👑 the king slew the dragon 🐉 for good +${ev.dragon.points}` : `slew the dragon 🐉 +${ev.dragon.points}`);
  if (ev.to === GOAL) bits.push(`piece home 🏁 +${POINTS.home}`);
  let text = bits.join(' · ');
  if (ev.seatFinished) text += ev.bonus ? ` — ${who} brought all pieces home first! 🏆 +${ev.bonus}` : ` — ${who} brought all pieces home!`;
  return text;
}
