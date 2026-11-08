// The 4 x 2 grid of knob dials. The pointer sweeps 270 degrees as the value
// goes 0-127. Like the sampler's tempo knob, a dial can be dragged up and down,
// scrolled, or moved with the arrow keys; it only reports what was asked for.
//
//   const dials = createKnobDials(element, { ccs, labels, onChange });
//   dials.turn(0, 64, "10 ms");   // point dial K1 at a 0-127 value (and say it in words)
//   dials.value(0);               // where dial K1 points now
//
// `ccs[i]` is the controller number printed under knob i, and `labels[i]` is
// what it controls. `onChange(index, value)` receives the wanted 0-127 value
// (already kept in range), after the dial has moved itself there; the caller decides
// what it means and may `turn` the dial elsewhere.

import { KNOB_MAX, clampKnob } from "./params.js";

const SWEEP = 270; // degrees from minimum to maximum
const DRAG_PER_PX = 0.5; // values per pixel of vertical drag
const WHEEL_STEP = 2;
const KEY_STEP = 1;
const KEY_BIG_STEP = 10; // Shift + arrow, Page Up / Page Down

export function createKnobDials(element, { ccs, labels, onChange = () => {} }) {
  const dialEls = [];
  const values = ccs.map(() => 0);

  function turn(index, value, text) {
    values[index] = value;
    const dial = dialEls[index];
    dial.style.setProperty("--a", `${-SWEEP / 2 + (value / KNOB_MAX) * SWEEP}deg`);
    dial.setAttribute("aria-valuenow", String(Math.round(value)));
    if (text !== undefined) dial.setAttribute("aria-valuetext", text);
  }

  // Each dial is a slider for the keyboard and for screen readers too.
  function wire(dial, index) {
    // The dial follows the hand itself, because the caller may have nothing to
    // show for a small move (a choice knob stays on one choice across part of its travel).
    const move = (value) => {
      turn(index, value);
      onChange(index, value);
    };
    const nudge = (delta) => move(clampKnob(values[index] + delta));

    let drag = null;
    dial.addEventListener("pointerdown", (e) => {
      dial.setPointerCapture(e.pointerId);
      drag = { y: e.clientY, value: values[index] };
    });
    dial.addEventListener("pointermove", (e) => {
      if (drag) move(clampKnob(drag.value + (drag.y - e.clientY) * DRAG_PER_PX));
    });
    const endDrag = () => (drag = null);
    dial.addEventListener("pointerup", endDrag);
    dial.addEventListener("pointercancel", endDrag);

    dial.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault(); // scrolling over a dial turns it, not the page
        nudge(e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP);
      },
      { passive: false },
    );

    dial.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? KEY_BIG_STEP : KEY_STEP;
      const moves = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step };
      moves.PageUp = KEY_BIG_STEP;
      moves.PageDown = -KEY_BIG_STEP;
      if (e.key in moves) nudge(moves[e.key]);
      else if (e.key === "Home") move(0);
      else if (e.key === "End") move(KNOB_MAX);
      else return;
      e.preventDefault();
    });
  }

  for (let i = 0; i < ccs.length; i++) {
    const cell = document.createElement("div");
    cell.className = "knob-cell";
    cell.innerHTML =
      `<div class="dial" role="slider" tabindex="0" aria-label="K${i + 1} ${labels[i] ?? ""}" ` +
      `aria-valuemin="0" aria-valuemax="${KNOB_MAX}" aria-valuenow="0"></div>` +
      `<span class="knob-name">K${i + 1}</span>` +
      `<span class="knob-cc">CC ${ccs[i]}</span>` +
      `<span class="knob-fn">${labels[i] ?? ""}</span>`;
    element.appendChild(cell);
    const dial = cell.querySelector(".dial");
    dialEls.push(dial);
    wire(dial, i);
  }

  return { turn, value: (index) => values[index] };
}
