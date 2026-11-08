// The 4 x 2 grid of pads, laid out like the hardware: pads 1-4 on the bottom row.
//
//   const grid = createPadGrid(element, { notes });  // notes: learned note per slot, for the labels
//   grid.hit(slot, note, velocity);                  // flash a pad; brighter for a harder hit

import { createFlasher } from "../../shared/flash.js";

const ROW_ORDER = [4, 5, 6, 7, 0, 1, 2, 3]; // top row (pads 5-8) first in the DOM
const FLASH_MS = 140;

export function createPadGrid(element, { notes }) {
  const padEls = [];
  const flash = createFlasher("hit", FLASH_MS);

  for (const idx of ROW_ORDER) {
    const el = document.createElement("div");
    el.className = "pad";
    el.innerHTML = `<span class="lbl">${idx + 1}</span><span class="nt">${notes[idx] ?? ""}</span>`;
    element.appendChild(el);
    padEls[idx] = el;
  }

  function hit(slot, note, velocity) {
    const el = padEls[slot];
    el.style.setProperty("--v", velocity / 127);
    el.querySelector(".nt").textContent = note;
    flash(el);
  }

  return { hit };
}
