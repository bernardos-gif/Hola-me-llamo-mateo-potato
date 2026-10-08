// Tiny WebAudio synth — all sound effects are generated, no asset files.
let ctx = null;
let muted = false;

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function setMuted(value) {
  muted = value;
}

export function isMuted() {
  return muted;
}

function blip(freq, dur, type = 'square', vol = 0.15, slideTo = null) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

function noise(dur, vol = 0.2, cutoff = 1400) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t);
}

export const sfx = {
  punch: () => noise(0.07, 0.16, 2200),
  kick: () => {
    noise(0.11, 0.2, 1000);
    blip(170, 0.1, 'sine', 0.12, 90);
  },
  hit: () => {
    noise(0.1, 0.24, 800);
    blip(130, 0.12, 'square', 0.14, 60);
  },
  block: () => blip(620, 0.08, 'square', 0.12, 950),
  jump: () => blip(300, 0.12, 'sine', 0.09, 620),
  whoosh: () => noise(0.16, 0.08, 2600),
  special: () => blip(210, 0.26, 'sawtooth', 0.11, 760),
  ko: () => {
    blip(150, 0.6, 'sawtooth', 0.18, 50);
    noise(0.5, 0.16, 500);
  },
  round: () => blip(520, 0.18, 'triangle', 0.14, 780),
  select: () => blip(700, 0.06, 'square', 0.09, 900),
};
