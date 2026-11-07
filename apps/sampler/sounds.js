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

function filtered(ctx, type, freq, q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
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
  const ng = ctx.createGain();
  envelope(ctx, ng.gain, t, 0.7, 0.2);
  n.connect(filtered(ctx, "highpass", 1200)).connect(ng).connect(out);
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
  const g = ctx.createGain();
  envelope(ctx, g.gain, t, level, decay);
  n.connect(filtered(ctx, "highpass", 7000)).connect(g).connect(out);
  n.start(t);
  n.stop(t + decay + 0.05);
}

const closedHat = (ctx, out, t) => hat(ctx, out, t);
const openHat = (ctx, out, t) => hat(ctx, out, t, 0.3, 0.3);

function clap(ctx, out, t) {
  const bp = filtered(ctx, "bandpass", 1500, 0.8);
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

function rim(ctx, out, t) {
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.value = 1700;
  const g = ctx.createGain();
  envelope(ctx, g.gain, t, 0.3, 0.03);
  osc.connect(filtered(ctx, "bandpass", 1700, 2)).connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.05);

  const n = noise(ctx);
  const ng = ctx.createGain();
  envelope(ctx, ng.gain, t, 0.25, 0.02);
  n.connect(filtered(ctx, "highpass", 3500)).connect(ng).connect(out);
  n.start(t);
  n.stop(t + 0.04);
}

function makeTom(startHz, endHz, decay) {
  return (ctx, out, t) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(startHz, t);
    osc.frequency.exponentialRampToValueAtTime(endHz, t + decay * 0.7);
    envelope(ctx, gain.gain, t, 0.8, decay);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  };
}

function cowbell(ctx, out, t) {
  const g = ctx.createGain();
  envelope(ctx, g.gain, t, 0.45, 0.35);
  const bp = filtered(ctx, "bandpass", 700, 1.2);
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

function conga(ctx, out, t) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(340, t);
  osc.frequency.exponentialRampToValueAtTime(250, t + 0.08);
  envelope(ctx, gain.gain, t, 0.8, 0.28);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + 0.3);
}

function shaker(ctx, out, t) {
  const n = noise(ctx);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.35, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  n.connect(filtered(ctx, "bandpass", 6500, 1)).connect(g).connect(out);
  n.start(t);
  n.stop(t + 0.12);
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

function crash(ctx, out, t) {
  const n = noise(ctx);
  const g = ctx.createGain();
  envelope(ctx, g.gain, t, 0.5, 1.2);
  n.connect(filtered(ctx, "highpass", 4500)).connect(g).connect(out);
  n.start(t);
  n.stop(t + 1.25);
}

function ride(ctx, out, t) {
  const hp = filtered(ctx, "highpass", 6000);
  const g = ctx.createGain();
  envelope(ctx, g.gain, t, 0.18, 0.9);
  hp.connect(g).connect(out);
  [205, 304, 369, 522, 540, 800].forEach((f) => {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = f * 3.1;
    osc.connect(hp);
    osc.start(t);
    osc.stop(t + 0.95);
  });
}

function zap(ctx, out, t) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(1800, t);
  osc.frequency.exponentialRampToValueAtTime(80, t + 0.25);
  const g = ctx.createGain();
  envelope(ctx, g.gain, t, 0.4, 0.3);
  osc.connect(filtered(ctx, "lowpass", 3000)).connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.32);
}

function blip(ctx, out, t) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(1200, t);
  osc.frequency.exponentialRampToValueAtTime(600, t + 0.06);
  const g = ctx.createGain();
  envelope(ctx, g.gain, t, 0.5, 0.12);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.14);
}

// Pad order matches the pad numbers on the panel (1-16).
export const SOUNDS = [
  { id: "kick", name: "Kick", play: kick },
  { id: "snare", name: "Snare", play: snare },
  { id: "chat", name: "C.Hat", play: closedHat },
  { id: "ohat", name: "O.Hat", play: openHat },
  { id: "clap", name: "Clap", play: clap },
  { id: "rim", name: "Rim", play: rim },
  { id: "tomlo", name: "Tom Lo", play: makeTom(220, 95, 0.35) },
  { id: "tomhi", name: "Tom Hi", play: makeTom(340, 150, 0.28) },
  { id: "bell", name: "Cowbell", play: cowbell },
  { id: "conga", name: "Conga", play: conga },
  { id: "shaker", name: "Shaker", play: shaker },
  { id: "bass", name: "Bass", play: bass },
  { id: "crash", name: "Crash", play: crash },
  { id: "ride", name: "Ride", play: ride },
  { id: "zap", name: "Zap", play: zap },
  { id: "blip", name: "Blip", play: blip },
];
