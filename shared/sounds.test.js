import { describe, expect, it, vi } from "vitest";
import { SOUNDS, playSound } from "./sounds.js";

// How a sound sounds can only be judged by ear. What can be checked here is that
// each one schedules cleanly: starts nothing before its time, stops everything
// it starts, and reaches the output. A fake context records the calls, and the
// graph: which node is connected to which.
function fakeContext(sampleRate = 8000) {
  const out = { name: "out" };
  const sources = []; // every oscillator and noise source, with its start and stop mocks
  const edges = []; // [from, to] for every connect()
  const ramps = []; // the target of every exponential ramp, on any parameter

  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn((target) => ramps.push(target)),
  });
  const node = (extra = {}) => {
    const self = {
      connect(next) {
        edges.push([self, next]);
        return next;
      },
      ...extra,
    };
    return self;
  };
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
  // Whether a sound made at `from` can get to the output, through however many
  // gains and filters.
  const reachesOut = (from) => {
    const seen = new Set();
    const queue = [from];
    while (queue.length) {
      const node = queue.shift();
      if (node === out) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const [a, b] of edges) if (a === node) queue.push(b);
    }
    return false;
  };
  return { ctx, out, sources, ramps, reachesOut };
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
    it("connects every source through to the output, so none is silent", () => {
      const { ctx, out, sources, reachesOut } = fakeContext();
      sound.play(ctx, out, WHEN);
      expect(sources.length).toBeGreaterThan(0);
      for (const s of sources) expect(reachesOut(s)).toBe(true);
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

    // Web Audio rejects an exponential ramp to zero (or below), on any parameter:
    // gain, frequency or filter.
    it("keeps every exponential ramp to a positive level", () => {
      const { ctx, out, ramps } = fakeContext();
      sound.play(ctx, out, WHEN);
      expect(ramps.length).toBeGreaterThan(0);
      for (const target of ramps) expect(target).toBeGreaterThan(0);
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

describe("playSound", () => {
  // A stand-in engine: ensure() hands back a context whose gains record their level and target.
  function fakeEngine() {
    const master = { name: "master" };
    const gains = [];
    const ctx = {
      currentTime: 4,
      createGain: () => {
        const gain = { gain: { value: 1 }, connect: vi.fn() };
        gains.push(gain);
        return gain;
      },
    };
    return { audio: { ensure: () => ctx, master, powered: true }, ctx, master, gains };
  }
  const probe = () => ({ play: vi.fn() });

  it("plays at the context's current time straight into the master at full velocity", () => {
    const { audio, ctx, master, gains } = fakeEngine();
    const sound = probe();
    playSound(audio, sound);
    expect(sound.play).toHaveBeenCalledWith(ctx, master, 4);
    expect(gains).toHaveLength(0);
  });

  it("routes a softer hit through its own gain stage into the master", () => {
    const { audio, master, gains } = fakeEngine();
    const sound = probe();
    playSound(audio, sound, 0.4);
    expect(gains).toHaveLength(1);
    expect(gains[0].gain.value).toBe(0.4);
    expect(gains[0].connect).toHaveBeenCalledWith(master);
    expect(sound.play.mock.calls[0][1]).toBe(gains[0]);
  });

  it("drops a hit while the power is off, so it cannot queue up and sound at power on", () => {
    const { audio } = fakeEngine();
    audio.powered = false;
    const sound = probe();
    playSound(audio, sound);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it("never lets a hit go fully silent", () => {
    const { audio, gains } = fakeEngine();
    playSound(audio, probe(), 0);
    expect(gains[0].gain.value).toBeGreaterThan(0);
  });
});
