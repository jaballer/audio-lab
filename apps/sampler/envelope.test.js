import { describe, expect, it } from "vitest";
import { envelopeShape, isFlat } from "./envelope.js";

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
    // attack 1 s up, decay 1 s down to 0.2, but the release starts at 0.5 s (2 - 1.5): in the middle of the attack
    expect(close(envelopeShape({ attack: 1, decay: 1, sustain: 0.2, release: 1.5 }, 2))).toEqual([
      [0, 0],
      [0.5, 0.5],
      [2, 0],
    ]);
    // the release starts in the decay (at 1.5 s), when it has fallen a quarter of the way from 1 to 0.2
    const shape = envelopeShape({ attack: 1, decay: 1, sustain: 0.2, release: 0.5 }, 2);
    expect(close(shape)).toEqual([
      [0, 0],
      [1, 1],
      [1.5, 0.6],
      [2, 0],
    ]);
  });

  it("ends a sample too short for its attack part-way up, without a release to finish it", () => {
    const shape = envelopeShape({ attack: 3 }, 2);
    expect(close(shape)).toEqual([
      [0, 0],
      [2, 0.666667],
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
