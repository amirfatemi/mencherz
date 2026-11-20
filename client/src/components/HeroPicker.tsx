import { useState, type CSSProperties } from 'react';
import { COLOR_HEX, type Seat } from '../../../shared/board.ts';
import { GUARDIAN_KILL, HERO_KILL, HERO_KINDS, HERO_LIFE, HERO_REST_ROUNDS, HERO_ROLE, HERO_ROLES, HERO_TEAM, type HeroKind } from '../../../shared/rules.ts';
import { HERO_ART, HERO_LOOK, ROLE_LOOK } from '../heroes.ts';
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
  seat: Seat;
  /** Whose heroes they are. */
  name: string;
  onPick: (kinds: HeroKind[]) => void;
  /** Put the picker away to look at the board first. */
  onHide: () => void;
}

/**
 * The hero cards, before the game starts, in a section per category: tap one in each (another in the same category
 * takes its place), then confirm.
 */
export function HeroPicker({ seat, name, onPick, onHide }: Props) {
  const [picked, setPicked] = useState<HeroKind[]>([]);
  const toggle = (kind: HeroKind) =>
    setPicked((list) => (list.includes(kind) ? list.filter((k) => k !== kind) : [...list.filter((k) => HERO_ROLE[k] !== HERO_ROLE[kind]), kind]));
  const ready = picked.length === HERO_TEAM;
  return (
    <div className="hero-picker-backdrop">
      <div className="hero-picker card" role="dialog" aria-modal="true" aria-label="Pick your heroes" dir="rtl" lang="fa" style={{ '--seat': COLOR_HEX[seat] } as CSSProperties}>
        <Compass />
        <div className="hero-picker-head">
          <h2>
            🦸 {name}، از هر دسته یک هیرو انتخاب کن
          </h2>
          <p>
            هیروها چهار دسته‌اند: حمله، دفاع، کنترل و امتیاز. از هر دسته یکی برمی‌داری، پس {fa(HERO_TEAM)} هیرو داری و هیچ‌کس همهٔ
            قوی‌ها را با هم ندارد. هر بار که تاست اجازهٔ بیرون آوردن مهره بدهد، می‌توانی به‌جایش با زدن مهرهٔ پنجمِ وسط آشیانه یکی از این هیروها را بیاوری، ولی هر بار
            فقط یکی روی صفحه. هیرویی که از صفحه بیرون برود {fa(HERO_REST_ROUNDS)} دور استراحت می‌کند و تا آن موقع فقط بقیهٔ هیروهایت را می‌شود
            آورد. هیرو از خانهٔ صف شروع می‌کند و {fa(HERO_LIFE)} خانه (یک دور کامل) روی مسیر می‌چرخد. فقط
            کماندار مهره‌ها را می‌زند (و مرگ فقط پادشاه را)؛ بقیه فقط قدرت خودشان را دارند. اگر کسی هیرو را بزند {fa(HERO_KILL)} امتیاز می‌گیرد
            (نگهبان {fa(GUARDIAN_KILL)}).
          </p>
        </div>
        {HERO_ROLES.map((role) => {
          const r = ROLE_LOOK[role];
          const chosen = picked.find((k) => HERO_ROLE[k] === role);
          return (
            <section key={role} className="hero-role" style={{ '--role': r.color } as CSSProperties}>
              <h3 className="hero-role-head">
                <span>
                  {r.icon} {r.fa}
                </span>
                <small>{r.what}</small>
                <span className={`pill${chosen ? ' accent' : ''}`}>{chosen ? `✓ ${HERO_LOOK[chosen].fa}` : 'یکی انتخاب کن'}</span>
              </h3>
              <ul className="hero-cards">
              {HERO_KINDS.filter((k) => HERO_ROLE[k] === role).map((kind) => {
                const look = HERO_LOOK[kind];
                const art = HERO_ART[kind];
                const n = picked.indexOf(kind);
                return (
                  <li key={kind}>
                    <button
                      className={`hero-card ${kind}${n >= 0 ? ' on' : ''}`}
                      style={{ '--hero-deep': look.deep, '--hero-light': look.light } as CSSProperties}
                      onClick={() => toggle(kind)}
                      aria-pressed={n >= 0}
                      aria-label={`${look.fa} (${look.en})`}
                    >
                      <span className="hero-card-art">
                        {art ? (
                          <img src={art} alt="" draggable={false} />
                        ) : (
                          <span className="hero-card-emoji" aria-hidden>
                            {look.face}
                          </span>
                        )}
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
                      <span className="hero-card-power">{look.power}</span>
                      {n >= 0 && (
                        <span className="hero-card-check" aria-hidden>
                          ✓
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
              </ul>
            </section>
          );
        })}
        <div className="hero-picker-actions">
          <button className="btn ghost hero-look" onClick={onHide}>
            📖 نگاه به صفحه
          </button>
          <button className="btn hero-go" disabled={!ready} onClick={() => ready && onPick(picked)}>
            {ready ? `${picked.map((k) => HERO_LOOK[k].fa).join('، ')}؛ بزن بریم! ✨` : `${fa(HERO_TEAM - picked.length)} هیروی دیگر انتخاب کن ✨`}
          </button>
        </div>
      </div>
    </div>
  );
}
