// The sliders for the selected pad's settings (gain, pitch), drawn into an element it is handed. It shows and
// reports; the sampler decides (setPadSetting). The ranges and the text come from pad-settings.js.
//
//   const sliders = createSettingsSliders(element, { onChange });   // onChange(name, value)
//   sliders.refresh({ settings: { gain, pitch }, pitchEnabled });
//
// A slider is a native range input, so it works from the keyboard, and double-clicking one puts it back to its
// default. Pitch is for loaded samples, so it is disabled while the pad plays its built-in sound.

import { SETTINGS, SETTING_NAMES, formatSetting } from "./pad-settings.js";

const PITCH_HINT = "Pitch applies to a loaded sample";

export function createSettingsSliders(element, { onChange }) {
  const rows = {};
  element.classList.add("sampler-settings");

  for (const name of SETTING_NAMES) {
    const { min, max, label } = SETTINGS[name];
    const row = document.createElement("label");
    row.className = "sampler-setting";
    const text = document.createElement("span");
    text.className = "small-label";
    text.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.className = "fader";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.value = String(SETTINGS[name].default);
    const output = document.createElement("output");
    output.className = "small-label sampler-setting-value";
    input.addEventListener("input", () => onChange(name, Number(input.value)));
    input.addEventListener("dblclick", () => onChange(name, SETTINGS[name].default));
    row.append(text, input, output);
    element.appendChild(row);
    rows[name] = { input, output, row };
  }

  return {
    refresh({ settings, pitchEnabled }) {
      for (const name of SETTING_NAMES) {
        const { input, output } = rows[name];
        input.value = String(settings[name]);
        input.setAttribute("aria-valuetext", formatSetting(name, settings[name]));
        output.textContent = formatSetting(name, settings[name]);
      }
      const { input, row } = rows.pitch;
      input.disabled = !pitchEnabled;
      row.title = pitchEnabled ? "" : PITCH_HINT;
      row.classList.toggle("disabled", !pitchEnabled);
    },
  };
}
