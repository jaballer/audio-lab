// The sampler's LCD: three text lines, a step ruler and a short-lived message.
// `formatLcd` builds the text from the sequencer's state with no DOM, so it can
// be tested; `createLcd` writes it into the page's elements.
//
//   state = { playing, recording, selected, soundName, bpm, playheadStep, steps, stepsOn }
//     selected:  the selected pad, 0-based
//     stepsOn:  the selected pad's steps, as booleans

import { pad2 } from "./format.js";

const MESSAGE_MS = 1600;

export function formatLcd({ playing, recording, selected, soundName, bpm, playheadStep, steps, stepsOn }) {
  const stepLabel = playheadStep >= 0 && playing ? pad2(playheadStep + 1) : "--";
  return {
    line1: `SEQ 01  ${playing ? "PLAYING" : "STOPPED"}${recording ? "  REC" : ""}`,
    line2: `PAD ${pad2(selected + 1)}  ${soundName}`,
    line3: `BPM ${bpm.toFixed(1)}  STEP ${stepLabel}/${steps}`,
    ruler: stepsOn.map((on, i) => ({ on, now: playing && i === playheadStep })),
  };
}

// `elements` is { lines: [el, el, el], message, ruler }, and `steps` is how
// many cells the ruler has.
export function createLcd({ lines, message, ruler, steps }) {
  const cells = [];
  for (let i = 0; i < steps; i++) {
    const cell = document.createElement("span");
    ruler.appendChild(cell);
    cells.push(cell);
  }

  let messageTimer = null;

  return {
    render(state) {
      const text = formatLcd(state);
      lines[0].textContent = text.line1;
      lines[1].textContent = text.line2;
      lines[2].textContent = text.line3;
      cells.forEach((cell, i) => {
        cell.classList.toggle("on", text.ruler[i].on);
        cell.classList.toggle("now", text.ruler[i].now);
      });
    },

    // A short message on the fourth line, cleared after a moment.
    showMessage(text) {
      message.textContent = text;
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => (message.textContent = ""), MESSAGE_MS);
    },
  };
}
