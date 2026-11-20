import { CHARM_ROUNDS, DRAGON_PRIZE, FROST_REACH, FROST_TURNS, GUARD_REACH, GUARDIAN_KILL, JESTER_REACH, JESTER_TURNS, THIEF_TIMES, type HeroKind, type HeroRole } from '../../shared/rules.ts';
import { POINTS } from '../../shared/scoring.ts';
import archerArt from './assets/heroes/archer.webp';
import deathArt from './assets/heroes/death.webp';
import engineerArt from './assets/heroes/engineer.webp';
import frostArt from './assets/heroes/frost.webp';
import guardianArt from './assets/heroes/guardian.webp';
import healerArt from './assets/heroes/healer.webp';
import jesterArt from './assets/heroes/jester.webp';
import riderArt from './assets/heroes/rider.webp';
import thiefArt from './assets/heroes/thief.webp';
import tricksterArt from './assets/heroes/trickster.webp';
import wizardArt from './assets/heroes/wizard.webp';
import archerFace from './assets/heroes/token-archer.webp';
import deathFace from './assets/heroes/token-death.webp';
import engineerFace from './assets/heroes/token-engineer.webp';
import frostFace from './assets/heroes/token-frost.webp';
import guardianFace from './assets/heroes/token-guardian.webp';
import healerFace from './assets/heroes/token-healer.webp';
import jesterFace from './assets/heroes/token-jester.webp';
import riderFace from './assets/heroes/token-rider.webp';
import thiefFace from './assets/heroes/token-thief.webp';
import tricksterFace from './assets/heroes/token-trickster.webp';
import wizardFace from './assets/heroes/token-wizard.webp';

const fa = (n: number) => n.toLocaleString('fa-IR');

/** How each category of heroes (HERO_ROLE) is shown on its cards. */
export const ROLE_LOOK: Record<HeroRole, { fa: string; icon: string; color: string; what: string }> = {
  attack: { fa: 'حمله', icon: '⚔️', color: '#c62828', what: 'می‌زند و منفجر می‌کند' },
  defence: { fa: 'دفاع', icon: '🛡️', color: '#1565c0', what: 'مهره‌هایت را نجات می‌دهد' },
  control: { fa: 'کنترل', icon: '🌀', color: '#6a1b9a', what: 'حریف را گیر می‌اندازد' },
  points: { fa: 'امتیاز', icon: '💰', color: '#ef6c00', what: 'امتیاز می‌گیرد' },
};

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
  /** Its piece's ring, and the badge with the squares it has left. */
  ring: string;
  dark: string;
  /** What it does, in Persian. */
  power: string;
}

/** Each hero's picture, for its card (a hero without one shows its emoji on its colours). */
export const HERO_ART: Partial<Record<HeroKind, string>> = {
  archer: archerArt,
  engineer: engineerArt,
  guardian: guardianArt,
  frost: frostArt,
  thief: thiefArt,
  rider: riderArt,
  wizard: wizardArt,
  death: deathArt,
  healer: healerArt,
  jester: jesterArt,
  trickster: tricksterArt,
};

/** Each hero's round portrait, for its piece on the board (likewise). */
export const HERO_FACE: Partial<Record<HeroKind, string>> = {
  archer: archerFace,
  engineer: engineerFace,
  guardian: guardianFace,
  frost: frostFace,
  thief: thiefFace,
  rider: riderFace,
  wizard: wizardFace,
  death: deathFace,
  healer: healerFace,
  jester: jesterFace,
  trickster: tricksterFace,
};

/** How each hero looks and what its card says. */
export const HERO_LOOK: Record<HeroKind, HeroLook> = {
  archer: {
    fa: 'کماندار',
    en: 'Archer',
    face: '🧝',
    badge: '🏹',
    deep: '#1b5e20',
    light: '#a5d6a7',
    ring: '#43a047',
    dark: '#1b5e20',
    power: 'با هر تاس خودت انتخاب می‌کنی جلو برود یا عقب، و هر مهره و هیرویی را که رویش بایستد می‌زند. تنها هیرویی است که مهره‌ها را می‌زند.',
  },
  engineer: {
    fa: 'مهندس بمب',
    en: 'Bomb engineer',
    face: '👷',
    badge: '🧨',
    deep: '#bf360c',
    light: '#ffcc80',
    ring: '#fb8c00',
    dark: '#b23c00',
    power: 'روی هر بمب حریفی بایستد، آن بمب مال خودت می‌شود (از رویش رد شدن کافی نیست، و بمب اژدها نه)، و هیچ بمبی منفجرش نمی‌کند. آخر عمرش یک ابر بمب هر جا بخواهی می‌گذارد و بعد با شمارش ۱، ۲، ۳ خودش منفجر می‌شود: خانهٔ خودش و یک خانه جلو و عقبش. انفجارش فقط حریف‌ها را می‌برد و به مهره‌های خودت کاری ندارد.',
  },
  guardian: {
    fa: 'نگهبان',
    en: 'Guardian',
    face: '💂',
    badge: '🛡️',
    deep: '#0d47a1',
    light: '#90caf9',
    ring: '#1e78e6',
    dark: '#0d2f7a',
    power: `مراقب مهره‌های تو روی خانهٔ خودش و ${fa(GUARD_REACH)} خانه جلو و عقبش است: اولین باری که حریف یا اژدها بخواهد یکی‌شان را بزند، نگهبان جای آن‌ها فدا می‌شود و از بازی می‌رود. جلوی بمب را نمی‌گیرد. هر کس بزندش ${fa(GUARDIAN_KILL)} امتیاز می‌گیرد.`,
  },
  frost: {
    fa: 'یخ‌زن',
    en: 'Frost mage',
    face: '🥶',
    badge: '❄️',
    deep: '#006064',
    light: '#b2ebf2',
    ring: '#1e88e5',
    dark: '#0d3a80',
    power: `هر جا بایستد، مهره‌ها و هیروهای حریف تا ${fa(FROST_REACH)} خانه جلو و عقبش ${fa(FROST_TURNS)} نوبت یخ می‌زنند.`,
  },
  thief: {
    fa: 'دزد',
    en: 'Thief',
    face: '🥷',
    badge: '💰',
    deep: '#4a148c',
    light: '#ce93d8',
    ring: '#8e24aa',
    dark: '#3d0a5c',
    power: `کسی را نمی‌زند؛ هر جا بایستد از هر مهرهٔ حریف آنجا ${fa(THIEF_TIMES)} برابرِ امتیازی را می‌دزدد که زدنش داشت (پادشاه، انتقام و جلو بودن مهره هم حساب است)، با جلیقه‌اش و جایزهٔ نفر اول. جعبهٔ جادو برایش همیشه خوب است.`,
  },
  rider: {
    fa: 'اژدهاسوار',
    en: 'Dragon rider',
    face: '🐲',
    badge: '🔥',
    deep: '#b71c1c',
    light: '#ffab91',
    ring: '#e53935',
    dark: '#8e0e0e',
    power: `اولین باری که اژدها بخواهد یکی از مهره‌های تو را بخورد یا با انفجارش ببرد، اژدهاسوار جای آن فدا می‌شود (روی خانهٔ صف کاری نمی‌کند). اگر روی اژدها فرود بیاید شکارش می‌کند و ${fa(DRAGON_PRIZE.king)} امتیاز می‌گیرد، مثل پادشاه.`,
  },
  wizard: {
    fa: 'جادوگر',
    en: 'Wizard',
    face: '🧙‍♀️',
    badge: '🪄',
    deep: '#004d40',
    light: '#a7ffeb',
    ring: '#00a88f',
    dark: '#00564a',
    power: `هر جا بایستد، مهره‌های حریف آنجا (به‌جز پادشاه) طلسم می‌شوند: ${fa(CHARM_ROUNDS)} دور مثل مهرهٔ خودت‌اند و تو حرکتشان می‌دهی. همه را می‌زنند و همه می‌توانند بزنندشان؛ وارد خط خانه نمی‌شوند و دور مسیر می‌چرخند.`,
  },
  death: {
    fa: 'مرگ',
    en: 'Death',
    face: '💀',
    badge: '⚰️',
    deep: '#212121',
    light: '#cfd8dc',
    ring: '#5d6d7e',
    dark: '#1c2833',
    power: `فقط پادشاه را می‌زند و روی بقیهٔ مهره‌ها کاری ندارد. پادشاهی که بزند، یکی از مهره‌هایی که آن حریف به خانه رسانده به آشیانه برمی‌گردد و ${fa(POINTS.home)} امتیازش مال تو می‌شود.`,
  },
  healer: {
    fa: 'طبیب',
    en: 'Healer',
    face: '🧑‍⚕️',
    badge: '🩺',
    deep: '#33691e',
    light: '#dcedc8',
    ring: '#7cb342',
    dark: '#33691e',
    power: 'تا وقتی روی صفحه است، اولین مهره‌ات که زده شود (با بمب و اژدها هم) به‌جای آشیانه روی خانهٔ طبیب زنده می‌شود. هر بار که بیاید یک بار.',
  },
  jester: {
    fa: 'دلقک',
    en: 'Jester',
    face: '🤡',
    badge: '🎪',
    deep: '#880e4f',
    light: '#f8bbd0',
    ring: '#ec407a',
    dark: '#880e4f',
    power: `هر جا بایستد، مهره‌های حریف روی مسیر تا ${fa(JESTER_REACH)} خانه جلو و عقبش ${fa(JESTER_TURNS)} نوبتِ بعدیِ صاحبشان برعکس حرکت می‌کنند: عقب‌عقب، بی‌پرش و بی‌پرواز.`,
  },
  trickster: {
    fa: 'شعبده‌باز',
    en: 'Trickster',
    face: '🎩',
    badge: '🃏',
    deep: '#311b92',
    light: '#d1c4e9',
    ring: '#673ab7',
    dark: '#311b92',
    power: 'تا وقتی روی صفحه است، اولین باری که مهرهٔ حریفی یکی از مهره‌های تو را بزند، اول نوبت بعدت می‌توانی جای یکی از مهره‌هایت را با همان مهره عوض کنی: مهرهٔ او می‌رود جای مهرهٔ تو و مهرهٔ تو می‌آید جای او. هر بار که بیاید یک بار.',
  },
};
