// The tempo knob's arithmetic: how far each kind of input moves the tempo. No DOM, so it can be tested.
// Every move lands on a whole BPM, except a Shift+drag, which is the way to a decimal.

export const DRAG_BPM_PER_PX = 0.5;
export const FINE_BPM_PER_PX = 0.1; // Shift while dragging: one tenth of a BPM per pixel, for an exact tempo
export const BIG_STEP = 10; // Shift on the wheel or arrow keys, and Page Up / Page Down: ten BPM at a time
export const SHIFT_WHEEL_GAP_MS = 100; // a trackpad flick sends a wheel event every frame; Shift makes each one ten BPM

// The tempo `pixelsUp` above where a drag began (negative: below).
export function dragTempo(startBpm, pixelsUp, fine) {
  return fine ? startBpm + pixelsUp * FINE_BPM_PER_PX : Math.round(startBpm + pixelsUp * DRAG_BPM_PER_PX);
}

// The tempo after one wheel event, or null if it should change nothing. Browsers turn Shift+wheel into a sideways
// scroll (deltaX), so both deltas are read. A Shift+wheel that follows another too soon is dropped, so one flick
// of a trackpad cannot slam the tempo from one end to the other.
export function wheelTempo(bpm, { deltaX = 0, deltaY = 0, shift = false, sinceLastMs = Infinity }) {
  const delta = deltaY || deltaX;
  if (delta === 0) return null;
  if (shift && sinceLastMs < SHIFT_WHEEL_GAP_MS) return null;
  return Math.round(bpm + (delta < 0 ? 1 : -1) * (shift ? BIG_STEP : 1));
}

const KEY_DIRECTION = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };

// The tempo after an arrow, Page Up or Page Down key, or null for any other key. A tapped 117.3 lands on a whole number.
export function keyTempo(bpm, key, shift) {
  if (key in KEY_DIRECTION) return Math.round(bpm + KEY_DIRECTION[key] * (shift ? BIG_STEP : 1));
  if (key === "PageUp") return Math.round(bpm + BIG_STEP);
  if (key === "PageDown") return Math.round(bpm - BIG_STEP);
  return null;
}
