import { useCallback, useEffect, useRef, useState } from 'react';
import { GOAL, HANGAR_SLOTS, TRACK_CELLS, piecePoint, type Point, type Seat } from '../../shared/board.ts';
import type { RoomUpdate, RoomView } from '../../shared/protocol.ts';
import { REACTION_MS } from '../../shared/reactions.ts';
import { blastOf, type BoxHit, type MoveEvent, type RollEvent, type StepKind } from '../../shared/rules.ts';
import { DRAGON_PRIZE, type GameState, type WorldEventKind } from '../../shared/rules.ts';
import { POINTS, killStreakName } from '../../shared/scoring.ts';
import {
  BOMB_MS,
  BOX_REVEAL_MS,
  PASS_HOLD_MS,
  CAPTURE_MS,
  ROLL_MS,
  STEP_MS,
  arrivalAt,
  blastAt,
  boxOpenAt,
  captureAt,
  settledAt,
  stepEnd,
} from '../../shared/timing.ts';
import { dragonPoint, heading, lerpAngle, restHeading } from './geometry.ts';
import { sfx } from './sound.ts';
import { getSocket, call } from './socket.ts';

export interface AnimPiece extends Point {
  angle: number;
  scale: number;
  /** 0..1 hop height. */
  lift: number;
  spin: number;
}

/** A score that floats up from the board for a moment. */
export interface Popup extends Point {
  id: number;
  text: string;
  seat: Seat;
  /** A kill streak: shown larger. */
  big?: boolean;
}

/** A magic box being opened: who opened it and what was inside. */
export interface BoxReveal {
  key: number;
  seat: Seat;
  box: BoxHit;
}

/** A short banner across the board for a big moment. */
export interface Banner {
  key: number;
  text: string;
  tone: 'kill' | 'gold' | 'event';
}

const BANNER_MS = 1700;

/** What each surprise event's banner says. */
export const EVENT_BANNERS: Record<WorldEventKind, string> = {
  storm: '🌪 طوفان! پروازها یک دور بسته‌اند',
  goldRain: '💰 باران طلا! رسیدن به خانه ۱٫۲ برابر، دو دور',
  earthquake: '🌋 زلزله! بمب‌ها جابه‌جا شدند',
  darkNight: '🌙 شب تاریک! زدن ۱٫۲ برابر، دو دور',
  fog: '🌫 مه! جعبه‌ها یک دور پنهان‌اند',
};

/**
 * The banner a move earns, with when it shows. Kill streaks, kings and revenge are cinematic (`slow`: the move
 * plays in slow motion); the dragon and a bounty always show.
 */
function moveBanner(ev: MoveEvent): { at: number; text: string; tone: Banner['tone']; slow: boolean } | null {
  const spree = ev.captures.find((c) => (c.streak ?? 1) >= 2);
  if (spree) return { at: captureAt(ev, spree), text: `💀 ${killStreakName(spree.streak)!.toUpperCase()}!`, tone: 'kill', slow: true };
  const king = ev.captures.find((c) => c.king);
  if (king) return { at: captureAt(ev, king), text: '👑 KING DOWN!', tone: 'kill', slow: true };
  const revenge = ev.captures.find((c) => c.revenge);
  if (revenge) return { at: captureAt(ev, revenge), text: '⚔️ انتقام!', tone: 'kill', slow: true };
  if (ev.dragon) return { at: arrivalAt(ev), text: `🐉 اژدها شکار شد! +${DRAGON_PRIZE}`, tone: 'gold', slow: false };
  const bounty = ev.captures.find((c) => c.bounty);
  if (bounty) return { at: captureAt(ev, bounty), text: `🎯 جایزه گرفت! +${bounty.bounty}`, tone: 'gold', slow: false };
  return null;
}

/** The dragon stepping along its route with a roll, and the pieces it eats where it stops flying home. */
function dragonTimeline(ev: RollEvent): Timeline {
  const d = ev.dragon!;
  const segments: Segment[] = [];
  for (let k = 0; k < ev.dice; k++) {
    segments.push({ from: dragonPoint(d.from + k), to: dragonPoint(d.from + k + 1), start: k * STEP_MS.step, dur: STEP_MS.step, kind: 'step' });
  }
  const end = ev.dice * STEP_MS.step;
  const tl: Timeline = { motions: [{ key: 'dragon', startAngle: 0, segments }], booms: [], total: end };
  for (const e of d.eaten) {
    tl.motions.push(returnHome(e.seat, e.piece, e.from, end));
    tl.booms.push({ at: piecePoint(e.seat, e.piece, e.from), start: end });
    tl.total = end + CAPTURE_MS;
  }
  return tl;
}

/** The dragon exploding: a blast where it stood, and the pieces it took flying home. */
function dragonBlastTimeline(blast: NonNullable<GameState['dragonBlast']>): Timeline {
  const tl: Timeline = { motions: [], booms: [{ at: dragonPoint(blast.at), start: 0 }], total: CAPTURE_MS };
  for (const v of blast.hit) {
    tl.booms.push({ at: piecePoint(v.seat, v.piece, v.from), start: 0 });
    if (!v.saved) tl.motions.push(returnHome(v.seat, v.piece, v.from, 0));
  }
  return tl;
}

/** A reaction GIF showing over a seat's hangar. */
export interface ActiveReaction {
  key: number;
  seat: Seat;
  id: string;
}

export interface AnimFrame {
  /** Positions in board grid units, keyed "seat:piece". */
  pieces: Map<string, AnimPiece>;
  effects: (Point & { t: number })[];
}

type SegKind = StepKind | 'capture';

interface Segment {
  from: Point;
  to: Point;
  start: number;
  dur: number;
  kind: SegKind;
}

interface Motion {
  key: string;
  /** Heading before the first segment, so turns ease in instead of snapping. */
  startAngle: number;
  segments: Segment[];
}

interface Timeline {
  motions: Motion[];
  booms: { at: Point; start: number }[];
  total: number;
}

const BOOM_MS = 520;
const POPUP_MS = 1400;
let popupIds = 0;

/** When each scoring moment of a move happens, measured from the start of its animation. */
interface ScoreMoment {
  at: Point;
  delay: number;
  text: string;
  seat: Seat;
  big?: boolean;
}

/** With cinematic moments on, a kill streak gets a banner (see moveBanner), so its popup shows just the points. */
function scoreMoments(ev: MoveEvent, cinematic: boolean): ScoreMoment[] {
  const out = ev.captures.map((c): ScoreMoment => {
    const spree = cinematic ? null : killStreakName(c.streak ?? 1);
    const marks = `${c.king ? '👑 ' : ''}${c.revenge ? '⚔️ ' : ''}`;
    return {
      at: piecePoint(c.seat, c.piece, c.from),
      delay: captureAt(ev, c),
      text: spree ? `${spree}! ${marks}+${c.points}` : `${marks}+${c.points}`,
      seat: ev.seat,
      big: !!spree,
    };
  });
  if (ev.bridge) {
    const text = ev.bridge.kind === 'heaven' ? '🌈 +10' : `🔥 ${ev.bridge.to - ev.bridge.from}`;
    out.push({ at: TRACK_CELLS[ev.bridge.square], delay: stepEnd(ev, ev.bridge.atStep - 1), text, seat: ev.seat, big: false });
  }
  if (ev.to === GOAL) {
    const text = ev.bonus ? `+${POINTS.home} · 🏆 +${ev.bonus}` : `+${POINTS.home}`;
    out.push({ at: piecePoint(ev.seat, ev.piece, GOAL), delay: arrivalAt(ev), text, seat: ev.seat });
  }
  const b = ev.bombed;
  if (b) {
    const text = b.saved ? '🦺 Saved!' : b.points ? `💣 +${b.points}` : '💣';
    out.push({ at: TRACK_CELLS[b.square], delay: stepEnd(ev, b.atStep), text, seat: b.saved ? ev.seat : b.owner });
    for (const v of b.blast ?? []) {
      const at = piecePoint(v.seat, v.piece, v.from);
      out.push({ at, delay: stepEnd(ev, b.atStep), text: v.saved ? '🦺 Saved!' : v.points ? `💥 +${v.points}` : '💥', seat: v.saved ? v.seat : b.owner });
    }
  }
  // What a magic box held is shown on its own card (see BoxReveal), not as a popup.
  return out;
}

function returnHome(seat: Seat, piece: number, from: number, start: number): Motion {
  const at = piecePoint(seat, piece, from);
  return {
    key: `${seat}:${piece}`,
    startAngle: restHeading(seat, piece, from),
    segments: [{ from: at, to: HANGAR_SLOTS[seat][piece], start, dur: CAPTURE_MS, kind: 'capture' }],
  };
}

function moveTimeline(ev: MoveEvent): Timeline {
  const segments: Segment[] = [];
  let from = piecePoint(ev.seat, ev.piece, ev.from);
  ev.path.forEach((step, i) => {
    const to = piecePoint(ev.seat, ev.piece, step.pos);
    const dur = STEP_MS[step.kind];
    // stepEnd counts the pause while an opened magic box shows its contents; the piece waits on the box.
    segments.push({ from, to, start: stepEnd(ev, i) - dur, dur, kind: step.kind });
    from = to;
  });
  const t = settledAt(ev);
  const tl: Timeline = {
    motions: [{ key: `${ev.seat}:${ev.piece}`, startAngle: restHeading(ev.seat, ev.piece, ev.from), segments }],
    booms: [],
    total: t,
  };
  for (const c of ev.captures) {
    const start = captureAt(ev, c);
    tl.motions.push(returnHome(c.seat, c.piece, c.from, start));
    tl.booms.push({ at: piecePoint(c.seat, c.piece, c.from), start });
    tl.total = Math.max(tl.total, start + CAPTURE_MS);
  }
  const blast = blastOf(ev);
  if (blast) {
    // Later motions for the same piece take over, so it flies home from where it blew up.
    const at = blastAt(ev);
    tl.motions.push(returnHome(ev.seat, ev.piece, blast.pos, at));
    tl.booms.push({ at: TRACK_CELLS[blast.square], start: at });
    tl.total = Math.max(tl.total, at + CAPTURE_MS);
  }
  // A super bomb takes the pieces around it along, whether or not the one that set it off survived.
  for (const v of ev.bombed?.blast ?? []) {
    if (v.saved) continue;
    const at = stepEnd(ev, ev.bombed!.atStep);
    tl.motions.push(returnHome(v.seat, v.piece, v.from, at));
    tl.booms.push({ at: piecePoint(v.seat, v.piece, v.from), start: at });
    tl.total = Math.max(tl.total, at + CAPTURE_MS);
  }
  return tl;
}

function penaltyTimeline(ev: RollEvent): Timeline {
  const tl: Timeline = { motions: [], booms: [], total: CAPTURE_MS };
  for (const p of ev.penalized) {
    tl.motions.push(returnHome(ev.seat, p.piece, p.from, 0));
    tl.booms.push({ at: piecePoint(ev.seat, p.piece, p.from), start: 0 });
  }
  return tl;
}

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

// How high each kind of move hops (0..1) and how much it grows at the top of the arc.
const HOP: Record<SegKind, { lift: number; grow: number }> = {
  step: { lift: 0.28, grow: 0.04 },
  bounce: { lift: 0.28, grow: 0.04 },
  launch: { lift: 0.6, grow: 0.15 },
  jump: { lift: 0.85, grow: 0.3 },
  fly: { lift: 1, grow: 0.7 },
  bridge: { lift: 1, grow: 0.55 },
  capture: { lift: 1, grow: -0.3 },
};

function frameAt(tl: Timeline, t: number): AnimFrame {
  const pieces = new Map<string, AnimPiece>();
  for (const m of tl.motions) {
    if (t < m.segments[0].start) continue;
    let i = m.segments.length - 1;
    let u = 1;
    for (let j = 0; j < m.segments.length; j++) {
      const s = m.segments[j];
      if (t < s.start + s.dur) {
        i = j;
        u = Math.max(0, (t - s.start) / s.dur);
        break;
      }
    }
    const seg = m.segments[i];
    const e = ease(u);
    const arc = Math.sin(Math.PI * u);
    const hop = HOP[seg.kind];
    const dir = heading(seg.from, seg.to);
    const prev = i > 0 ? heading(m.segments[i - 1].from, m.segments[i - 1].to) : m.startAngle;
    pieces.set(m.key, {
      x: seg.from.x + (seg.to.x - seg.from.x) * e,
      y: seg.from.y + (seg.to.y - seg.from.y) * e,
      angle: seg.kind === 'capture' ? prev : lerpAngle(prev, dir, Math.min(1, u / 0.35)),
      scale: 1 + hop.grow * arc,
      lift: hop.lift * arc,
      spin: seg.kind === 'capture' ? 540 * e : 0,
    });
  }
  const effects = tl.booms
    .filter((b) => t >= b.start && t < b.start + BOOM_MS)
    .map((b) => ({ ...b.at, t: (t - b.start) / BOOM_MS }));
  return { pieces, effects };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The sounds of a move, each with when it plays, in ms from the start of the move's animation. */
function moveSounds(ev: MoveEvent): { at: number; play: () => void }[] {
  const out: { at: number; play: () => void }[] = [];
  ev.path.forEach((step, i) => {
    const end = stepEnd(ev, i);
    if (step.kind === 'fly' || step.kind === 'bridge') out.push({ at: end - STEP_MS[step.kind], play: sfx.fly });
    else if (step.kind === 'jump') out.push({ at: end - STEP_MS.jump, play: sfx.jump });
    else if (step.kind === 'launch') out.push({ at: 0, play: sfx.launch });
    else out.push({ at: end, play: sfx.step });
  });
  for (const c of ev.captures) out.push({ at: captureAt(ev, c), play: (c.streak ?? 1) >= 2 ? sfx.streak : sfx.hit });
  if (blastOf(ev) || ev.bombed?.blast?.some((v) => !v.saved)) out.push({ at: blastOf(ev) ? blastAt(ev) : stepEnd(ev, ev.bombed!.atStep), play: sfx.boom });
  if (ev.bombed?.saved) out.push({ at: stepEnd(ev, ev.bombed.atStep), play: sfx.good });
  const box = ev.box;
  if (box?.outcome) {
    const open = boxOpenAt(ev);
    out.push({ at: open, play: sfx.box });
    const outcome = box.outcome === 'freeze' ? sfx.freeze : (box.outcome === 'bomb' && !box.saved) || box.outcome === 'minus' ? sfx.bad : sfx.good;
    out.push({ at: open + 350, play: outcome });
  }
  if (ev.to === GOAL) out.push({ at: arrivalAt(ev), play: sfx.home });
  if (ev.seatFinished || ev.gameOver) out.push({ at: arrivalAt(ev) + 450, play: sfx.win });
  if (ev.power) out.push({ at: arrivalAt(ev), play: sfx.power });
  return out;
}

/**
 * Joins a room and replays its updates in order, animating dice rolls and moves before
 * each new state is shown. Falls behind gracefully by speeding up or skipping animations.
 */
export function useRoomStream(code: string) {
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anim, setAnim] = useState<AnimFrame | null>(null);
  const [rolling, setRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState<{ seat: Seat; value: number } | null>(null);
  const [animating, setAnimating] = useState(false);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [reactions, setReactions] = useState<ActiveReaction[]>([]);
  const [reveal, setReveal] = useState<BoxReveal | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [shake, setShake] = useState(false);
  /**
   * A roll that couldn't be played. Among people it stays on the dice until the next roll; with a computer
   * in the game it shows for a few seconds while the next player waits (`wait`), so people see it before a
   * bot rolls over it, and then the dice clears.
   */
  const [held, setHeld] = useState<{ seat: Seat; value: number; wait: boolean } | null>(null);

  const queue = useRef<RoomUpdate[]>([]);
  const running = useRef(false);
  const current = useRef<RoomView | null>(null);
  const alive = useRef(true);
  const clockOffset = useRef(0);

  const commit = useCallback((room: RoomView) => {
    setAnim(null);
    if (current.current && room.serverNow < current.current.serverNow) return;
    current.current = room;
    clockOffset.current = room.serverNow - Date.now();
    setView(room);
  }, []);

  const play = useCallback((tl: Timeline, speed: number) => {
    return new Promise<void>((resolve) => {
      const t0 = performance.now();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(fallback);
        resolve();
      };
      // Hidden tabs get no animation frames; the timer makes sure the queue keeps moving.
      const fallback = setTimeout(finish, tl.total / speed + 60);
      const tick = () => {
        if (done) return;
        if (!alive.current) return finish();
        const t = (performance.now() - t0) * speed;
        setAnim(frameAt(tl, Math.min(t, tl.total)));
        if (t >= tl.total) return finish();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, []);

  const showBanner = useCallback((text: string, tone: Banner['tone']) => {
    const shown: Banner = { key: ++popupIds, text, tone };
    setBanner(shown);
    sfx.sting();
    setTimeout(() => setBanner((b) => (b?.key === shown.key ? null : b)), BANNER_MS);
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length && alive.current) {
        const u = queue.current.shift()!;
        const ev = u.event;
        const behind = queue.current.length;
        const skip = document.hidden || behind > 6;
        const speed = behind > 2 ? 3 : 1;
        if (ev?.type === 'roll') {
          setLastRoll({ seat: ev.seat, value: ev.dice });
          setHeld(null);
        }
        const wait = u.room.seats.some((s) => s.kind === 'bot');
        const cinematic = u.room.settings.cinematic !== false;
        // Announced once the update has played: a new surprise event, or the dragon arriving.
        const before = current.current?.game;
        const announce = () => {
          const after = u.room.game;
          if (!before || !after || skip) return;
          if (after.event && after.event.n !== before.event?.n) {
            showBanner(EVENT_BANNERS[after.event.kind], 'event');
            sfx.event(after.event.kind);
          } else if (after.dragon && !before.dragon) {
            showBanner('🐉 اژدها آمد! مراقب باشید', 'event');
            sfx.roar();
          }
        };
        // The dragon exploding at the turn's end plays just before the new state shows.
        const blast = !skip && before && u.room.game?.dragonBlast && u.room.game.dragonBlast.n !== before.dragonBlast?.n ? u.room.game.dragonBlast : null;
        const explode = async () => {
          if (!blast) return;
          showBanner('🐉💥 اژدها منفجر شد!', 'kill');
          sfx.boom();
          if (cinematic) {
            setShake(true);
            setTimeout(() => setShake(false), 650);
          }
          await play(dragonBlastTimeline(blast), speed);
        };
        if (ev && current.current?.game && !skip) {
          setAnimating(true);
          // Reactions can come with any event (a move, or a roll of three sixes), timed from its start.
          for (const r of u.reactions ?? []) {
            const shown: ActiveReaction = { key: ++popupIds, seat: r.seat, id: r.id };
            setTimeout(() => {
              if (!alive.current) return;
              // A newer reaction for the same hangar replaces the old one.
              setReactions((list) => [...list.filter((x) => x.seat !== shown.seat), shown]);
              setTimeout(() => setReactions((list) => list.filter((x) => x.key !== shown.key)), REACTION_MS);
            }, r.at / speed);
          }
          if (ev.type === 'roll') {
            setRolling(true);
            sfx.roll();
            await sleep(ROLL_MS / speed);
            setRolling(false);
            if (ev.outcome === 'penalty' || ev.outcome === 'forfeit') sfx.bad();
            else sfx.land();
            if (ev.dragon) {
              sfx.roar();
              if (ev.dragon.eaten.length) setTimeout(() => alive.current && sfx.hit(), (ev.dice * STEP_MS.step) / speed);
              await play(dragonTimeline(ev), speed);
            }
            if (ev.penalized.length) await play(penaltyTimeline(ev), speed);
            if (ev.outcome === 'pass') {
              // Show the turn moving on, but keep the number up (and, with a bot about, the next player waiting).
              await explode();
              commit(u.room);
              announce();
              setHeld({ seat: ev.seat, value: ev.dice, wait });
              if (wait) {
                // Then the dice clears for the next player, in their colour.
                await sleep(PASS_HOLD_MS / speed);
                setHeld(null);
              }
              continue;
            }
          } else if (ev.type === 'power' || ev.type === 'vest') {
            (ev.type === 'power' ? sfx.power : sfx.good)();
            await explode();
            commit(u.room);
            announce();
            continue;
          } else if (ev.type === 'bomb' || ev.type === 'box' || ev.type === 'bridge' || ev.type === 'safe') {
            // The bomb or box drops in (CSS) once the new state is shown.
            sfx.place();
            await explode();
            commit(u.room);
            announce();
            await sleep(BOMB_MS / speed);
            continue;
          } else {
            // A big knock-out plays in slow motion, with its banner; a super bomb shakes the board.
            const big = moveBanner(ev);
            const pace = big?.slow && cinematic ? speed * 0.6 : speed;
            if (big && (!big.slow || cinematic)) setTimeout(() => alive.current && showBanner(big.text, big.tone), big.at / pace);
            if (cinematic && ev.bombed?.blast?.some((v) => !v.saved)) {
              setTimeout(() => {
                if (!alive.current) return;
                setShake(true);
                setTimeout(() => setShake(false), 650);
              }, stepEnd(ev, ev.bombed.atStep) / pace);
            }
            for (const s of moveSounds(ev)) setTimeout(() => alive.current && s.play(), s.at / pace);
            for (const m of scoreMoments(ev, cinematic)) {
              const popup: Popup = { ...m.at, id: ++popupIds, text: m.text, seat: m.seat, big: m.big };
              setTimeout(() => {
                if (!alive.current) return;
                setPopups((list) => [...list, popup]);
                setTimeout(() => setPopups((list) => list.filter((p) => p.id !== popup.id)), POPUP_MS);
              }, m.delay / pace);
            }
            if (ev.box?.outcome) {
              const shown: BoxReveal = { key: ++popupIds, seat: ev.seat, box: ev.box };
              setTimeout(() => {
                if (!alive.current) return;
                setReveal(shown);
                setTimeout(() => setReveal((r) => (r?.key === shown.key ? null : r)), BOX_REVEAL_MS / pace);
              }, boxOpenAt(ev) / pace);
            }
            await play(moveTimeline(ev), pace);
          }
          await explode();
        }
        commit(u.room);
        announce();
      }
    } finally {
      running.current = false;
      setAnimating(false);
      setRolling(false);
      setHeld((h) => (h?.wait ? null : h));
    }
  }, [commit, play, showBanner]);

  useEffect(() => {
    alive.current = true;
    const socket = getSocket();
    const join = () =>
      call('room:join', { code })
        .then((room) => {
          queue.current = [];
          current.current = null;
          setHeld(null);
          commit(room);
          const last = room.events.at(-1);
          if (last?.type === 'roll') setLastRoll({ seat: last.seat, value: last.dice });
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    const onUpdate = (u: RoomUpdate) => {
      if (u.room.code !== code) return;
      queue.current.push(u);
      void pump();
    };
    const onClosed = (info: { code: string; reason: string }) => {
      if (info.code === code) setError(`This game was closed (${info.reason.toLowerCase()}).`);
    };
    socket.on('room:update', onUpdate);
    socket.on('room:closed', onClosed);
    socket.on('connect', join);
    if (socket.connected) join();
    return () => {
      alive.current = false;
      socket.off('room:update', onUpdate);
      socket.off('room:closed', onClosed);
      socket.off('connect', join);
      socket.emit('room:unwatch', { code });
    };
  }, [code, commit, pump]);

  const now = useCallback(() => Date.now() + clockOffset.current, []);

  return { view, error, anim, rolling, lastRoll, held, animating, popups, reactions, reveal, banner, shake, now };
}
