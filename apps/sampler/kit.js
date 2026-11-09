// What each pad plays and how: the built-in sound, which can be swapped for another (a loaded sample) and put
// back, and the pad's settings (gain, pitch, choke group). No DOM. A sound is { id, name, play(ctx, out, t) }, as in
// shared/sounds.js.
//
//   const kit = createKit(SOUNDS, { onChange, settings });
//   kit.length;                       // how many pads
//   kit.get(3);                       // the sound pad 3 plays now (for its name)
//   kit.set(3, sound);                // pad 3 plays `sound` from now on
//   kit.reset(3);                     // back to the built-in one
//   kit.isDefault(3);                 // is it the built-in one?
//   kit.settings(3);                  // { gain, pitch, choke } of pad 3 (pad-settings.js)
//   kit.setSetting(3, "gain", -6);    // one setting; the value is clamped and rounded
//   kit.settingsSnapshot();           // { pad: { gain, pitch, choke } } for the pads that are not at the defaults
//   kit.voice(3).play(ctx, out, t)    // what the sequencer and live hits call: the sound, with the pad's settings
//
// `onChange(index, what)` is called when a pad's sound ("sound") or a setting ("setting") actually changes, so views
// can show it and the page can save it. The
// sequencer and the pads read the kit each time they play, so a change is heard at the next hit. `settings` is
// the starting settings, in the shape settingsSnapshot gives (parsePadSettings makes it from what was saved).
//
// Gain applies to every sound. Pitch changes the playback rate, which only a sample has: a built-in sound is
// synthesized with fixed frequencies and plays as it is, so the pitch setting is for loaded samples.

import { withGain } from "../../shared/sounds.js";
import { DEFAULT_SETTINGS, SETTING_NAMES, clampSetting, gainToLinear, pitchToRate } from "./pad-settings.js";

export function createKit(defaults, { onChange, settings: initial = {} } = {}) {
  const current = [...defaults];
  const settings = defaults.map((_, index) => ({ ...DEFAULT_SETTINGS, ...initial[index] }));

  function voice(index) {
    return {
      get id() {
        return current[index].id;
      },
      get name() {
        return current[index].name;
      },
      play(ctx, out, t) {
        const { gain, pitch } = settings[index];
        const target = withGain(ctx, out, gainToLinear(gain));
        // Only a changed pitch passes the option, so a sound that knows nothing of it is called as it always was.
        if (pitch === DEFAULT_SETTINGS.pitch) current[index].play(ctx, target, t);
        else current[index].play(ctx, target, t, { rate: pitchToRate(pitch) });
      },
    };
  }

  return {
    length: defaults.length,
    get: (index) => current[index],
    isDefault: (index) => current[index] === defaults[index],
    set(index, sound) {
      if (current[index] === sound) return;
      current[index] = sound;
      onChange?.(index, "sound");
    },
    reset(index) {
      if (current[index] === defaults[index]) return;
      current[index] = defaults[index];
      onChange?.(index, "sound");
    },
    settings: (index) => ({ ...settings[index] }),
    setSetting(index, name, value) {
      const next = clampSetting(name, value);
      if (settings[index][name] === next) return;
      settings[index][name] = next;
      onChange?.(index, "setting");
    },
    settingsSnapshot() {
      const out = {};
      settings.forEach((entry, index) => {
        if (SETTING_NAMES.some((name) => entry[name] !== DEFAULT_SETTINGS[name])) out[index] = { ...entry };
      });
      return out;
    },
    voice,
  };
}
