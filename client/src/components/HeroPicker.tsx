import { useState, type CSSProperties } from 'react';
import { COLOR_HEX, type Seat } from '../../../shared/board.ts';
import { HERO_KILL, HERO_KINDS, HERO_LIFE, heroOptions, type GameState, type HeroKind } from '../../../shared/rules.ts';
import { HERO_LOOK } from '../heroes.ts';
import { HeroPortrait } from './HeroArt.tsx';

const fa = (n: number) => n.toLocaleString('fa-IR');

interface Props {
  game: GameState;
  seat: Seat;
  /** Whose hero it is, when it's not the viewer's own seat. */
  name: string;
  onPick: (kind: HeroKind) => void;
  /** Put the picker away to look at the board first. */
  onHide: () => void;
}

/** The hero cards: tap one to look at it, then confirm. Kinds already had this game are greyed out. */
export function HeroPicker({ game, seat, name, onPick, onHide }: Props) {
  const options = heroOptions(game, seat);
  const [picked, setPicked] = useState<HeroKind | null>(null);
  const chosen = picked && options.includes(picked) ? picked : null;
  return (
    <div className="hero-picker-backdrop">
      <div className="hero-picker card" role="dialog" aria-modal="true" aria-label="Pick a hero" dir="rtl" lang="fa" style={{ '--seat': COLOR_HEX[seat] } as CSSProperties}>
        <div className="hero-picker-head">
          <h2>🦸 {name}، هیروی خودت را انتخاب کن</h2>
          <p>
            هیرو مثل مهرهٔ پنجم است: {fa(HERO_LIFE)} خانه (یک دور کامل) روی مسیر می‌چرخد، وارد خط خانه نمی‌شود و بعد می‌رود. حرکتش جای حرکت یکی از
            مهره‌هاست. اگر کسی بزندش، {fa(HERO_KILL)} امتیاز می‌گیرد. هر هیرو را در هر بازی فقط یک بار می‌توانی بیاوری.
          </p>
        </div>
        <ul className="hero-cards">
          {HERO_KINDS.map((kind) => {
            const look = HERO_LOOK[kind];
            const used = !options.includes(kind);
            return (
              <li key={kind}>
                <button
                  className={`hero-card ${kind}${chosen === kind ? ' on' : ''}`}
                  style={{ '--hero-deep': look.deep, '--hero-light': look.light } as CSSProperties}
                  disabled={used}
                  onClick={() => setPicked(kind)}
                  aria-pressed={chosen === kind}
                >
                  <HeroPortrait kind={kind} size={96} />
                  <span className="hero-card-name">
                    {look.fa} <small dir="ltr">{look.en}</small>
                  </span>
                  <span className="hero-card-power">{used ? 'این هیرو را در این بازی آورده‌ای.' : look.power}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="hero-picker-actions">
          <button className="btn ghost" onClick={onHide}>
            نگاه به صفحه
          </button>
          <button className="btn primary big" disabled={!chosen} onClick={() => chosen && onPick(chosen)}>
            {chosen ? `${HERO_LOOK[chosen].face} ${HERO_LOOK[chosen].fa} بیاید!` : 'یکی را انتخاب کن'}
          </button>
        </div>
      </div>
    </div>
  );
}
