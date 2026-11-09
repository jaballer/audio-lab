// The tempo knob: drag it, scroll it, or use the arrow keys. It only reports
// what the user asked for; the caller decides the tempo and tells the knob to
// show it.
//
//   const knob = createTempoKnob(element, { min, max, getBpm, onChange });
//   knob.render(bpm);   // point the knob at a tempo
//
// `onChange(bpm)` receives the wanted tempo (not yet clamped). `getBpm()` is
// the current tempo, which relative moves start from.

import { setAttr } from "../../shared/dom-updates.js";

const SWEEP = 270; // degrees from minimum to maximum
const DRAG_BPM_PER_PX = 0.5;

export function createTempoKnob(element, { min, max, getBpm, onChange }) {
  let drawn = null; // the transform last written
  function render(bpm) {
    const angle = ((bpm - min) / (max - min)) * SWEEP - SWEEP / 2;
    // Called on every redraw, which is every step while playing: only what changed is written.
    const transform = `rotate(${angle}deg)`;
    if (drawn !== transform) {
      drawn = transform;
      element.style.transform = transform;
    }
    setAttr(element, "aria-valuenow", String(Math.round(bpm)));
    setAttr(element, "aria-valuetext", `${bpm.toFixed(1)} BPM`);
  }

  let drag = null;
  element.addEventListener("pointerdown", (e) => {
    element.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, bpm: getBpm() };
  });
  element.addEventListener("pointermove", (e) => {
    if (drag) onChange(drag.bpm + (drag.y - e.clientY) * DRAG_BPM_PER_PX);
  });
  const endDrag = () => (drag = null);
  element.addEventListener("pointerup", endDrag);
  element.addEventListener("pointercancel", endDrag);

  element.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      onChange(getBpm() + (e.deltaY < 0 ? 1 : -1));
    },
    { passive: false },
  );

  element.addEventListener("keydown", (e) => {
    const big = e.shiftKey ? 10 : 1;
    const moves = { ArrowUp: big, ArrowRight: big, ArrowDown: -big, ArrowLeft: -big, PageUp: 10, PageDown: -10 };
    if (e.key in moves) {
      e.preventDefault();
      onChange(getBpm() + moves[e.key]);
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(min);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(max);
    }
  });

  return { render };
}
