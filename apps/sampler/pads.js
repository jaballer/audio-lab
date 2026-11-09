// The 4 x 4 grid of pads, and the computer keys that mirror it.
//
//   const grid = createPadGrid(element, { sounds, onTrigger });
//   grid.flash(0);    // a pad was pressed: light it and push it down briefly
//   grid.light(0);    // the sequence played a pad: light it, but it does not move
//   grid.select(0);   // mark the selected pad (aria-current)
//   grid.setName(0, "Kick 808", true);   // a pad plays another sound now (true: a loaded sample, not the built-in one)
//   padForKey("q")    // which pad a key plays (8), or -1

import { setAttr } from "../../shared/dom-updates.js";
import { createFlasher } from "../../shared/flash.js";
import { PAD_COLUMNS, PAD_ROWS, padIndex } from "./layout.js";

// Keyboard rows mirror the pad grid: top row of keys = top row of pads.
export const KEY_ROWS = ["1234", "qwer", "asdf", "zxcv"];

// Pad 1 sits bottom-left, so the top key row plays the top pad row (pads 13-16).
export function padForKey(key) {
  for (let row = 0; row < PAD_ROWS; row++) {
    const col = KEY_ROWS[row].indexOf(key);
    if (col !== -1) return padIndex(row, col);
  }
  return -1;
}

const FLASH_MS = 110;

// `sounds` is a list of { name }; `onTrigger(index)` is called for a pointer
// press or a keyboard activation (Enter/Space on a focused pad).
export function createPadGrid(element, { sounds, onTrigger }) {
  const padEls = [];
  const keys = []; // each pad's computer key, for its label
  const flash = createFlasher("hit", FLASH_MS);
  const light = createFlasher("lit", FLASH_MS);
  element.style.setProperty("--pad-columns", String(PAD_COLUMNS));

  for (let row = 0; row < PAD_ROWS; row++) {
    for (let col = 0; col < PAD_COLUMNS; col++) {
      const idx = padIndex(row, col);
      const key = KEY_ROWS[row][col];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sampler-pad";
      btn.dataset.pad = String(idx); // which pad a dropped file is for (sample-loader.js)
      btn.setAttribute("aria-label", `Pad ${idx + 1}, ${sounds[idx].name}, key ${key.toUpperCase()}`);
      btn.innerHTML =
        `<span class="num">${idx + 1}</span>` + `<span class="key">${key}</span>` + `<span class="name"></span>`;
      btn.querySelector(".name").textContent = sounds[idx].name; // text, not markup: a file's name goes here
      keys[idx] = key;
      btn.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return; // a right or middle press is not a hit (a right press opens the context menu)
        e.preventDefault();
        onTrigger(idx);
      });
      // Keyboard activation (Enter/Space on a focused pad) fires click with detail 0.
      btn.addEventListener("click", (e) => {
        if (e.detail === 0) onTrigger(idx);
      });
      element.appendChild(btn);
      padEls[idx] = btn;
    }
  }

  return {
    flash(idx) {
      flash(padEls[idx]);
    },

    light(idx) {
      light(padEls[idx]);
    },

    setName(idx, name, custom = false) {
      const el = padEls[idx];
      el.querySelector(".name").textContent = name;
      el.classList.toggle("custom", custom);
      el.setAttribute("aria-label", `Pad ${idx + 1}, ${name}, key ${keys[idx].toUpperCase()}`);
    },

    // The selected pad is what the pad editor and the step keys are for, so a screen reader is told which it is.
    select(idx) {
      padEls.forEach((el, i) => {
        el.classList.toggle("selected", i === idx);
        if (i === idx) setAttr(el, "aria-current", "true");
        else if (el.hasAttribute("aria-current")) el.removeAttribute("aria-current");
      });
    },
  };
}
