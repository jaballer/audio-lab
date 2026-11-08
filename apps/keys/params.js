// Every synth parameter the page lets you change, in one table. Each entry says
// how a control maps to a value and how to display it, so the sliders, the
// select and the hardware knobs are all wired from this list instead of each
// being written out by hand. No DOM in here.
//
// An entry is either
//   a range:  { name, group, toValue(position), toSlider(value), format(value) }
//             position is the slider position, 0-100 (see shared/scales.js)
//   a choice: { name, group, choices: [...] }   shown as a <select>
//
// `group` and `name` give the control's element id: `${group}-${name}` is the
// slider or select, and `out-${name}` is its readout.
//
// The order is the knob order: entry 0 is knob K1, entry 1 is K2, and so on.
//
// To add a parameter: give it a default in synth.js (DEFAULT_PARAMS) and add one
// entry here. The page draws its control from the entry (synth-panel.js).

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
  { name: "attack", group: "env", ...timeScale, format: formatTime },
  { name: "decay", group: "env", ...timeScale, format: formatTime },
  { name: "sustain", group: "env", ...linear(0, 1), format: (s) => `${Math.round(s * 100)}%` },
  { name: "release", group: "env", ...timeScale, format: formatTime },
  // A choice, not a range: a knob picks one by splitting its travel into equal parts.
  { name: "wave", group: "tone", choices: WAVES },
  // Exponential, because pitch is: equal slider steps should be equal musical steps.
  {
    name: "cutoff",
    group: "tone",
    ...exp(CUTOFF_MIN, CUTOFF_MAX),
    format: (hz) => (hz < 1000 ? `${Math.round(hz)} Hz` : `${(hz / 1000).toFixed(1)} kHz`),
  },
  { name: "resonance", group: "tone", ...linear(0, RESONANCE_MAX), format: (db) => `${db.toFixed(1)} dB` },
  { name: "volume", group: "tone", ...squared(), format: (gain) => `${Math.round(Math.sqrt(gain) * 100)}%` },
];

// The sections the panel draws, in order: `id` matches a param's `group`.
export const GROUPS = [
  { id: "env", label: "Envelope", title: "Envelope \u00b7 ADSR" },
  { id: "tone", label: "Tone", title: "Tone \u00b7 K5\u2013K8" },
];

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// What a control is called on the page.
export const labelFor = (param) => capitalize(param.name);

// What a choice is called in its select. Only the odd ones are listed.
const CHOICE_LABELS = { sawtooth: "Saw" };
export const choiceLabel = (choice) => CHOICE_LABELS[choice] ?? capitalize(choice);

export const isChoice = (param) => Array.isArray(param.choices);

// A knob sends 0-127. As a slider position that is 0-100.
export const knobPosition = (midiValue) => (midiValue / 127) * 100;

// For a choice, the knob's 0-127 travel is split into equal parts, one per choice.
export function knobChoice(midiValue, choices) {
  return choices[Math.min(choices.length - 1, Math.floor(midiValue / (128 / choices.length)))];
}
