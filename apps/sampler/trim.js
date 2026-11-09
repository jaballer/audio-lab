// Which part of a loaded sample plays: a start and an end, each a fraction of its length (0 is the start of the
// file, 1 the end). No DOM. Fractions, not seconds, so they mean the same whatever rate the file was decoded at.
//
//   FULL_TRIM                              // { start: 0, end: 1 }: all of it
//   clampTrim({ start, end }, duration, "end")   // a trim that is possible: inside 0-1, at least MIN_TRIM_SECONDS long
//   trimWindow(trim, duration)             // { offset, length } in seconds, for source.start(when, offset, length)
//   parseTrim(stored)                      // what was saved, or FULL_TRIM when it is not usable
//   isFullTrim(trim)
//   nearestHandle(trim, 0.3)               // "start" or "end": which one a press at this place would move
//
// `moved` is the handle a person is dragging ("start" or "end"): it is the one held back when the two would
// meet, so the other one stays where it is.

export const MIN_TRIM_SECONDS = 0.005; // shorter than this is a click, not a sound
const PRECISION = 10000; // a hundredth of a percent: 1 ms in 10 s

export const FULL_TRIM = Object.freeze({ start: 0, end: 1 });

export const isFullTrim = (trim) => trim.start === 0 && trim.end === 1;

const round = (value) => Math.round(value * PRECISION) / PRECISION;
const unit = (value, fallback) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback);

export function clampTrim(trim, duration, moved) {
  let start = unit(trim?.start, 0);
  let end = unit(trim?.end, 1);
  // The shortest window, as a fraction of this sample. A sample shorter than that has nothing to trim.
  const gap = duration > 0 ? MIN_TRIM_SECONDS / duration : 1;
  if (gap >= 1) return FULL_TRIM;
  if (end - start < gap) {
    if (moved === "start") start = Math.max(0, end - gap);
    else end = Math.min(1, start + gap);
    // Pushed against an edge: the other one gives way, so the window is still at least `gap` long.
    if (end - start < gap) {
      if (moved === "start") end = start + gap;
      else start = end - gap;
    }
  }
  return { start: round(start), end: round(end) };
}

// Offset and length in seconds of the part that plays.
export function trimWindow(trim, duration) {
  return { offset: trim.start * duration, length: (trim.end - trim.start) * duration };
}

// A saved trim, or all of the sample when what was saved is not one: not an object, not numbers, outside 0-1,
// or with no length (end not after start).
export function parseTrim(stored) {
  if (typeof stored !== "object" || stored === null) return FULL_TRIM;
  const { start, end } = stored;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end <= start) return FULL_TRIM;
  return { start: round(start), end: round(end) };
}

// Which handle a press at `fraction` of the way along the sample would move: the nearer one, and when the window
// is narrow and the press is inside it, the nearer to the press (so both can be reached).
export function nearestHandle(trim, fraction) {
  return Math.abs(fraction - trim.start) <= Math.abs(fraction - trim.end) ? "start" : "end";
}
