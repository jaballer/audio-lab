import { describe, expect, it } from "vitest";
import {
  orbitPositions,
  bandLevels,
  beatPhase,
  beatPulse,
  lightFrame,
  rmsLevel,
  smoothLevel,
  sparkleOpacity,
} from "./light-show.js";

describe("rmsLevel", () => {
  it("is 0 for silence and for nothing", () => {
    expect(rmsLevel(new Float32Array(64))).toBe(0);
    expect(rmsLevel(undefined)).toBe(0);
  });
  it("grows with loudness and stops at 1", () => {
    const quiet = rmsLevel(new Float32Array(64).fill(0.05));
    const loud = rmsLevel(new Float32Array(64).fill(0.2));
    expect(loud).toBeGreaterThan(quiet);
    expect(rmsLevel(new Float32Array(64).fill(1))).toBe(1);
  });
});

describe("smoothLevel", () => {
  it("rises faster than it falls", () => {
    const up = smoothLevel(0, 1, 16);
    const down = 1 - smoothLevel(1, 0, 16);
    expect(up).toBeGreaterThan(down);
  });
  it("does not move with no time, and is the same in one long step or two short ones", () => {
    expect(smoothLevel(0.3, 1, 0)).toBe(0.3);
    expect(smoothLevel(smoothLevel(0, 1, 8), 1, 8)).toBeCloseTo(smoothLevel(0, 1, 16));
  });
});

describe("beatPhase and beatPulse", () => {
  it("is 0 on a beat and carries on through the four steps", () => {
    // 120 bpm: a step is 125 ms
    expect(beatPhase({ step: 4, sinceStepMs: 0, bpm: 120 })).toBe(0);
    expect(beatPhase({ step: 6, sinceStepMs: 62.5, bpm: 120 })).toBeCloseTo(0.625);
  });
  it("has no beat before the first step (the scheduler's step is -1 then): phase 0, not a negative one", () => {
    expect(beatPhase({ step: -1, sinceStepMs: 40, bpm: 120 })).toBe(0);
  });
  it("never reaches 1 when a step is late", () => {
    expect(beatPhase({ step: 3, sinceStepMs: 5000, bpm: 120 })).toBeLessThan(1);
  });
  it("peaks on the beat and fades", () => {
    expect(beatPulse(0)).toBe(1);
    expect(beatPulse(0.5)).toBeLessThan(beatPulse(0.1));
  });
});

describe("lightFrame", () => {
  it("is blue and dim in silence, red and bright at full level", () => {
    const quiet = lightFrame({ level: 0, phase: 0.5, playing: false });
    const hot = lightFrame({ level: 1, phase: 0.5, playing: true });
    expect(quiet.hue).toBeGreaterThan(200);
    expect(hot.hue).toBe(0);
    expect(hot.glow).toBeGreaterThan(quiet.glow);
  });
  it("pulses on the beat only while playing", () => {
    expect(lightFrame({ level: 0, phase: 0, playing: true }).glow).toBeGreaterThan(
      lightFrame({ level: 0, phase: 0, playing: false }).glow,
    );
  });
  it("does not pulse when still, but the colour and brightness still follow the sound", () => {
    const beat = { level: 0.4, phase: 0, playing: true, beat: 0 };
    const still = lightFrame({ ...beat, still: true });
    expect(still.pulse).toBe(0);
    expect(still.even).toBe(still.odd);
    expect(still.glow).toBe(lightFrame({ ...beat, phase: 0.9, still: true }).glow); // the same on the beat and off it
    expect(still.glow).toBeGreaterThan(lightFrame({ level: 0, phase: 0, playing: true, still: true }).glow);
  });
  it("keeps the glow within 0 to 1", () => {
    expect(lightFrame({ level: 5, phase: 0, playing: true }).glow).toBeLessThanOrEqual(1);
  });
  it("hands the beats to the diagonal pairs in turn", () => {
    const even = lightFrame({ level: 0, phase: 0, playing: true, beat: 0 });
    const odd = lightFrame({ level: 0, phase: 0, playing: true, beat: 1 });
    expect(even.even).toBeGreaterThan(even.odd);
    expect(odd.odd).toBeGreaterThan(odd.even);
  });
  it("wanders with time, and stays put when still", () => {
    const at = (timeMs, still) => lightFrame({ level: 0, phase: 0, playing: false, timeMs, still });
    expect(at(3000, false).x).not.toBe(at(0, false).x);
    expect(at(3000, true)).toEqual(at(0, true));
  });
  it("swells with the beat and with loudness", () => {
    const base = lightFrame({ level: 0, phase: 0.9, playing: true }).size;
    expect(lightFrame({ level: 0, phase: 0, playing: true }).size).toBeGreaterThan(base);
    expect(lightFrame({ level: 1, phase: 0.9, playing: true }).size).toBeGreaterThan(base);
  });
});

describe("bandLevels", () => {
  // 1024 bins up to 24 kHz: a bin is about 23.4 Hz wide
  const bins = (fill) => {
    const bytes = new Uint8Array(1024);
    fill(bytes);
    return bytes;
  };
  it("is 0 for silence and for nothing", () => {
    expect(bandLevels(new Uint8Array(1024), 48000)).toEqual({ low: 0, high: 0 });
    expect(bandLevels(undefined, 48000)).toEqual({ low: 0, high: 0 });
  });
  it("tells a kick from a hat", () => {
    const kick = bandLevels(
      bins((b) => b.fill(255, 0, 12)),
      48000,
    ); // 23-210 Hz
    const hat = bandLevels(
      bins((b) => b.fill(255, 160, 540)),
      48000,
    ); // 4-12 kHz
    expect(kick.low).toBeGreaterThan(0.9);
    expect(kick.high).toBe(0);
    expect(hat.high).toBeGreaterThan(0.9);
    expect(hat.low).toBe(0);
  });
  it("ignores room noise below the gate", () => {
    expect(
      bandLevels(
        bins((b) => b.fill(100)),
        48000,
      ),
    ).toEqual({ low: 0, high: 0 });
  });
});

describe("sparkleOpacity", () => {
  it("is dark when the highs are silent and never above 1", () => {
    expect(sparkleOpacity(0, 3, 1234)).toBe(0);
    expect(sparkleOpacity(1, 3, 1234)).toBeLessThanOrEqual(1);
  });
  it("flickers: the same sparkle changes over time, and sparkles differ from each other", () => {
    expect(sparkleOpacity(1, 0, 0)).not.toBe(sparkleOpacity(1, 0, 400));
    expect(sparkleOpacity(1, 0, 0)).not.toBe(sparkleOpacity(1, 1, 0));
  });
});

describe("lightFrame bands", () => {
  it("lets the bass swell the glow and passes the highs on", () => {
    const quiet = lightFrame({ level: 0.3, phase: 0.9, playing: true });
    const bass = lightFrame({ level: 0.3, phase: 0.9, playing: true, low: 1, high: 0.6 });
    expect(bass.size).toBeGreaterThan(quiet.size);
    expect(bass.glow).toBeGreaterThan(quiet.glow);
    expect(bass.high).toBe(0.6);
  });
});

describe("orbitPositions", () => {
  it("puts the lights evenly round the window, a quarter turn apart", () => {
    const [a, b, c, d] = orbitPositions(0);
    expect(a.x).toBeGreaterThan(100 - 1); // at the angle: beyond the right edge
    expect(b.y).toBeGreaterThan(100); // a quarter turn on: below the bottom
    expect(c.x).toBeLessThan(0);
    expect(d.y).toBeLessThan(0);
  });
  it("reaches into the corners on the way round", () => {
    const [a, b, c, d] = orbitPositions(Math.PI / 4);
    for (const { x, y } of [a, b, c, d]) {
      expect(Math.abs(x - 50)).toBeGreaterThan(35);
      expect(Math.abs(y - 50)).toBeGreaterThan(35);
    }
  });
  it("goes round: a whole turn is back where it started", () => {
    expect(orbitPositions(2 * Math.PI)[0]).toEqual(orbitPositions(0)[0]);
  });
});

describe("lightFrame spin", () => {
  it("is faster at a higher tempo and when loud, and still when asked", () => {
    const at = (bpm, level, still = false) => lightFrame({ level, phase: 0, playing: true, bpm, still }).spin;
    expect(at(160, 0)).toBeGreaterThan(at(80, 0));
    expect(at(100, 1)).toBeGreaterThan(at(100, 0));
    expect(at(160, 1, true)).toBe(0);
  });
});
