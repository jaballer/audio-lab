// The five-line LCD. `formatLcd` builds the text from the page's state, with no
// DOM, so it can be tested; `createLcd` writes it into the page's elements.
//
//   state = { last, bend, mod, sustain, lastKnob, lastCc }
//     last:    { note, velocity } or null
//     bend:    -1 .. 1
//     mod:     0-127
//     sustain: boolean
//     lastKnob: { index, name, text } or null
//     lastCc:  { cc, value } or null

import { noteName } from "../../shared/notes.js";
import { BEND_RANGE } from "./synth.js";

// A fixed-width level meter: "#####...........".
export const bar = (value, max = 127, width = 16) => {
  const n = Math.round((value / max) * width);
  return "#".repeat(n) + ".".repeat(width - n);
};

// The longest parameter name ("resonance"), so the values line up.
const KNOB_NAME_WIDTH = 9;

export function formatLcd({ last, bend, mod, sustain, lastKnob, lastCc }) {
  return {
    note: last ? `NOTE ${noteName(last.note).padEnd(3)} (${last.note})` : "NOTE --",
    vel: last ? `VEL  ${bar(last.velocity)} ${last.velocity}` : "VEL  --",
    wheels: `BEND ${bend >= 0 ? "+" : ""}${(bend * BEND_RANGE).toFixed(2)}  MOD ${mod}  SUS ${sustain ? "ON" : "OFF"}`,
    // What a hardware display shows when a knob is touched: which one, and its value in words.
    knob: lastKnob
      ? `K${lastKnob.index + 1} ${lastKnob.name.toUpperCase().padEnd(KNOB_NAME_WIDTH)} ${lastKnob.text}`
      : "KNOB --",
    cc: lastCc ? `CC${String(lastCc.cc).padStart(3, "0")} ${bar(lastCc.value)} ${lastCc.value}` : "CC   --",
  };
}

// `elements` is { note, vel, wheels, knob, cc }: the five line elements.
export function createLcd(elements) {
  return {
    render(state) {
      const text = formatLcd(state);
      for (const line of Object.keys(elements)) elements[line].textContent = text[line];
    },
  };
}
