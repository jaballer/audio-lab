import { describe, expect, it } from "vitest";
import { curveLevelAt, envelopeCurve, envelopeShape, isFlat } from "./pad-envelope.js";

const close = (shape) => shape.map(([t, v]) => [Number(t.toFixed(6)), Number(v.toFixed(6))]);

describe("isFlat", () => {
  it("is an envelope that changes nothing: no attack, no release, nothing to decay to", () => {
    expect(isFlat({})).toBe(true);
    expect(isFlat({ attack: 0, decay: 0.5, sustain: 1, release: 0 })).toBe(true); // a decay to the level it is at
    expect(isFlat({ attack: 0.01 })).toBe(false);
    expect(isFlat({ release: 0.01 })).toBe(false);
    expect(isFlat({ sustain: 0.99 })).toBe(false);
  });
});

describe("envelopeShape", () => {
  it("goes up in the attack, down in the decay to the sustain, holds, and falls in the release", () => {
    const shape = envelopeShape({ attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 }, 2);
    expect(close(shape)).toEqual([
      [0, 0],
      [0.01, 1],
      [0.21, 0.5],
      [1.7, 0.5],
      [2, 0],
    ]);
  });

  it("starts at full when there is no attack, and stays there with nothing to decay to and no release", () => {
    expect(envelopeShape({ attack: 0, decay: 0, sustain: 1, release: 0 }, 2)).toEqual([
      [0, 1],
      [2, 1],
    ]);
  });

  it("does only the attack when only that is set", () => {
    expect(envelopeShape({ attack: 0.5 }, 2)).toEqual([
      [0, 0],
      [0.5, 1],
      [2, 1],
    ]);
  });

  it("does only the release when only that is set: full until the last of it, then down to silence at the end", () => {
    expect(envelopeShape({ release: 0.5 }, 2)).toEqual([
      [0, 1],
      [1.5, 1],
      [2, 0],
    ]);
  });

  it("steps down to a sustain with no decay as a very fast ramp, not a jump", () => {
    const shape = envelopeShape({ sustain: 0.5 }, 2);
    expect(shape[0]).toEqual([0, 1]);
    expect(shape[1][1]).toBe(0.5);
    expect(shape[1][0]).toBeGreaterThan(0);
    expect(shape[1][0]).toBeLessThan(0.005);
    expect(shape.at(-1)).toEqual([2, 0.5]);
  });

  it("cuts the decay short where the release begins, from the level it had reached", () => {
    // the attack is 0.2 s and the decay 1 s down to 0.2; the release starts at 1.5 s (2 - 0.5), in the middle of the decay,
    // a third of the way down from 1 to 0.2 (it has fallen 0.8 * 0.3 / 1 of the way)... which is the level at 1.5 s
    const shape = envelopeShape({ attack: 1, decay: 1, sustain: 0.2, release: 0.5 }, 2);
    expect(close(shape)).toEqual([
      [0, 0],
      [1, 1],
      [1.5, 0.6],
      [2, 0],
    ]);
  });

  it("does not begin the release before the attack has reached full, when the sample is long enough for that", () => {
    // a release of 1.5 s on 2 s would start at 0.5 s, in the middle of the 1 s attack: it starts at the peak instead
    expect(close(envelopeShape({ attack: 1, decay: 1, sustain: 0.2, release: 1.5 }, 2))).toEqual([
      [0, 0],
      [1, 1],
      [2, 0],
    ]);
  });

  it("plays a sample as long as its release (or shorter) as a rise to full and a fall to silence, not as silence", () => {
    const shape = envelopeShape({ attack: 0.1, release: 1 }, 0.5);
    expect(close(shape)).toEqual([
      [0, 0],
      [0.1, 1],
      [0.5, 0],
    ]);
    expect(Math.max(...shape.map(([, level]) => level))).toBe(1);
  });

  it("ends a sample too short for its attack part-way up, without a release to finish it", () => {
    const shape = envelopeShape({ attack: 3 }, 2);
    expect(close(shape)).toEqual([
      [0, 0],
      [2, 0.666667],
    ]);
  });

  it("still fades out at the end when the attack is longer than the sample, from where the attack had got to", () => {
    // the attack would take 3 s on a 2 s sample: a release of 0.5 s starts at 1.5 s, when it is half way up
    expect(close(envelopeShape({ attack: 3, release: 0.5 }, 2))).toEqual([
      [0, 0],
      [1.5, 0.5],
      [2, 0],
    ]);
  });

  it("fades the whole sample out when the release is longer than it", () => {
    expect(envelopeShape({ release: 5 }, 2)).toEqual([
      [0, 1],
      [2, 0],
    ]);
  });

  it("never gives two points at the same time, which a ramp could not be given", () => {
    for (const envelope of [
      { attack: 0.5, release: 1.5 },
      { attack: 0, decay: 0, sustain: 0, release: 2 },
      { attack: 1, decay: 0, sustain: 0.5, release: 1 },
    ]) {
      const times = envelopeShape(envelope, 2).map(([t]) => t);
      expect(new Set(times).size).toBe(times.length);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });

  it("keeps every level between 0 and 1, and ends no later than the sample", () => {
    const shape = envelopeShape({ attack: 0.3, decay: 0.4, sustain: 0.25, release: 0.6 }, 1.5);
    for (const [time, level] of shape) {
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
      expect(time).toBeLessThanOrEqual(1.5);
    }
    expect(shape.at(-1)[0]).toBe(1.5);
  });
});

describe("envelopeCurve", () => {
  const envelope = { attack: 0.5, decay: 0, sustain: 1, release: 0.5 };

  it("is the shape laid over the sample, as fractions of it: the whole sample from 0 to 1", () => {
    expect(close(envelopeCurve(envelope, { trim: { start: 0, end: 1 }, duration: 4 }))).toEqual([
      [0, 0],
      [0.125, 1], // the attack, 0.5 s of 4 s
      [0.875, 1], // the release begins 0.5 s before the end
      [1, 0],
    ]);
  });

  it("covers only the trimmed part, from where it starts to where it ends", () => {
    const curve = envelopeCurve(envelope, { trim: { start: 0.25, end: 0.75 }, duration: 4 }); // 2 s of it
    expect(close(curve)).toEqual([
      [0.25, 0],
      [0.375, 1],
      [0.625, 1],
      [0.75, 0],
    ]);
  });

  it("is laid over the sample's own time when the pitch changes how long it is heard: the same end, a shorter attack in it", () => {
    // an octave up: the 4 s sample is heard for 2 s, the attack's 0.5 s is 1 s of the sample, the release 1 s of it
    const curve = envelopeCurve(envelope, { trim: { start: 0, end: 1 }, duration: 4, rate: 2 });
    expect(close(curve)).toEqual([
      [0, 0],
      [0.25, 1],
      [0.75, 1],
      [1, 0],
    ]);
    expect(curve[0][0]).toBe(0);
    expect(curve.at(-1)[0]).toBe(1);
  });

  it("starts and ends where the trim does, whatever the rate", () => {
    for (const rate of [0.5, 1, 2]) {
      const curve = envelopeCurve(envelope, { trim: { start: 0.2, end: 0.6 }, duration: 5, rate });
      expect(curve[0][0]).toBeCloseTo(0.2);
      expect(curve.at(-1)[0]).toBeCloseTo(0.6);
    }
  });
});

describe("curveLevelAt", () => {
  const curve = [
    [0.2, 0],
    [0.4, 1],
    [0.8, 0.5],
  ];

  it("interpolates between the points", () => {
    expect(curveLevelAt(curve, 0.3)).toBeCloseTo(0.5);
    expect(curveLevelAt(curve, 0.6)).toBeCloseTo(0.75);
  });

  it("is the level at a point itself", () => {
    expect(curveLevelAt(curve, 0.2)).toBe(0);
    expect(curveLevelAt(curve, 0.4)).toBe(1);
    expect(curveLevelAt(curve, 0.8)).toBe(0.5);
  });

  it("is 1, untouched, outside the part the curve covers, and for no curve", () => {
    expect(curveLevelAt(curve, 0.1)).toBe(1);
    expect(curveLevelAt(curve, 0.9)).toBe(1);
    expect(curveLevelAt([], 0.5)).toBe(1);
  });
});
