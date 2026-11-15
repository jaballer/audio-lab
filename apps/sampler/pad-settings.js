// What can be set on a pad besides its sound: how loud it is, (for a loaded sample) how high and how its volume is
// shaped over time, which choke group it is in, a drive, a filter and a pan for what it plays, and how much of it goes to the shared
// reverb and delay (effects.js). No DOM, and plain numbers, so the same values are what the sliders show, the kit plays and the song saves.
//
//   gain:  decibels, -24 to +6 in whole steps (0 leaves the sound as it is)
//   pitch: semitones, -12 to +12 in whole steps (0 plays the sample at its own pitch)
//   attack, decay, release: (for a loaded sample) 0 to 100 on a slider, a time up to 2, 2 and 5 seconds (envelopeSeconds)
//   sustain: (for a loaded sample) the level the decay falls to, 0 to 100 per cent (100 leaves the sample as it is)
//   choke: a choke group, 0 (none) or 1 to 8: pads in the same group cut each other off (voices.js)
//   drive: 0 to 100 per cent, how hard what the pad plays is pushed into a soft clip, before its filter; 0 is off and leaves the sound
//           exactly as it is (driveSpec)
//   filter: -100 to +100: one control for a low-pass (below 0: the cutoff comes down from the top of hearing, so the sound
//           darkens) and a high-pass (above 0: the cutoff goes up from the bottom, so it thins); 0 is off (filterSpec)
//   pan: -100 (left) to +100 (right), 0 in the centre: a balance, not a mix of the two sides (panGains)
//   reverb, delay: 0 to 100 per cent, how much of what the pad plays (after its filter and pan) is sent to the shared reverb and
//           the shared delay; 0 sends none, which is how every pad starts (sendGain in effects.js)
//   color: a colour for the pad, 0 (none) or 1 to 6 (pad-colors.js); only for looks, and chosen with swatches, not a slider
//
//   clampSetting("gain", 9.4)            // 6
//   gainToLinear(-6)                     // 0.501...: what to multiply the signal by
//   pitchToRate(12)                      // 2: the playbackRate that sounds an octave up
//   formatSetting("pitch", 2)            // "+2 st"
//   formatSetting("choke", 0)            // "OFF"; 3 is "GROUP 3"
//   formatSetting("color", 3)            // "BLUE"
//   formatSetting("attack", 50)          // "250 MS": a time, not the slider position; "sustain" is "50 %", and so is a send
//   driveSpec(50)                        // { on: true, preGain: 1.58, postGain: 0.4 }: what the strip's drive is set to ({ on: false } at 0)
//   driveCurve()                         // the soft clip the strip's shaper is given: tanh, over what the pre-gain brings in
//   filterSpec(-50)                      // { type: "lowpass", frequency: 1265 }: what the strip's filter is set to ({ type: "off" } at 0)
//   panGains(50)                         // { left: 0.5, right: 1 }: what each side is multiplied by
//   envelopeSeconds("release", 100)      // 5
//   padEnvelope(settings)                // { attack, decay, sustain, release } in seconds and 0-1, or null when flat
//   parsePadSettings(stored, padCount)   // { pad: { gain, pitch, choke, filter, pan, reverb, delay, color, attack, decay, sustain, release } } for the pads that differ from the default

import { isFlat } from "./pad-envelope.js";
import { COLOR_COUNT, padColorName } from "./pad-colors.js";
import { exp } from "../../shared/scales.js";

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
  // How hard the pad is driven: any sound, since it acts on what comes out of the pad. Off until asked for.
  drive: { min: 0, max: 100, default: 0, unit: "%", label: "Drive" },
  // Whole numbers either side of an off in the middle, like a DJ filter and a balance: they apply to any sound, a built-in
  // one as well as a sample, since they act on what comes out of the pad.
  filter: { min: -100, max: 100, default: 0, unit: "", label: "Filter" },
  pan: { min: -100, max: 100, default: 0, unit: "", label: "Pan" },
  // How much of the pad goes to the shared reverb and delay: any sound can, so they are never disabled. None until asked for.
  reverb: { min: 0, max: 100, default: 0, unit: "%", label: "Reverb" },
  delay: { min: 0, max: 100, default: 0, unit: "%", label: "Delay" },
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
  if (name === "sustain" || name === "reverb" || name === "delay" || name === "drive") return `${value} %`;
  if (name === "choke") return value === 0 ? "OFF" : `GROUP ${value}`;
  if (name === "color") return padColorName(value).toUpperCase();
  if (name === "filter")
    return value === 0 ? "OFF" : `${value < 0 ? "LP" : "HP"} ${formatHz(filterSpec(value).frequency)}`;
  if (name === "pan") return value === 0 ? "CENTER" : `${value < 0 ? "L" : "R"} ${Math.abs(value)}`;
  return `${value > 0 ? "+" : ""}${value} ${SETTINGS[name].unit}`;
}

// The drive as what the strip does with it: the sound is pushed into a soft clip, tanh(g * x), and brought back down. `g` runs from 1,
// which is a gentle bend that is barely more than the sound itself, to 40, which turns anything louder than a fortieth of full scale
// into a flat top (an equal ratio for an equal step, `exp`, so the sweep feels even). The make-up is 1 / sqrt(g), which was measured
// through the strip on six of the built-in sounds to keep their loudness (RMS) between -5 and +7 dB of where it was across the whole
// range (most within 3 dB, the sparse noisy ones such as the clap the loudest, the kick the quietest at the top): a bare tanh was
// 14 dB louder at g = 10 and 17 dB louder at g = 40, and dividing by g all the way would have been quieter than the sound by as much.
// Peaks come down, as they do when a sound is squashed. The shaper takes its input between -1 and 1, and its curve is tanh over that range
// scaled by DRIVE_CURVE_REACH, so the pre-gain is g divided by it (a hit of full scale at g = 40 is 10 times past the end of the
// table, which is flat there: tanh of 4 is already 0.9993).
const DRIVE_GAIN = exp(1, 40);
export const DRIVE_CURVE_REACH = 4;
export const DRIVE_CURVE_SIZE = 4097; // an odd number of points, so there is one at 0 and the curve passes through it exactly
const DRIVE_OFF = Object.freeze({ on: false });

export function driveSpec(value) {
  if (value === 0) return DRIVE_OFF;
  const gain = DRIVE_GAIN.toValue(value);
  return { on: true, preGain: gain / DRIVE_CURVE_REACH, postGain: 1 / Math.sqrt(gain) };
}

// The soft clip the shaper is given, from -1 to 1 in, odd (so there is no DC from it) and flat at the ends.
export function driveCurve(size = DRIVE_CURVE_SIZE) {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) curve[i] = Math.tanh(DRIVE_CURVE_REACH * ((i / (size - 1)) * 2 - 1));
  return curve;
}

// The filter control as what the strip does with it. A low-pass comes down from the top of hearing to 80 Hz and a high-pass
// goes up from the bottom to 8 kHz (a high-pass any higher leaves nothing of most sounds), each an equal ratio for an equal
// step (`exp`, so the sweep feels even). `type` is "off", "lowpass" or "highpass". Q is a Butterworth's, the flattest the
// bend can be without a bump at the cutoff, and is in decibels, as a low-pass and a high-pass take it in Web Audio
// (10 ** (dB / 20) is the usual Q of 0.707).
const LOW_PASS_HZ = exp(80, 20000);
const HIGH_PASS_HZ = exp(20, 8000);
export const FILTER_Q_DB = 20 * Math.log10(Math.SQRT1_2);
// Where a filter waits while it is not the one in use, so that it is already at work on the sound, and nearly out of the way,
// when it is: a low-pass at the top of the range and a high-pass at the bottom.
export const LOW_PASS_PARKED_HZ = LOW_PASS_HZ.toValue(100);
export const HIGH_PASS_PARKED_HZ = HIGH_PASS_HZ.toValue(0);
const FILTER_OFF = Object.freeze({ type: "off" });

export function filterSpec(value) {
  if (value === 0) return FILTER_OFF;
  const amount = Math.abs(value);
  if (value < 0) return { type: "lowpass", frequency: LOW_PASS_HZ.toValue(100 - amount) };
  return { type: "highpass", frequency: HIGH_PASS_HZ.toValue(amount) };
}

// A balance: the side the sound is moved away from is turned down, and the other stays as it is, so the centre is the sound
// untouched and a mono sound at the far edge is all on one side at its own level (about 3 dB quieter in all than at the
// centre, where it is on both). A stereo sample is balanced the same way.
export function panGains(value) {
  const pan = value / 100;
  return { left: Math.min(1, 1 - pan), right: Math.min(1, 1 + pan) };
}

const formatHz = (hz) => (hz < 1000 ? `${Math.round(hz)} HZ` : `${(hz / 1000).toFixed(1)} KHZ`);

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// What was stored, as { pad: { gain, pitch, envelope, choke, filter, pan, reverb, delay, color } } for the pads that exist and have something other than the
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
