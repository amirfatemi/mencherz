import { HERO_DEFUSE, HERO_STEAL, DRAGON_PRIZE, type HeroKind } from '../../shared/rules.ts';

const fa = (n: number) => n.toLocaleString('fa-IR');

export interface HeroLook {
  /** Persian name, shown first; the English one goes in titles and the game log. */
  fa: string;
  en: string;
  /** The character, and what it carries. */
  face: string;
  badge: string;
  /** Its card's colours: deep, then light. */
  deep: string;
  light: string;
  /** What it does, in Persian. */
  power: string;
}

/** How each hero looks and what its card says. */
export const HERO_LOOK: Record<HeroKind, HeroLook> = {
  archer: {
    fa: 'کماندار',
    en: 'Archer',
    face: '🧝',
    badge: '🏹',
    deep: '#1b5e20',
    light: '#a5d6a7',
    power: 'با هر تاس خودت انتخاب می‌کنی جلو برود یا عقب، و هر مهره‌ای را که رویش بایستد می‌زند.',
  },
  engineer: {
    fa: 'مهندس بمب',
    en: 'Bomb engineer',
    face: '👷',
    badge: '🧨',
    deep: '#bf360c',
    light: '#ffcc80',
    power: `هر بمبی که از رویش رد شود یا رویش بایستد خنثی می‌کند (هر کدام ${fa(HERO_DEFUSE)}+) و هیچ بمبی منفجرش نمی‌کند. آخر عمرش یک ابر بمب می‌گذارد و بعد با شمارش ۱، ۲، ۳ خودش منفجر می‌شود.`,
  },
  guardian: {
    fa: 'نگهبان',
    en: 'Guardian',
    face: '💂',
    badge: '🛡️',
    deep: '#0d47a1',
    light: '#90caf9',
    power: 'مهره‌های تو روی خانهٔ نگهبان و یک خانه جلو و عقبش زده نمی‌شوند؛ نه بمب به آن‌ها کاری دارد، نه اژدها.',
  },
  frost: {
    fa: 'یخ‌زن',
    en: 'Frost mage',
    face: '🧙',
    badge: '❄️',
    deep: '#006064',
    light: '#b2ebf2',
    power: 'هر جا بایستد، مهره‌ها و هیروهای حریف تا دو خانه جلو و عقبش یک نوبت یخ می‌زنند.',
  },
  thief: {
    fa: 'دزد',
    en: 'Thief',
    face: '🥷',
    badge: '💰',
    deep: '#4a148c',
    light: '#ce93d8',
    power: `کسی را نمی‌زند؛ هر جا بایستد از هر حریفی که آنجاست ${fa(HERO_STEAL)} امتیاز و جلیقه‌اش را می‌دزدد، و جایزهٔ نفر اول را هم. جعبهٔ جادو برایش همیشه خوب است.`,
  },
  rider: {
    fa: 'اژدهاسوار',
    en: 'Dragon rider',
    face: '🐲',
    badge: '🔥',
    deep: '#b71c1c',
    light: '#ffab91',
    power: `تا وقتی هست، اژدها مهره‌های تو را نمی‌خورد و انفجارش به آن‌ها نمی‌رسد. اگر روی اژدها فرود بیاید مثل پادشاه شکارش می‌کند: ${fa(DRAGON_PRIZE.king)} امتیاز، و اژدها دیگر نمی‌آید.`,
  },
};
