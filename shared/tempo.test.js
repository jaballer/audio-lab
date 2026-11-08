import { describe, expect, it } from "vitest";
import { BPM_MAX, BPM_MIN, clampBpm, createTapTempo, nearestStep, stepSeconds } from "./tempo.js";

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
