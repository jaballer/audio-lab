// The 4 x 4 grid of pads, and the computer keys that mirror it.
//
//   const grid = createPadGrid(element, { sounds, onTrigger });   // onTrigger(index, { shift }) for a pointer press; the computer keys are read by the page (padForKeyEvent)
//   grid.flash(0);    // a pad was pressed: light it and push it down briefly
//   grid.light(0);    // the sequence played a pad: light it, but it does not move
//   grid.setPower("booting");   // "off" | "booting" | "on" | "shutdown" (power-sequence.js): the CSS sweeps light across the pads
//   grid.select(0);   // mark the selected pad (aria-current)
//   grid.setColor(0, 5);   // the pad's colour: 0 for none, or a swatch (pad-colors.js); shown as its rim, and named in its label
//   grid.setName(0, "Kick 808", true);   // a pad plays another sound now (true: a loaded sample, not the built-in one)
//   padForKey("q")    // which pad a key plays (8), or -1
//   padForKeyEvent(event)   // the same from a keydown event, which also reads the number row with Shift held

import { setAttr } from "../../shared/dom-updates.js";
import { createFlasher } from "../../shared/flash.js";
import { sweepStep } from "../../shared/power-sequence.js";
import { PAD_COLUMNS, PAD_ROWS, padIndex } from "./layout.js";
import { padColorCss, padColorName } from "./pad-colors.js";

// Keyboard rows mirror the pad grid: top row of keys = top row of pads.
export const KEY_ROWS = ["1234", "qwer", "asdf", "zxcv"];

// Pad 1 sits bottom-left, so the top key row plays the top pad row (pads 13-16).
export function padForKey(key) {
  if (!key) return -1; // indexOf("") is 0, which would be the first pad
  for (let row = 0; row < PAD_ROWS; row++) {
    const col = KEY_ROWS[row].indexOf(key);
    if (col !== -1) return padIndex(row, col);
  }
  return -1;
}

const FLASH_MS = 110;

// Which pad a key press plays (or, with Shift, edits). `key` is what the key types, so it follows the keyboard layout;
// but Shift turns the number row into symbols (Shift+1 types "!"), so a digit key is also read from its `code`.
export function padForKeyEvent({ key = "", code = "" }) {
  const index = padForKey(key.toLowerCase());
  if (index >= 0) return index;
  const digit = /^Digit(\d)$/.exec(code);
  return digit ? padForKey(digit[1]) : -1;
}

// What a press on a pad does, by a pointer or by its computer key. A plain press plays it. Shift is for editing: it
// selects the pad and opens its editor without a sound, so a pad can be set up in the middle of a live take without a
// hit landing in it. (Enter and Space on a focused pad always play. A touch screen or a MIDI pad has no Shift: Edit Pad
// is their way to the editor.)
export const padPressAction = ({ shift = false } = {}) => (shift ? "edit" : "play");

// A pad's label for a screen reader: which pad, what it plays, its key, and its colour when it has one.
export function padLabel({ index, name, key, color = 0 }) {
  return `Pad ${index + 1}, ${name}, key ${key.toUpperCase()}${color ? `, ${padColorName(color).toLowerCase()}` : ""}`;
}

// `sounds` is a list of { name }; `onTrigger(index, { shift })` is called for a pointer press, with whether Shift was
// held, and `onTrigger(index)` for a keyboard activation (Enter/Space on a focused pad).
export function createPadGrid(element, { sounds, onTrigger }) {
  const padEls = [];
  const keys = []; // each pad's computer key, for its label
  const names = []; // what each pad plays now
  const colors = []; // each pad's colour (0 for none)
  const labelOf = (idx) => padLabel({ index: idx, name: names[idx], key: keys[idx], color: colors[idx] });
  const flash = createFlasher("hit", FLASH_MS);
  const light = createFlasher("lit", FLASH_MS);
  element.style.setProperty("--pad-columns", String(PAD_COLUMNS));
  element.style.setProperty("--sweep-last", String(sweepStep(0, PAD_COLUMNS - 1, PAD_ROWS)));

  for (let row = 0; row < PAD_ROWS; row++) {
    for (let col = 0; col < PAD_COLUMNS; col++) {
      const idx = padIndex(row, col);
      const key = KEY_ROWS[row][col];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sampler-pad";
      btn.style.setProperty("--sweep", String(sweepStep(row, col, PAD_ROWS))); // its place in the power-on sweep
      btn.dataset.pad = String(idx); // which pad a dropped file is for (sample-loader.js)
      keys[idx] = key;
      names[idx] = sounds[idx].name;
      colors[idx] = 0;
      btn.setAttribute("aria-label", labelOf(idx));
      btn.innerHTML =
        `<span class="num">${idx + 1}</span>` + `<span class="key">${key}</span>` + `<span class="name"></span>`;
      btn.querySelector(".name").textContent = sounds[idx].name; // text, not markup: a file's name goes here
      btn.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return; // a right or middle press is not a hit (a right press opens the context menu)
        e.preventDefault();
        onTrigger(idx, { shift: e.shiftKey });
      });
      // Keyboard activation (Enter/Space on a focused pad) fires click with detail 0. It always plays, Shift or not:
      // Shift+Enter would open the editor with focus left on the pad. Shift with the pad's computer key is the keyboard's
      // way to edit a pad (the page opens the editor and moves focus into it), and Edit Pad is the other.
      btn.addEventListener("click", (e) => {
        if (e.detail === 0) onTrigger(idx);
      });
      element.appendChild(btn);
      padEls[idx] = btn;
    }
  }

  return {
    // The middle of a pad in the window, as a share of its width and height (the light show bursts from there).
    center(idx) {
      const r = padEls[idx].getBoundingClientRect();
      return { x: ((r.left + r.width / 2) / innerWidth) * 100, y: ((r.top + r.height / 2) / innerHeight) * 100 };
    },

    setPower(phase) {
      setAttr(element, "data-power", phase);
    },

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
      names[idx] = name;
      el.setAttribute("aria-label", labelOf(idx));
    },

    setColor(idx, color) {
      if (colors[idx] === color) return;
      colors[idx] = color;
      const el = padEls[idx];
      const css = padColorCss(color);
      if (css) {
        el.style.setProperty("--pad-color", css);
        el.title = padColorName(color); // a cue that is not the colour alone, for anyone who cannot tell two apart
      } else {
        el.style.removeProperty("--pad-color");
        el.removeAttribute("title");
      }
      el.setAttribute("aria-label", labelOf(idx));
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
