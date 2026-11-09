// The tempo knob: drag it, scroll it, or use the arrow keys. Moves are whole BPM; Shift drags in tenths and scrolls
// or steps by 10 (knob-moves.js has the arithmetic). It only reports what the user asked for; the caller decides the tempo and tells the knob to
// show it.
//
//   const knob = createTempoKnob(element, { min, max, getBpm, onChange });
//   knob.render(bpm);   // point the knob at a tempo
//
// `onChange(bpm)` receives the wanted tempo (not yet clamped). `getBpm()` is
// the current tempo, which relative moves start from.

import { setAttr } from "../../shared/dom-updates.js";
import { createShiftWheelClock, dragTempo, keyTempo, wheelTempo } from "./knob-moves.js";

const SWEEP = 270; // degrees from minimum to maximum

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
    drag = { y: e.clientY, bpm: getBpm(), fine: e.shiftKey };
  });
  element.addEventListener("pointermove", (e) => {
    if (!drag) return;
    // Pressing or releasing Shift mid-drag starts the drag again from here, so the speed changes without a jump
    // (the tempo may still settle onto a whole number as Shift is released).
    if (drag.fine !== e.shiftKey) drag = { y: e.clientY, bpm: getBpm(), fine: e.shiftKey };
    onChange(dragTempo(drag.bpm, drag.y - e.clientY, drag.fine));
  });
  const endDrag = () => (drag = null);
  element.addEventListener("pointerup", endDrag);
  element.addEventListener("pointercancel", endDrag);

  const sinceShiftWheel = createShiftWheelClock();
  element.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const bpm = wheelTempo(getBpm(), {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        shift: e.shiftKey,
        sinceLastMs: sinceShiftWheel(e.timeStamp, e.shiftKey),
      });
      if (bpm === null) return;
      onChange(bpm);
    },
    { passive: false },
  );

  element.addEventListener("keydown", (e) => {
    const bpm = keyTempo(getBpm(), e.key, e.shiftKey);
    if (bpm !== null) {
      e.preventDefault();
      onChange(bpm);
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
