import { describe, expect, it } from "vitest";
import {
  BPM_MAX,
  BPM_MIN,
  SWING_DEFAULT,
  SWING_MAX,
  SWING_MIN,
  clampBpm,
  clampSwing,
  createTapTempo,
  nearestStep,
  stepSeconds,
  swingDelay,
} from "./tempo.js";

describe("clampBpm", () => {
  it("keeps the tempo within the knob's range", () => {
    expect(clampBpm(0)).toBe(BPM_MIN);
    expect(clampBpm(1000)).toBe(BPM_MAX);
    expect(clampBpm(100)).toBe(100);
  });

  it("takes another page's range", () => {
    const range = { min: 30, max: 300 };
    expect(clampBpm(35, range)).toBe(35);
    expect(clampBpm(250, range)).toBe(250);
    expect(clampBpm(10, range)).toBe(30);
    expect(clampBpm(999, range)).toBe(300);
  });

  it("rounds to one decimal place", () => {
    expect(clampBpm(120.04)).toBe(120);
    expect(clampBpm(120.06)).toBe(120.1);
    expect(clampBpm(99.949)).toBe(99.9);
  });
});

describe("stepSeconds", () => {
  it("is a 16th note: a quarter of a beat", () => {
    expect(stepSeconds(120)).toBeCloseTo(0.125);
    expect(stepSeconds(100)).toBeCloseTo(0.15);
  });
});

describe("nearestStep", () => {
  // At 120 BPM a step lasts 0.125 s, so the halfway point is 0.0625 s.
  const at = (now, playheadStep = 3) => nearestStep({ now, playheadTime: 10, playheadStep, bpm: 120, steps: 16 });

  it("keeps a hit in the first half of a step on that step", () => {
    expect(at(10)).toBe(3);
    expect(at(10.06)).toBe(3);
    expect(at(10.0625)).toBe(3); // exactly halfway rounds back
  });

  it("moves a hit in the second half to the next step", () => {
    expect(at(10.07)).toBe(4);
    expect(at(10.12)).toBe(4);
  });

  it("wraps from the last step to the first", () => {
    expect(at(10.1, 15)).toBe(0);
  });

  it("returns -1 before any step has played, unless the hit is late enough to round up", () => {
    expect(at(10.01, -1)).toBe(-1);
    expect(at(10.1, -1)).toBe(0);
  });
});

describe("createTapTempo", () => {
  it("needs two taps before it knows a tempo", () => {
    const taps = createTapTempo();
    expect(taps.tap(1000)).toBeNull();
    expect(taps.tap(1500)).toBeCloseTo(120);
  });

  it("averages the intervals", () => {
    const taps = createTapTempo();
    taps.tap(0);
    taps.tap(500);
    expect(taps.tap(1100)).toBeCloseTo(60000 / 550);
  });

  it("starts over after a pause longer than two seconds", () => {
    const taps = createTapTempo();
    taps.tap(0);
    taps.tap(500);
    expect(taps.tap(2600)).toBeNull();
    expect(taps.tap(3100)).toBeCloseTo(120);
  });

  it("does not reset on a gap of exactly two seconds", () => {
    const taps = createTapTempo();
    taps.tap(0);
    expect(taps.tap(2000)).toBeCloseTo(30);
  });

  it("only averages the last five taps", () => {
    const taps = createTapTempo();
    [0, 1000, 1500, 2000, 2500].forEach((t) => taps.tap(t));
    // Six taps: the first (at 0) drops out, leaving 1000, 1500, 2000, 2500, 3000.
    expect(taps.tap(3000)).toBeCloseTo(120);
  });
});

describe("clampSwing", () => {
  it("keeps swing to whole numbers inside the range", () => {
    expect(clampSwing(40)).toBe(SWING_MIN);
    expect(clampSwing(90)).toBe(SWING_MAX);
    expect(clampSwing(58.4)).toBe(58);
    expect(clampSwing(58.6)).toBe(59);
  });

  it("reads anything that is not a number as straight", () => {
    for (const bad of [undefined, null, NaN, "58", Infinity]) expect(clampSwing(bad)).toBe(SWING_DEFAULT);
  });
});

describe("swingDelay", () => {
  // 120 BPM: a step is 0.125 s.
  it("is nothing at 50, however the steps are numbered", () => {
    for (const step of [0, 1, 2, 3, 15]) expect(swingDelay(step, 120, 50)).toBe(0);
  });

  it("only moves the second step of each pair, which sounds a share of a step later", () => {
    expect(swingDelay(0, 120, 66)).toBe(0);
    expect(swingDelay(2, 120, 66)).toBe(0);
    // 66 per cent: the pair is 0.25 s and its second step starts 0.165 s in, 0.04 s after the grid.
    expect(swingDelay(1, 120, 66)).toBeCloseTo(0.04);
    expect(swingDelay(15, 120, 66)).toBeCloseTo(0.04);
  });

  it("is a triplet feel near 67 and half a step at the top of the range", () => {
    expect(swingDelay(1, 120, 67)).toBeCloseTo(0.125 / 3, 2);
    expect(swingDelay(1, 120, SWING_MAX)).toBeCloseTo(0.0625);
  });

  it("scales with the tempo, and keeps a pair the length of two steps", () => {
    expect(swingDelay(1, 60, 60)).toBeCloseTo(2 * swingDelay(1, 120, 60));
    // The second step ends where the next pair begins, so the pair as a whole is as long as it was.
    expect(2 * stepSeconds(120) - (stepSeconds(120) + swingDelay(1, 120, 70))).toBeGreaterThan(0);
  });

  it("is kept inside the range, so a wild value cannot push a step past the next", () => {
    expect(swingDelay(1, 120, 500)).toBe(swingDelay(1, 120, SWING_MAX));
    expect(swingDelay(1, 120, -5)).toBe(0);
  });
});
