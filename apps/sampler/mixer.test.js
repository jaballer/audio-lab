import { describe, expect, it, vi } from "vitest";
import { createLiveMixer, createMixer } from "./mixer.js";
import {
  FILTER_Q_DB,
  HIGH_PASS_PARKED_HZ,
  LOW_PASS_PARKED_HZ,
  driveCurve,
  driveSpec,
  filterSpec,
} from "./pad-settings.js";
import { DEFAULT_EFFECTS, delaySeconds, reverbGain, reverbSeconds } from "./effects.js";

// A context that makes the nodes a strip is made of, which record what they were connected to and what was done to their
// parameters.
function fakeContext() {
  const made = {
    gains: [],
    filters: [],
    shapers: [],
    splitters: [],
    mergers: [],
    delays: [],
    convolvers: [],
    buffers: [],
  };
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
    createWaveShaper: vi.fn(() => {
      // A real one has no curve until it is given one, and is not oversampled until it is told to be.
      const shaper = { ...node(), curve: null, oversample: "none" };
      made.shapers.push(shaper);
      return shaper;
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

// The nodes of a context, in the order the mixer makes them: the master filter's (an input and the three paths' gains, and the
// two filters), the reverb's input and level, the delay's (an input, three gains into the lines, four feedbacks and a level),
// and then the strips.
const MASTER_GAINS = 4;
const MASTER_FILTERS = 2;
const RETURN_GAINS = 2 + 9;
// The gains made before the first strip's.
const BEFORE_STRIPS = MASTER_GAINS + RETURN_GAINS;

// A strip's gains: the input, the gate (the pad's mute), the drive's four (the dry path, the pre-gain, the post-gain and where they meet), then the filter's three
// paths, the two sides of the pan and the two sends.
const GAINS_PER_STRIP = 13;
const FILTERS_PER_STRIP = 2;

// The nodes of pad `pad`'s strip, in the order the mixer makes them (after those of the delay and the reverb, which come first:
// the strips' sends lead to them).
function stripOf(ctx, pad) {
  const from = BEFORE_STRIPS + pad * GAINS_PER_STRIP;
  const [
    input,
    gate,
    driveDry,
    drivePre,
    drivePost,
    driveOut,
    dry,
    lowGain,
    highGain,
    left,
    right,
    reverbSend,
    delaySend,
  ] = ctx.made.gains.slice(from, from + GAINS_PER_STRIP);
  const [lowPass, highPass] = ctx.made.filters.slice(
    MASTER_FILTERS + pad * FILTERS_PER_STRIP,
    MASTER_FILTERS + (pad + 1) * FILTERS_PER_STRIP,
  );
  // The delay made the first splitter and merger.
  const splitter = ctx.made.splitters[1 + pad];
  const merger = ctx.made.mergers[1 + pad];
  const shaper = ctx.made.shapers[pad];
  return {
    input,
    gate,
    driveDry,
    drivePre,
    drivePost,
    driveOut,
    shaper,
    dry,
    lowGain,
    highGain,
    left,
    right,
    reverbSend,
    delaySend,
    lowPass,
    highPass,
    splitter,
    merger,
  };
}

// The master filter's nodes, which are the first the mixer makes: everything leads into its input.
const masterOf = (ctx) => {
  const [input, dry, lowGain, highGain] = ctx.made.gains.slice(0, MASTER_GAINS);
  const [lowPass, highPass] = ctx.made.filters.slice(0, MASTER_FILTERS);
  return { input, dry, lowGain, highGain, lowPass, highPass };
};

// The reverb's and the delay's inputs, which the strips' sends lead to.
const returnInputs = (ctx) => ({
  reverb: ctx.made.gains[MASTER_GAINS],
  delay: ctx.made.gains[MASTER_GAINS + 2],
});

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
    expect(ctx.made.filters).toHaveLength(MASTER_FILTERS + 4 * FILTERS_PER_STRIP);
    expect(ctx.made.gains).toHaveLength(BEFORE_STRIPS + 4 * GAINS_PER_STRIP);
    for (const pad of [0, 1, 2, 3]) {
      expect(reaches(mixer.padInput(pad), output)).toBe(true);
      expect(stripOf(ctx, pad).merger.connect).toHaveBeenCalledWith(masterOf(ctx).input); // through the master filter
    }
  });

  it("sends a strip's sound down a dry path, a low-pass and a high-pass, which come together in the two sides", () => {
    const ctx = fakeContext();
    createMixer(ctx, {}, { pads: 1 });
    const strip = stripOf(ctx, 0);
    const { splitter, merger } = strip;
    expect(splitter.channels).toBe(2);
    expect(merger.channels).toBe(2);
    // The paths take what the drive leaves, which is the input as it is when the drive is off.
    expect(strip.driveOut.connect).toHaveBeenCalledWith(strip.dry);
    expect(strip.driveOut.connect).toHaveBeenCalledWith(strip.lowPass);
    expect(strip.driveOut.connect).toHaveBeenCalledWith(strip.highPass);
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

describe("a strip's gate (mute and solo)", () => {
  const glidesTo = (param, value, ctx) =>
    expect(param.setTargetAtTime).toHaveBeenCalledWith(value, ctx.currentTime, expect.any(Number));
  function setUp(heard = {}) {
    const ctx = fakeContext();
    const mixer = createMixer(ctx, {}, { pads: 3, audible: (pad) => heard[pad] ?? true });
    return { ctx, mixer, heard };
  }

  it("leads the strip's input through the gate, so what the voices play into is silenced", () => {
    const { ctx } = setUp();
    const strip = stripOf(ctx, 0);
    expect(strip.input.connect).toHaveBeenCalledWith(strip.gate);
    expect(strip.gate.connect).toHaveBeenCalledWith(strip.driveDry);
  });

  it("is open for every pad by default", () => {
    const ctx = fakeContext();
    createMixer(ctx, {}, { pads: 2 });
    expect([0, 1].map((pad) => stripOf(ctx, pad).gate.gain.value)).toEqual([1, 1]);
  });

  it("is closed from the start for a pad that is not heard when the strips are made", () => {
    const { ctx } = setUp({ 1: false });
    expect([0, 1, 2].map((pad) => stripOf(ctx, pad).gate.gain.value)).toEqual([1, 0, 1]);
  });

  it("glides shut when the pad is muted, and open again, and changes nothing else", () => {
    const { ctx, mixer, heard } = setUp();
    const strip = stripOf(ctx, 0);
    heard[0] = false;
    mixer.update(0);
    glidesTo(strip.gate.gain, 0, ctx);
    expect(strip.gate.gain.setValueAtTime).not.toHaveBeenCalled(); // a glide, not a step: no click
    heard[0] = true;
    mixer.update(0);
    glidesTo(strip.gate.gain, 1, ctx);
    expect(stripOf(ctx, 1).gate.gain.setTargetAtTime).not.toHaveBeenCalledWith(0, expect.anything(), expect.anything());
  });

  it("is carried to a mixer the live one builds again after the master is replaced", () => {
    const heard = { 0: false };
    const audio = {
      ctx: fakeContext(),
      master: {},
      ensure() {
        return this.ctx;
      },
    };
    const live = createLiveMixer(audio, { pads: 1, audible: (pad) => heard[pad] ?? true, defer: () => () => {} });
    live.padInput(0);
    audio.master = {}; // killSound() made another
    live.padInput(0);
    const second = 2 * BEFORE_STRIPS + GAINS_PER_STRIP; // the second mixer's strip: its gate follows the input
    expect(audio.ctx.made.gains[second + 1].gain.value).toBe(0);
  });
});

describe("a strip's drive", () => {
  const driveGains = ({ driveDry, drivePre, drivePost }) => ({
    dry: driveDry.gain.value,
    pre: drivePre.gain.value,
    post: drivePost.gain.value,
  });
  function setUp(initial = {}) {
    const ctx = fakeContext();
    const settings = { 0: initial };
    const mixer = createMixer(ctx, {}, { pads: 2, settings: (pad) => settings[pad] ?? {} });
    return { ctx, mixer, settings, strip: stripOf(ctx, 0) };
  }
  const glidesTo = (param, value, ctx) =>
    expect(param.setTargetAtTime).toHaveBeenCalledWith(value, ctx.currentTime, expect.any(Number));

  it("is a dry path beside a shaped one (a gain in, the shaper, a gain out), which meet again before the filter", () => {
    const { strip } = setUp();
    expect(strip.gate.connect).toHaveBeenCalledWith(strip.driveDry);
    expect(strip.gate.connect).toHaveBeenCalledWith(strip.drivePre);
    expect(strip.drivePre.connect).toHaveBeenCalledWith(strip.shaper);
    expect(strip.shaper.connect).toHaveBeenCalledWith(strip.drivePost);
    expect(strip.driveDry.connect).toHaveBeenCalledWith(strip.driveOut);
    expect(strip.drivePost.connect).toHaveBeenCalledWith(strip.driveOut);
    expect(strip.input.connect).not.toHaveBeenCalledWith(strip.dry); // the filter's paths are after the drive and not beside it
    expect(strip.driveOut.connect).toHaveBeenCalledWith(strip.dry);
  });

  it("gives every strip the same soft clip, not oversampled (which would delay a driven pad against the others)", () => {
    const { ctx } = setUp();
    expect(ctx.made.shapers).toHaveLength(2);
    for (const shaper of ctx.made.shapers) {
      expect(shaper.curve).toEqual(driveCurve());
      expect(shaper.oversample).toBe("none");
    }
  });

  it("is off to begin with: the dry path alone, and the shaped path silent", () => {
    const { strip } = setUp();
    expect(strip.driveDry.gain.value).toBe(1);
    expect(strip.drivePost.gain.value).toBe(0);
  });

  it("is set when the strip is made, at once and not by a glide", () => {
    const { strip, ctx } = setUp({ drive: 50 });
    const spec = driveSpec(50);
    expect(driveGains(strip)).toEqual({ dry: 0, pre: spec.preGain, post: spec.postGain });
    expect(strip.drivePre.gain.setTargetAtTime).not.toHaveBeenCalled();
    expect(driveGains(stripOf(ctx, 1))).toEqual({ dry: 1, pre: 1, post: 0 }); // the other pad is as it was
  });

  it("is turned on by fading the shaped path in, with the pre-gain set at once while that path is still silent", () => {
    const { ctx, mixer, settings, strip } = setUp();
    settings[0] = { drive: 40 };
    mixer.update(0);
    expect(strip.drivePre.gain.cancelScheduledValues).toHaveBeenCalledWith(ctx.currentTime);
    expect(strip.drivePre.gain.setValueAtTime).toHaveBeenCalledWith(driveSpec(40).preGain, ctx.currentTime);
    expect(strip.drivePre.gain.setTargetAtTime).not.toHaveBeenCalled(); // not swept from where it waited
    glidesTo(strip.drivePost.gain, driveSpec(40).postGain, ctx);
    glidesTo(strip.driveDry.gain, 0, ctx);
  });

  it("follows the slider while it is on: the pre-gain and the make-up glide together", () => {
    const { ctx, mixer, settings, strip } = setUp({ drive: 40 });
    settings[0] = { drive: 70 };
    mixer.update(0);
    glidesTo(strip.drivePre.gain, driveSpec(70).preGain, ctx);
    glidesTo(strip.drivePost.gain, driveSpec(70).postGain, ctx);
    expect(strip.drivePre.gain.setValueAtTime).not.toHaveBeenCalled();
    expect(strip.driveDry.gain.setTargetAtTime).not.toHaveBeenCalledWith(1, expect.anything(), expect.anything());
  });

  it("is turned off by fading back to the dry path, and leaves the shaped path where it was", () => {
    const { ctx, mixer, settings, strip } = setUp({ drive: 70 });
    settings[0] = { drive: 0 };
    mixer.update(0);
    glidesTo(strip.driveDry.gain, 1, ctx);
    glidesTo(strip.drivePost.gain, 0, ctx);
    expect(strip.drivePre.gain.setTargetAtTime).not.toHaveBeenCalled();
    expect(strip.drivePre.gain.setValueAtTime).not.toHaveBeenCalled();
  });

  it("is that of the pad whose setting changed, and nothing else moves", () => {
    const { ctx, mixer, settings } = setUp();
    settings[0] = { drive: 80 };
    mixer.update(0);
    const other = stripOf(ctx, 1);
    for (const param of [other.driveDry.gain, other.drivePre.gain, other.drivePost.gain]) {
      expect(param.setTargetAtTime).not.toHaveBeenCalled();
      expect(param.setValueAtTime).not.toHaveBeenCalled();
    }
  });

  it("never rewires or lets go of anything, whatever it is moved to", () => {
    const { ctx, mixer, settings, strip } = setUp();
    const nodes = [strip.driveDry, strip.drivePre, strip.drivePost, strip.driveOut, strip.shaper];
    const before = nodes.map((node) => node.connect.mock.calls.length);
    for (const drive of [100, 3, 0, 1, 60, 0]) {
      settings[0] = { drive };
      mixer.update(0);
    }
    expect(nodes.map((node) => node.connect.mock.calls.length)).toEqual(before);
    for (const node of nodes) expect(node.disconnect).not.toHaveBeenCalled();
    expect(ctx.made.shapers).toHaveLength(2); // and no shaper is made for a change
  });

  it("leaves the filter, the sends and the master filter at what they were", () => {
    const { ctx, mixer, settings, strip } = setUp({ filter: -30, reverb: 40 });
    settings[0] = { filter: -30, reverb: 40, drive: 90 };
    mixer.update(0);
    glidesTo(strip.lowPass.frequency, filterSpec(-30).frequency, ctx); // where it was
    glidesTo(strip.reverbSend.gain, 0.4, ctx);
    expect(masterOf(ctx).lowGain.gain.setTargetAtTime).not.toHaveBeenCalled();
  });
});

describe("the master filter", () => {
  function setUp({ masterFilter = 0, pads = 2 } = {}) {
    const ctx = fakeContext();
    const output = { id: "output" };
    const state = { effects: { ...DEFAULT_EFFECTS, masterFilter } };
    const mixer = createMixer(ctx, output, { pads, effects: () => state.effects, settings: () => ({ reverb: 50 }) });
    return { ctx, output, mixer, state, master: masterOf(ctx) };
  }
  const masterPaths = ({ dry, lowGain, highGain }) => ({
    dry: dry.gain.value,
    low: lowGain.gain.value,
    high: highGain.gain.value,
  });
  const glidesTo = (param, value, ctx) =>
    expect(param.setTargetAtTime).toHaveBeenCalledWith(value, ctx.currentTime, expect.any(Number));

  it("is the last thing before the output: three paths, a dry one, a low-pass and a high-pass, which all lead to it", () => {
    const { ctx, output, master } = setUp();
    expect(master.input.connect).toHaveBeenCalledWith(master.dry);
    expect(master.input.connect).toHaveBeenCalledWith(master.lowPass);
    expect(master.input.connect).toHaveBeenCalledWith(master.highPass);
    expect(master.lowPass.connect).toHaveBeenCalledWith(master.lowGain);
    expect(master.highPass.connect).toHaveBeenCalledWith(master.highGain);
    for (const path of [master.dry, master.lowGain, master.highGain]) {
      expect(path.connect).toHaveBeenCalledWith(output);
    }
    expect(ctx.made.splitters).toHaveLength(1 + 2); // the delay's and the two strips': the master has no pan
  });

  it("takes everything: every strip, and the reverb's and the delay's returns, lead into it and not straight to the output", () => {
    const { ctx, output, master } = setUp({ pads: 3 });
    for (const pad of [0, 1, 2]) {
      const { merger } = stripOf(ctx, pad);
      expect(merger.connect).toHaveBeenCalledWith(master.input);
      expect(merger.connect).not.toHaveBeenCalledWith(output);
    }
    const delayLevel = ctx.made.gains[BEFORE_STRIPS - 1]; // the last gain the delay makes
    expect(delayLevel.connect).toHaveBeenCalledWith(master.input);
    expect(delayLevel.connect).not.toHaveBeenCalledWith(output);
    const reverbLevel = ctx.made.gains[MASTER_GAINS + 1];
    expect(reverbLevel.connect).toHaveBeenCalledWith(master.input);
    expect(reverbLevel.connect).not.toHaveBeenCalledWith(output);
    // Nothing but the master's three paths reaches the output.
    const toOutput = ctx.made.gains.filter((gain) => gain.connect.mock.calls.some(([node]) => node === output));
    expect(toOutput).toEqual([master.dry, master.lowGain, master.highGain]);
  });

  it("makes the two filters what they are for good, waiting at the ends of their ranges, and is the dry path alone at the start", () => {
    const { master } = setUp();
    expect(master.lowPass.type).toBe("lowpass");
    expect(master.highPass.type).toBe("highpass");
    expect(master.lowPass.typeSets).toBe(1);
    expect(master.highPass.typeSets).toBe(1);
    expect(master.lowPass.frequency.value).toBeCloseTo(LOW_PASS_PARKED_HZ, 6);
    expect(master.highPass.frequency.value).toBeCloseTo(HIGH_PASS_PARKED_HZ, 6);
    expect(master.lowPass.Q.value).toBeCloseTo(FILTER_Q_DB, 9);
    expect(masterPaths(master)).toEqual({ dry: 1, low: 0, high: 0 });
  });

  it("is set from the effects when it is made, at once and not by a glide, for a low-pass and for a high-pass", () => {
    const low = setUp({ masterFilter: -50 }).master;
    expect(masterPaths(low)).toEqual({ dry: 0, low: 1, high: 0 });
    expect(low.lowPass.frequency.value).toBeCloseTo(filterSpec(-50).frequency, 6);
    expect(low.lowPass.frequency.setTargetAtTime).not.toHaveBeenCalled();
    const high = setUp({ masterFilter: 40 }).master;
    expect(masterPaths(high)).toEqual({ dry: 0, low: 0, high: 1 });
    expect(high.highPass.frequency.value).toBeCloseTo(filterSpec(40).frequency, 6);
  });

  it("is off when the effects have no setting for it", () => {
    const ctx = fakeContext();
    // The effects of a beat saved before the master filter had no entry for it.
    const without = Object.fromEntries(Object.entries(DEFAULT_EFFECTS).filter(([name]) => name !== "masterFilter"));
    createMixer(ctx, {}, { pads: 1, effects: () => without });
    expect(masterPaths(masterOf(ctx))).toEqual({ dry: 1, low: 0, high: 0 });
  });

  it("follows a change of the effects: a cutoff that moves glides, and one turned on is set at once, from where it waited", () => {
    const { ctx, mixer, state, master } = setUp({ masterFilter: -20 });
    state.effects = { ...state.effects, masterFilter: -60 };
    mixer.updateEffects();
    glidesTo(master.lowPass.frequency, filterSpec(-60).frequency, ctx);
    expect(master.lowPass.frequency.setValueAtTime).not.toHaveBeenCalled();
    state.effects = { ...state.effects, masterFilter: 40 };
    mixer.updateEffects();
    expect(master.highPass.frequency.cancelScheduledValues).toHaveBeenCalledWith(ctx.currentTime);
    expect(master.highPass.frequency.setValueAtTime).toHaveBeenCalledWith(filterSpec(40).frequency, ctx.currentTime);
    glidesTo(master.lowGain.gain, 0, ctx);
    glidesTo(master.highGain.gain, 1, ctx);
    state.effects = { ...state.effects, masterFilter: 0 };
    mixer.updateEffects();
    glidesTo(master.dry.gain, 1, ctx);
    glidesTo(master.highGain.gain, 0, ctx);
  });

  it("never changes a filter's type or rewires, whatever it is moved to", () => {
    const { ctx, mixer, state, master } = setUp();
    const nodes = [...ctx.made.gains.slice(0, MASTER_GAINS), ...ctx.made.filters.slice(0, MASTER_FILTERS)];
    const before = nodes.map((node) => node.connect.mock.calls.length);
    for (const masterFilter of [-80, -10, 0, 10, 80, -40, 0]) {
      state.effects = { ...state.effects, masterFilter };
      mixer.updateEffects();
    }
    expect(master.lowPass.typeSets).toBe(1);
    expect(master.highPass.typeSets).toBe(1);
    expect(nodes.map((node) => node.connect.mock.calls.length)).toEqual(before);
    for (const node of nodes) expect(node.disconnect).not.toHaveBeenCalled();
  });

  it("is not moved by a change of a pad's settings", () => {
    const { mixer, master } = setUp({ masterFilter: -30 });
    mixer.update(0);
    expect(master.lowPass.frequency.setTargetAtTime).not.toHaveBeenCalled();
    expect(master.lowGain.gain.setTargetAtTime).not.toHaveBeenCalled();
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
    expect(audio.ctx.made.filters).toHaveLength(MASTER_FILTERS + 2 * FILTERS_PER_STRIP);
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
    expect(audio.ctx.made.filters).toHaveLength(MASTER_FILTERS + 2 * FILTERS_PER_STRIP);
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

  it("builds the master filter of the new mixer at the setting the effects have then, and leaves the old one as it was", () => {
    const audio = fakeAudio();
    const state = { effects: { ...DEFAULT_EFFECTS, masterFilter: 0 } };
    const live = createLiveMixer(audio, { pads: 1, effects: () => state.effects });
    live.padInput(0);
    state.effects = { ...DEFAULT_EFFECTS, masterFilter: 40 }; // moved while the sound was playing, then Kill
    audio.master = { id: "master 2" };
    live.padInput(0);
    const first = 0;
    const second = BEFORE_STRIPS + GAINS_PER_STRIP; // the gains of the first mixer come before the second's
    const [, oldDry, , oldHigh] = audio.ctx.made.gains.slice(first, first + MASTER_GAINS);
    const [, newDry, , newHigh] = audio.ctx.made.gains.slice(second, second + MASTER_GAINS);
    expect([oldDry.gain.value, oldHigh.gain.value]).toEqual([1, 0]);
    expect([newDry.gain.value, newHigh.gain.value]).toEqual([0, 1]);
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
    const from = 2 * BEFORE_STRIPS + GAINS_PER_STRIP;
    const [, , , , , , dry, lowGain, highGain] = ctx.made.gains.slice(from, from + GAINS_PER_STRIP);
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
    const [input, leftToLeft, rightToLeft, rightToRight, leftAround, rightAround, leftAcross, rightAcross, level] =
      ctx.made.gains.slice(MASTER_GAINS + 2);
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
      const { ctx } = setUp({ pads: 1 });
      const strip = stripOf(ctx, 0);
      const inputs = returnInputs(ctx);
      expect(strip.merger.connect).toHaveBeenCalledWith(strip.reverbSend);
      expect(strip.merger.connect).toHaveBeenCalledWith(strip.delaySend);
      expect(strip.merger.connect).toHaveBeenCalledWith(masterOf(ctx).input); // the dry sound still goes straight on
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
      const nodes = [...ctx.made.gains.slice(MASTER_GAINS + 2), ...ctx.made.filters, ...ctx.made.delays];
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
      const level = ctx.made.gains[MASTER_GAINS + 1];
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
      const reverbInput = ctx.made.gains[MASTER_GAINS];
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
