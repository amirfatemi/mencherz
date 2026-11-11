import { COLOR_NAMES, GOAL, HANGAR, TAKEOFF, type Seat } from '../../shared/board.ts';
import type { SeatView } from '../../shared/protocol.ts';
import { HERO, ICE_TURNS, type GameEvent, type MoveEvent, type RollEvent } from '../../shared/rules.ts';
import { HERO_LOOK } from './heroes.ts';
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
  const whose = (e: { seat: Seat; piece: number }) => `${seatName(seats, e.seat)}'s ${e.piece >= HERO ? 'hero' : 'piece'}`;
  const bits = d.eaten.length ? [`the dragon 🐉 ate ${d.eaten.map(whose).join(' and ')}`] : [];
  for (const g of d.saved ?? []) bits.push(`${seatName(seats, g.seat)}'s ${g.by === 'rider' ? 'dragon rider 🐲' : 'guardian 💂'} went in a piece's place 🛡️`);
  if (d.bomb !== undefined) bits.push(d.superBomb ? 'three sixes: the dragon 🐉 left a super bomb 💥' : 'two sixes: the dragon 🐉 left a bomb 💣');
  return bits.map((b) => ` · ${b}`).join('');
}

function knockOuts(ev: MoveEvent, seats: SeatView[]): string[] {
  const out = ev.captures.map((c) => {
    const extras = [c.king && '👑 a king', c.revenge && '⚔️ revenge', killStreakName(c.streak ?? 1), c.bounty && `🎯 bounty +${c.bounty}`].filter(Boolean);
    if (c.sacrifice) return `${seatName(seats, c.seat)}'s guardian 💂 went in its pieces' place 🛡️ +${c.points}`;
    const whom = c.piece >= HERO ? `${seatName(seats, c.seat)}'s hero off the board` : `${seatName(seats, c.seat)} back`;
    return `sent ${whom} 💥 +${c.points}${extras.length ? ` (${extras.join(', ')})` : ''}`;
  });
  return out;
}

/** A hero's move, and what it did. */
function heroMove(ev: MoveEvent, who: string, seats: SeatView[]): string {
  const h = ev.hero!;
  const look = HERO_LOOK[h.kind];
  if (h.launch) return `${who} brought on the ${look.en.toLowerCase()} ${look.face}`;
  const bits = [`${who}'s ${look.en.toLowerCase()} ${look.face} went ${ev.path.length}${h.back ? ' back' : ''}`];
  bits.push(...knockOuts(ev, seats));
  if (h.hijacked.length) bits.push(`took over ${h.hijacked.length === 1 ? 'a bomb' : `${h.hijacked.length} bombs`} 💣 — they're ${who}'s now`);
  for (const x of h.stolen) {
    const whose = `${seatName(seats, x.seat)}'s ${x.piece >= HERO ? 'hero' : x.king ? 'king 👑' : 'piece'}`;
    bits.push(`robbed ${whose} 💰 +${x.points}${x.vests ? ' and a vest 🦺' : ''}`);
  }
  if (h.charmed.length) bits.push(`charmed ${h.charmed.map((v) => `${seatName(seats, v.seat)}'s piece`).join(' and ')} 🪄 — ${who}'s to move for a while`);
  for (const r of h.raised) bits.push(`sent one of ${seatName(seats, r.seat)}'s pieces back from the centre 💀 +${r.points}`);
  if (h.bounty) bits.push(`took the bounty 🎯 +${h.bounty}`);
  if (h.froze.length) bits.push(`froze ${h.froze.length === 1 ? 'a piece' : `${h.froze.length} pieces`} ❄️`);
  if (ev.box?.outcome) bits.push(ev.box.outcome === 'plus' ? `found +${POINTS.boxBonus} in a magic box 🎁` : 'found a vest in a magic box 🦺');
  if (ev.bombed && !ev.bombed.saved) bits.push('stepped on a bomb 💣 and is gone');
  else if (ev.bombed) bits.push('stepped on a bomb — its vest saved it 🦺');
  if (ev.dragon) bits.push(`slew the dragon 🐉 +${ev.dragon.points}`);
  if (h.ends && ev.to !== HANGAR && h.kind !== 'engineer') bits.push('its lap is done, and it leaves 👋');
  if (h.ends && h.kind === 'engineer') bits.push('its lap is done: its last super bomb comes next');
  return bits.join(' · ');
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
  if (ev.type === 'bomb') {
    if (ev.ends) return `${who}'s engineer 👷 put down its last super bomb 💥, then went off`;
    return ev.super ? `${who} put down a super bomb 💥` : `${who} dropped a bomb 💣`;
  }
  if (ev.type === 'hero') return `${who} picked their heroes 🦸`;
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
  if (ev.hero) return heroMove(ev, who, seats);
  if (ev.charm) {
    const bits = [`${who} moved ${seatName(seats, ev.charm.seat)}'s charmed piece 🪄 ${ev.dice}`, ...knockOuts(ev, seats)];
    if (ev.bombed) bits.push(ev.bombed.saved ? 'it stepped on a bomb — its vest saved it 🦺' : 'it stepped on a bomb 💣 and went home');
    if (ev.dragon) bits.push(`slew the dragon 🐉 +${ev.dragon.points}`);
    return bits.join(' · ');
  }
  if (ev.to === TAKEOFF) return `${who} launched a plane ✈`;
  const bits = [`${who} moved ${ev.dice}`];
  for (const step of ev.path) {
    if (step.kind === 'jump') bits.push('jumped');
    if (step.kind === 'fly') bits.push('took the shortcut ✈');
  }
  bits.push(...knockOuts(ev, seats));
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
      freeze: `ice 🧊 — that piece sits out ${ICE_TURNS} turns`,
    }[ev.box.outcome] ?? 'nothing';
    bits.push(`opened ${own ? 'their own' : `${owner}'s`} magic box 🎁: ${inside}`);
  }
  if (ev.bridge) {
    const whose = ev.bridge.owner === ev.seat ? 'their own' : `${seatName(seats, ev.bridge.owner)}'s`;
    bits.push(ev.bridge.kind === 'heaven' ? `crossed ${whose} heaven bridge 🌈 +10` : `fell through ${whose} hell bridge 🔥`);
  }
  if (ev.power) bits.push('landed on a power square ⚡');
  if (ev.dragon) bits.push(ev.dragon.king ? `👑 the king slew the dragon 🐉 +${ev.dragon.points}` : `slew the dragon 🐉 +${ev.dragon.points}`);
  if (ev.to === GOAL) bits.push(`piece home 🏁 +${POINTS.home}`);
  let text = bits.join(' · ');
  if (ev.seatFinished) text += ev.bonus ? ` — ${who} brought all pieces home first! 🏆 +${ev.bonus}` : ` — ${who} brought all pieces home!`;
  return text;
}
