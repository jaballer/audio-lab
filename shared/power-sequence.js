// What the device's screen and pads do when power comes on or goes off: a short boot, and the same run backwards.
// It only tracks which phase the machine is in; the views draw it (the LCD's boot text, the pads' sweep of light).
//
//   off -> booting -> on -> shutdown -> off
//
// `powered` is the page's one answer to "is the device on" (audio running), so the screen, the pads and the
// POWER switch's lamp cannot disagree. Pressing again in the middle of a boot or shutdown turns around from where
// it is, so the machine never waits for an animation to finish before it obeys.

export const BOOT_MS = 1100; // long enough to read the boot lines and watch the pads sweep, short enough not to wait on
export const SHUTDOWN_MS = 600;
export const SWEEP_STAGGER_MS = 55; // between one diagonal of pads and the next

// How far a pad is along the sweep, which runs from pad 1 (bottom-left) to the top-right corner. Pads on the same
// diagonal light together. `row` 0 is the top row, as in layout.js.
export function sweepStep(row, col, rows) {
  return col + (rows - 1 - row);
}

// The phase after power is switched to `powered`, or the same one when it already matches.
export function phaseFor(phase, powered) {
  if (powered) return phase === "off" || phase === "shutdown" ? "booting" : phase;
  return phase === "on" || phase === "booting" ? "shutdown" : phase;
}

// `onPhase(phase)` is told every change, and `phase` is readable. A phase that is a transition ends by itself.
export function createPowerSequence({ onPhase, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let phase = "off";
  let timer = null;

  function enter(next) {
    clearTimer(timer);
    timer = null;
    phase = next;
    onPhase(next);
    if (next === "booting") timer = setTimer(() => enter("on"), BOOT_MS);
    if (next === "shutdown") timer = setTimer(() => enter("off"), SHUTDOWN_MS);
  }

  return {
    get phase() {
      return phase;
    },
    set(powered) {
      const next = phaseFor(phase, powered);
      if (next !== phase) enter(next);
    },
  };
}
