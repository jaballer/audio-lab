// A row of step keys for one pad, in groups (a beat of 16ths, four keys, by default). Shared by the
// pages that have a step sequencer; its styles are in shared/step-keys.css, which the page imports.
//
//   const keys = createStepKeys(element, { steps: 16, group: 4, onToggle });
//   keys.refresh({ on, soundName });     // show which steps are on (on: booleans)
//   keys.refresh({ on, soundName, first: 16 });   // the keys are steps 17-32 of a longer sequence; a key whose
//                                                 // `on` is undefined is not a step (the sequence ends first)
//   keys.paintPlayhead(playing, step);   // light the step the playhead is on

import { setAttr, setHidden, setText } from "./dom-updates.js";

// The index of the last step key that is shown (its `on` is not undefined), or -1: where focus goes from a key
// that is hidden.
export function lastShownIndex(on, count = on.length) {
  for (let i = count - 1; i >= 0; i--) if (on[i] !== undefined) return i;
  return -1;
}

export function createStepKeys(element, { steps, group: groupSize = 4, onToggle }) {
  const cells = [];
  element.classList.add("step-keys");
  element.style.setProperty("--step-groups", String(steps / groupSize));

  let group = null;
  for (let i = 0; i < steps; i++) {
    if (i % groupSize === 0) {
      group = document.createElement("div");
      group.className = "step-keys-group";
      group.style.setProperty("--step-group", String(groupSize));
      element.appendChild(group);
    }
    const cell = document.createElement("div");
    cell.className = "step-keys-cell";
    const led = document.createElement("span");
    led.className = "step-keys-led";
    led.setAttribute("aria-hidden", "true");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "step-keys-key";
    btn.textContent = String(i + 1);
    btn.addEventListener("click", () => onToggle(i));
    cell.append(led, btn);
    group.appendChild(cell);
    cells.push({ cell, btn });
  }

  return {
    // Called on every redraw, which is every step while playing: only what changed is written.
    refresh({ on, soundName, first = 0 }) {
      // A key that goes away (a shorter sequence) hands its focus to the last one that stays.
      const lastShown = lastShownIndex(on, cells.length);
      const fallback = lastShown >= 0 ? cells[lastShown].btn : null;
      cells.forEach(({ cell, btn }, i) => {
        const hidden = on[i] === undefined;
        setHidden(cell, hidden, fallback);
        if (hidden) return;
        setText(btn, String(first + i + 1));
        cell.classList.toggle("on", on[i]);
        setAttr(btn, "aria-pressed", String(on[i]));
        setAttr(btn, "aria-label", `${soundName} step ${first + i + 1}${on[i] ? ", on" : ", off"}`);
      });
    },

    paintPlayhead(playing, playheadStep) {
      cells.forEach(({ cell }, i) => cell.classList.toggle("now", playing && i === playheadStep));
    },
  };
}
