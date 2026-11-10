// The volume knob: drag it, scroll it, or use the arrow keys, like the tempo knob (tempo-knob.js), and with the same
// arithmetic (knob-moves.js), on a scale of whole steps from `min` to `max`. A drag of two pixels is one step; Shift on
// the wheel or the arrow keys, and Page Up and Page Down, are ten. It reports what the user asked for, kept inside the
// scale (the sampler does not clamp a volume) and only when it differs from the current one, and the caller decides
// the volume and tells the knob to show it.
//
//   const knob = createVolumeKnob(element, { min, max, getValue, onChange });
//   knob.render(value);   // point the knob at a volume
//
// `onChange(value)` receives the wanted volume. `getValue()` is the current one, which relative moves start from.

import { setAttr } from "../../shared/dom-updates.js";
import { createShiftWheelClock, dialAngle, dragTempo, keyTempo, wheelTempo } from "./knob-moves.js";

export function createVolumeKnob(element, { min, max, getValue, onChange }) {
  // Only a change is reported: a drag sends a move for every pixel, and a repeat would log VOLUME again and save again.
  const report = (value) => {
    const wanted = Math.min(max, Math.max(min, value));
    if (wanted !== getValue()) onChange(wanted);
  };

  let drawn = null; // the transform last written
  function render(value) {
    // Called on every redraw, which is every step while playing: only what changed is written.
    const transform = `rotate(${dialAngle(value, min, max)}deg)`;
    if (drawn !== transform) {
      drawn = transform;
      element.style.transform = transform;
    }
    setAttr(element, "aria-valuenow", String(Math.round(value)));
    setAttr(element, "aria-valuetext", `${Math.round(value)}%`);
  }

  let drag = null;
  element.addEventListener("pointerdown", (e) => {
    element.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, value: getValue() };
  });
  element.addEventListener("pointermove", (e) => {
    if (drag) report(dragTempo(drag.value, drag.y - e.clientY, false));
  });
  const endDrag = () => (drag = null);
  element.addEventListener("pointerup", endDrag);
  element.addEventListener("pointercancel", endDrag);

  const sinceShiftWheel = createShiftWheelClock();
  element.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const value = wheelTempo(getValue(), {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        shift: e.shiftKey,
        sinceLastMs: sinceShiftWheel(e.timeStamp, e.shiftKey),
      });
      if (value !== null) report(value);
    },
    { passive: false },
  );

  element.addEventListener("keydown", (e) => {
    const value = keyTempo(getValue(), e.key, e.shiftKey);
    if (value !== null) {
      e.preventDefault();
      report(value);
    } else if (e.key === "Home") {
      e.preventDefault();
      report(min);
    } else if (e.key === "End") {
      e.preventDefault();
      report(max);
    }
  });

  return { render };
}
