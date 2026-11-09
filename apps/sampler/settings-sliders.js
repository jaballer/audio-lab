// The sliders for some of the selected pad's settings, drawn into an element it is handed. It shows and reports;
// the sampler decides (setPadSetting). The ranges and the text come from pad-settings.js.
//
//   const sliders = createSettingsSliders(element, { names, onChange, fallbackFocus });   // onChange(name, value)
//   sliders.refresh({ settings, sampleEnabled });
//
// `names` are the settings this one draws (the page uses two: Gain, Pitch and Choke, and the envelope); default all the
// sliders. A slider is a native range input, so it works from the keyboard (arrows, Home, End); Delete or Backspace,
// or a double-click, puts it back to its default. Some settings are for loaded samples only (`samples` in
// pad-settings.js: Pitch and the envelope), so while the pad plays a built-in sound their sliders are disabled, show
// a dash, and say why to a screen reader (the reason is described by the input, so it is read with it). Focus on one
// when it goes disabled moves to the first slider that stays enabled, or to `fallbackFocus` when this draws only
// sample settings, so the keyboard stays in the editor.

import { setAttr, setDisabled, setText } from "../../shared/dom-updates.js";
import { SETTINGS, SLIDER_NAMES, formatSetting } from "./pad-settings.js";

const SAMPLE_HINT = "Applies to a loaded sample";
const RESET_KEYS = ["Delete", "Backspace"];
const NOT_APPLICABLE = "—"; // an em dash

export function createSettingsSliders(element, { names = SLIDER_NAMES, onChange, fallbackFocus = null }) {
  const rows = {};
  element.classList.add("sampler-settings");
  const idBase = `setting-${element.id || "sliders"}`;

  for (const name of names) {
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

  const forSamples = names.filter((name) => SETTINGS[name].samples);
  if (forSamples.length) {
    const hint = document.createElement("span");
    hint.id = `${idBase}-sample-hint`;
    hint.className = "sampler-visually-hidden";
    hint.textContent = SAMPLE_HINT;
    element.appendChild(hint);
    for (const name of forSamples) rows[name].input.setAttribute("aria-describedby", hint.id);
  }
  // Where focus goes from a slider that is disabled under it.
  const fallbackName = names.find((name) => !SETTINGS[name].samples);

  return {
    refresh({ settings, sampleEnabled }) {
      for (const name of names) {
        const { input, output, row } = rows[name];
        const applies = !SETTINGS[name].samples || sampleEnabled;
        // A pad that cannot use a setting shows the slider at rest and a dash, not a value that does nothing.
        const value = applies ? settings[name] : SETTINGS[name].default;
        if (input.value !== String(value)) input.value = String(value);
        setAttr(input, "aria-valuetext", applies ? formatSetting(name, value) : SAMPLE_HINT);
        setText(output, applies ? formatSetting(name, value) : NOT_APPLICABLE);
        if (SETTINGS[name].samples) {
          setDisabled(input, !sampleEnabled, fallbackName ? rows[fallbackName].input : fallbackFocus);
          setAttr(row, "title", sampleEnabled ? "" : SAMPLE_HINT);
          row.classList.toggle("disabled", !sampleEnabled);
        }
      }
    },
  };
}
