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

describe("nearestStep with swing", () => {
  // 120 BPM, 66 per cent: step 0 sounds at 10, step 1 at 10.165 (0.04 after its place on the grid), step 2 at 10.25.
  const swung = (now, playheadStep, playheadTime) =>
    nearestStep({ now, playheadTime, playheadStep, bpm: 120, steps: 16, swing: 66 });

  it("splits an even step from the next at the middle of the time between them as they sound", () => {
    expect(swung(10.08, 0, 10)).toBe(0); // nearer the step that sounded at 10 than the one at 10.165
    expect(swung(10.09, 0, 10)).toBe(1);
  });

  it("splits an odd step from the next at the middle of the shorter time between them", () => {
    expect(swung(10.2, 1, 10.165)).toBe(1); // 10.2 is nearer 10.165 than 10.25
    expect(swung(10.21, 1, 10.165)).toBe(2);
  });

  it("splits against the delay the playhead's step was given, not the swing it has now", () => {
    // Step 1 was queued at 75 per cent (0.0625 s late, so on the grid at 10.1) and the knob has gone to 50 since.
    const args = { playheadTime: 10.1625, playheadStep: 1, bpm: 120, steps: 16, swing: 50 };
    // Step 2 is at 10.225: the middle is 10.19375. With the swing it has now the step would be taken to be on the grid.
    expect(nearestStep({ ...args, now: 10.19, playheadDelay: 0.0625 })).toBe(1);
    expect(nearestStep({ ...args, now: 10.2, playheadDelay: 0.0625 })).toBe(2);
    expect(nearestStep({ ...args, now: 10.2 })).toBe(1); // what the swing now would say, which is wrong for this step
  });

  it("is what it was when the swing is straight, or not given", () => {
    const straight = { now: 10.07, playheadTime: 10, playheadStep: 3, bpm: 120, steps: 16 };
    expect(nearestStep(straight)).toBe(4);
    expect(nearestStep({ ...straight, swing: 50 })).toBe(4);
  });

  it("wraps from the last step to the first", () => {
    expect(nearestStep({ now: 10.12, playheadTime: 10, playheadStep: 15, bpm: 120, steps: 16, swing: 66 })).toBe(0);
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

  it("scales with the tempo", () => {
    expect(swingDelay(1, 60, 60)).toBeCloseTo(2 * swingDelay(1, 120, 60));
  });

  it("never moves the second step of a pair as far as the next pair, at any swing", () => {
    for (let swing = SWING_MIN; swing <= SWING_MAX; swing++) {
      expect(swingDelay(1, 120, swing)).toBeLessThan(stepSeconds(120));
    }
  });

  it("is kept inside the range, so a wild value cannot push a step past the next", () => {
    expect(swingDelay(1, 120, 500)).toBe(swingDelay(1, 120, SWING_MAX));
    expect(swingDelay(1, 120, -5)).toBe(0);
  });
});
