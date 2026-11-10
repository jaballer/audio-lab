// The row of colours for the selected pad, drawn into an element it is handed. It shows and reports; the sampler
// decides (setPadSetting). The colours and their names are in pad-colors.js.
//
//   const swatches = createColorSwatches(element, { onChange });   // onChange(index): 0 for none, 1 to 6
//   swatches.refresh({ color });                                    // the selected pad's colour
//
// A radio group: one swatch is in the tab order (the chosen one), the arrow keys move to the next or previous and
// choose it (Home and End go to the ends), and each swatch is named for a screen reader, so the colour is never
// carried by sight alone.

import { setAttr } from "../../shared/dom-updates.js";
import { PAD_COLORS } from "./pad-colors.js";

// The swatch a key moves to from `current`, or null for a key that is not for this. Wraps round at the ends.
export function nextSwatch(current, key, count = PAD_COLORS.length) {
  const moved = {
    ArrowRight: current + 1,
    ArrowDown: current + 1,
    ArrowLeft: current - 1,
    ArrowUp: current - 1,
    Home: 0,
    End: count - 1,
  }[key];
  return moved === undefined ? null : (moved + count) % count;
}

export function createColorSwatches(element, { onChange }) {
  element.classList.add("sampler-swatches");
  element.setAttribute("role", "radiogroup");
  element.setAttribute("aria-label", "Pad color");
  const buttons = PAD_COLORS.map((color, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sampler-swatch";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-label", color.name);
    button.title = color.name;
    if (color.css) button.style.setProperty("--swatch", color.css);
    else button.classList.add("none");
    button.addEventListener("click", () => onChange(index));
    button.addEventListener("keydown", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const next = nextSwatch(index, e.key);
      if (next === null) return;
      e.preventDefault();
      buttons[next].focus();
      onChange(next);
    });
    element.appendChild(button);
    return button;
  });

  return {
    // Called on every redraw, which is every step while playing: only what changed is written.
    refresh({ color }) {
      buttons.forEach((button, index) => {
        setAttr(button, "aria-checked", String(index === color));
        setAttr(button, "tabindex", index === color ? "0" : "-1");
      });
    },
  };
}
