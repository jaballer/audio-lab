// What can be set on a pad besides its sound: how loud it is, and (for a loaded sample) how high. No DOM,
// and plain numbers, so the same values are what the sliders show, the kit plays and the song saves.
//
//   gain:  decibels, -24 to +6 in whole steps (0 leaves the sound as it is)
//   pitch: semitones, -12 to +12 in whole steps (0 plays the sample at its own pitch)
//
//   clampSetting("gain", 9.4)            // 6
//   gainToLinear(-6)                     // 0.501...: what to multiply the signal by
//   pitchToRate(12)                      // 2: the playbackRate that sounds an octave up
//   formatSetting("pitch", 2)            // "+2 st"
//   parsePadSettings(stored, padCount)   // { pad: { gain, pitch } } for the pads that differ from the default

export const SETTINGS = {
  gain: { min: -24, max: 6, default: 0, unit: "dB", label: "Gain" },
  pitch: { min: -12, max: 12, default: 0, unit: "st", label: "Pitch" },
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

// "-3 dB", "+2 st", "0 dB": the sign shown so a positive value reads as one.
export function formatSetting(name, value) {
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
