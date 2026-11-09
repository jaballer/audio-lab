// The sliders for the selected pad's settings (gain, pitch), drawn into an element it is handed. It shows and
// reports; the sampler decides (setPadSetting). The ranges and the text come from pad-settings.js.
//
//   const sliders = createSettingsSliders(element, { onChange });   // onChange(name, value)
//   sliders.refresh({ settings: { gain, pitch }, pitchEnabled });
//
// A slider is a native range input, so it works from the keyboard (arrows, Home, End); Delete or Backspace, or
// a double-click, puts it back to its default. Pitch is for loaded samples, so while the pad plays a built-in
// sound its slider is disabled, shows a dash, and says why to a screen reader (the reason is described by
// the input, so it is read with it).

import { SETTINGS, SETTING_NAMES, formatSetting } from "./pad-settings.js";

const PITCH_HINT = "Pitch applies to a loaded sample";
const RESET_KEYS = ["Delete", "Backspace"];
const NOT_APPLICABLE = "—"; // an em dash

export function createSettingsSliders(element, { onChange }) {
  const rows = {};
  element.classList.add("sampler-settings");
  const idBase = `setting-${element.id || "sliders"}`;

  for (const name of SETTING_NAMES) {
    const { min, max, label } = SETTINGS[name];
    const id = `${idBase}-${name}`;
    const row = document.createElement("div");
    row.className = "sampler-setting";

    const text = document.createElement("label");
    text.className = "small-label";
    text.htmlFor = id;
    text.textContent = label;

    const input = document.createElement("input");
    input.id = id;
    input.type = "range";
    input.className = "fader";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.value = String(SETTINGS[name].default);
    input.addEventListener("input", () => onChange(name, Number(input.value)));
    input.addEventListener("dblclick", () => onChange(name, SETTINGS[name].default));
    input.addEventListener("keydown", (e) => {
      if (!RESET_KEYS.includes(e.key)) return;
      e.preventDefault();
      onChange(name, SETTINGS[name].default);
    });

    // The value is shown for the eye; the slider itself says it to a screen reader (aria-valuetext), so this is
    // hidden from them rather than announced a second time.
    const output = document.createElement("output");
    output.className = "small-label sampler-setting-value";
    output.htmlFor = id;
    output.setAttribute("aria-hidden", "true");

    row.append(text, input, output);
    element.appendChild(row);
    rows[name] = { input, output, row };
  }

  const hint = document.createElement("span");
  hint.id = `${idBase}-pitch-hint`;
  hint.className = "sampler-visually-hidden";
  hint.textContent = PITCH_HINT;
  element.appendChild(hint);
  rows.pitch.input.setAttribute("aria-describedby", hint.id);

  return {
    refresh({ settings, pitchEnabled }) {
      for (const name of SETTING_NAMES) {
        const { input, output } = rows[name];
        const applies = name !== "pitch" || pitchEnabled;
        // A pad that cannot use its pitch shows the slider at rest and a dash, not a value that does nothing.
        const value = applies ? settings[name] : SETTINGS[name].default;
        input.value = String(value);
        input.setAttribute("aria-valuetext", applies ? formatSetting(name, value) : PITCH_HINT);
        output.textContent = applies ? formatSetting(name, value) : NOT_APPLICABLE;
      }
      const { input, row } = rows.pitch;
      input.disabled = !pitchEnabled;
      row.title = pitchEnabled ? "" : PITCH_HINT;
      row.classList.toggle("disabled", !pitchEnabled);
    },
  };
}
