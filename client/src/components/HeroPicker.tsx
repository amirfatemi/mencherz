import { useState, type CSSProperties } from 'react';
import { COLOR_HEX, type Seat } from '../../../shared/board.ts';
import { HERO_KILL, HERO_KINDS, HERO_LIFE, heroOptions, type GameState, type HeroKind } from '../../../shared/rules.ts';
import { HERO_ART, HERO_LOOK } from '../heroes.ts';

const fa = (n: number) => n.toLocaleString('fa-IR');

/** Each hero's sign, drawn in white on its badge. */
function HeroIcon({ kind }: { kind: HeroKind }) {
  const line = { fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      {kind === 'guardian' && (
        <>
          <path d="M12 2.5 19.5 5.4V11c0 4.9-3.1 8.6-7.5 10.4C7.6 19.6 4.5 15.9 4.5 11V5.4Z" {...line} fill="#fff" fillOpacity={0.18} />
          <path d="M12 3v18" {...line} />
        </>
      )}
      {kind === 'engineer' && (
        <>
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x={10.7} y={1.6} width={2.6} height={4.2} rx={0.8} fill="#fff" transform={`rotate(${i * 45} 12 12)`} />
          ))}
          <circle cx={12} cy={12} r={6.2} {...line} strokeWidth={2.6} />
          <circle cx={12} cy={12} r={2.2} fill="#fff" />
        </>
      )}
      {kind === 'archer' && (
        <g transform="rotate(-45 12 12)">
          <path d="M9 2.5c6 2.5 6 16.5 0 19" {...line} />
          <path d="M9 2.5v19" {...line} strokeWidth={1.1} />
          <path d="M3 12h17.5M20.5 12l-3-2.4M20.5 12l-3 2.4M3 12l-1.5-1.8M3 12l-1.5 1.8" {...line} />
        </g>
      )}
      {kind === 'frost' &&
        [0, 60, 120].map((a) => (
          <g key={a} transform={`rotate(${a} 12 12)`}>
            <path d="M12 2v20M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" {...line} />
          </g>
        ))}
      {kind === 'thief' && (
        <>
          <path d="M9 3.5h6l-1.6 3h-2.8Z" fill="#fff" />
          <path d="M10 6.5C5.5 8.5 4 12.5 4.5 16c.5 3.3 3.4 5 7.5 5s7-1.7 7.5-5c.5-3.5-1-7.5-5.5-9.5Z" {...line} fill="#fff" fillOpacity={0.18} />
          <text x={12} y={17.6} textAnchor="middle" fontSize={9} fontWeight={800} fill="#fff">
            $
          </text>
        </>
      )}
      {kind === 'rider' && (
        <path
          d="M12 2.5c.8 3.4 5.5 5.5 5.5 11a5.5 5.5 0 0 1-11 0c0-2.6 1.4-4.4 2.6-5.6.1 1.8.9 3 2 3.4-.4-3.3-.3-5.9.9-8.8Z"
          {...line}
          fill="#fff"
          fillOpacity={0.25}
        />
      )}
    </svg>
  );
}

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
