import { describe, expect, it, vi } from "vitest";
import {
  CLIP_DB,
  FLOOR_DB,
  METER_SEGMENTS,
  SILENCE_DB,
  STEP_DB,
  cellStates,
  createLevelReader,
  createMeterChannel,
  levelsOf,
  litSegments,
  toDb,
} from "./level-meter.js";

// A block of samples that is the same everywhere: its loudness and its peak are both `amplitude`.
const block = (amplitude, length = 64) => new Float32Array(length).fill(amplitude);
const dbToAmplitude = (db) => 10 ** (db / 20);

describe("toDb", () => {
  it("reads full scale as 0 and each halving as about -6", () => {
    expect(toDb(1)).toBe(0);
    expect(toDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(toDb(0.1)).toBeCloseTo(-20, 5);
  });

  it("keeps silence finite, far below the floor", () => {
    expect(toDb(0)).toBe(SILENCE_DB);
    expect(toDb(1e-12)).toBe(SILENCE_DB);
    expect(SILENCE_DB).toBeLessThan(FLOOR_DB);
  });
});

describe("litSegments", () => {
  it("lights nothing at or below the floor, so silence leaves a bar empty", () => {
    expect(litSegments(SILENCE_DB)).toBe(0);
    expect(litSegments(FLOOR_DB)).toBe(0);
    expect(litSegments(NaN)).toBe(0);
  });

  it("lights segment i above FLOOR_DB + i * STEP_DB", () => {
    for (let i = 0; i < METER_SEGMENTS; i++) {
      const threshold = FLOOR_DB + i * STEP_DB;
      expect(litSegments(threshold + 0.01)).toBe(i + 1);
      if (i > 0) expect(litSegments(threshold - 0.01)).toBe(i);
    }
  });

  it("has -12, -24, -36 and -48 as exact edges of its segments", () => {
    expect(litSegments(-12.01)).toBe(9);
    expect(litSegments(-11.99)).toBe(10);
    expect(litSegments(-24.01)).toBe(6);
    expect(litSegments(-23.99)).toBe(7);
    expect(litSegments(-36.01)).toBe(3);
    expect(litSegments(-35.99)).toBe(4);
    expect(litSegments(-48.01)).toBe(0);
    expect(litSegments(-47.99)).toBe(1);
  });

  it("lights a segment only above its edge, the same at every edge, exactly on it included", () => {
    expect(litSegments(-48)).toBe(0);
    expect(litSegments(-44)).toBe(1);
    expect(litSegments(-40)).toBe(2);
    expect(litSegments(-12)).toBe(9);
    expect(litSegments(-8)).toBe(10);
  });

  it("stops at the top level segment: the clip lamp is a separate thing", () => {
    expect(litSegments(0)).toBe(METER_SEGMENTS);
    expect(litSegments(12)).toBe(METER_SEGMENTS);
    expect(litSegments(FLOOR_DB + (METER_SEGMENTS - 1) * STEP_DB + 0.01)).toBe(METER_SEGMENTS);
  });
});

describe("levelsOf", () => {
  it("gives the loudness (RMS) and the peak of a block", () => {
    expect(levelsOf(block(0.25))).toEqual({ rms: 0.25, peak: 0.25 });
    // a negative swing counts the same, and a lone spike raises the peak far more than the loudness
    const spike = new Float32Array(100);
    spike[10] = -0.8;
    const { rms, peak } = levelsOf(spike);
    expect(peak).toBeCloseTo(0.8, 6);
    expect(rms).toBeCloseTo(0.08, 6);
  });

  it("reads a sine as 3 dB below its peak", () => {
    const sine = Float32Array.from({ length: 1000 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * i) / 100));
    const { rms, peak } = levelsOf(sine);
    expect(toDb(peak) - toDb(rms)).toBeCloseTo(3.01, 1);
  });

  it("reads nothing as silence", () => {
    expect(levelsOf(new Float32Array(0))).toEqual({ rms: 0, peak: 0 });
    expect(levelsOf(undefined)).toEqual({ rms: 0, peak: 0 });
  });
});

describe("createMeterChannel", () => {
  it("is empty for silence", () => {
    const channel = createMeterChannel();
    expect(channel.update(block(0), 0)).toEqual({ level: 0, clip: false });
    expect(channel.update(block(0), 16)).toEqual({ level: 0, clip: false });
  });

  it("rises towards the loudness within a few frames", () => {
    const channel = createMeterChannel();
    channel.update(block(0), 0);
    let frame;
    for (let t = 16; t <= 400; t += 16) frame = channel.update(block(dbToAmplitude(-18)), t);
    expect(frame.level).toBe(litSegments(-18)); // 8: the segments whose edge is below -18 dB
  });

  it("lights its first segments on the first frames of a hit, not after a climb through levels nothing shows", () => {
    const channel = createMeterChannel();
    channel.update(block(0), 0);
    expect(channel.update(block(dbToAmplitude(-10)), 16).level).toBeGreaterThan(0);
  });

  it("rises faster than it falls", () => {
    const rise = createMeterChannel();
    rise.update(block(0), 0);
    const afterRise = rise.update(block(dbToAmplitude(-10)), 60).level; // one attack time constant

    const fall = createMeterChannel();
    fall.update(block(0), 0);
    for (let t = 16; t <= 800; t += 16) fall.update(block(dbToAmplitude(-10)), t);
    const settled = fall.update(block(dbToAmplitude(-10)), 816).level;
    const afterFall = fall.update(block(0), 816 + 60).level; // the same 60 ms, going down

    expect(settled).toBe(litSegments(-10));
    const rose = afterRise; // from an empty bar up
    const fell = settled - afterFall; // from where it settled down
    expect(rose).toBeGreaterThan(fell);
  });

  it("lets a tail die away to an empty bar", () => {
    const channel = createMeterChannel();
    channel.update(block(0), 0);
    for (let t = 16; t <= 400; t += 16) channel.update(block(dbToAmplitude(-6)), t);
    let frame;
    for (let t = 416; t <= 3000; t += 16) frame = channel.update(block(0), t);
    expect(frame.level).toBe(0);
  });

  it("lights the clip lamp for a peak within 0.5 dB of full scale, for half a second", () => {
    const channel = createMeterChannel();
    channel.update(block(0), 0);
    expect(channel.update(block(dbToAmplitude(CLIP_DB - 0.1)), 16).clip).toBe(false);
    expect(channel.update(block(dbToAmplitude(CLIP_DB + 0.01)), 32).clip).toBe(true);
    expect(channel.update(block(0), 400).clip).toBe(true);
    expect(channel.update(block(0), 600).clip).toBe(false);
  });

  it("does not light the clip lamp for a loud sine that stays under it", () => {
    const channel = createMeterChannel();
    channel.update(block(0), 0);
    const sine = Float32Array.from({ length: 1000 }, (_, i) => 0.9 * Math.sin((2 * Math.PI * i) / 100)); // peak -0.9 dB
    for (let t = 16; t <= 400; t += 16) expect(channel.update(sine, t).clip).toBe(false);
  });

  it("takes a long gap between frames (a hidden tab) as a jump to what is heard, not a slow climb", () => {
    const channel = createMeterChannel();
    channel.update(block(0), 0);
    const after = channel.update(block(dbToAmplitude(-10)), 60_000);
    expect(after.level).toBe(litSegments(-10));
  });

  it("treats a clock that went backwards as no time passing: the level does not move", () => {
    const channel = createMeterChannel();
    channel.update(block(0), 0);
    for (let t = 16; t <= 800; t += 16) channel.update(block(dbToAmplitude(-10)), t);
    const settled = channel.update(block(dbToAmplitude(-10)), 816).level;
    expect(settled).toBe(litSegments(-10));
    // an earlier time with silence: no time has passed, so nothing has fallen, and nothing has risen either
    expect(channel.update(block(0), 500).level).toBe(settled);
  });

  it("ignores a time that is not a number instead of losing the level for good", () => {
    const channel = createMeterChannel();
    channel.update(block(0), 0);
    for (let t = 16; t <= 800; t += 16) channel.update(block(dbToAmplitude(-10)), t);
    channel.update(block(dbToAmplitude(-10)), NaN);
    channel.update(block(dbToAmplitude(-10)), undefined);
    expect(channel.update(block(dbToAmplitude(-10)), 900).level).toBe(litSegments(-10));
  });

  it("lets a full bar fall in well under a second, but not in one frame", () => {
    const channel = createMeterChannel();
    channel.update(block(0), 0);
    for (let t = 16; t <= 800; t += 16) channel.update(block(dbToAmplitude(-3)), t);
    const t = 816;
    expect(channel.update(block(dbToAmplitude(-3)), t).level).toBe(METER_SEGMENTS);
    const next = channel.update(block(0), t + 16).level; // one frame of silence
    expect(next).toBeLessThan(METER_SEGMENTS);
    expect(next).toBeGreaterThan(METER_SEGMENTS / 2);
    let frame;
    for (let later = 32; later <= 250; later += 16) frame = channel.update(block(0), t + later);
    expect(frame.level).toBe(0); // empty within a quarter of a second
  });

  it("goes back to silence on reset, the clip lamp and the clock included", () => {
    const channel = createMeterChannel();
    channel.update(block(0), 0);
    for (let t = 16; t <= 400; t += 16) channel.update(block(1), t); // full scale: the lamp is lit
    expect(channel.update(block(1), 416).clip).toBe(true);
    channel.reset();
    expect(channel.update(block(0), 420)).toEqual({ level: 0, clip: false }); // 4 ms later: the lamp would still be lit
  });
});

describe("cellStates", () => {
  it("lights the segments up to the level, and the clip lamp last", () => {
    const cells = cellStates({ level: 3, clip: false });
    expect(cells).toHaveLength(METER_SEGMENTS + 1);
    expect(cells.slice(0, METER_SEGMENTS)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(cells[METER_SEGMENTS]).toBe(false);
  });

  it("lights every level segment at the top level, and not the clip lamp with them", () => {
    const cells = cellStates({ level: METER_SEGMENTS, clip: false });
    expect(cells.slice(0, METER_SEGMENTS).every(Boolean)).toBe(true);
    expect(cells[METER_SEGMENTS]).toBe(false);
  });

  it("lights the clip lamp on its own", () => {
    const cells = cellStates({ level: 0, clip: true });
    expect(cells.filter(Boolean)).toHaveLength(1);
    expect(cells[METER_SEGMENTS]).toBe(true);
  });

  it("is dark for silence", () => {
    expect(cellStates({ level: 0, clip: false }).some(Boolean)).toBe(false);
  });
});

describe("createLevelReader", () => {
  const analyser = (amplitude) => ({
    fftSize: 128,
    getFloatTimeDomainData: vi.fn((buffer) => buffer.fill(amplitude)),
  });

  it("reads a bar for each analyser, each from its own signal", () => {
    const reader = createLevelReader([analyser(dbToAmplitude(-10)), analyser(0)]);
    reader.read(0);
    const [left, right] = reader.read(500);
    expect(reader.count).toBe(2);
    expect(left.level).toBeGreaterThan(0);
    expect(right).toEqual({ level: 0, clip: false });
  });

  it("reuses its buffers instead of making new ones every frame", () => {
    const left = analyser(0.1);
    const reader = createLevelReader([left]);
    reader.read(0);
    reader.read(16);
    const [first, second] = left.getFloatTimeDomainData.mock.calls.map(([buffer]) => buffer);
    expect(first).toBe(second);
    expect(first).toHaveLength(128);
  });

  it("has no bars when there are no analysers", () => {
    for (const none of [null, undefined, []]) {
      const reader = createLevelReader(none);
      expect(reader.count).toBe(0);
      expect(reader.read(0)).toEqual([]);
    }
  });

  it("goes back to silence on reset", () => {
    let amplitude = 1;
    const source = { fftSize: 128, getFloatTimeDomainData: (buffer) => buffer.fill(amplitude) };
    const reader = createLevelReader([source]);
    reader.read(0);
    for (let t = 16; t <= 400; t += 16) reader.read(t);
    expect(reader.read(416)[0]).toMatchObject({ clip: true });
    expect(reader.read(432)[0].level).toBeGreaterThan(0);
    reader.reset();
    amplitude = 0;
    expect(reader.read(440)[0]).toEqual({ level: 0, clip: false });
  });
});
