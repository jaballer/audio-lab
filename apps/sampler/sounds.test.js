import { describe, expect, it, vi } from "vitest";
import { SOUNDS } from "./sounds.js";

// How a sound sounds can only be judged by ear. What can be checked here is that
// each one schedules cleanly: starts nothing before its time, stops everything
// it starts, and reaches the output. A fake context records the calls.
function fakeContext(sampleRate = 8000) {
  const out = { name: "out" };
  const sources = []; // every oscillator and noise source, with its start and stop mocks
  let reachedOut = 0;

  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = (extra = {}) => ({
    connect(next) {
      if (next === out) reachedOut++;
      return next;
    },
    ...extra,
  });
  const source = (extra) => {
    const s = node({ start: vi.fn(), stop: vi.fn(), ...extra });
    sources.push(s);
    return s;
  };

  const ctx = {
    sampleRate,
    // A real AudioBuffer knows its sample rate, and the noise cache looks at it.
    createBuffer: vi.fn((_channels, length, rate) => ({
      sampleRate: rate,
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: () => source({ buffer: null }),
    createOscillator: () => source({ type: "sine", frequency: param() }),
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ type: "lowpass", frequency: param(), Q: param() }),
  };
  return { ctx, out, sources, reachedOut: () => reachedOut };
}

const WHEN = 2.5; // seconds on the audio clock

describe("SOUNDS", () => {
  // Saved songs store each pad's steps by its position in this list, so reordering
  // it would silently remix everyone's saved pattern.
  it("lists the 16 pads in panel order", () => {
    expect(SOUNDS.map((s) => s.id)).toEqual([
      "kick",
      "snare",
      "chat",
      "ohat",
      "clap",
      "rim",
      "tomlo",
      "tomhi",
      "bell",
      "conga",
      "shaker",
      "bass",
      "crash",
      "ride",
      "zap",
      "blip",
    ]);
  });

  it("gives every pad a name for the display, all different", () => {
    const names = SOUNDS.map((s) => s.name);
    expect(names.every((name) => typeof name === "string" && name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  describe.each(SOUNDS.map((s) => [s.id, s]))("%s", (_id, sound) => {
    it("makes sound that reaches the output", () => {
      const { ctx, out, sources, reachedOut } = fakeContext();
      sound.play(ctx, out, WHEN);
      expect(sources.length).toBeGreaterThan(0);
      expect(reachedOut()).toBeGreaterThan(0);
    });

    it("starts each source once, no earlier than asked", () => {
      const { ctx, out, sources } = fakeContext();
      sound.play(ctx, out, WHEN);
      for (const s of sources) {
        expect(s.start).toHaveBeenCalledTimes(1);
        expect(s.start.mock.calls[0][0]).toBeGreaterThanOrEqual(WHEN);
      }
    });

    it("stops everything it starts, after it began, so no voice runs on", () => {
      const { ctx, out, sources } = fakeContext();
      sound.play(ctx, out, WHEN);
      for (const s of sources) {
        expect(s.stop).toHaveBeenCalledTimes(1);
        expect(s.stop.mock.calls[0][0]).toBeGreaterThan(s.start.mock.calls[0][0]);
      }
    });

    it("keeps its ramps to positive levels, which exponential ramps require", () => {
      const { ctx, out } = fakeContext();
      const ramps = [];
      const createGain = ctx.createGain;
      ctx.createGain = () => {
        const g = createGain();
        g.gain.exponentialRampToValueAtTime = vi.fn((value) => ramps.push(value));
        return g;
      };
      sound.play(ctx, out, WHEN);
      for (const value of ramps) expect(value).toBeGreaterThan(0);
    });
  });

  it("builds its noise once per sample rate, not on every hit", () => {
    // A distinct rate per case, because the noise is cached across the whole module.
    const first = fakeContext(11025);
    const snare = SOUNDS.find((s) => s.id === "snare");
    snare.play(first.ctx, first.out, WHEN);
    snare.play(first.ctx, first.out, WHEN + 1);
    expect(first.ctx.createBuffer).toHaveBeenCalledTimes(1);

    const second = fakeContext(22050); // a different device rate needs its own buffer
    snare.play(second.ctx, second.out, WHEN);
    expect(second.ctx.createBuffer).toHaveBeenCalledTimes(1);
    expect(second.ctx.createBuffer.mock.calls[0][2]).toBe(22050);
  });
});
