// Short game sounds, made on the spot with the Web Audio API, so there are no files to download. The
// 🔊 button turns them off; the choice is kept on the device.

let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('mz.muted') === '1';
  } catch {
    return false;
  }
})();

/** The audio context, made on first use. Browsers only let it play after a tap, which unlocks it below. */
function audio(): AudioContext | null {
  if (muted || typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

if (typeof document !== 'undefined') {
  const unlock = () => {
    if (!muted) audio();
  };
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', unlock);
}

export const isMuted = () => muted;
export function setMuted(on: boolean) {
  muted = on;
  try {
    localStorage.setItem('mz.muted', on ? '1' : '0');
  } catch {
    /* private mode */
  }
}

interface Tone {
  /** Start and end pitch, in Hz. */
  f: number;
  to?: number;
  type?: OscillatorType;
  /** Seconds from now. */
  at?: number;
  dur: number;
  vol?: number;
}

function tone({ f, to, type = 'sine', at = 0, dur, vol = 0.18 }: Tone) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.015, dur / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** A burst of filtered noise: clicks, whooshes and blasts. */
function noise({ at = 0, dur, vol = 0.2, freq, to, type = 'bandpass' }: { at?: number; dur: number; vol?: number; freq: number; to?: number; type?: BiquadFilterType }) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t);
  if (to) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const gain = a.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(gain).connect(a.destination);
  src.start(t);
}

const notes = (freqs: number[], step: number, opts: Partial<Tone> = {}) =>
  freqs.forEach((f, i) => tone({ f, dur: step * 1.6, at: i * step, type: 'triangle', ...opts }));

export const sfx = {
  /** The dice rattling. */
  roll: () => {
    for (let i = 0; i < 7; i++) noise({ at: i * 0.085 + Math.random() * 0.02, dur: 0.035, vol: 0.22, freq: 2200 + Math.random() * 1500 });
  },
  /** The dice coming to rest. */
  land: () => {
    tone({ f: 190, to: 95, dur: 0.12, vol: 0.22 });
    noise({ dur: 0.05, vol: 0.15, freq: 1800 });
  },
  step: () => tone({ f: 660, dur: 0.05, type: 'triangle', vol: 0.07 }),
  launch: () => tone({ f: 300, to: 760, dur: 0.18, type: 'triangle', vol: 0.16 }),
  jump: () => tone({ f: 420, to: 980, dur: 0.16, type: 'square', vol: 0.06 }),
  fly: () => {
    noise({ dur: 0.75, vol: 0.12, freq: 400, to: 2600 });
    tone({ f: 500, to: 1200, dur: 0.6, vol: 0.05 });
  },
  hit: () => {
    tone({ f: 240, to: 55, dur: 0.22, type: 'sawtooth', vol: 0.14 });
    noise({ dur: 0.12, vol: 0.2, freq: 900 });
  },
  /** A double kill or better. */
  streak: () => {
    sfx.hit();
    notes([523, 659, 784, 1047], 0.07, { at: 0.12, type: 'square', vol: 0.07 });
  },
  boom: () => {
    noise({ dur: 0.9, vol: 0.45, freq: 900, to: 60, type: 'lowpass' });
    tone({ f: 90, to: 30, dur: 0.7, vol: 0.3 });
  },
  home: () => notes([523, 659, 784, 1047], 0.08, { vol: 0.14 }),
  box: () => notes([880, 1175, 1568], 0.05, { type: 'sine', vol: 0.1 }),
  good: () => notes([659, 988], 0.09, { vol: 0.13 }),
  bad: () => notes([392, 294], 0.13, { type: 'sawtooth', vol: 0.07 }),
  freeze: () => {
    notes([1568, 2093, 1760, 2349], 0.06, { type: 'sine', vol: 0.08 });
    noise({ dur: 0.4, vol: 0.06, freq: 6000, type: 'highpass' });
  },
  power: () => notes([523, 784, 1047, 1568], 0.06, { type: 'sine', vol: 0.1 }),
  place: () => tone({ f: 160, to: 80, dur: 0.15, vol: 0.2 }),
  /** It's your turn. */
  turn: () => notes([880, 1320], 0.09, { type: 'sine', vol: 0.08 }),
  /** A player brings everything home, or the game ends. */
  win: () => {
    notes([392, 523, 659, 784], 0.11, { vol: 0.13 });
    tone({ f: 1047, dur: 0.6, at: 0.44, type: 'triangle', vol: 0.15 });
  },
};
