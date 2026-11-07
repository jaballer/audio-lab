// The five-line LCD. `formatLcd` builds the text from the page's state, with no
// DOM, so it can be tested; `createLcd` writes it into the page's elements.
//
//   state = { last, bend, mod, sustain, lastCc, lastPad }
//     last:    { note, velocity } or null
//     bend:    -1 .. 1
//     mod:     0-127
//     sustain: boolean
//     lastCc:  { cc, value } or null
//     lastPad: { note, velocity, channel } or null

import { noteName } from "../../shared/notes.js";
import { BEND_RANGE } from "./synth.js";

// A fixed-width level meter: "#####...........".
export const bar = (value, max = 127, width = 16) => {
  const n = Math.round((value / max) * width);
  return "#".repeat(n) + ".".repeat(width - n);
};

export function formatLcd({ last, bend, mod, sustain, lastCc, lastPad }) {
  return {
    note: last ? `NOTE ${noteName(last.note).padEnd(3)} (${last.note})` : "NOTE --",
    vel: last ? `VEL  ${bar(last.velocity)} ${last.velocity}` : "VEL  --",
    wheels: `BEND ${bend >= 0 ? "+" : ""}${(bend * BEND_RANGE).toFixed(2)}  MOD ${mod}  SUS ${sustain ? "ON" : "OFF"}`,
    cc: lastCc ? `CC${String(lastCc.cc).padStart(3, "0")} ${bar(lastCc.value)} ${lastCc.value}` : "CC   --",
    pad: lastPad ? `PAD  NOTE ${lastPad.note}  CH ${lastPad.channel}  VEL ${lastPad.velocity}` : "PAD  --",
  };
}

// `elements` is { note, vel, wheels, cc, pad }: the five line elements.
export function createLcd(elements) {
  return {
    render(state) {
      const text = formatLcd(state);
      for (const line of Object.keys(elements)) elements[line].textContent = text[line];
    },
  };
}
