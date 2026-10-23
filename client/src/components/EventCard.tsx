import { EVENT_BOOST, type GameState, type WorldEventKind } from '../../../shared/rules.ts';

const fa = (n: number) => n.toLocaleString('fa-IR');

/** What each surprise event is called, and what it changes, in a line. */
const EVENT_INFO: Record<WorldEventKind, { icon: string; name: string; text: string }> = {
  storm: { icon: '🌪', name: 'طوفان', text: 'پرواز ✈ و پرش روی خانهٔ رنگ خودتان بسته است.' },
  goldRain: { icon: '💰', name: 'باران طلا', text: `هر مهره‌ای که به خانهٔ وسط برسد ${fa(EVENT_BOOST)} برابر امتیاز می‌گیرد.` },
  earthquake: { icon: '🌋', name: 'زلزله', text: 'همهٔ بمب‌ها به خانه‌های تازه پریدند؛ حواستان باشد کجا می‌روید.' },
  darkNight: { icon: '🌙', name: 'شب تاریک', text: `زدن مهره‌ها ${fa(EVENT_BOOST)} برابر امتیاز دارد.` },
  fog: { icon: '🌫', name: 'مه', text: 'بمب، ابر بمب، جعبهٔ جادو و پل‌های بهشت و جهنم دیده نمی‌شوند، ولی سر جایشان هستند.' },
};

/** The surprise event in play, and how long it has left, shown under the dice while it lasts. */
export function EventCard({ game }: { game: GameState }) {
  const event = game.event;
  if (!event) return null;
  const info = EVENT_INFO[event.kind];
  const playing = Math.max(1, game.active.filter((s) => !game.ranking.includes(s)).length);
  const rounds = Math.max(1, Math.ceil((event.until - game.turnNo) / playing));
  return (
    <section className={`card event-card ${event.kind}`} dir="rtl" role="status">
      <span className="event-card-icon" aria-hidden>
        {info.icon}
      </span>
      <div className="event-card-text">
        <div className="event-card-head">
          <b>{info.name}</b>
          <span className="pill">{rounds === 1 ? 'دور آخر' : `${fa(rounds)} دور مانده`}</span>
        </div>
        <div className="event-card-body">{info.text}</div>
      </div>
    </section>
  );
}
