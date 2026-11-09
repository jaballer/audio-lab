// What can be set on a pad besides its sound: how loud it is, (for a loaded sample) how high, and which choke group
// it is in. No DOM,
// and plain numbers, so the same values are what the sliders show, the kit plays and the song saves.
//
//   gain:  decibels, -24 to +6 in whole steps (0 leaves the sound as it is)
//   pitch: semitones, -12 to +12 in whole steps (0 plays the sample at its own pitch)
//   choke: a choke group, 0 (none) or 1 to 8: pads in the same group cut each other off (voices.js)
//
//   clampSetting("gain", 9.4)            // 6
//   gainToLinear(-6)                     // 0.501...: what to multiply the signal by
//   pitchToRate(12)                      // 2: the playbackRate that sounds an octave up
//   formatSetting("pitch", 2)            // "+2 st"
//   formatSetting("choke", 0)            // "OFF"; 3 is "GROUP 3"
//   parsePadSettings(stored, padCount)   // { pad: { gain, pitch, choke } } for the pads that differ from the default

export const SETTINGS = {
  gain: { min: -24, max: 6, default: 0, unit: "dB", label: "Gain" },
  pitch: { min: -12, max: 12, default: 0, unit: "st", label: "Pitch" },
  // A whole-number group, not a quantity: 0 is "no group". Eight is enough to keep hats, cymbals and a few more apart.
  choke: { min: 0, max: 8, default: 0, unit: "", label: "Choke" },
};

export const SETTING_NAMES = Object.keys(SETTINGS);
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

// "-3 dB", "+2 st", "0 dB": the sign shown so a positive value reads as one. A choke group is "OFF" or "GROUP 3".
export function formatSetting(name, value) {
  if (name === "choke") return value === 0 ? "OFF" : `GROUP ${value}`;
  return `${value > 0 ? "+" : ""}${value} ${SETTINGS[name].unit}`;
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// What was stored, as { pad: { gain, pitch } } for the pads that exist and have something other than the
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
