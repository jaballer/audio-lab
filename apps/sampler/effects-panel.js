// The panel for the reverb and the delay the pads send to, and the filter over the mix, drawn into an element it is handed: sliders
// for the room's Size and Level, keys for which note the echoes are apart, a Ping-Pong switch, sliders for the echoes' Feedback and
// Level, and a Filter slider for the whole mix. It shows and reports; the sampler decides (setEffect). The ranges and the text come from effects.js.
//
//   const panel = createEffectsPanel(element, { onChange, onLearn, onClearAssignment });
//                                       // onChange(name, value), for any of the settings in effects.js; the others for the knob
//                                       // (onLearn(target) is the Learn key, pressed to wait and pressed again to stop)
//   panel.refresh({ effects, midi });   // midi: { learning, assigned } from midi-map.js
//
// A slider is a native range input, so it works from the keyboard (arrows, Home, End); Delete or Backspace, or a double-click, puts it
// back to its default, as the pad editor's sliders do. The note and Ping-Pong keys say which is chosen and whether it is on
// (`aria-pressed`).

import { setAttr, setHidden, setText } from "../../shared/dom-updates.js";
import { DELAY_DIVISIONS, EFFECTS, formatEffect } from "./effects.js";

const RESET_KEYS = ["Delete", "Backspace"];

// The sliders of each group, in the order they are drawn.
const REVERB_SLIDERS = ["reverbSize", "reverbLevel"];
const DELAY_SLIDERS = ["delayFeedback", "delayLevel"];
const MASTER_SLIDERS = ["masterFilter"];

export function createEffectsPanel(element, { onChange, onLearn, onClearAssignment }) {
  const sliders = {};
  const idBase = `effects-${element.id || "panel"}`;
  element.classList.add("sampler-effects-groups");

  function group(title) {
    const section = document.createElement("div");
    section.className = "sampler-effects-group";
    section.setAttribute("role", "group");
    const heading = document.createElement("h3");
    heading.id = `${idBase}-${title.toLowerCase()}`;
    heading.className = "small-label sampler-effects-group-title";
    heading.textContent = title;
    section.setAttribute("aria-labelledby", heading.id);
    section.appendChild(heading);
    element.appendChild(section);
    return { section, heading };
  }

  function slider(section, name) {
    const { min, max, label } = EFFECTS[name];
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
    input.value = String(EFFECTS[name].default);
    input.addEventListener("input", () => onChange(name, Number(input.value)));
    input.addEventListener("dblclick", () => onChange(name, EFFECTS[name].default));
    input.addEventListener("keydown", (e) => {
      if (!RESET_KEYS.includes(e.key)) return;
      e.preventDefault();
      onChange(name, EFFECTS[name].default);
    });
    // Seen for the eye, and said by the slider itself (aria-valuetext), so it is hidden from a screen reader here.
    const output = document.createElement("output");
    output.className = "small-label sampler-setting-value";
    output.htmlFor = id;
    output.setAttribute("aria-hidden", "true");
    row.append(text, input, output);
    section.appendChild(row);
    sliders[name] = { input, output };
  }

  const reverb = group("Reverb");
  for (const name of REVERB_SLIDERS) slider(reverb.section, name);

  const delay = group("Delay");
  // The echoes' note and the switch share a row under the heading.
  const keys = document.createElement("div");
  keys.className = "sampler-effects-delay-keys";
  const notes = document.createElement("div");
  notes.className = "btn-group";
  notes.setAttribute("role", "group");
  notes.setAttribute("aria-label", "Time between echoes");
  const noteButtons = DELAY_DIVISIONS.map(({ name, spoken }, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-small";
    button.textContent = name;
    // The visible text is in the name (what a voice control says to press it), then the note said in words.
    button.setAttribute("aria-label", `${name} ${spoken.toLowerCase()}`);
    button.addEventListener("click", () => onChange("delayDivision", index));
    notes.appendChild(button);
    return button;
  });
  const pingPong = document.createElement("button");
  pingPong.type = "button";
  pingPong.className = "btn btn-small sampler-effects-ping-pong";
  pingPong.textContent = EFFECTS.pingPong.label;
  pingPong.setAttribute("aria-pressed", "false");
  pingPong.addEventListener("click", () =>
    onChange("pingPong", pingPong.getAttribute("aria-pressed") === "true" ? 0 : 1),
  );
  keys.append(notes, pingPong);
  delay.section.appendChild(keys);
  for (const name of DELAY_SLIDERS) slider(delay.section, name);

  // Over everything that is heard: the pads, the reverb and the echoes.
  const master = group("Master");
  for (const name of MASTER_SLIDERS) slider(master.section, name);

  // The Master Filter's knob (midi-map.js): Learn, then turn a knob on a controller. The key is pressed while it waits, a
  // status line says what it waits for or which knob is assigned (also to a screen reader, as it changes), and Clear is there
  // only while a knob is assigned.
  const midiRow = document.createElement("div");
  midiRow.className = "sampler-effects-midi";
  const learn = document.createElement("button");
  learn.type = "button";
  learn.className = "btn btn-small";
  learn.textContent = "MIDI Learn";
  learn.setAttribute("aria-pressed", "false");
  learn.setAttribute("aria-label", "MIDI learn for the master filter");
  learn.addEventListener("click", () => onLearn("masterFilter"));
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn btn-small";
  clear.textContent = "Clear";
  clear.setAttribute("aria-label", "Clear the MIDI knob of the master filter");
  clear.hidden = true;
  clear.addEventListener("click", () => onClearAssignment("masterFilter"));
  const status = document.createElement("span");
  status.className = "small-label sampler-effects-midi-status";
  status.setAttribute("role", "status");
  midiRow.append(learn, status, clear);
  master.section.appendChild(midiRow);

  return {
    refresh({ effects, midi }) {
      if (midi) {
        const { learning: waiting, assigned } = midi;
        const learning = waiting === "masterFilter";
        setAttr(learn, "aria-pressed", String(learning));
        setText(status, learning ? "Turn a knob" : (assigned.masterFilter ?? "No knob"));
        setHidden(clear, !assigned.masterFilter, learn);
      }
      for (const [name, { input, output }] of Object.entries(sliders)) {
        const value = effects[name];
        if (input.value !== String(value)) input.value = String(value);
        setAttr(input, "aria-valuetext", formatEffect(name, value));
        setText(output, formatEffect(name, value));
      }
      noteButtons.forEach((button, index) => setAttr(button, "aria-pressed", String(index === effects.delayDivision)));
      setAttr(pingPong, "aria-pressed", String(effects.pingPong === 1));
    },
  };
}
