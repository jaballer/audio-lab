// The 4 x 4 grid of pads, laid out like the hardware: pad 1 bottom-left, numbers running
// along each row, so the top row holds pads 13-16.
//
//   const grid = createPadGrid(element, { onSelect });   // onSelect(index) when a pad is clicked or Entered
//   grid.render({ bank, pads, selected });   // pads: board.snapshot().pads for that bank; selected: the
//                                            // pad index the sequencer is editing here, or -1
//
// A pad lights while it is held (brighter for a harder hit), fills from the bottom with the
// pressure on it, and flashes on each hit, so a tap shorter than a frame is still seen.

import { createFlasher } from "../../shared/flash.js";
import { PADS_PER_BANK, noteForPad } from "../../shared/mpc-sample.js";

const COLUMNS = 4;
const ROWS = PADS_PER_BANK / COLUMNS;
const MIDI_MAX = 127;
const FLASH_MS = 140;

export function createPadGrid(element, { onSelect }) {
  const padEls = [];
  const noteEls = [];
  const flash = createFlasher("hit", FLASH_MS);
  const hitsDrawn = new Map(); // "bank:index" -> hits already flashed

  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const index = (ROWS - 1 - row) * COLUMNS + column;
      const pad = document.createElement("div");
      pad.className = "mpc-pad";
      pad.tabIndex = 0;
      pad.setAttribute("role", "button");
      pad.setAttribute("aria-label", `Pad ${index + 1}`);
      pad.addEventListener("click", () => onSelect(index));
      pad.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect(index);
      });
      const label = document.createElement("span");
      label.className = "num";
      label.textContent = String(index + 1);
      const note = document.createElement("span");
      note.className = "note";
      pad.append(label, note);
      element.append(pad);
      padEls[index] = pad;
      noteEls[index] = note;
    }
  }

  return {
    render({ bank, pads, selected }) {
      pads.forEach((pad, index) => {
        const el = padEls[index];
        el.classList.toggle("down", pad.down);
        el.classList.toggle("selected", index === selected);
        el.setAttribute("aria-pressed", String(index === selected));
        el.style.setProperty("--v", String(pad.velocity / MIDI_MAX));
        el.style.setProperty("--pressure", String(pad.pressure / MIDI_MAX));
        noteEls[index].textContent = String(noteForPad(index, bank));

        const key = `${bank}:${index}`;
        if (pad.hits > (hitsDrawn.get(key) ?? 0)) flash(el);
        hitsDrawn.set(key, pad.hits);
      });
    },
  };
}
