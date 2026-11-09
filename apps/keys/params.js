// Every synth parameter the page lets you change, in one table. Each entry says
// how a knob maps to a value and how to display it, so the on-screen dials, the
// hardware knobs and the LCD are all wired from this list instead of each being
// written out by hand. No DOM in here.
//
// An entry is either
//   a range:  { name, toValue(position), toSlider(value), format(value) }
//             position is a 0-100 scale of the knob's travel (see shared/scales.js)
//   a choice: { name, choices: [...] }   a knob picks one by splitting its travel
//
// The order is the knob order: entry 0 is knob K1, entry 1 is K2, and so on.
//
// To add a parameter: give it a default in synth.js (DEFAULT_PARAMS) and add one
// entry here. The page labels its dial from the entry.

import { exp, linear, squared } from "../../shared/scales.js";
import { WAVES } from "./synth.js";

// Time sliders run 0-100 but map exponentially to seconds, so there is fine
// control over short times (5 ms) as well as long ones (3 s).
const TIME_MIN = 0.005;
const TIME_MAX = 3;
const timeScale = exp(TIME_MIN, TIME_MAX);
const formatTime = (t) => (t < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(2)} s`);

const CUTOFF_MIN = 60; // Hz
const CUTOFF_MAX = 16000; // Hz
const RESONANCE_MAX = 24; // dB

export const PARAMS = [
  { name: "attack", ...timeScale, format: formatTime },
  { name: "decay", ...timeScale, format: formatTime },
  { name: "sustain", ...linear(0, 1), format: (s) => `${Math.round(s * 100)}%` },
  { name: "release", ...timeScale, format: formatTime },
  // A choice, not a range: a knob picks one by splitting its travel into equal parts.
  { name: "wave", choices: WAVES },
  // Exponential, because pitch is: equal slider steps should be equal musical steps.
  {
    name: "cutoff",
    ...exp(CUTOFF_MIN, CUTOFF_MAX),
    format: (hz) => (hz < 1000 ? `${Math.round(hz)} Hz` : `${(hz / 1000).toFixed(1)} kHz`),
  },
  { name: "resonance", ...linear(0, RESONANCE_MAX), format: (db) => `${db.toFixed(1)} dB` },
  { name: "volume", ...squared(), format: (gain) => `${Math.round(Math.sqrt(gain) * 100)}%` },
];

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// What a choice is called on the display. Only the odd ones are listed.
const CHOICE_LABELS = { sawtooth: "Saw" };
export const choiceLabel = (choice) => CHOICE_LABELS[choice] ?? capitalize(choice);

export const isChoice = (param) => Array.isArray(param.choices);

// A knob sends 0-127. As a slider position that is 0-100.
export const KNOB_MAX = 127;
export const knobPosition = (midiValue) => (midiValue / KNOB_MAX) * 100;

// The way back: where a knob sits for a slider position, so an on-screen dial can
// follow the slider (and a drag on the dial starts from where the sound is).
export const positionKnob = (position) => (position / 100) * KNOB_MAX;

export const clampKnob = (value) => Math.min(KNOB_MAX, Math.max(0, value));

// For a choice, the knob's 0-127 travel is split into equal parts, one per choice.
export function knobChoice(midiValue, choices) {
  return choices[Math.min(choices.length - 1, Math.floor(midiValue / (128 / choices.length)))];
}

// Where a knob sits for a choice: the middle of that choice's part of the travel,
// so it reads back as the same choice (and a drag has room either way).
export function choiceKnob(choice, choices) {
  const part = 128 / choices.length;
  return Math.min(KNOB_MAX, (choices.indexOf(choice) + 0.5) * part);
}

// Where a choice knob's dial should point once the choice is `choice`: where it is
// now if that already means this choice, so it keeps following the hand (or the
// hardware knob) instead of snapping to the middle; else the choice's middle.
export function knobForChoice(current, choice, choices) {
  return knobChoice(current, choices) === choice ? current : choiceKnob(choice, choices);
}
