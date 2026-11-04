import { useState, type CSSProperties } from 'react';
import { COLOR_HEX, type Seat } from '../../../shared/board.ts';
import { HERO_KILL, HERO_KINDS, HERO_LIFE, heroOptions, type GameState, type HeroKind } from '../../../shared/rules.ts';
import { HERO_ART, HERO_LOOK } from '../heroes.ts';
import { HeroIcon } from './HeroArt.tsx';

const fa = (n: number) => n.toLocaleString('fa-IR');

/** A faint compass rose in the corner, as on an old map. */
function Compass() {
  return (
    <svg className="hero-picker-compass" viewBox="-50 -50 100 100" aria-hidden>
      <circle r={30} fill="none" stroke="currentColor" strokeWidth={1.2} />
      <circle r={36} fill="none" stroke="currentColor" strokeWidth={0.6} strokeDasharray="2 3" />
      {[0, 90, 180, 270].map((a) => (
        <path key={a} d="M0-44 6-6 0 0-6-6Z" fill="currentColor" transform={`rotate(${a})`} />
      ))}
      {[45, 135, 225, 315].map((a) => (
        <path key={a} d="M0-28 3.5-3.5 0 0-3.5-3.5Z" fill="currentColor" opacity={0.7} transform={`rotate(${a})`} />
      ))}
      <text y={-46} textAnchor="middle" fontSize={9} fill="currentColor">
        N
      </text>
      <text y={52} textAnchor="middle" fontSize={9} fill="currentColor">
        S
      </text>
    </svg>
  );
}

interface Props {
  game: GameState;
  seat: Seat;
  /** Whose hero it is. */
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
        <Compass />
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
                  aria-label={`${look.fa} (${look.en})`}
                >
                  <span className="hero-card-art">
                    <img src={HERO_ART[kind]} alt="" draggable={false} />
                    <span className="hero-card-ribbon" dir="ltr">
                      <span className="hero-card-badge">
                        <HeroIcon kind={kind} />
                      </span>
                      <span className="hero-card-title" dir="rtl">
                        <b>{look.fa}</b>
                        <small dir="ltr">{look.en}</small>
                      </span>
                    </span>
                  </span>
                  <span className="hero-card-power">{used ? 'این هیرو را در این بازی آورده‌ای.' : look.power}</span>
                  {chosen === kind && (
                    <span className="hero-card-check" aria-hidden>
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="hero-picker-actions">
          <button className="btn ghost hero-look" onClick={onHide}>
            📖 نگاه به صفحه
          </button>
          <button className="btn hero-go" disabled={!chosen} onClick={() => chosen && onPick(chosen)}>
            {chosen ? `${HERO_LOOK[chosen].fa} بیاید! ✨` : 'یکی را انتخاب کن ✨'}
          </button>
        </div>
      </div>
    </div>
  );
}
