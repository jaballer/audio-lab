// Synthesized drum sounds, and the kit that lists them in pad order. Each sound
// schedules itself at time `t` on the given AudioContext and connects to `out`.
// The pieces they are built from (noise, envelopes, filters) are in dsp.js.
// Shared because more than one page plays the kit: the sampler and the MPC Sample companion.

import { envelope, filtered, noise, sweep } from "./dsp.js";

function kick(ctx, out, t) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  sweep(osc.frequency, 150, 40, t, 0.15);
  envelope(gain.gain, t, 1, 0.45);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + 0.5);
}

function snare(ctx, out, t) {
  const n = noise(ctx);
  const ng = ctx.createGain();
  envelope(ng.gain, t, 0.7, 0.2);
  n.connect(filtered(ctx, "highpass", 1200))
    .connect(ng)
    .connect(out);
  n.start(t);
  n.stop(t + 0.25);

  const osc = ctx.createOscillator();
  osc.type = "triangle";
  sweep(osc.frequency, 190, 120, t, 0.1);
  const og = ctx.createGain();
  envelope(og.gain, t, 0.5, 0.12);
  osc.connect(og).connect(out);
  osc.start(t);
  osc.stop(t + 0.15);
}

function hat(ctx, out, t, decay = 0.05, level = 0.35) {
  const n = noise(ctx);
  const g = ctx.createGain();
  envelope(g.gain, t, level, decay);
  n.connect(filtered(ctx, "highpass", 7000))
    .connect(g)
    .connect(out);
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
    envelope(g.gain, t + offset, 0.6, i === 2 ? 0.18 : 0.015);
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
  envelope(g.gain, t, 0.3, 0.03);
  osc
    .connect(filtered(ctx, "bandpass", 1700, 2))
    .connect(g)
    .connect(out);
  osc.start(t);
  osc.stop(t + 0.05);

  const n = noise(ctx);
  const ng = ctx.createGain();
  envelope(ng.gain, t, 0.25, 0.02);
  n.connect(filtered(ctx, "highpass", 3500))
    .connect(ng)
    .connect(out);
  n.start(t);
  n.stop(t + 0.04);
}

function makeTom(startHz, endHz, decay) {
  return (ctx, out, t) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    sweep(osc.frequency, startHz, endHz, t, decay * 0.7);
    envelope(gain.gain, t, 0.8, decay);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  };
}

function cowbell(ctx, out, t) {
  const g = ctx.createGain();
  envelope(g.gain, t, 0.45, 0.35);
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
  sweep(osc.frequency, 340, 250, t, 0.08);
  envelope(gain.gain, t, 0.8, 0.28);
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
  n.connect(filtered(ctx, "bandpass", 6500, 1))
    .connect(g)
    .connect(out);
  n.start(t);
  n.stop(t + 0.12);
}

function bass(ctx, out, t) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 55;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  sweep(lp.frequency, 600, 120, t, 0.4);
  const g = ctx.createGain();
  envelope(g.gain, t, 0.6, 0.5);
  osc.connect(lp).connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.55);
}

function crash(ctx, out, t) {
  const n = noise(ctx);
  const g = ctx.createGain();
  envelope(g.gain, t, 0.5, 1.2);
  n.connect(filtered(ctx, "highpass", 4500))
    .connect(g)
    .connect(out);
  n.start(t);
  n.stop(t + 1.25);
}

function ride(ctx, out, t) {
  const hp = filtered(ctx, "highpass", 6000);
  const g = ctx.createGain();
  envelope(g.gain, t, 0.18, 0.9);
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
  sweep(osc.frequency, 1800, 80, t, 0.25);
  const g = ctx.createGain();
  envelope(g.gain, t, 0.4, 0.3);
  osc
    .connect(filtered(ctx, "lowpass", 3000))
    .connect(g)
    .connect(out);
  osc.start(t);
  osc.stop(t + 0.32);
}

function blip(ctx, out, t) {
  const osc = ctx.createOscillator();
  sweep(osc.frequency, 1200, 600, t, 0.06);
  const g = ctx.createGain();
  envelope(g.gain, t, 0.5, 0.12);
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

// A hit never goes fully silent: a velocity of 0 would otherwise do nothing at all.
const MIN_GAIN = 0.05;

// Where a sound at `velocity` (0-1) should be connected so that it sounds that loud: `out` itself at full
// velocity, otherwise a gain stage of its own in front of `out`. Live hits and sequenced steps share this.
export function withVelocity(ctx, out, velocity = 1) {
  if (velocity >= 1) return out;
  const stage = ctx.createGain();
  stage.gain.value = Math.max(velocity, MIN_GAIN);
  stage.connect(out);
  return stage;
}

// Where a sound should be connected so that it is `gain` times as loud (a plain multiplier, which may be above
// 1): `out` itself at 1, otherwise a gain stage of its own in front of `out`.
export function withGain(ctx, out, gain) {
  if (gain === 1) return out;
  const stage = ctx.createGain();
  stage.gain.value = gain;
  stage.connect(out);
  return stage;
}
