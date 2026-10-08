import type { CSSProperties } from 'react';
import { COLOR_HEX } from '../../../shared/board.ts';
import type { SeatView } from '../../../shared/protocol.ts';
import { POINTS } from '../../../shared/scoring.ts';
import { seatName } from '../events.ts';
import type { BoxReveal } from '../useRoomStream.ts';

/** The card in the middle of the board while a magic box shows what it held. */
export function BoxRevealCard({ reveal, seats }: { reveal: BoxReveal; seats: SeatView[] }) {
  const { box, seat } = reveal;
  const who = seatName(seats, seat);
  const owner = seatName(seats, box.owner);
  const blast = box.outcome === 'bomb' && !box.saved;
  const good = box.outcome === 'vest' || box.outcome === 'empty' || box.saved;
  const [icon, title, text] =
    box.outcome === 'bomb'
      ? box.saved
        ? ['🦺', 'A bomb — but the vest saved it!', `${who}'s piece stays on the board. The vest is used up.`]
        : ['💣', 'A bomb!', `${who}'s piece goes back to the hangar.${box.points ? ` +${box.points} for ${owner}.` : ''}`]
      : box.outcome === 'vest'
        ? ['🦺', 'A protective vest!', `The next bomb ${who} lands on won't hurt.`]
        : box.outcome === 'empty'
          ? ['💨', 'Empty!', 'Nothing inside — lucky escape.']
          : ['💸', `−${POINTS.boxPenalty} points!`, `${who} loses ${POINTS.boxPenalty} points.`];
  return (
    <div className="box-reveal" aria-live="polite">
      <div className={`box-reveal-card ${blast || box.outcome === 'minus' ? 'bad' : good ? 'good' : ''}`} style={{ '--seat': COLOR_HEX[seat] } as CSSProperties}>
        <div className="box-reveal-head">
          🎁 {who} opened {box.owner === seat ? 'their own' : `${owner}'s`} magic box
        </div>
        <div className="box-reveal-art">
          <span className="box-reveal-box">🎁</span>
          <span className="box-reveal-icon">{icon}</span>
        </div>
        <div className="box-reveal-title">{title}</div>
        <div className="box-reveal-text">{text}</div>
      </div>
    </div>
  );
}
