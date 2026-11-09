// The shape of a pad's amplitude envelope (attack, decay, sustain, release) as the breakpoints a gain is ramped
// through. Pure: no DOM, no Web Audio. A sample plays once with nothing to say when it ends (no note off), so the
// envelope is laid over the time the sample is heard for:
//
//   attack   from silence up to full over this long, from the start
//   decay    then down to the sustain level over this long
//   sustain  that level (0 to 1), held until the release
//   release  the last this-much of the sample fades to silence at its end (and a pad hit again, or cut by its choke
//            group, fades out over this long: voices.js)
//
//   envelopeShape({ attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 }, 2)
//     // [[0, 0], [0.01, 1], [0.21, 0.5], [1.7, 0.5], [2, 0]]: [seconds, level], to be linear-ramped through
//
// A stage that is not set takes no time: no attack starts at full, no release leaves the end as it is, a sustain of 1
// leaves nothing to decay to. Stages that run into each other are cut where the next begins (a release that starts
// before the decay has finished cuts the decay short, from the level it had reached), except that the release never
// begins before the attack has reached full, so a release as long as the sample still plays it, rising and falling.
// An attack as long as the sample or longer, with a release, shares the sample's time with it in proportion.

import { trimWindow } from "./trim.js";

const MIN_DECAY = 0.001; // a decay of 0 with a sustain below 1 is a step down, which is a click; this is a fast ramp

// Does this envelope change nothing: no attack, no release, and nothing to decay to?
export const isFlat = ({ attack = 0, sustain = 1, release = 0 }) => attack <= 0 && release <= 0 && sustain >= 1;

// The level of a piecewise-linear shape at `time`.
function levelAt(points, time) {
  for (let i = 1; i < points.length; i++) {
    const [t0, v0] = points[i - 1];
    const [t1, v1] = points[i];
    if (time <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (time - t0)) / (t1 - t0);
  }
  return points.at(-1)[1];
}

export function envelopeShape({ attack = 0, decay = 0, sustain = 1, release = 0 }, length) {
  // An attack that does not fit in the sample, with a release to make as well: there is no time for both, so they share
  // it in proportion (a rise to full, then a fall to silence at the end), rather than the release leaving no attack.
  if (release > 0 && length > 0 && attack >= length) {
    return [
      [0, 0],
      [(length * attack) / (attack + release), 1],
      [length, 0],
    ];
  }
  const points = [[0, attack > 0 ? 0 : 1]];
  if (attack > 0) points.push([attack, 1]);
  if (sustain < 1) points.push([attack + Math.max(decay, MIN_DECAY), sustain]);
  points.push([Infinity, points.at(-1)[1]]); // the sustain level, held to wherever the shape is cut

  // The release starts `release` before the end, but not before the attack has reached its peak (when the sample is
  // long enough for that): otherwise a release as long as the sample would cut the attack at silence and play nothing.
  const peakAt = attack > 0 && attack < length ? attack : 0;
  const cutAt = release > 0 ? Math.max(length - release, peakAt) : length;
  const shape = [];
  for (const [time, level] of points) {
    if (time >= cutAt) break;
    shape.push([time, level]);
  }
  shape.push([cutAt, levelAt(points, cutAt)]);
  if (release > 0) shape.push([length, 0]);
  // A point at the same time as the one before it replaces it (a ramp cannot be given two values at one moment).
  return shape.filter((point, i) => i === shape.length - 1 || point[0] !== shape[i + 1][0]);
}

// The envelope as a curve over the sample's waveform, for drawing: [[x, level], ...] where x is a fraction (0 to 1) of
// the whole sample, so it lines up with the waveform whatever the trim and the pitch are. The envelope runs over the
// trimmed part, and the time it is heard for is shorter or longer than that by the playback rate, so a point `t`
// seconds into the hit is `t * rate` seconds into the sample.
//
//   envelopeCurve(envelope, { trim: { start: 0.25, end: 0.75 }, duration: 4, rate: 1 })   // from x = 0.25 to x = 0.75
export function envelopeCurve(envelope, { trim, duration, rate = 1 }) {
  const { offset, length } = trimWindow(trim, duration);
  return envelopeShape(envelope, length / rate).map(([time, level]) => [(offset + time * rate) / duration, level]);
}

// The level of a curve at `x`, by interpolation; 1 (untouched) outside the part the curve covers.
export function curveLevelAt(curve, x) {
  if (!curve.length || x < curve[0][0] || x > curve.at(-1)[0]) return 1;
  for (let i = 1; i < curve.length; i++) {
    const [x1, level1] = curve[i];
    if (x <= x1) {
      const [x0, level0] = curve[i - 1];
      return x1 === x0 ? level1 : level0 + ((level1 - level0) * (x - x0)) / (x1 - x0);
    }
  }
  return curve.at(-1)[1];
}
