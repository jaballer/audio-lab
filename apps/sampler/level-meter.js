// The maths behind the level meter on the display: how loud each side of the output is, as segments that light. No DOM.
//
//   const reader = createLevelReader(audio.channelAnalysers);   // [left, right] AnalyserNodes, or anything that has getFloatTimeDomainData
//   const frames = reader.read(performance.now());              // [{ level, clip }, { level, clip }], once a frame
//   cellStates(frames[0])                                       // [bool, ...]: which cells of one bar are lit, bottom first, the clip lamp last
//   reader.reset()                                              // back to silence (the sound stopped being heard)
//
// What the bars show is the loudness (RMS) of what is heard, after the clipper, in dB below digital full scale (dBFS), with a
// clip lamp on top. There is no held peak marker: with drums a hit tops it up before it can fall, so it would only sit near
// the top. It is a level meter, not a calibrated VU meter. There are no numbers on
// the display, but the segments are exact: segment `i` (0 at the bottom) lights when the loudness is above
// FLOOR_DB + i * STEP_DB, so the lowest turns on above -48 dB and the top level segment above -8 dB. The clip lamp is the peak:
// it lights when a sample comes within 0.5 dB of full scale, which is the clipper working at its ceiling (see CLIP in
// shared/audio.js), and stays lit for CLIP_MS.
//
// The loudness rises quickly and falls slowly, in dB, so a hit reads clearly and a tail dies away: it moves towards the
// level heard with a 60 ms time constant going up and 300 ms going down, and silence is far below the floor (SILENCE_DB), so
// a full bar empties in about 150 ms, not 300. It rests at the floor (a bar that is empty), so a hit lights its first
// segment on the first frame and does not first climb through levels no segment shows.

export const METER_SEGMENTS = 11; // level segments in a bar: the clip lamp is one more, on top
export const FLOOR_DB = -48; // nothing lights at or below this
export const STEP_DB = 4; // loudness a segment covers
export const CLIP_DB = -0.5; // a peak this close to full scale lights the clip lamp
export const SILENCE_DB = -120; // what no signal reads as: far below the floor, so a tail dies away at once

const ATTACK_MS = 60; // time constant of the loudness going up
const RELEASE_MS = 300; // and coming down
const CLIP_MS = 500; // the clip lamp stays lit this long

// dB below full scale of an amplitude (1 is full scale), with silence kept finite.
export function toDb(amplitude) {
  return amplitude > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(amplitude)) : SILENCE_DB;
}

// How many level segments a loudness (dBFS) lights, 0 to METER_SEGMENTS: segment i is lit above FLOOR_DB + i * STEP_DB, and a
// loudness exactly on an edge does not light the segment above it. Nothing at or below the floor, so a silent bar is empty.
export function litSegments(db) {
  if (!(db > FLOOR_DB)) return 0;
  return Math.min(METER_SEGMENTS, Math.ceil((db - FLOOR_DB) / STEP_DB));
}

// The loudness and the peak of a block of samples, as amplitudes (1 is full scale).
export function levelsOf(samples) {
  if (!samples?.length) return { rms: 0, peak: 0 };
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    sum += value * value;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }
  return { rms: Math.sqrt(sum / samples.length), peak };
}

// One bar's state between frames. `update(samples, timeMs)` takes the latest block of samples and the time of the frame
// (milliseconds, any origin), and gives { level, clip }: how many level segments are lit, and whether the clip lamp is lit.
export function createMeterChannel() {
  let loudness = FLOOR_DB;
  let clipUntil = -Infinity;
  let last = null;

  return {
    update(samples, timeMs) {
      // The first frame, a time that is not a number, or one that went backwards: no time has passed. After a long gap (a
      // hidden tab) a lot has, so the loudness jumps to what is heard. A time that is not a number must not be kept: the
      // loudness would be NaN for good.
      if (!Number.isFinite(timeMs)) timeMs = last ?? 0;
      const elapsed = last === null ? 0 : Math.max(0, timeMs - last);
      last = timeMs;
      const { rms, peak } = levelsOf(samples);
      const rmsDb = toDb(rms);
      const peakDb = toDb(peak);

      const tau = rmsDb > loudness ? ATTACK_MS : RELEASE_MS;
      loudness = Math.max(FLOOR_DB, loudness + (rmsDb - loudness) * (1 - Math.exp(-elapsed / tau)));

      if (peakDb >= CLIP_DB) clipUntil = timeMs + CLIP_MS;

      return { level: litSegments(loudness), clip: timeMs < clipUntil };
    },
    reset() {
      loudness = FLOOR_DB;
      clipUntil = -Infinity;
      last = null;
    },
  };
}

// Which cells of one bar are lit, bottom first: the level segments up to the loudness, then the clip lamp.
export function cellStates({ level, clip }, segments = METER_SEGMENTS) {
  const cells = Array.from({ length: segments }, (_, i) => i < level);
  cells.push(Boolean(clip));
  return cells;
}

// Reads a bar for each analyser. Each analyser's buffer is made once and reused, since a new one every frame is garbage
// sixty times a second. An analyser can be missing (a context that cannot make one): the reader then has no bars.
export function createLevelReader(analysers) {
  const list = analysers ?? [];
  const buffers = list.map((analyser) => new Float32Array(analyser.fftSize));
  const channels = list.map(() => createMeterChannel());

  return {
    count: list.length,
    read(timeMs) {
      return list.map((analyser, i) => {
        analyser.getFloatTimeDomainData(buffers[i]);
        return channels[i].update(buffers[i], timeMs);
      });
    },
    reset() {
      for (const channel of channels) channel.reset();
    },
  };
}
