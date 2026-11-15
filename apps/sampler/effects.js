// The effects every pad shares: a reverb and a delay, and a filter over the whole mix. A pad sends some of what it plays to each
// effect (its Reverb and Delay, in pad-settings.js), and these settings are the effects themselves: how big the room is, how
// loud it comes back, how far apart the echoes are and how many there are, and how the mix is filtered. They belong to the
// beat, not to a pad or a sequence. No DOM, and plain
// numbers, so the same values are what the panel shows, the mixer plays, the beat saves and the export renders.
//
//   reverbSize:    0 to 100 on a slider, how long the room rings: from 0.3 to 3 seconds (reverbSeconds)
//   reverbLevel:   0 to 100, how loud the room comes back (0 is silent: the pads' sends are not heard)
//   delayDivision: which note the echoes are apart, as a position in DELAY_DIVISIONS (it follows the tempo)
//   delayFeedback: 0 to 90 per cent of each echo that comes round again
//   delayLevel:    0 to 100, how loud the echoes come back
//   pingPong:      0 or 1: the echoes alternate between the left and the right
//   masterFilter:  -100 to +100, a low-pass below 0 and a high-pass above it, 0 off: the same control as a pad's Filter, over the mix
//
//   clampEffect("delayFeedback", 120)        // 90
//   parseEffects(stored)                     // the settings as a full object, or null when they are all the defaults
//   delaySeconds(1, 120)                     // 0.25: an eighth at 120 BPM
//   effectsTail(effects, 120, { reverb: true, delay: false })   // how long what is sent to the reverb rings on, in seconds
//   reverbImpulse(40, 44100)                 // [left, right]: the room, the same every time it is made
//   formatEffect("reverbSize", 40)           // "0.8 S"
//   formatEffect("masterFilter", -50)        // "LP 1.3 KHZ"

import { exp } from "../../shared/scales.js";
import { formatSetting } from "./pad-settings.js";

// Which note an echo is apart from the one before, as a share of a beat (a quarter note). The saved beat keeps the position
// in this list, so a new division goes on the end.
export const DELAY_DIVISIONS = Object.freeze([
  Object.freeze({ name: "1/16", spoken: "Sixteenth note", beats: 0.25 }),
  Object.freeze({ name: "1/8", spoken: "Eighth note", beats: 0.5 }),
  Object.freeze({ name: "1/8.", spoken: "Dotted eighth note", beats: 0.75 }), // three sixteenths
  Object.freeze({ name: "1/4", spoken: "Quarter note", beats: 1 }),
]);

// `label` names the control in the panel, and `lcd` the change on the display.
export const EFFECTS = {
  reverbSize: { min: 0, max: 100, default: 40, label: "Size", lcd: "REVERB SIZE" },
  reverbLevel: { min: 0, max: 100, default: 50, label: "Level", lcd: "REVERB LEVEL" },
  delayDivision: { min: 0, max: DELAY_DIVISIONS.length - 1, default: 1, label: "Time", lcd: "DELAY TIME" },
  // Below 100: an echo that came back at full level would never die away. At 90 the echoes go on for a long while and still
  // decay; how long an export follows them is bounded (effectsTail).
  delayFeedback: { min: 0, max: 90, default: 35, label: "Feedback", lcd: "DELAY FEEDBACK" },
  delayLevel: { min: 0, max: 100, default: 50, label: "Level", lcd: "DELAY LEVEL" },
  pingPong: { min: 0, max: 1, default: 0, label: "Ping-Pong", lcd: "PING-PONG" },
  // Off in the middle, as a pad's Filter is (see filterSpec in pad-settings.js, which says what the cutoffs are).
  masterFilter: { min: -100, max: 100, default: 0, label: "Filter", lcd: "MASTER FILTER" },
};

export const EFFECT_NAMES = Object.keys(EFFECTS);
export const DEFAULT_EFFECTS = Object.freeze(
  Object.fromEntries(EFFECT_NAMES.map((name) => [name, EFFECTS[name].default])),
);

// A whole number inside the setting's range. Anything that is not a number is the default.
export function clampEffect(name, value) {
  const { min, max, default: fallback } = EFFECTS[name];
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const isDefaultEffects = (effects) => EFFECT_NAMES.every((name) => effects[name] === DEFAULT_EFFECTS[name]);

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// What was stored (or what a beat carries), as the full set of settings, each brought into range, or null when it is not an
// object or has nothing but the defaults: a beat nobody touched the effects of has none to keep.
export function parseEffects(stored) {
  if (!isObject(stored)) return null;
  const effects = Object.fromEntries(EFFECT_NAMES.map((name) => [name, clampEffect(name, stored[name])]));
  return isDefaultEffects(effects) ? null : effects;
}

// The settings to use, from a beat that may have none: the defaults.
export const effectsOf = (beat) => parseEffects(beat?.effects) ?? DEFAULT_EFFECTS;

// How long the room rings, in seconds: an equal step of the slider is an equal ratio of length, 0.3 s (a small room) to 3 s
// (a hall). Three seconds is also what the impulse is capped at, so the page and a phone can afford it.
const ROOM_SECONDS = exp(0.3, 3);
export const reverbSeconds = (size) => ROOM_SECONDS.toValue(size);

// How long an echo is after the one before, in seconds. A tempo change moves it (the mixer glides to the new time).
export const delaySeconds = (division, bpm) => (DELAY_DIVISIONS[division].beats * 60) / bpm;

// The gains the controls stand for: a send and a level are a share of full (a straight line on the slider), and so is the
// feedback. A convolver is normalized by the loudness of its impulse, which leaves a pad sent fully to the biggest room 7 dB under
// its own sound, and to the smallest 17 dB (energy, measured in a browser with a snare-like hit), so the top of the Level slider
// would be a whisper: the room is brought up by 12 dB (a factor of 4) to make it a wash, with the sends as the way to turn it down.
export const REVERB_RETURN_GAIN = 4;
export const sendGain = (value) => value / 100;
export const reverbGain = (level) => (level / 100) * REVERB_RETURN_GAIN;
export const delayGain = (level) => level / 100;
export const feedbackGain = (feedback) => feedback / 100;

// What an effect is heard until, in seconds after a sound is sent to it: where it is 60 dB down (a thousandth). The room has
// that by its impulse's own decay (reverbImpulse); the echoes have it after as many repeats as it takes the feedback to bring
// one down. A feedback of 0 is the one echo.
const SILENT = 1e-3;
// No more than this is rendered or kept for: with a feedback of 90 per cent and a long note, the echoes ring on for minutes.
export const MAX_TAIL_SECONDS = 10;

export function delayTailSeconds({ delayDivision, delayFeedback }, bpm) {
  const feedback = feedbackGain(delayFeedback);
  const repeats = feedback <= 0 ? 0 : Math.ceil(Math.log(SILENT) / Math.log(feedback));
  return delaySeconds(delayDivision, bpm) * (1 + repeats);
}

// How long what a pad sends rings on after it, as far as an export follows it, given which of the effects a pad sends to
// (`reverb`, `delay`) and whether they are turned up at all. 0 when nothing is heard.
export function effectsTail(effects, bpm, { reverb = false, delay = false }) {
  let tail = 0;
  if (reverb && effects.reverbLevel > 0) tail = Math.max(tail, reverbSeconds(effects.reverbSize));
  if (delay && effects.delayLevel > 0) tail = Math.max(tail, delayTailSeconds(effects, bpm));
  return Math.min(MAX_TAIL_SECONDS, tail);
}

// The same for a beat as it is saved: which of the effects some pad sends to, from the pads' settings (those that are not at the
// defaults are all that is kept). It over-counts a pad that sends but plays nothing in the part exported, which is the safe side.
export function beatEffectsTail(beat) {
  const pads = Object.values(beat.padSettings ?? {});
  return effectsTail(effectsOf(beat), beat.bpm, {
    reverb: pads.some((settings) => settings.reverb > 0),
    delay: pads.some((settings) => settings.delay > 0),
  });
}

// A small seeded generator, so the room is the same every time and in every place it is made (the page and an export), which
// `Math.random` could not give. mulberry32: a few lines, and good enough for noise.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The seeds of the two sides: different, so the two channels are not the same room (which would sound like a mono one).
const LEFT_SEED = 0x1f2e3d4c;
const RIGHT_SEED = 0x5a6b7c8d;
// The first few milliseconds fade in, so the room does not start with a click.
const ONSET_SECONDS = 0.002;
// How bright the room is as it begins and as it ends, as the share of each step of noise the filter takes: air takes the top
// off a sound as it travels, so the tail is darker than the start.
const BRIGHT = 0.9;
const DARK = 0.12;

// The room as an impulse response for a ConvolverNode: noise that dies away to 60 dB down over `reverbSeconds(size)`, and
// darkens as it does. Two arrays, one for each side. A reverb's size is the one thing that changes it, so it is made again
// only when the size does.
export function reverbImpulse(size, sampleRate) {
  const seconds = reverbSeconds(size);
  const length = Math.max(1, Math.ceil(seconds * sampleRate));
  const onset = Math.max(1, Math.round(ONSET_SECONDS * sampleRate));
  const side = (seed) => {
    const random = seeded(seed);
    const data = new Float32Array(length);
    let heard = 0;
    for (let i = 0; i < length; i++) {
      const progress = i / length;
      const decay = SILENT ** progress; // 1 at the start, a thousandth at the end
      const brightness = BRIGHT + (DARK - BRIGHT) * progress;
      heard += brightness * (random() * 2 - 1 - heard);
      data[i] = heard * decay * Math.min(1, (i + 1) / onset);
    }
    return data;
  };
  return [side(LEFT_SEED), side(RIGHT_SEED)];
}

// For the display and the panel.
export function formatEffect(name, value) {
  if (name === "reverbSize") return `${reverbSeconds(value).toFixed(1)} S`;
  if (name === "delayDivision") return DELAY_DIVISIONS[value].name;
  if (name === "pingPong") return value ? "ON" : "OFF";
  if (name === "masterFilter") return formatSetting("filter", value);
  return `${value} %`;
}
