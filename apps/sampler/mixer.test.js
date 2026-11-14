import { describe, expect, it, vi } from "vitest";
import { createLiveMixer, createMixer } from "./mixer.js";
import { FILTER_Q_DB, HIGH_PASS_PARKED_HZ, LOW_PASS_PARKED_HZ, filterSpec } from "./pad-settings.js";

// A context that makes the nodes a strip is made of, which record what they were connected to and what was done to their
// parameters.
function fakeContext() {
  const made = { gains: [], filters: [], splitters: [], mergers: [] };
  const param = (value) => ({
    value,
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  return {
    made,
    currentTime: 2,
    createGain: vi.fn(() => {
      const gain = { ...node(), gain: param(1) };
      made.gains.push(gain);
      return gain;
    }),
    createBiquadFilter: vi.fn(() => {
      // A real one is a low-pass at 350 Hz until it is told otherwise, and a change of type is counted: a filter in use must
      // not have its type changed (see mixer.js).
      const filter = { ...node(), frequency: param(350), Q: param(1), gain: param(0), typeSets: 0 };
      let type = "lowpass";
      Object.defineProperty(filter, "type", {
        get: () => type,
        set: (value) => {
          type = value;
          filter.typeSets++;
        },
      });
      made.filters.push(filter);
      return filter;
    }),
    createChannelSplitter: vi.fn((channels) => {
      const splitter = { ...node(), channels };
      made.splitters.push(splitter);
      return splitter;
    }),
    createChannelMerger: vi.fn((channels) => {
      const merger = { ...node(), channels };
      made.mergers.push(merger);
      return merger;
    }),
  };
}

const GAINS_PER_STRIP = 6;
const FILTERS_PER_STRIP = 2;

// The nodes of pad `pad`'s strip, in the order the mixer makes them.
function stripOf(ctx, pad) {
  const [input, dry, lowGain, highGain, left, right] = ctx.made.gains.slice(
    pad * GAINS_PER_STRIP,
    (pad + 1) * GAINS_PER_STRIP,
  );
  const [lowPass, highPass] = ctx.made.filters.slice(pad * FILTERS_PER_STRIP, (pad + 1) * FILTERS_PER_STRIP);
  return { input, dry, lowGain, highGain, left, right, lowPass, highPass };
}

// Whether what `from` is connected to, and what that is connected to, and so on, reaches `target`.
function reaches(from, target, seen = new Set()) {
  if (from === target) return true;
  if (seen.has(from) || !from.connect?.mock) return false;
  seen.add(from);
  return from.connect.mock.calls.some((call) => reaches(call[0], target, seen));
}

// What the strip's three gains are, as { dry, low, high } and { left, right }.
const paths = (strip) => ({
  dry: strip.dry.gain.value,
  low: strip.lowGain.gain.value,
  high: strip.highGain.gain.value,
});

describe("createMixer", () => {
  it("makes a strip for each pad, which leads to the output", () => {
    const ctx = fakeContext();
    const output = { id: "output" };
    const mixer = createMixer(ctx, output, { pads: 4 });
    expect(ctx.made.filters).toHaveLength(4 * FILTERS_PER_STRIP);
    expect(ctx.made.gains).toHaveLength(4 * GAINS_PER_STRIP);
    for (const pad of [0, 1, 2, 3]) expect(reaches(mixer.padInput(pad), output)).toBe(true);
    for (const merger of ctx.made.mergers) expect(merger.connect).toHaveBeenCalledExactlyOnceWith(output);
  });

  it("sends a strip's sound down a dry path, a low-pass and a high-pass, which come together in the two sides", () => {
    const ctx = fakeContext();
    createMixer(ctx, {}, { pads: 1 });
    const strip = stripOf(ctx, 0);
    const [splitter] = ctx.made.splitters;
    const [merger] = ctx.made.mergers;
    expect(splitter.channels).toBe(2);
    expect(merger.channels).toBe(2);
    expect(strip.input.connect).toHaveBeenCalledWith(strip.dry);
    expect(strip.input.connect).toHaveBeenCalledWith(strip.lowPass);
    expect(strip.input.connect).toHaveBeenCalledWith(strip.highPass);
    expect(strip.lowPass.connect).toHaveBeenCalledWith(strip.lowGain);
    expect(strip.highPass.connect).toHaveBeenCalledWith(strip.highGain);
    for (const path of [strip.dry, strip.lowGain, strip.highGain]) expect(path.connect).toHaveBeenCalledWith(splitter);
    expect(splitter.connect).toHaveBeenCalledWith(strip.left, 0);
    expect(splitter.connect).toHaveBeenCalledWith(strip.right, 1);
    expect(strip.left.connect).toHaveBeenCalledWith(merger, 0, 0);
    expect(strip.right.connect).toHaveBeenCalledWith(merger, 0, 1);
  });

  it("makes the strip's input two channels as speakers are, so a mono sound is on both sides", () => {
    const ctx = fakeContext();
    createMixer(ctx, {}, { pads: 1 });
    const { input } = stripOf(ctx, 0);
    expect(input.channelCount).toBe(2);
    expect(input.channelCountMode).toBe("explicit");
    expect(input.channelInterpretation).toBe("speakers");
  });

  it("gives each pad its own strip", () => {
    const ctx = fakeContext();
    const mixer = createMixer(ctx, {}, { pads: 3 });
    const inputs = [0, 1, 2].map((pad) => mixer.padInput(pad));
    expect(new Set(inputs).size).toBe(3);
    expect(mixer.padInput(1)).toBe(inputs[1]);
  });

  it("makes the two filters what they are for good, a low-pass and a high-pass, waiting at the ends of their ranges", () => {
    const ctx = fakeContext();
    createMixer(ctx, {}, { pads: 2 });
    for (const pad of [0, 1]) {
      const { lowPass, highPass } = stripOf(ctx, pad);
      expect(lowPass.type).toBe("lowpass");
      expect(highPass.type).toBe("highpass");
      expect(lowPass.frequency.value).toBeCloseTo(LOW_PASS_PARKED_HZ, 6);
      expect(highPass.frequency.value).toBeCloseTo(HIGH_PASS_PARKED_HZ, 6);
      expect(lowPass.Q.value).toBeCloseTo(FILTER_Q_DB, 9);
      expect(highPass.Q.value).toBeCloseTo(FILTER_Q_DB, 9);
    }
  });

  it("leaves a pad with no settings as it is: only the dry path, and both sides at full", () => {
    const ctx = fakeContext();
    createMixer(ctx, {}, { pads: 2 });
    for (const pad of [0, 1]) {
      const strip = stripOf(ctx, pad);
      expect(paths(strip)).toEqual({ dry: 1, low: 0, high: 0 });
      expect(strip.left.gain.value).toBe(1);
      expect(strip.right.gain.value).toBe(1);
    }
  });

  it("sets a pad's filter and pan when its strip is made, at once and not by a glide", () => {
    const ctx = fakeContext();
    const settings = { 1: { filter: -50, pan: -30 } };
    createMixer(ctx, {}, { pads: 2, settings: (pad) => settings[pad] ?? {} });
    const strip = stripOf(ctx, 1);
    expect(paths(strip)).toEqual({ dry: 0, low: 1, high: 0 });
    expect(strip.lowPass.frequency.value).toBeCloseTo(filterSpec(-50).frequency, 6);
    expect(strip.highPass.frequency.value).toBeCloseTo(HIGH_PASS_PARKED_HZ, 6);
    expect(strip.lowPass.frequency.setTargetAtTime).not.toHaveBeenCalled();
    expect(strip.left.gain.value).toBe(1);
    expect(strip.right.gain.value).toBeCloseTo(0.7, 9);
    expect(paths(stripOf(ctx, 0))).toEqual({ dry: 1, low: 0, high: 0 }); // the other pad is as it was
  });

  describe("update", () => {
    function mixerWith(initial) {
      const ctx = fakeContext();
      const settings = { 0: initial };
      const mixer = createMixer(ctx, {}, { pads: 2, settings: (pad) => settings[pad] ?? {} });
      return { ctx, mixer, settings, strip: stripOf(ctx, 0) };
    }
    const glidesTo = (param, value, ctx) =>
      expect(param.setTargetAtTime).toHaveBeenCalledWith(value, ctx.currentTime, expect.any(Number));

    it("glides the pan to the new balance, from now", () => {
      const { ctx, mixer, settings, strip } = mixerWith({});
      settings[0] = { pan: 50 };
      mixer.update(0);
      glidesTo(strip.left.gain, 0.5, ctx);
      glidesTo(strip.right.gain, 1, ctx);
      expect(strip.left.gain.setValueAtTime).not.toHaveBeenCalled();
    });

    it("glides a cutoff that moves while the same filter is in use", () => {
      const { ctx, mixer, settings, strip } = mixerWith({ filter: -20 });
      settings[0] = { filter: -60 };
      mixer.update(0);
      glidesTo(strip.lowPass.frequency, filterSpec(-60).frequency, ctx);
      expect(strip.lowPass.frequency.setValueAtTime).not.toHaveBeenCalled();
    });

    it("turns a filter on by crossfading to it, with the cutoff set at once from where it waited", () => {
      const { ctx, mixer, settings, strip } = mixerWith({});
      settings[0] = { filter: 40 };
      mixer.update(0);
      expect(strip.highPass.frequency.cancelScheduledValues).toHaveBeenCalledWith(ctx.currentTime);
      expect(strip.highPass.frequency.setValueAtTime).toHaveBeenCalledWith(filterSpec(40).frequency, ctx.currentTime);
      expect(strip.highPass.frequency.setTargetAtTime).not.toHaveBeenCalled();
      glidesTo(strip.dry.gain, 0, ctx);
      glidesTo(strip.highGain.gain, 1, ctx);
      glidesTo(strip.lowGain.gain, 0, ctx);
    });

    it("goes from one filter to the other across the middle by crossfading, and back to the dry sound at 0", () => {
      const { ctx, mixer, settings, strip } = mixerWith({ filter: -30 });
      settings[0] = { filter: 30 };
      mixer.update(0);
      glidesTo(strip.lowGain.gain, 0, ctx);
      glidesTo(strip.highGain.gain, 1, ctx);
      expect(strip.lowPass.frequency.setValueAtTime).not.toHaveBeenCalled(); // the low-pass is left where it was
      settings[0] = {};
      mixer.update(0);
      glidesTo(strip.dry.gain, 1, ctx);
      glidesTo(strip.highGain.gain, 0, ctx);
    });

    it("never changes the type of a filter, which would reset its memory and be heard as a tick", () => {
      const { mixer, settings, strip } = mixerWith({});
      expect(strip.lowPass.typeSets).toBe(1); // when it was made
      expect(strip.highPass.typeSets).toBe(1);
      for (const filter of [-80, -10, 0, 10, 80, -40, 0]) {
        settings[0] = { filter, pan: filter };
        mixer.update(0);
      }
      expect(strip.lowPass.typeSets).toBe(1);
      expect(strip.highPass.typeSets).toBe(1);
      expect(strip.lowPass.type).toBe("lowpass");
      expect(strip.highPass.type).toBe("highpass");
    });

    it("rewires nothing, whatever changes", () => {
      const { ctx, mixer, settings } = mixerWith({});
      const nodes = () => [...ctx.made.filters, ...ctx.made.gains];
      const connections = () => nodes().map((node) => node.connect.mock.calls.length);
      const before = connections();
      settings[0] = { filter: -80, pan: 100 };
      mixer.update(0);
      settings[0] = { filter: 80, pan: -100 };
      mixer.update(0);
      expect(connections()).toEqual(before);
      for (const node of [...nodes(), ...ctx.made.mergers]) expect(node.disconnect).not.toHaveBeenCalled();
    });

    it("leaves the other pads alone, and is not troubled by a pad there is none of", () => {
      const { ctx, mixer, settings } = mixerWith({});
      settings[0] = { pan: 100, filter: 50 };
      mixer.update(0);
      const other = stripOf(ctx, 1);
      for (const param of [other.left.gain, other.dry.gain, other.highGain.gain, other.highPass.frequency]) {
        expect(param.setTargetAtTime).not.toHaveBeenCalled();
        expect(param.setValueAtTime).not.toHaveBeenCalled();
      }
      expect(() => mixer.update(9)).not.toThrow();
    });
  });
});

describe("createLiveMixer", () => {
  function fakeAudio() {
    return { ctx: fakeContext(), master: { id: "master 1" } };
  }

  it("builds nothing until a hit asks, then leads into the master", () => {
    const audio = fakeAudio();
    const live = createLiveMixer(audio, { pads: 2 });
    expect(audio.ctx.made.filters).toHaveLength(0);
    const input = live.padInput(1);
    expect(audio.ctx.made.filters).toHaveLength(2 * FILTERS_PER_STRIP);
    expect(reaches(input, audio.master)).toBe(true);
  });

  it("says so, and builds nothing, when the audio engine has not made its master yet", () => {
    const audio = { ctx: fakeContext(), master: null };
    const live = createLiveMixer(audio, { pads: 2 });
    expect(() => live.padInput(0)).toThrow(/audio\.ensure/);
    expect(audio.ctx.made.filters).toHaveLength(0);
  });

  it("keeps the same strips while the master is the same one", () => {
    const audio = fakeAudio();
    const live = createLiveMixer(audio, { pads: 2 });
    expect(live.padInput(0)).toBe(live.padInput(0));
    expect(audio.ctx.made.filters).toHaveLength(2 * FILTERS_PER_STRIP);
  });

  it("builds new strips on the master that replaced the old one (after all sound is cut off), and leaves the old ones alone", () => {
    const audio = fakeAudio();
    const oldMaster = audio.master;
    const live = createLiveMixer(audio, { pads: 2 });
    const before = live.padInput(0);
    audio.master = { id: "master 2" };
    const after = live.padInput(0);
    expect(after).not.toBe(before);
    expect(reaches(after, audio.master)).toBe(true);
    expect(reaches(after, oldMaster)).toBe(false);
    expect(reaches(before, oldMaster)).toBe(true);
    for (const node of [...audio.ctx.made.filters, ...audio.ctx.made.gains]) {
      expect(node.disconnect).not.toHaveBeenCalled(); // the old master's own fade-out ends it
    }
    expect(live.padInput(0)).toBe(after);
  });

  it("makes new strips with the settings the pads have then, and not the ones they had", () => {
    const audio = fakeAudio();
    const settings = { 0: { filter: 30 } };
    const live = createLiveMixer(audio, { pads: 1, settings: (pad) => settings[pad] });
    live.padInput(0);
    settings[0] = { filter: -30 };
    audio.master = { id: "master 2" }; // sound was cut off
    live.padInput(0);
    expect(paths(stripOf(audio.ctx, 0))).toEqual({ dry: 0, low: 0, high: 1 });
    expect(paths({ ...firstOf(audio.ctx, 1) })).toEqual({ dry: 0, low: 1, high: 0 });
  });

  // The strip made second, which the pad index of stripOf cannot reach with one pad.
  function firstOf(ctx, n) {
    const [, dry, lowGain, highGain] = ctx.made.gains.slice(n * GAINS_PER_STRIP, (n + 1) * GAINS_PER_STRIP);
    return { dry, lowGain, highGain };
  }

  describe("update", () => {
    it("moves the strip of the pad the settings changed on", () => {
      const audio = fakeAudio();
      const settings = { 0: {} };
      const live = createLiveMixer(audio, { pads: 1, settings: (pad) => settings[pad] });
      live.padInput(0);
      settings[0] = { pan: -100 };
      live.update(0);
      const { left, right } = stripOf(audio.ctx, 0);
      expect(left.gain.setTargetAtTime).toHaveBeenCalledWith(1, audio.ctx.currentTime, expect.any(Number));
      expect(right.gain.setTargetAtTime).toHaveBeenCalledWith(0, audio.ctx.currentTime, expect.any(Number));
    });

    it("does nothing before there are strips, which are made from the settings as they are by then", () => {
      const audio = fakeAudio();
      const live = createLiveMixer(audio, { pads: 1, settings: () => ({ pan: 100 }) });
      expect(() => live.update(0)).not.toThrow();
      expect(audio.ctx.made.filters).toHaveLength(0);
    });
  });
});
