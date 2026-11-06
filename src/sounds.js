// Synthesized drum sounds. Each function schedules a sound at time `t`
// on the given AudioContext and connects it to `out`.

function noiseBuffer(ctx) {
  const length = ctx.sampleRate; // 1 second of white noise
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

let cachedNoise = null;
function noise(ctx) {
  if (!cachedNoise || cachedNoise.sampleRate !== ctx.sampleRate) cachedNoise = noiseBuffer(ctx);
  const src = ctx.createBufferSource();
  src.buffer = cachedNoise;
  return src;
}

function envelope(ctx, param, t, peak, duration) {
  param.setValueAtTime(peak, t);
  param.exponentialRampToValueAtTime(0.0001, t + duration);
}

function kick(ctx, out, t) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
  envelope(ctx, gain.gain, t, 1, 0.45);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + 0.5);
}

function snare(ctx, out, t) {
  const n = noise(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1200;
  const ng = ctx.createGain();
  envelope(ctx, ng.gain, t, 0.7, 0.2);
  n.connect(hp).connect(ng).connect(out);
  n.start(t);
  n.stop(t + 0.25);

  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(190, t);
  osc.frequency.exponentialRampToValueAtTime(120, t + 0.1);
  const og = ctx.createGain();
  envelope(ctx, og.gain, t, 0.5, 0.12);
  osc.connect(og).connect(out);
  osc.start(t);
  osc.stop(t + 0.15);
}

function hat(ctx, out, t, decay = 0.05, level = 0.35) {
  const n = noise(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  envelope(ctx, g.gain, t, level, decay);
  n.connect(hp).connect(g).connect(out);
  n.start(t);
  n.stop(t + decay + 0.05);
}

function openHat(ctx, out, t) {
  hat(ctx, out, t, 0.3, 0.3);
}

function clap(ctx, out, t) {
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1500;
  bp.Q.value = 0.8;
  bp.connect(out);
  [0, 0.012, 0.024].forEach((offset, i) => {
    const n = noise(ctx);
    const g = ctx.createGain();
    envelope(ctx, g.gain, t + offset, 0.6, i === 2 ? 0.18 : 0.015);
    n.connect(g).connect(bp);
    n.start(t + offset);
    n.stop(t + offset + 0.2);
  });
}

function tom(ctx, out, t) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(95, t + 0.25);
  envelope(ctx, gain.gain, t, 0.8, 0.35);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + 0.4);
}

function cowbell(ctx, out, t) {
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 700;
  bp.Q.value = 1.2;
  const g = ctx.createGain();
  envelope(ctx, g.gain, t, 0.45, 0.35);
  bp.connect(g).connect(out);
  [540, 800].forEach((f) => {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = f;
    osc.connect(bp);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

function bass(ctx, out, t) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 55;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(600, t);
  lp.frequency.exponentialRampToValueAtTime(120, t + 0.4);
  const g = ctx.createGain();
  envelope(ctx, g.gain, t, 0.6, 0.5);
  osc.connect(lp).connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.55);
}

export const SOUNDS = [
  { id: "kick", name: "Kick", key: "q", play: kick },
  { id: "snare", name: "Snare", key: "w", play: snare },
  { id: "hat", name: "Hat", key: "e", play: (c, o, t) => hat(c, o, t) },
  { id: "open", name: "Open Hat", key: "r", play: openHat },
  { id: "clap", name: "Clap", key: "a", play: clap },
  { id: "tom", name: "Tom", key: "s", play: tom },
  { id: "bell", name: "Cowbell", key: "d", play: cowbell },
  { id: "bass", name: "Bass", key: "f", play: bass },
];
