import { describe, expect, it, vi } from "vitest";
import { createLiveMixer, createMixer } from "./mixer.js";
import { FILTER_Q_DB, HIGH_PASS_PARKED_HZ, LOW_PASS_PARKED_HZ, filterSpec } from "./pad-settings.js";
import { DEFAULT_EFFECTS, delaySeconds, reverbGain, reverbSeconds } from "./effects.js";

// A context that makes the nodes a strip is made of, which record what they were connected to and what was done to their
// parameters.
function fakeContext() {
  const made = { gains: [], filters: [], splitters: [], mergers: [], delays: [], convolvers: [], buffers: [] };
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
    sampleRate: 44100,
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
    createDelay: vi.fn((maxDelayTime) => {
      const delay = { ...node(), delayTime: param(0), maxDelayTime };
      made.delays.push(delay);
      return delay;
    }),
    createConvolver: vi.fn(() => {
      const convolver = { ...node(), buffer: null, normalize: false };
      made.convolvers.push(convolver);
      return convolver;
    }),
    createBuffer: vi.fn((channels, length, sampleRate) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buffer = { numberOfChannels: channels, length, sampleRate, getChannelData: (i) => data[i] };
      made.buffers.push(buffer);
      return buffer;
    }),
  };
}

// The nodes of a context, in the order the mixer makes them: the reverb's input and level, the delay's (an input, three gains
// into the lines, four feedbacks and a level), and then the strips.
const RETURN_GAINS = 2 + 9;

const GAINS_PER_STRIP = 8;
const FILTERS_PER_STRIP = 2;

// The nodes of pad `pad`'s strip, in the order the mixer makes them (after those of the delay and the reverb, which come first:
// the strips' sends lead to them).
function stripOf(ctx, pad) {
  const from = RETURN_GAINS + pad * GAINS_PER_STRIP;
  const [input, dry, lowGain, highGain, left, right, reverbSend, delaySend] = ctx.made.gains.slice(
    from,
    from + GAINS_PER_STRIP,
  );
  const [lowPass, highPass] = ctx.made.filters.slice(pad * FILTERS_PER_STRIP, (pad + 1) * FILTERS_PER_STRIP);
  // The delay made the first splitter and merger.
  const splitter = ctx.made.splitters[1 + pad];
  const merger = ctx.made.mergers[1 + pad];
  return { input, dry, lowGain, highGain, left, right, reverbSend, delaySend, lowPass, highPass, splitter, merger };
}

// The reverb's and the delay's inputs, which the strips' sends lead to.
const returnInputs = (ctx) => ({ reverb: ctx.made.gains[0], delay: ctx.made.gains[2] });

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
    expect(ctx.made.gains).toHaveLength(RETURN_GAINS + 4 * GAINS_PER_STRIP);
    for (const pad of [0, 1, 2, 3]) {
      expect(reaches(mixer.padInput(pad), output)).toBe(true);
      expect(stripOf(ctx, pad).merger.connect).toHaveBeenCalledWith(output);
    }
  });

  it("sends a strip's sound down a dry path, a low-pass and a high-pass, which come together in the two sides", () => {
    const ctx = fakeContext();
    createMixer(ctx, {}, { pads: 1 });
    const strip = stripOf(ctx, 0);
    const { splitter, merger } = strip;
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
    expect(paths(secondMixersStrip(audio.ctx))).toEqual({ dry: 0, low: 1, high: 0 });
  });

  // The strip of the mixer made second (with one pad each): the first mixer's returns and strip, then its own returns.
  function secondMixersStrip(ctx) {
    const from = 2 * RETURN_GAINS + GAINS_PER_STRIP;
    const [, dry, lowGain, highGain] = ctx.made.gains.slice(from, from + GAINS_PER_STRIP);
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

// The effects: what each pad sends, and the reverb and the delay it goes to.
describe("the sends, the reverb and the delay", () => {
  // `defer` is run by hand: the timers are what lets go of a room.
  function deferred() {
    const timers = [];
    const defer = vi.fn((fn, ms) => {
      const timer = { fn, ms, cancelled: false, ran: false };
      timers.push(timer);
      return () => (timer.cancelled = true);
    });
    const run = (timer) => {
      timer.ran = true;
      if (!timer.cancelled) timer.fn();
    };
    return { defer, timers, run, pending: () => timers.filter((t) => !t.ran && !t.cancelled) };
  }

  function setUp({ pads = 2, settings = {}, effects = DEFAULT_EFFECTS, bpm = 120, withDefer = true } = {}) {
    const ctx = fakeContext();
    const output = { id: "output" };
    const state = { settings: { ...settings }, effects, bpm };
    const timers = deferred();
    const mixer = createMixer(ctx, output, {
      pads,
      settings: (pad) => state.settings[pad] ?? {},
      effects: () => state.effects,
      bpm: () => state.bpm,
      ...(withDefer ? { defer: timers.defer } : {}),
    });
    return { ctx, output, mixer, state, timers };
  }
  const delayNodes = (ctx) => {
    const [, , input, leftToLeft, rightToLeft, rightToRight, leftAround, rightAround, leftAcross, rightAcross, level] =
      ctx.made.gains;
    const [left, right] = ctx.made.delays;
    return {
      input,
      leftToLeft,
      rightToLeft,
      rightToRight,
      leftAround,
      rightAround,
      leftAcross,
      rightAcross,
      level,
      left,
      right,
    };
  };
  const glidesTo = (param, value, ctx) =>
    expect(param.setTargetAtTime).toHaveBeenCalledWith(value, ctx.currentTime, expect.any(Number));

  describe("a pad's sends", () => {
    it("lead from what is left after the pad's filter and pan, to the reverb and to the delay", () => {
      const { ctx, output } = setUp({ pads: 1 });
      const strip = stripOf(ctx, 0);
      const inputs = returnInputs(ctx);
      expect(strip.merger.connect).toHaveBeenCalledWith(strip.reverbSend);
      expect(strip.merger.connect).toHaveBeenCalledWith(strip.delaySend);
      expect(strip.merger.connect).toHaveBeenCalledWith(output); // the dry sound still goes straight on
      expect(strip.reverbSend.connect).toHaveBeenCalledExactlyOnceWith(inputs.reverb);
      expect(strip.delaySend.connect).toHaveBeenCalledExactlyOnceWith(inputs.delay);
    });

    it("send nothing for a pad with no settings", () => {
      const { ctx } = setUp({ pads: 2 });
      for (const pad of [0, 1]) {
        expect(stripOf(ctx, pad).reverbSend.gain.value).toBe(0);
        expect(stripOf(ctx, pad).delaySend.gain.value).toBe(0);
      }
    });

    it("are a share of full for what the pad has set, at once when the strip is made", () => {
      const { ctx } = setUp({ settings: { 1: { reverb: 40, delay: 100 } } });
      const strip = stripOf(ctx, 1);
      expect(strip.reverbSend.gain.value).toBeCloseTo(0.4, 9);
      expect(strip.delaySend.gain.value).toBe(1);
      expect(strip.reverbSend.gain.setTargetAtTime).not.toHaveBeenCalled();
      expect(stripOf(ctx, 0).reverbSend.gain.value).toBe(0);
    });

    it("glide to the new level when the pad's settings change", () => {
      const { ctx, mixer, state } = setUp();
      state.settings[0] = { reverb: 25, delay: 60 };
      mixer.update(0);
      glidesTo(stripOf(ctx, 0).reverbSend.gain, 0.25, ctx);
      glidesTo(stripOf(ctx, 0).delaySend.gain, 0.6, ctx);
      expect(stripOf(ctx, 1).reverbSend.gain.setTargetAtTime).not.toHaveBeenCalled();
    });

    it("rewire nothing in a strip or the delay, whatever they are set to (the reverb makes its room, which is the only new connection)", () => {
      const { ctx, mixer, state } = setUp();
      // Everything but the reverb's own input and level, which lead to the room once it is made: the nodes as they are now.
      const nodes = [...ctx.made.gains.slice(2), ...ctx.made.filters, ...ctx.made.delays];
      const before = nodes.map((node) => node.connect.mock.calls.length);
      state.settings[0] = { reverb: 100, delay: 100 };
      mixer.update(0);
      state.settings[0] = { reverb: 0, delay: 0 };
      mixer.update(0);
      expect(nodes.map((node) => node.connect.mock.calls.length)).toEqual(before);
      for (const node of nodes) expect(node.disconnect).not.toHaveBeenCalled();
    });
  });

  describe("the delay", () => {
    it("is two delay lines which each feed back into themselves and into the other, and come out the two sides", () => {
      const { ctx, output } = setUp({ pads: 1 });
      const nodes = delayNodes(ctx);
      const { left, right } = nodes;
      expect(left.maxDelayTime).toBeGreaterThanOrEqual(delaySeconds(3, 40));
      expect(left.connect).toHaveBeenCalledWith(nodes.leftAround);
      expect(left.connect).toHaveBeenCalledWith(nodes.leftAcross);
      expect(right.connect).toHaveBeenCalledWith(nodes.rightAround);
      expect(right.connect).toHaveBeenCalledWith(nodes.rightAcross);
      expect(nodes.leftAround.connect).toHaveBeenCalledWith(left);
      expect(nodes.rightAround.connect).toHaveBeenCalledWith(right);
      expect(nodes.leftAcross.connect).toHaveBeenCalledWith(right);
      expect(nodes.rightAcross.connect).toHaveBeenCalledWith(left);
      const merger = ctx.made.mergers[0];
      expect(left.connect).toHaveBeenCalledWith(merger, 0, 0);
      expect(right.connect).toHaveBeenCalledWith(merger, 0, 1);
      expect(reaches(nodes.input, output)).toBe(true);
    });

    it("takes the pads' sends in two channels as speakers are", () => {
      const { ctx } = setUp({ pads: 1 });
      const { input } = delayNodes(ctx);
      expect(input.channelCount).toBe(2);
      expect(input.channelCountMode).toBe("explicit");
    });

    it("is set from the effects and the tempo when it is made: a note of the beat, an echo on each side, the feedback round", () => {
      const { ctx } = setUp({
        effects: { ...DEFAULT_EFFECTS, delayDivision: 2, delayFeedback: 60, delayLevel: 80 },
        bpm: 100,
      });
      const nodes = delayNodes(ctx);
      expect(nodes.left.delayTime.value).toBeCloseTo(delaySeconds(2, 100), 9);
      expect(nodes.right.delayTime.value).toBeCloseTo(delaySeconds(2, 100), 9);
      expect([nodes.leftToLeft, nodes.rightToLeft, nodes.rightToRight].map((g) => g.gain.value)).toEqual([1, 0, 1]);
      expect([nodes.leftAround, nodes.rightAround].map((g) => g.gain.value)).toEqual([0.6, 0.6]);
      expect([nodes.leftAcross, nodes.rightAcross].map((g) => g.gain.value)).toEqual([0, 0]);
      expect(nodes.level.gain.value).toBeCloseTo(0.8, 9);
    });

    it("ping-pong mixes both sides into the left line and passes each echo across to the other, instead of round", () => {
      const { ctx } = setUp({ effects: { ...DEFAULT_EFFECTS, pingPong: 1, delayFeedback: 50 } });
      const nodes = delayNodes(ctx);
      expect([nodes.leftToLeft, nodes.rightToLeft, nodes.rightToRight].map((g) => g.gain.value)).toEqual([0.5, 0.5, 0]);
      expect([nodes.leftAround, nodes.rightAround].map((g) => g.gain.value)).toEqual([0, 0]);
      expect([nodes.leftAcross, nodes.rightAcross].map((g) => g.gain.value)).toEqual([0.5, 0.5]);
    });

    it("glides to a new setting, and is not rewired by it: ping-pong is gains and not a different graph", () => {
      const { ctx, mixer, state } = setUp();
      const nodes = delayNodes(ctx);
      const connections = () => [...ctx.made.gains, ...ctx.made.delays].map((node) => node.connect.mock.calls.length);
      const before = connections();
      state.effects = { ...DEFAULT_EFFECTS, pingPong: 1, delayFeedback: 70, delayLevel: 20 };
      mixer.updateEffects();
      glidesTo(nodes.leftAcross.gain, 0.7, ctx);
      glidesTo(nodes.leftAround.gain, 0, ctx);
      glidesTo(nodes.rightToRight.gain, 0, ctx);
      glidesTo(nodes.level.gain, 0.2, ctx);
      expect(connections()).toEqual(before);
      for (const node of [...ctx.made.gains, ...ctx.made.delays]) expect(node.disconnect).not.toHaveBeenCalled();
    });

    it("follows the tempo: a change of BPM glides the delay time to the new one, slowly enough not to click", () => {
      const { ctx, mixer, state } = setUp();
      const { left, right } = delayNodes(ctx);
      state.bpm = 90;
      mixer.updateEffects();
      for (const line of [left, right]) {
        expect(line.delayTime.setTargetAtTime).toHaveBeenCalledWith(
          delaySeconds(1, 90),
          ctx.currentTime,
          expect.any(Number),
        );
        expect(line.delayTime.setTargetAtTime.mock.calls[0][2]).toBeGreaterThanOrEqual(0.03);
      }
      state.effects = { ...DEFAULT_EFFECTS, delayDivision: 3 };
      mixer.updateEffects();
      expect(left.delayTime.setTargetAtTime).toHaveBeenLastCalledWith(
        delaySeconds(3, 90),
        ctx.currentTime,
        expect.any(Number),
      );
    });
  });

  describe("the reverb's room", () => {
    it("is not made while no pad sends to it: a beat with no reverb costs no convolver", () => {
      const { ctx, mixer, output } = setUp({ settings: { 0: { delay: 80, filter: 20 } } });
      expect(ctx.made.convolvers).toHaveLength(0);
      expect(ctx.made.buffers).toHaveLength(0);
      expect(mixer.hasReverb).toBe(false);
      expect(reaches(returnInputs(ctx).reverb, output)).toBe(false); // nothing is between its input and the output
    });

    it("is made when the mixer is, if a pad already sends: a convolver on a stereo room, between the send and the output", () => {
      const { ctx, mixer, output, state } = setUp({
        settings: { 1: { reverb: 30 } },
        effects: { ...DEFAULT_EFFECTS, reverbSize: 60 },
      });
      expect(mixer.hasReverb).toBe(true);
      const [convolver] = ctx.made.convolvers;
      expect(convolver.normalize).toBe(true);
      expect(convolver.buffer.numberOfChannels).toBe(2);
      expect(convolver.buffer.length).toBe(Math.ceil(reverbSeconds(60) * ctx.sampleRate));
      expect(convolver.buffer.getChannelData(0).some((x) => x !== 0)).toBe(true);
      expect(reaches(stripOf(ctx, 1).input, convolver)).toBe(true);
      expect(reaches(convolver, output)).toBe(true);
      expect(state.effects.reverbSize).toBe(60);
    });

    it("is the same room each time it is made at a size, so that the page and the export sound alike", () => {
      const a = setUp({ settings: { 0: { reverb: 10 } } });
      const b = setUp({ settings: { 0: { reverb: 90 } } });
      expect(Array.from(a.ctx.made.convolvers[0].buffer.getChannelData(1).slice(0, 500))).toEqual(
        Array.from(b.ctx.made.convolvers[0].buffer.getChannelData(1).slice(0, 500)),
      );
    });

    it("comes back from the room at the level set", () => {
      const { ctx, mixer, state } = setUp({
        settings: { 0: { reverb: 100 } },
        effects: { ...DEFAULT_EFFECTS, reverbLevel: 70 },
      });
      const [, level] = ctx.made.gains;
      expect(level.gain.value).toBeCloseTo(reverbGain(70), 9);
      state.effects = { ...DEFAULT_EFFECTS, reverbLevel: 20 };
      mixer.updateEffects();
      glidesTo(level.gain, reverbGain(20), ctx);
    });

    it("is made when a pad first sends, and not before", () => {
      const { ctx, mixer, state } = setUp();
      state.settings[0] = { reverb: 5 };
      mixer.update(0);
      expect(ctx.made.convolvers).toHaveLength(1);
      expect(mixer.hasReverb).toBe(true);
      mixer.update(0);
      expect(ctx.made.convolvers).toHaveLength(1); // not again
    });

    it("is kept for as long as it rings after the last send goes down to 0, and then let go of", () => {
      const { ctx, mixer, state, timers } = setUp({
        settings: { 0: { reverb: 50 } },
        effects: { ...DEFAULT_EFFECTS, reverbSize: 100 },
      });
      const [convolver] = ctx.made.convolvers;
      state.settings[0] = {};
      mixer.update(0);
      expect(mixer.hasReverb).toBe(true); // what is in the room is still to be heard
      const [release] = timers.pending();
      expect(release.ms).toBeGreaterThan(reverbSeconds(100) * 1000);
      timers.run(release);
      expect(mixer.hasReverb).toBe(false);
      expect(convolver.disconnect).toHaveBeenCalled();
      expect(returnInputs(ctx).reverb.disconnect).toHaveBeenCalledWith(convolver);
    });

    it("is not let go of while another pad still sends", () => {
      const { mixer, state, timers } = setUp({ settings: { 0: { reverb: 50 }, 1: { reverb: 10 } } });
      state.settings[0] = {};
      mixer.update(0);
      expect(timers.pending()).toHaveLength(0);
      expect(mixer.hasReverb).toBe(true);
    });

    it("stays if a pad sends again before the room is let go of", () => {
      const { mixer, state, timers } = setUp({ settings: { 0: { reverb: 50 } } });
      state.settings[0] = {};
      mixer.update(0);
      const [release] = timers.pending();
      state.settings[0] = { reverb: 20 };
      mixer.update(0);
      timers.run(release);
      expect(mixer.hasReverb).toBe(true);
    });

    it("waits for one release at a time, and builds the room again for a send that comes after it is let go of", () => {
      const { ctx, mixer, state, timers } = setUp({ settings: { 0: { reverb: 50 } } });
      state.settings[0] = {};
      mixer.update(0);
      mixer.update(0);
      expect(timers.pending()).toHaveLength(1);
      timers.run(timers.pending()[0]);
      state.settings[0] = { reverb: 50 };
      mixer.update(0);
      expect(mixer.hasReverb).toBe(true);
      expect(ctx.made.convolvers).toHaveLength(2);
    });

    it("is never let go of when nothing can run later (an export sets it once and renders)", () => {
      const { mixer, state } = setUp({ settings: { 0: { reverb: 50 } }, withDefer: false });
      state.settings[0] = {};
      mixer.update(0);
      expect(mixer.hasReverb).toBe(true);
    });
  });

  describe("a change of the room's Size", () => {
    const sized = (size) => ({ ...DEFAULT_EFFECTS, reverbSize: size });
    const roomGain = (convolver) => convolver.connect.mock.calls[0][0];

    it("makes the new room once the slider has stopped, not for every step of a drag", () => {
      const { ctx, mixer, state, timers } = setUp({ settings: { 0: { reverb: 50 } }, effects: sized(40) });
      for (const size of [41, 50, 70, 90]) {
        state.effects = sized(size);
        mixer.updateEffects();
      }
      expect(ctx.made.convolvers).toHaveLength(1); // nothing yet
      expect(timers.pending()).toHaveLength(1); // the earlier steps' waits were cancelled
      timers.run(timers.pending()[0]);
      expect(ctx.made.convolvers).toHaveLength(2);
      expect(ctx.made.convolvers[1].buffer.length).toBe(Math.ceil(reverbSeconds(90) * ctx.sampleRate));
    });

    it("fades from the old room to the new one, and lets go of the old one when it is silent", () => {
      const { ctx, mixer, state, timers } = setUp({ settings: { 0: { reverb: 50 } }, effects: sized(40) });
      const [oldRoom] = ctx.made.convolvers;
      state.effects = sized(80);
      mixer.updateEffects();
      timers.run(timers.pending()[0]);
      const [, newRoom] = ctx.made.convolvers;
      expect(newRoom.connect).toHaveBeenCalledOnce();
      const [oldGain, newGain] = [roomGain(oldRoom), roomGain(newRoom)];
      expect(newGain.gain.value).toBe(0); // it begins silent...
      glidesTo(newGain.gain, 1, ctx); // ...and comes up as the old one goes down
      glidesTo(oldGain.gain, 0, ctx);
      expect(oldRoom.disconnect).not.toHaveBeenCalled();
      const [retire] = timers.pending();
      timers.run(retire);
      expect(oldRoom.disconnect).toHaveBeenCalled();
      expect(newRoom.disconnect).not.toHaveBeenCalled();
    });

    it("is silent from the moment it is connected, so no block of it is heard before the fade begins", () => {
      const { ctx, mixer, state, timers } = setUp({ settings: { 0: { reverb: 50 } }, effects: sized(40) });
      const heardAtConnection = [];
      const [reverbInput] = ctx.made.gains;
      reverbInput.connect.mockImplementation((node) => {
        if (node.buffer !== undefined) heardAtConnection.push(ctx.made.gains.at(-1).gain.value);
      });
      state.effects = sized(80);
      mixer.updateEffects();
      timers.run(timers.pending()[0]);
      expect(heardAtConnection).toEqual([0]); // the new room's gain, when the input was first connected to it
    });

    it("does nothing for a size it already has, or while there is no room", () => {
      const { ctx, mixer, state, timers } = setUp({ settings: { 0: { reverb: 50 } }, effects: sized(40) });
      state.effects = { ...sized(40), reverbLevel: 10 };
      mixer.updateEffects();
      expect(timers.pending()).toHaveLength(0);
      const quiet = setUp({ effects: sized(40) });
      quiet.state.effects = sized(90);
      quiet.mixer.updateEffects();
      expect(quiet.timers.pending()).toHaveLength(0);
      expect(quiet.ctx.made.convolvers).toHaveLength(0);
      expect(ctx.made.convolvers).toHaveLength(1);
    });

    it("is made at the size the settings have by then, when a pad sends for the first time after it was changed", () => {
      const { ctx, mixer, state } = setUp({ effects: sized(40) });
      state.effects = sized(90);
      mixer.updateEffects();
      state.settings[0] = { reverb: 30 };
      mixer.update(0);
      expect(ctx.made.convolvers[0].buffer.length).toBe(Math.ceil(reverbSeconds(90) * ctx.sampleRate));
    });

    it("does not make a new room after the old one was let go of", () => {
      const { ctx, mixer, state, timers } = setUp({ settings: { 0: { reverb: 50 } }, effects: sized(40) });
      state.effects = sized(90);
      mixer.updateEffects();
      state.settings[0] = {};
      mixer.update(0);
      const pending = timers.pending();
      const release = pending.find((timer) => timer.ms > 1000);
      timers.run(release); // the room goes first (the new size's wait is still to come)
      for (const timer of timers.pending()) timers.run(timer);
      expect(ctx.made.convolvers).toHaveLength(1);
      expect(mixer.hasReverb).toBe(false);
    });
  });
});

describe("createLiveMixer and the effects", () => {
  const fakeAudio = () => ({ ctx: fakeContext(), master: { id: "master 1" } });

  it("passes the effects and the tempo on to the mixer it builds, and follows them", () => {
    const audio = fakeAudio();
    const state = { effects: DEFAULT_EFFECTS, bpm: 120 };
    const live = createLiveMixer(audio, {
      pads: 1,
      settings: () => ({}),
      effects: () => state.effects,
      bpm: () => state.bpm,
    });
    live.padInput(0);
    const { left } = { left: audio.ctx.made.delays[0] };
    expect(left.delayTime.value).toBeCloseTo(delaySeconds(1, 120), 9);
    state.bpm = 60;
    live.updateEffects();
    expect(left.delayTime.setTargetAtTime).toHaveBeenCalledWith(
      delaySeconds(1, 60),
      audio.ctx.currentTime,
      expect.any(Number),
    );
  });

  it("does nothing for a change of the effects before there are strips, which read them when they are made", () => {
    const audio = fakeAudio();
    const live = createLiveMixer(audio, {
      pads: 1,
      settings: () => ({}),
      effects: () => DEFAULT_EFFECTS,
      bpm: () => 120,
    });
    expect(() => live.updateEffects()).not.toThrow();
    expect(audio.ctx.made.delays).toHaveLength(0);
    expect(live.hasReverb).toBe(false);
  });

  it("lets go of a room that has rung out by a timer of its own", () => {
    vi.useFakeTimers();
    try {
      const audio = fakeAudio();
      const settings = { 0: { reverb: 50 } };
      const live = createLiveMixer(audio, {
        pads: 1,
        settings: (pad) => settings[pad],
        effects: () => DEFAULT_EFFECTS,
        bpm: () => 120,
      });
      live.padInput(0);
      expect(live.hasReverb).toBe(true);
      settings[0] = {};
      live.update(0);
      expect(live.hasReverb).toBe(true);
      vi.advanceTimersByTime(reverbSeconds(DEFAULT_EFFECTS.reverbSize) * 1000 + 2000);
      expect(live.hasReverb).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("builds the reverb's room again on a new master, with the effects as they are then", () => {
    const audio = fakeAudio();
    const settings = { 0: { reverb: 50 } };
    const live = createLiveMixer(audio, {
      pads: 1,
      settings: (pad) => settings[pad],
      effects: () => DEFAULT_EFFECTS,
      bpm: () => 120,
    });
    live.padInput(0);
    audio.master = { id: "master 2" };
    live.padInput(0);
    expect(audio.ctx.made.convolvers).toHaveLength(2);
    expect(reaches(audio.ctx.made.convolvers[1], audio.master)).toBe(true);
    expect(reaches(audio.ctx.made.convolvers[1], { id: "master 1" })).toBe(false);
  });
});
