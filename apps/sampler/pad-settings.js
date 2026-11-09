// What can be set on a pad besides its sound: how loud it is, (for a loaded sample) how high and how its volume is
// shaped over time, and which choke group it is in. No DOM, and plain numbers, so the same values are what the sliders show, the kit plays and the song saves.
//
//   gain:  decibels, -24 to +6 in whole steps (0 leaves the sound as it is)
//   pitch: semitones, -12 to +12 in whole steps (0 plays the sample at its own pitch)
//   attack, decay, release: (for a loaded sample) 0 to 100 on a slider, a time up to 2, 2 and 5 seconds (envelopeSeconds)
//   sustain: (for a loaded sample) the level the decay falls to, 0 to 100 per cent (100 leaves the sample as it is)
//   choke: a choke group, 0 (none) or 1 to 8: pads in the same group cut each other off (voices.js)
//   color: a colour for the pad, 0 (none) or 1 to 8 (pad-colors.js); only for looks, and chosen with swatches, not a slider
//
//   clampSetting("gain", 9.4)            // 6
//   gainToLinear(-6)                     // 0.501...: what to multiply the signal by
//   pitchToRate(12)                      // 2: the playbackRate that sounds an octave up
//   formatSetting("pitch", 2)            // "+2 st"
//   formatSetting("choke", 0)            // "OFF"; 3 is "GROUP 3"
//   formatSetting("color", 5)            // "BLUE"
//   formatSetting("attack", 50)          // "250 MS": a time, not the slider position; "sustain" is "50 %"
//   envelopeSeconds("release", 100)      // 5
//   padEnvelope(settings)                // { attack, decay, sustain, release } in seconds and 0-1, or null when flat
//   parsePadSettings(stored, padCount)   // { pad: { gain, pitch, choke, color, attack, decay, sustain, release } } for the pads that differ from the default

import { isFlat } from "./pad-envelope.js";
import { COLOR_COUNT, padColorName } from "./pad-colors.js";

export const SETTINGS = {
  gain: { min: -24, max: 6, default: 0, unit: "dB", label: "Gain" },
  // `samples`: only a loaded sample has it (a built-in sound is synthesized with its own frequencies and envelope), so
  // the pad editor disables it for a pad playing a built-in sound.
  pitch: { min: -12, max: 12, default: 0, unit: "st", label: "Pitch", samples: true },
  // A whole-number group, not a quantity: 0 is "no group". Eight is enough to keep hats, cymbals and a few more apart.
  choke: { min: 0, max: 8, default: 0, unit: "", label: "Choke" },
  // The envelope: slider positions 0 to 100. A time is a cube of the position (fine control over short times, a long
  // reach), up to `seconds`. All at their defaults leaves the sample exactly as it is.
  attack: { min: 0, max: 100, default: 0, unit: "", label: "Attack", samples: true, seconds: 2 },
  decay: { min: 0, max: 100, default: 0, unit: "", label: "Decay", samples: true, seconds: 2 },
  sustain: { min: 0, max: 100, default: 100, unit: "%", label: "Sustain", samples: true },
  release: { min: 0, max: 100, default: 0, unit: "", label: "Release", samples: true, seconds: 5 },
  // Which swatch: not a quantity, so it has no slider (`swatches`): the pad editor draws it as a row of colours.
  color: { min: 0, max: COLOR_COUNT, default: 0, unit: "", label: "Color", swatches: true },
};

export const SETTING_NAMES = Object.keys(SETTINGS);
// The ones only a loaded sample has.
export const SAMPLE_SETTING_NAMES = SETTING_NAMES.filter((name) => SETTINGS[name].samples);
// The ones drawn as sliders: the rest have a control of their own.
export const SLIDER_NAMES = SETTING_NAMES.filter((name) => !SETTINGS[name].swatches);
export const DEFAULT_SETTINGS = Object.freeze(
  Object.fromEntries(SETTING_NAMES.map((name) => [name, SETTINGS[name].default])),
);

// A whole number inside the setting's range. Anything that is not a number is the default.
export function clampSetting(name, value) {
  const { min, max, default: fallback } = SETTINGS[name];
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const gainToLinear = (db) => 10 ** (db / 20);

// Twelve semitones to the octave: each is a factor of the twelfth root of two.
export const pitchToRate = (semitones) => 2 ** (semitones / 12);

// Below a millisecond is no time: it is shown as 0 MS and is no envelope at all, so a pad with the slider just off its end
// does not get a stage for nothing.
const MIN_ENVELOPE_SECONDS = 0.001;

// The time an envelope setting stands for, in seconds: 0 at position 0, then the cube of the position's share of the
// way to the setting's longest time.
export const envelopeSeconds = (name, position) => {
  const seconds = position <= 0 ? 0 : SETTINGS[name].seconds * (position / 100) ** 3;
  return seconds < MIN_ENVELOPE_SECONDS ? 0 : seconds;
};

// A time for the display: "5 MS", "250 MS", "1.20 S".
const formatSeconds = (seconds) => (seconds < 1 ? `${Math.round(seconds * 1000)} MS` : `${seconds.toFixed(2)} S`);

// The pad's envelope as the sample voice wants it (seconds, and a level from 0 to 1), or null when it changes
// nothing, so a pad with no envelope is played exactly as before.
export function padEnvelope(settings) {
  const envelope = {
    attack: envelopeSeconds("attack", settings.attack),
    decay: envelopeSeconds("decay", settings.decay),
    sustain: settings.sustain / 100,
    release: envelopeSeconds("release", settings.release),
  };
  return isFlat(envelope) ? null : envelope;
}

// "-3 dB", "+2 st", "0 dB": the sign shown so a positive value reads as one. A choke group is "OFF" or "GROUP 3", and
// an envelope time is shown as the time and not as the slider's position.
export function formatSetting(name, value) {
  if (SETTINGS[name].seconds) return formatSeconds(envelopeSeconds(name, value));
  if (name === "sustain") return `${value} %`;
  if (name === "choke") return value === 0 ? "OFF" : `GROUP ${value}`;
  if (name === "color") return padColorName(value).toUpperCase();
  return `${value > 0 ? "+" : ""}${value} ${SETTINGS[name].unit}`;
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// What was stored, as { pad: { gain, pitch, envelope, choke, color } } for the pads that exist and have something other than the
// defaults. Values are brought into range; anything unusable is left out.
export function parsePadSettings(stored, padCount) {
  const pads = {};
  if (!isObject(stored)) return pads;
  for (const [key, entry] of Object.entries(stored)) {
    const pad = Number(key);
    if (!Number.isInteger(pad) || String(pad) !== key || pad < 0 || pad >= padCount || !isObject(entry)) continue;
    const settings = Object.fromEntries(SETTING_NAMES.map((name) => [name, clampSetting(name, entry[name])]));
    if (SETTING_NAMES.some((name) => settings[name] !== DEFAULT_SETTINGS[name])) pads[pad] = settings;
  }
  return pads;
}
