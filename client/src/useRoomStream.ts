import { useCallback, useEffect, useRef, useState } from 'react';
import { GOAL, HANGAR_SLOTS, TRACK_CELLS, piecePoint, type Point, type Seat } from '../../shared/board.ts';
import type { RoomUpdate, RoomView } from '../../shared/protocol.ts';
import { REACTION_MS } from '../../shared/reactions.ts';
import { blastOf, type BoxHit, type MoveEvent, type RollEvent, type StepKind } from '../../shared/rules.ts';
import { POINTS } from '../../shared/scoring.ts';
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
import { heading, lerpAngle, restHeading } from './geometry.ts';
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
}

/** A magic box being opened: who opened it and what was inside. */
export interface BoxReveal {
  key: number;
  seat: Seat;
  box: BoxHit;
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
function scoreMoments(ev: MoveEvent): { at: Point; delay: number; text: string; seat: Seat }[] {
  const out = ev.captures.map((c) => ({ at: piecePoint(c.seat, c.piece, c.from), delay: captureAt(ev, c), text: `+${c.points}`, seat: ev.seat }));
  if (ev.to === GOAL) out.push({ at: piecePoint(ev.seat, ev.piece, GOAL), delay: arrivalAt(ev), text: `+${POINTS.home}`, seat: ev.seat });
  const b = ev.bombed;
  if (b) {
    const text = b.saved ? '🦺 Saved!' : b.points ? `💣 +${b.points}` : '💣';
    out.push({ at: TRACK_CELLS[b.square], delay: stepEnd(ev, b.atStep), text, seat: b.saved ? ev.seat : b.owner });
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
  /** A roll that couldn't be played, kept on the dice for a while before the next player goes. */
  const [held, setHeld] = useState<{ seat: Seat; value: number } | null>(null);

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
        if (ev?.type === 'roll') setLastRoll({ seat: ev.seat, value: ev.dice });
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
            await sleep(ROLL_MS / speed);
            setRolling(false);
            if (ev.penalized.length) await play(penaltyTimeline(ev), speed);
            if (ev.outcome === 'pass') {
              // Show the turn moving on, but keep the number up and the next player waiting.
              commit(u.room);
              setHeld({ seat: ev.seat, value: ev.dice });
              await sleep(PASS_HOLD_MS / speed);
              setHeld(null);
              continue;
            }
          } else if (ev.type === 'bomb' || ev.type === 'box') {
            // The bomb or box drops in (CSS) once the new state is shown.
            commit(u.room);
            await sleep(BOMB_MS / speed);
            continue;
          } else {
            for (const m of scoreMoments(ev)) {
              const popup: Popup = { ...m.at, id: ++popupIds, text: m.text, seat: m.seat };
              setTimeout(() => {
                if (!alive.current) return;
                setPopups((list) => [...list, popup]);
                setTimeout(() => setPopups((list) => list.filter((p) => p.id !== popup.id)), POPUP_MS);
              }, m.delay / speed);
            }
            if (ev.box?.outcome) {
              const shown: BoxReveal = { key: ++popupIds, seat: ev.seat, box: ev.box };
              setTimeout(() => {
                if (!alive.current) return;
                setReveal(shown);
                setTimeout(() => setReveal((r) => (r?.key === shown.key ? null : r)), BOX_REVEAL_MS / speed);
              }, boxOpenAt(ev) / speed);
            }
            await play(moveTimeline(ev), speed);
          }
        }
        commit(u.room);
      }
    } finally {
      running.current = false;
      setAnimating(false);
      setRolling(false);
      setHeld(null);
    }
  }, [commit, play]);

  useEffect(() => {
    alive.current = true;
    const socket = getSocket();
    const join = () =>
      call('room:join', { code })
        .then((room) => {
          queue.current = [];
          current.current = null;
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

  return { view, error, anim, rolling, lastRoll, held, animating, popups, reactions, reveal, now };
}
