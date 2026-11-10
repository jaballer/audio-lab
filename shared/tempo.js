// Tempo maths for the sequencer: no DOM, no timers, no audio.

export const BPM_MIN = 40;
export const BPM_MAX = 240;

// Keep a tempo in range, to one decimal place. The range is the sampler's unless a page passes
// its own: the MPC Sample runs from 30 to 300.
export const clampBpm = (value, { min = BPM_MIN, max = BPM_MAX } = {}) =>
  Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;

// Seconds in one step. The sequencer's steps are 16th notes, four to a beat.
export const stepSeconds = (bpm) => 60 / bpm / 4;

// Swing: how much of each pair of steps (an on-beat 16th and the one after it) the first takes, in per cent. 50 is
// straight; 66 is a triplet feel; past 75 the second step would crowd the next pair. Only the second step of a pair
// moves, later: the pair as a whole, and so the loop, keeps its length.
export const SWING_MIN = 50;
export const SWING_MAX = 75;
export const SWING_DEFAULT = SWING_MIN;

// A whole number inside the range. Anything that is not a number is straight.
export const clampSwing = (value) =>
  Number.isFinite(value) ? Math.min(SWING_MAX, Math.max(SWING_MIN, Math.round(value))) : SWING_DEFAULT;

// How many seconds later than the grid a step sounds: nothing for the first of a pair (the even steps), and for the
// second a share of a step that grows with the swing (0 at 50, a third of a step at 66.7). `step` counts from the
// start of the sequence, which is always a whole number of bars, so the pairs line up wherever it wraps.
export const swingDelay = (step, bpm, swing) => (step % 2 === 1 ? stepSeconds(bpm) * (clampSwing(swing) / 50 - 1) : 0);

// Live recording: which step a pad hit belongs to. The playhead sits on
// `playheadStep` (which began at `playheadTime`); a hit after the halfway point between that step and the next one
// (as they sound, with swing: the steps of a pair are not the same length) belongs to the next one. -1 means no step
// has played yet. `playheadDelay` is how much later than the grid the playhead's step was set to sound, when it is known
// (the scheduler keeps it): the swing may have changed since that step was queued, and `swing` is only what the next step
// is given.
export function nearestStep({
  now,
  playheadTime,
  playheadStep,
  bpm,
  steps,
  swing = SWING_DEFAULT,
  playheadDelay = swingDelay(playheadStep, bpm, swing),
}) {
  const next = (playheadStep + 1) % steps;
  const gridTime = playheadTime - playheadDelay;
  const nextTime = gridTime + stepSeconds(bpm) + swingDelay(next, bpm, swing);
  return now - playheadTime > (nextTime - playheadTime) / 2 ? next : playheadStep;
}

// Tap tempo: average the last few intervals, and start over after a pause.
//
//   const taps = createTapTempo();
//   taps.tap(performance.now())   // null on the first tap, then the tempo in BPM (unclamped)
export function createTapTempo({ resetMs = 2000, keep = 5 } = {}) {
  let taps = [];
  return {
    tap(now) {
      if (taps.length && now - taps[taps.length - 1] > resetMs) taps = [];
      taps.push(now);
      taps = taps.slice(-keep);
      if (taps.length < 2) return null;
      const average = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      return 60000 / average;
    },
  };
}
