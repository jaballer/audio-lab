// Tempo maths for the sequencer: no DOM, no timers, no audio.

export const BPM_MIN = 40;
export const BPM_MAX = 240;

// Keep a tempo in range, to one decimal place. The range is the sampler's unless a page passes
// its own: the MPC Sample runs from 30 to 300.
export const clampBpm = (value, { min = BPM_MIN, max = BPM_MAX } = {}) =>
  Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;

// Seconds in one step. The sequencer's steps are 16th notes, four to a beat.
export const stepSeconds = (bpm) => 60 / bpm / 4;

// Live recording: which step a pad hit belongs to. The playhead sits on
// `playheadStep` (which began at `playheadTime`); a hit in the second half of
// that step belongs to the next one. -1 means no step has played yet.
export function nearestStep({ now, playheadTime, playheadStep, bpm, steps }) {
  const sincePlayhead = now - playheadTime;
  return sincePlayhead > stepSeconds(bpm) / 2 ? (playheadStep + 1) % steps : playheadStep;
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
