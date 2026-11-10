import { describe, expect, it, vi } from "vitest";
import {
  LEAD_SECONDS,
  MAX_WARM_UP_PASSES,
  MAX_EXPORT_SAMPLE_RATE,
  MIN_EXPORT_SAMPLE_RATE,
  READY_WAIT_MS,
  canRenderOffline,
  createExportAction,
  emptyBars,
  encodeWav,
  exportName,
  exportSampleRate,
  exportSequence,
  exportStems,
  hasSteps,
  hitsOf,
  stemName,
  stemPads,
  stemsName,
  planRender,
  renderCost,
  renderSequence,
  renderStems,
  toMono,
  wasCancelled,
  WINDOW_SECONDS,
  windowPauses,
} from "./export-wav.js";
import { exportInfo, stemsInfo } from "./export-options.js";
import { createKit } from "./kit.js";
import { TRIM_LEAD_SECONDS } from "./sample-voice.js";
import { zipParts } from "./zip.js";

const sound = (id) => ({ id, name: id, play: vi.fn() });
// A loaded sample's shape, as far as the export looks at it.
const sample = (duration, trim = { start: 0, end: 1 }) => ({
  id: "s",
  name: "s",
  play: vi.fn(),
  setTrim() {},
  duration,
  trim,
});

const sequence = (pattern, velocities = {}, bars = 1) => ({ bars, pattern, velocities });
const songOf = (seq, extra = {}) => ({ bpm: 120, volume: 80, current: 0, sequences: [seq], padSettings: {}, ...extra });

describe("hitsOf", () => {
  it("lists the steps that are on, in the order they sound, pads in order within a step, with their velocity", () => {
    const hits = hitsOf(sequence({ 2: [4, 0], 0: [4] }, { 2: { 4: 50 } }), 16);
    expect(hits).toEqual([
      { step: 0, row: 2, velocity: 127 },
      { step: 4, row: 0, velocity: 127 },
      { step: 4, row: 2, velocity: 50 },
    ]);
  });

  it("leaves out the steps of bars the sequence no longer has, which it keeps for when they come back", () => {
    const shortened = sequence({ 0: [3, 20, 40], 1: [16] }, {}, 1); // one bar of 16 steps
    expect(hitsOf(shortened, 16).map((hit) => hit.step)).toEqual([3]);
    expect(hitsOf({ ...shortened, bars: 2 }, 16).map((hit) => hit.step)).toEqual([3, 16, 20]);
  });

  it("is empty for an empty sequence", () => {
    expect(hitsOf(sequence({}), 16)).toEqual([]);
  });
});

describe("canRenderOffline", () => {
  it("is whether the browser has an OfflineAudioContext, asked each time", () => {
    vi.stubGlobal("OfflineAudioContext", undefined);
    expect(canRenderOffline()).toBe(false);
    vi.stubGlobal("OfflineAudioContext", class {});
    expect(canRenderOffline()).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("emptyBars", () => {
  it("lists the bars of the sequence showing that have no steps, counting from 1", () => {
    // 4 bars of 16 steps: steps in bars 1 and 3
    const song = songOf(sequence({ 0: [0, 5], 1: [33] }, {}, 4));
    expect(emptyBars(song, 16)).toEqual([2, 4]);
  });

  it("is nothing when every bar has a step, and every bar when none has", () => {
    expect(emptyBars(songOf(sequence({ 0: [0], 1: [16] }, {}, 2)), 16)).toEqual([]);
    expect(emptyBars(songOf(sequence({}, {}, 3)), 16)).toEqual([1, 2, 3]);
  });

  it("does not count steps in bars the sequence no longer has, which it keeps for when they come back", () => {
    expect(emptyBars(songOf(sequence({ 0: [0, 40] }, {}, 2)), 16)).toEqual([2]);
  });

  it("looks at the sequence showing, not another", () => {
    const song = {
      ...songOf(sequence({ 0: [0] }, {}, 2)),
      sequences: [sequence({ 0: [0] }, {}, 2), sequence({ 0: [16] }, {}, 2)],
      current: 1,
    };
    expect(emptyBars(song, 16)).toEqual([1]);
  });
});

describe("hasSteps", () => {
  it("is whether the sequence showing has anything on", () => {
    expect(hasSteps(songOf(sequence({})), 16)).toBe(false);
    expect(hasSteps(songOf(sequence({ 0: [] })), 16)).toBe(false);
    expect(hasSteps(songOf(sequence({ 0: [3] })), 16)).toBe(true);
    const second = { ...songOf(sequence({})), sequences: [sequence({}), sequence({ 1: [0] })], current: 1 };
    expect(hasSteps(second, 16)).toBe(true);
  });

  it("does not count steps in bars the sequence does not have", () => {
    expect(hasSteps(songOf(sequence({ 0: [20] }, {}, 1)), 16)).toBe(false);
    expect(hasSteps(songOf(sequence({ 0: [20] }, {}, 2)), 16)).toBe(true);
  });
});

// An offline context that records what is done to it and hands back a render with a marker in every frame.
// With `pausable`, it pauses the way a real one does: suspend(time) returns a promise that settles when the render
// reaches that time, and the render stays paused until resume() is called (so one never resumed never finishes).
function fakeOffline({ pausable = false } = {}) {
  const nodes = [];
  const pauses = [];
  const resumes = { count: 0 };
  const made = { frames: 0, rate: 0 };
  const destination = { id: "destination" };
  const ctx = {
    currentTime: 0,
    destination,
    createGain: () => {
      const node = {
        gain: { value: 1, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      nodes.push(node);
      return node;
    },
    startRendering: async () => {
      for (const pause of [...pauses].sort((a, b) => a.time - b.time)) {
        const before = resumes.count;
        ctx.currentTime = pause.time; // the clock is where the render has got to, as a real context's is
        pause.reach();
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (resumes.count === before) await new Promise(() => {}); // paused for good
      }
      return {
        numberOfChannels: 2,
        sampleRate: made.rate,
        getChannelData: (channel) => Float32Array.from({ length: made.frames }, (_, i) => i + channel * 1000),
      };
    },
  };
  if (pausable) {
    ctx.suspend = vi.fn((time) => new Promise((reach) => pauses.push({ time, reach })));
    ctx.resume = vi.fn(async () => void resumes.count++);
  }
  return {
    ctx,
    nodes,
    made,
    destination,
    createContext: (frames, rate) => {
      made.frames = frames;
      made.rate = rate;
      return ctx;
    },
  };
}

describe("renderSequence", () => {
  const setup = (seq, extra = {}, sounds = [sound("a"), sound("b"), sound("c")]) => {
    const kit = createKit(sounds);
    const offline = fakeOffline();
    const render = () =>
      renderSequence({
        song: songOf(seq, extra),
        kit,
        stepsPerBar: 16,
        sampleRate: 1000,
        createContext: offline.createContext,
      });
    return { kit, offline, render, sounds };
  };
  // 120 BPM: a sixteenth is 0.125 s, a bar of 16 steps is 2 s

  it("plays each step that is on at its time, after the lead, in two passes, so the second is a loop's steady state", async () => {
    const { render, sounds } = setup(sequence({ 0: [0, 4], 1: [8] }));
    await render();
    const times = (sound) => sound.play.mock.calls.map((call) => call[2]);
    expect(times(sounds[0])).toEqual([LEAD_SECONDS, LEAD_SECONDS + 0.5, LEAD_SECONDS + 2, LEAD_SECONDS + 2.5]);
    expect(times(sounds[1])).toEqual([LEAD_SECONDS + 1, LEAD_SECONDS + 3]);
    expect(sounds[2].play).not.toHaveBeenCalled();
  });

  it("plays at the song's tempo, not another", async () => {
    const { render, sounds } = setup(sequence({ 0: [4] }), { bpm: 60 });
    await render();
    expect(sounds[0].play.mock.calls[0][2]).toBeCloseTo(LEAD_SECONDS + 4 * 0.25);
  });

  it("is exactly the length of the bars, and is the second pass: the first pass's end is at its start", async () => {
    const { render, offline } = setup(sequence({ 0: [0] }, {}, 2)); // 2 bars: 32 steps, 4 s
    const audio = await render();
    expect(offline.made.rate).toBe(1000);
    const first = Math.round((LEAD_SECONDS + 4) * 1000); // where the second pass begins in the render
    expect(offline.made.frames).toBe(first + 4000);
    expect(audio.channels).toHaveLength(2);
    expect(audio.channels[0]).toHaveLength(4000);
    expect(audio.channels[1]).toHaveLength(4000);
    expect(audio.channels[0][0]).toBe(first); // the render's frame at the start of the second pass is the file's first
    expect(audio.channels[1][0]).toBe(1000 + first);
    expect(audio.sampleRate).toBe(1000);
  });

  it("is as long as the bars whatever is in them: a sample longer than the loop adds nothing", async () => {
    const { render, offline } = setup(sequence({ 0: [0] }), {}, [sample(9), sound("b"), sound("c")]);
    const audio = await render();
    expect(audio.channels[0]).toHaveLength(2000);
    expect(offline.made.frames).toBe(Math.round((LEAD_SECONDS + 2) * 1000) + 2000);
  });

  it("runs the master at the volume on the page, straight to the speakers when the context has no clipper", async () => {
    const { render, offline } = setup(sequence({ 0: [0] }), { volume: 50 });
    await render();
    const master = offline.nodes[0];
    expect(master.gain.value).toBe(0.5);
    expect(master.connect).toHaveBeenCalledWith(offline.destination);
  });

  it("runs the master through the clipper, and the clipper to the speakers, when the context can make one", async () => {
    const { kit, offline } = setup(sequence({ 0: [0] }));
    const base = offline.createContext;
    const shaper = { curve: null, oversample: "2x", connect: vi.fn() };
    await renderSequence({
      song: songOf(sequence({ 0: [0] })),
      kit,
      stepsPerBar: 16,
      sampleRate: 1000,
      createContext: (frames, rate) => Object.assign(base(frames, rate), { createWaveShaper: () => shaper }),
    });
    const [master, half] = offline.nodes;
    expect(master.connect).toHaveBeenCalledWith(half);
    expect(half.connect).toHaveBeenCalledWith(shaper);
    expect(shaper.connect).toHaveBeenCalledWith(offline.destination);
    expect(master.connect).not.toHaveBeenCalledWith(offline.destination);
  });

  it("is a whole number of frames long at a tempo where a bar is not, and the second pass starts where the first ends", async () => {
    const kit = createKit([sound("a")]);
    const offline = fakeOffline();
    const audio = await renderSequence({
      song: songOf(sequence({ 0: [0] }), { bpm: 123 }),
      kit,
      stepsPerBar: 16,
      sampleRate: 44100,
      createContext: offline.createContext,
    });
    const loop = (16 * 60) / 123 / 4; // 1.951219... s, which is 86048.78 frames
    const frames = Math.round(loop * 44100);
    expect(frames).toBe(86049); // rounded up, not cut down
    expect(audio.channels[0]).toHaveLength(frames);
    expect(Number.isInteger(frames)).toBe(true);
    const first = Math.round((LEAD_SECONDS + loop) * 44100);
    expect(offline.made.frames).toBe(first + frames);
    expect(audio.channels[0][0]).toBe(first);
  });

  it("does not play steps in bars the sequence does not have", async () => {
    const sounds = [sound("a"), sound("b")];
    const { render } = setup(sequence({ 0: [0], 1: [20] }, {}, 1), {}, sounds);
    await render();
    expect(sounds[1].play).not.toHaveBeenCalled();
  });

  it("gives a quieter step a gain stage in front of its pad's voice", async () => {
    const { render, offline, sounds } = setup(sequence({ 0: [0] }, { 0: { 0: 64 } }));
    await render();
    const stage = sounds[0].play.mock.calls[0][1];
    expect(stage.gain.value).toBeCloseTo(64 / 127);
    expect(offline.nodes).toContain(stage);
  });

  it("applies the pad's own settings, as the page does (the kit plays it)", async () => {
    const { render, kit, sounds } = setup(sequence({ 0: [0] }));
    kit.setSetting(0, "gain", -6);
    await render();
    const stage = sounds[0].play.mock.calls[0][1];
    expect(stage.gain.value).toBeCloseTo(0.501, 3);
  });

  it("cuts a pad's earlier hit when it is hit again, as it does on the page", async () => {
    const { render, sounds } = setup(sequence({ 0: [0, 4] }));
    await render();
    const first = sounds[0].play.mock.calls[0][1];
    expect(first.gain.setTargetAtTime).toHaveBeenCalledWith(0, LEAD_SECONDS + 0.5, expect.any(Number));
  });

  describe("warm-up passes for a long release", () => {
    const samplePad = () => ({ id: "s", name: "s", play: vi.fn(), setTrim() {} });

    it("renders one warm-up pass when no release reaches past the loop, as before", async () => {
      const { render, sounds } = setup(sequence({ 0: [0] }));
      await render();
      expect(sounds[0].play).toHaveBeenCalledTimes(2);
    });

    it("renders enough passes before the one kept to cover a release longer than the loop", async () => {
      const sounds = [samplePad(), sound("b"), sound("c")];
      const { render, kit, offline } = setup(sequence({ 0: [0] }), {}, sounds); // a 2 s loop at 120 BPM
      kit.setSetting(0, "release", 100); // 5 s: tails from three passes back, so 1 + ceil(5 / 2) = 4 warm-up passes
      const audio = await render();
      expect(sounds[0].play).toHaveBeenCalledTimes(5); // four warm-up passes and the one kept
      const times = sounds[0].play.mock.calls.map((call) => call[2]);
      expect(times).toEqual([0, 2, 4, 6, 8].map((t) => LEAD_SECONDS + t));
      expect(offline.made.frames).toBe(Math.round((LEAD_SECONDS + 8) * 1000) + 2000); // the kept pass is the last
      expect(audio.channels[0]).toHaveLength(2000); // and the file is still exactly the loop
      expect(audio.channels[0][0]).toBe(Math.round((LEAD_SECONDS + 8) * 1000));
    });

    it("counts only the pads that have steps: a long release on an unused pad adds nothing", async () => {
      const sounds = [sound("a"), samplePad(), sound("c")];
      const { render, kit } = setup(sequence({ 0: [0] }), {}, sounds);
      kit.setSetting(1, "release", 100);
      await render();
      expect(sounds[0].play).toHaveBeenCalledTimes(2);
    });

    it("stops adding passes at a limit, so a very short loop cannot render for ever", async () => {
      const sounds = [samplePad(), sound("b"), sound("c")];
      const { render, kit } = setup(sequence({ 0: [0] }), { bpm: 1000 }, sounds); // a loop of a quarter of a second
      kit.setSetting(0, "release", 100);
      await render();
      expect(sounds[0].play).toHaveBeenCalledTimes(MAX_WARM_UP_PASSES + 1);
    });
  });

  it("fades a cut over the pad's release, as the page does, for a pad that plays a loaded sample", async () => {
    const sounds = [{ id: "s", name: "s", play: vi.fn(), setTrim() {} }, sound("b"), sound("c")];
    const { render, kit } = setup(sequence({ 0: [0, 4] }), {}, sounds);
    kit.setSetting(0, "release", 100); // 5 s
    await render();
    const first = sounds[0].play.mock.calls[0][1];
    expect(first.gain.setTargetAtTime).toHaveBeenCalledWith(0, LEAD_SECONDS + 0.5, 5 / 7);
  });

  it("cuts a pad's hit when another pad in its choke group starts, as it does on the page", async () => {
    const { render, kit, sounds } = setup(sequence({ 0: [0], 1: [4] }));
    kit.setSetting(0, "choke", 2);
    kit.setSetting(1, "choke", 2);
    await render();
    const first = sounds[0].play.mock.calls[0][1];
    expect(first.gain.setTargetAtTime).toHaveBeenCalledWith(0, LEAD_SECONDS + 0.5, expect.any(Number));
  });

  it("lets the last hit of the first pass be cut by the pad's first hit of the second, as in a loop", async () => {
    const { render, sounds } = setup(sequence({ 0: [0] }));
    await render();
    const lastOfFirstPass = sounds[0].play.mock.calls[0][1];
    expect(lastOfFirstPass.gain.setTargetAtTime).toHaveBeenCalledWith(0, LEAD_SECONDS + 2, expect.any(Number));
  });

  it("starts no timers: an offline render has nothing to clean up", async () => {
    vi.useFakeTimers();
    const { render } = setup(sequence({ 0: [0, 4, 8] }));
    await render();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe("planRender", () => {
  // 120 BPM, 16 steps a bar: 2 s a bar; at 1000 Hz, 2000 frames
  const plan = (seq, extra = {}, options = {}, sounds = [sound("a"), sound("b"), sound("c")]) =>
    planRender({ song: songOf(seq, extra), kit: createKit(sounds), stepsPerBar: 16, sampleRate: 1000, ...options });

  it("is in frames of the rate it is given: the lead, the warm-up and the file all scale with it", () => {
    const p = plan(sequence({ 0: [0] }), {}, { sampleRate: 48000 }); // a bar at 120 BPM is 2 s
    expect(p.sampleRate).toBe(48000);
    expect(p.frames).toBe(96000);
    expect(p.first).toBe(Math.round((LEAD_SECONDS + 2) * 48000));
    expect(p.total).toBe(p.first + p.frames);
  });

  it("is the hits, the passes and where the kept window is, worked out before any audio", () => {
    const p = plan(sequence({ 0: [0, 4], 1: [8] }));
    expect(p.hits).toHaveLength(3);
    expect(p.length).toBe(16);
    expect(p.stepLength).toBeCloseTo(0.125);
    expect(p.warmUp).toBe(1);
    expect(p.copies).toBe(1);
    expect(p.passes).toBe(2);
    expect(p.first).toBe(Math.round((LEAD_SECONDS + 2) * 1000));
    expect(p.frames).toBe(2000);
    expect(p.total).toBe(p.first + p.frames);
    expect(p.sampleRate).toBe(1000);
  });

  it("keeps the loops after the same warm-up", () => {
    const p = plan(sequence({ 0: [0] }), {}, { loops: 4 });
    expect(p.copies).toBe(4);
    expect(p.warmUp).toBe(1);
    expect(p.passes).toBe(5);
    expect(p.frames).toBe(8000);
  });

  it("warms up for a release longer than the loop, up to the limit, counting only the pads that have steps", () => {
    const sample = () => ({ id: "s", name: "s", play: vi.fn(), setTrim() {} });
    const kit = createKit([sample(), sample()]);
    kit.setSetting(0, "release", 100); // 5 s in a 2 s loop
    kit.setSetting(1, "release", 100);
    const planned = (pattern, bpm = 120) =>
      planRender({ song: songOf(sequence(pattern), { bpm }), kit, stepsPerBar: 16, sampleRate: 1000 });
    expect(planned({ 0: [0] }).warmUp).toBe(1 + Math.ceil(5 / 2));
    expect(planned({ 0: [0] }, 1000).warmUp).toBe(MAX_WARM_UP_PASSES); // a loop of a quarter of a second
    const silent = createKit([sound("a"), sample()]);
    silent.setSetting(1, "release", 100); // a long release on a pad with no steps
    expect(
      planRender({ song: songOf(sequence({ 0: [0] })), kit: silent, stepsPerBar: 16, sampleRate: 1000 }).warmUp,
    ).toBe(1);
  });

  it("treats loops that are not a count as one", () => {
    expect(plan(sequence({ 0: [0] }), {}, { loops: 0 }).copies).toBe(1);
    expect(plan(sequence({ 0: [0] }), {}, { loops: 2.7 }).copies).toBe(2);
  });
});

describe("renderSequence, loops and channels", () => {
  // 120 BPM, 16 steps a bar: 2 s a bar; at 1000 Hz, 2000 frames. One warm-up pass, so the kept window starts at 2010.
  const first = Math.round((LEAD_SECONDS + 2) * 1000);
  const run = (options, seq = sequence({ 0: [0] }), kitSounds = [sound("a")]) => {
    const offline = fakeOffline();
    const kit = createKit(kitSounds);
    const done = renderSequence({
      song: songOf(seq),
      kit,
      stepsPerBar: 16,
      sampleRate: 1000,
      createContext: offline.createContext,
      ...options,
    });
    return { done, offline, sounds: kitSounds };
  };

  it("keeps the sequence once, in stereo, when it is told nothing", async () => {
    const { done, offline } = run({});
    const audio = await done;
    expect(audio.channels).toHaveLength(2);
    expect(audio.channels[0]).toHaveLength(2000);
    expect(offline.made.frames).toBe(first + 2000);
  });

  it("keeps the loop that many times in one file, after the same warm-up", async () => {
    const { done, offline } = run({ loops: 4 });
    const audio = await done;
    expect(audio.channels[0]).toHaveLength(8000);
    expect(offline.made.frames).toBe(first + 8000);
    expect(audio.channels[0][0]).toBe(first); // it starts where the one-loop file starts
  });

  it("plays the steps of every pass it renders: the warm-up, then each loop kept", async () => {
    const { done, sounds } = run({ loops: 4 });
    await done;
    const times = sounds[0].play.mock.calls.map((call) => call[2]);
    expect(times).toEqual([0, 1, 2, 3, 4].map((pass) => LEAD_SECONDS + pass * 2)); // 1 warm-up + 4 kept
  });

  it("warms up for as long as a release needs, whatever the loops", async () => {
    const samplePad = { id: "s", name: "s", play: vi.fn(), setTrim() {} };
    const kit = createKit([samplePad]);
    kit.setSetting(0, "release", 100); // 5 s
    const offline = fakeOffline();
    await renderSequence({
      song: songOf(sequence({ 0: [0] })),
      kit,
      stepsPerBar: 16,
      sampleRate: 1000,
      createContext: offline.createContext,
      loops: 2,
    });
    const warmUp = 1 + Math.ceil(5 / 2); // a 5 s release in a 2 s loop: the loops do not change it
    expect(offline.made.frames).toBe(Math.round((LEAD_SECONDS + warmUp * 2) * 1000) + 4000);
    expect(samplePad.play).toHaveBeenCalledTimes(warmUp + 2);
  });

  it("mixes down to one channel, the mean of the two", async () => {
    const { done } = run({ channels: "mono" });
    const audio = await done;
    expect(audio.channels).toHaveLength(1);
    expect(audio.channels[0]).toHaveLength(2000);
    expect(audio.channels[0][0]).toBe(first + 500); // the fake's left is i and its right i + 1000
    expect(audio.channels[0][10]).toBe(first + 10 + 500);
  });

  it("does both: loops of a mono file", async () => {
    const audio = await run({ loops: 2, channels: "mono" }).done;
    expect(audio.channels).toHaveLength(1);
    expect(audio.channels[0]).toHaveLength(4000);
  });

  it("hands back views of the render, not copies of it: a long export is hundreds of megabytes", async () => {
    const offline = fakeOffline();
    let data;
    const audio = await renderSequence({
      song: songOf(sequence({ 0: [0] })),
      kit: createKit([sound("a")]),
      stepsPerBar: 16,
      sampleRate: 1000,
      createContext: (frames, rate) => {
        const ctx = offline.createContext(frames, rate);
        ctx.startRendering = async () => {
          data = [new Float32Array(frames), new Float32Array(frames)];
          return { numberOfChannels: 2, sampleRate: rate, getChannelData: (channel) => data[channel] };
        };
        return ctx;
      },
    });
    expect(audio.channels[0].buffer).toBe(data[0].buffer);
    expect(audio.channels[1].buffer).toBe(data[1].buffer);
    expect(audio.channels[0]).toHaveLength(2000); // the window, not the whole render with its warm-up
  });

  it("is as long and as big as the dialog said it would be", async () => {
    const song = songOf(sequence({ 0: [0] }, {}, 2));
    for (const options of [
      { loops: 1, channels: "stereo" },
      { loops: 4, channels: "mono" },
      { loops: 8, channels: "stereo" },
    ]) {
      const offline = fakeOffline();
      const audio = await renderSequence({
        song,
        kit: createKit([sound("a")]),
        stepsPerBar: 16,
        sampleRate: 1000,
        createContext: offline.createContext,
        ...options,
      });
      const info = exportInfo(song, options, 16, 1000);
      expect(audio.channels[0]).toHaveLength(info.frames);
      expect(audio.channels).toHaveLength(info.channels === "mono" ? 1 : 2);
      expect(encodeWav(audio.channels, audio.sampleRate).byteLength).toBe(info.bytes);
    }
  });
});

describe("toMono", () => {
  it("is the mean of the channels at each frame", () => {
    const mono = toMono([Float32Array.of(1, 0, -0.5), Float32Array.of(0, 0.5, -0.5)]);
    expect([...mono]).toEqual([0.5, 0.25, -0.5]);
  });

  it("leaves two identical channels as they are, to the last bit: mono must not change the level", () => {
    const channel = Float32Array.from({ length: 1000 }, (_, i) => Math.fround(Math.sin(i) * 0.9));
    expect(toMono([channel, Float32Array.from(channel)])).toEqual(channel);
  });

  it("is the channel itself for one channel, and nothing for no audio", () => {
    expect([...toMono([Float32Array.of(0.25, -1)])]).toEqual([0.25, -1]);
    expect(toMono([new Float32Array(0), new Float32Array(0)])).toHaveLength(0);
    expect(toMono([])).toHaveLength(0);
  });
});

describe("renderSequence, loops cut into each other", () => {
  it("lets a pad's last hit of each loop be cut by its first hit of the next, as the page's loop does", async () => {
    const sounds = [sound("a")];
    const offline = fakeOffline();
    await renderSequence({
      song: songOf(sequence({ 0: [0] })),
      kit: createKit(sounds),
      stepsPerBar: 16,
      sampleRate: 1000,
      createContext: offline.createContext,
      loops: 3,
    });
    const stages = sounds[0].play.mock.calls.map((call) => call[1]);
    expect(stages).toHaveLength(4); // one warm-up pass and three loops
    [1, 2, 3].forEach((pass, i) => {
      // each pass's hit is cut where the next one starts (2 s on); the last loop's hit is cut by nothing
      const cut = stages[i].gain.setTargetAtTime;
      expect(cut).toHaveBeenCalledWith(0, LEAD_SECONDS + pass * 2, expect.any(Number));
    });
    expect(stages[3].gain.setTargetAtTime).not.toHaveBeenCalled();
  });
});

describe("encodeWav", () => {
  const view = (bytes) => new DataView(bytes);
  const text = (bytes, at, length) => String.fromCharCode(...new Uint8Array(bytes, at, length));

  it("writes a PCM header that says what the data is", () => {
    const bytes = encodeWav([new Float32Array(10), new Float32Array(10)], 44100);
    const v = view(bytes);
    expect(text(bytes, 0, 4)).toBe("RIFF");
    expect(text(bytes, 8, 4)).toBe("WAVE");
    expect(text(bytes, 12, 4)).toBe("fmt ");
    expect(text(bytes, 36, 4)).toBe("data");
    expect(v.getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(2); // channels
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(44100 * 2 * 2); // bytes a second
    expect(v.getUint16(32, true)).toBe(4); // bytes a frame
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(10 * 2 * 2);
    expect(bytes.byteLength).toBe(44 + 40);
  });

  it("interleaves the channels, as frames", () => {
    const bytes = encodeWav([Float32Array.of(0.5, -0.5), Float32Array.of(0.25, -0.25)], 8000);
    const v = view(bytes);
    expect(v.getInt16(44, true)).toBe(Math.round(0.5 * 0x7fff)); // left, frame 0
    expect(v.getInt16(46, true)).toBe(Math.round(0.25 * 0x7fff)); // right, frame 0
    expect(v.getInt16(48, true)).toBe(Math.round(-0.5 * 0x8000)); // left, frame 1
    expect(v.getInt16(50, true)).toBe(Math.round(-0.25 * 0x8000));
  });

  it("holds what is beyond full scale at full scale instead of wrapping round", () => {
    const bytes = encodeWav([Float32Array.of(2, -2, 1, -1)], 8000);
    const v = view(bytes);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([32767, -32768, 32767, -32768]);
  });

  it("writes a header alone for no audio", () => {
    expect(encodeWav([new Float32Array(0)], 44100).byteLength).toBe(44);
  });
});

describe("exportName", () => {
  it("names the sequence and the tempo", () => {
    expect(exportName({ current: 0, bpm: 100 })).toBe("pad16-seq-01-100bpm.wav");
    expect(exportName({ current: 7, bpm: 96.5 })).toBe("pad16-seq-08-97bpm.wav");
  });

  it("says how many loops and that it is mono, when they are not the plain export, so files do not overwrite each other", () => {
    const song = { current: 0, bpm: 100 };
    expect(exportName(song, { loops: 1, channels: "stereo" })).toBe("pad16-seq-01-100bpm.wav");
    expect(exportName(song, { loops: 4, channels: "stereo" })).toBe("pad16-seq-01-100bpm-x4.wav");
    expect(exportName(song, { loops: 1, channels: "mono" })).toBe("pad16-seq-01-100bpm-mono.wav");
    expect(exportName(song, { loops: 8, channels: "mono" })).toBe("pad16-seq-01-100bpm-x8-mono.wav");
  });
});

describe("exportSampleRate", () => {
  it("is the rate the page's audio runs at, so what is heard is what is saved and nothing is resampled", () => {
    expect(exportSampleRate(48000)).toBe(48000);
    expect(exportSampleRate(44100)).toBe(44100);
    expect(exportSampleRate(96000)).toBe(96000);
    expect(exportSampleRate(22050)).toBe(22050);
  });

  it("is 44.1 kHz when the page has no audio yet, or reports nothing usable", () => {
    for (const rate of [undefined, null, 0, -48000, NaN, Infinity, "48000"]) expect(exportSampleRate(rate)).toBe(44100);
  });

  it("is 44.1 kHz for a rate that would make a huge file or a poor one, rather than follow it", () => {
    expect(exportSampleRate(MAX_EXPORT_SAMPLE_RATE + 1)).toBe(44100);
    expect(exportSampleRate(192000)).toBe(44100);
    expect(exportSampleRate(MIN_EXPORT_SAMPLE_RATE - 1)).toBe(44100);
    expect(exportSampleRate(MAX_EXPORT_SAMPLE_RATE)).toBe(MAX_EXPORT_SAMPLE_RATE);
    expect(exportSampleRate(MIN_EXPORT_SAMPLE_RATE)).toBe(MIN_EXPORT_SAMPLE_RATE);
  });

  it("is a whole number of frames a second", () => {
    expect(exportSampleRate(44100.4)).toBe(44100);
  });
});

describe("exportSequence", () => {
  const kit = createKit([sound("a")]);
  const render = vi.fn(async () => ({ sampleRate: 8000, channels: [Float32Array.of(0.5), Float32Array.of(0.5)] }));
  const run = (song, extra = {}) => {
    const onMessage = vi.fn();
    const save = vi.fn();
    const done = exportSequence({ song, kit, stepsPerBar: 16, onMessage, save, render, supported: true, ...extra });
    return { done, onMessage, save };
  };

  it("renders the song, saves it as a wav under its name, and says so", async () => {
    const { done, onMessage, save } = run(songOf(sequence({ 0: [0] })));
    expect(await done).toBe(true);
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ song: expect.anything(), kit, stepsPerBar: 16 }));
    const [blob, name] = save.mock.calls[0];
    expect(name).toBe("pad16-seq-01-120bpm.wav");
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + 2 * 2); // a header and one frame of two channels
    expect(onMessage.mock.calls.map((call) => call[0])).toEqual(["EXPORTING...", "EXPORTED pad16-seq-01-120bpm.wav"]);
  });

  it("renders what it is told to, and names the file for it", async () => {
    render.mockClear();
    const { done, save } = run(songOf(sequence({ 0: [0] })), { options: { loops: 4, channels: "mono" } });
    expect(await done).toBe(true);
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ loops: 4, channels: "mono" }));
    expect(save.mock.calls[0][1]).toBe("pad16-seq-01-120bpm-x4-mono.wav");
  });

  it("renders at the rate it is given, and the file says so in its header", async () => {
    const echo = vi.fn(async ({ sampleRate }) => ({ sampleRate, channels: [Float32Array.of(0.5)] }));
    const { done, save } = run(songOf(sequence({ 0: [0] })), { sampleRate: 48000, render: echo });
    await done;
    expect(echo).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 48000 }));
    const header = new DataView(await save.mock.calls[0][0].arrayBuffer());
    expect(header.getUint32(24, true)).toBe(48000);
  });

  it("renders at 44.1 kHz when it is given no rate", async () => {
    render.mockClear();
    const { done } = run(songOf(sequence({ 0: [0] })));
    await done;
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 44100 }));
  });

  it("is the plain export, one loop in stereo, when it is told nothing", async () => {
    render.mockClear();
    const { done, save } = run(songOf(sequence({ 0: [0] })));
    await done;
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ loops: 1, channels: "stereo" }));
    expect(save.mock.calls[0][1]).toBe("pad16-seq-01-120bpm.wav");
  });

  it("treats options that are not choices as the plain export", async () => {
    render.mockClear();
    const { done } = run(songOf(sequence({ 0: [0] })), { options: { loops: 99, channels: "5.1" } });
    await done;
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ loops: 1, channels: "stereo" }));
  });

  it("says so, and renders nothing, when there is nothing in the sequence", async () => {
    render.mockClear();
    const { done, onMessage, save } = run(songOf(sequence({})));
    expect(await done).toBe(false);
    expect(onMessage).toHaveBeenCalledWith("NOTHING TO EXPORT");
    expect(render).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("says so when the browser cannot render offline", async () => {
    const { done, onMessage, save } = run(songOf(sequence({ 0: [0] })), { supported: false });
    expect(await done).toBe(false);
    expect(onMessage).toHaveBeenCalledWith("EXPORT NOT SUPPORTED");
    expect(save).not.toHaveBeenCalled();
  });

  it("says so, and does not throw, when the render fails", async () => {
    const { done, onMessage, save } = run(songOf(sequence({ 0: [0] })), {
      render: async () => {
        throw new Error("out of memory");
      },
    });
    expect(await done).toBe(false);
    expect(onMessage).toHaveBeenLastCalledWith("EXPORT FAILED");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("exportSequence, cancelled and with progress", () => {
  const kit = createKit([sound("a")]);
  const song = songOf(sequence({ 0: [0] }));
  const cancelledError = () => new DOMException("stop", "AbortError");

  it("says it was cancelled, and saves nothing, when the render is cancelled; that is not a failure", async () => {
    const onMessage = vi.fn();
    const save = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const render = async () => {
      throw cancelledError();
    };
    const done = await exportSequence({ song, kit, stepsPerBar: 16, onMessage, save, render, supported: true });
    expect(done).toBe(false);
    expect(onMessage).toHaveBeenLastCalledWith("EXPORT CANCELLED");
    expect(save).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("hands the render its signal and its progress callback", async () => {
    const render = vi.fn(async () => ({ sampleRate: 8000, channels: [Float32Array.of(0)] }));
    const signal = new AbortController().signal;
    const onProgress = vi.fn();
    await exportSequence({
      song,
      kit,
      stepsPerBar: 16,
      onMessage() {},
      save() {},
      render,
      supported: true,
      signal,
      onProgress,
    });
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ signal, onProgress }));
  });
});

describe("exportSequence, a cancel while the file is encoded", () => {
  it("is heard before the file is saved: encoding is one long task, so it gives the event loop a turn first", async () => {
    const kit = createKit([sound("a")]);
    const controller = new AbortController();
    const onMessage = vi.fn();
    const save = vi.fn();
    // The press on Cancel arrives while the page is busy encoding: a task queued when the render ended.
    const render = async () => {
      setTimeout(() => controller.abort(), 0);
      return { sampleRate: 8000, channels: [Float32Array.of(0.5)] };
    };
    const done = await exportSequence({
      song: songOf(sequence({ 0: [0] })),
      kit,
      stepsPerBar: 16,
      onMessage,
      save,
      render,
      supported: true,
      signal: controller.signal,
    });
    expect(done).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenLastCalledWith("EXPORT CANCELLED");
  });
});

describe("wasCancelled", () => {
  it("wasCancelled is whether an error is an abort", () => {
    expect(wasCancelled(new DOMException("x", "AbortError"))).toBe(true);
    expect(wasCancelled(new Error("x"))).toBe(false);
    expect(wasCancelled(undefined)).toBe(false);
  });
});

describe("windowPauses, at the rates an export can be made at", () => {
  it.each([22050, 44100, 48000, 96000])("%i Hz: whole blocks, a window apart, none twice", (rate) => {
    const total = rate * 5;
    const frames = windowPauses(total, rate, 1);
    expect(frames).toHaveLength(4);
    expect(frames.every((frame) => frame % 128 === 0 && frame > 0 && frame < total)).toBe(true);
    frames.forEach((frame, i) => expect(Math.abs(frame - (i + 1) * rate)).toBeLessThanOrEqual(64));
    expect(new Set(frames).size).toBe(frames.length);
  });
});

describe("windowPauses", () => {
  it("puts a pause at the end of each window, on whole blocks of 128 frames, none at the start or the end", () => {
    const total = 44100 * 10;
    const frames = windowPauses(total, 44100, 1);
    expect(frames).toHaveLength(9); // 10 seconds in windows of 1: 9 inside
    expect(frames.every((frame) => frame % 128 === 0 && frame > 0 && frame < total)).toBe(true);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
    frames.forEach((frame, i) => expect(Math.abs(frame - (i + 1) * 44100)).toBeLessThanOrEqual(64)); // to the nearest block
  });

  it("never pauses twice in one block, however short the window", () => {
    const frames = windowPauses(100_000, 44100, 0.001);
    expect(new Set(frames).size).toBe(frames.length);
  });

  it("has no pause for a render that fits in one window", () => {
    expect(windowPauses(44100, 44100, 1)).toEqual([]);
    expect(windowPauses(100, 44100, 1)).toEqual([]);
  });

  it("is a window of a second unless told otherwise", () => {
    expect(WINDOW_SECONDS).toBe(1);
    expect(windowPauses(44100 * 3, 44100)).toHaveLength(2);
  });
});

describe("renderSequence, in windows", () => {
  // 120 BPM, 16 steps a bar: a bar is 2 s and a sixteenth 0.125 s; at 1000 Hz, a window of 1 s is 1000 frames.
  const run = ({ pausable = true, windowSeconds = 1, loops = 3, steps = [0, 4, 8, 12], extra = {} } = {}) => {
    const scheduled = [];
    const played = {
      id: "a",
      name: "a",
      play: vi.fn((ctx, _out, time) => scheduled.push({ time, at: ctx.currentTime })),
    };
    const offline = fakeOffline({ pausable });
    let ended = false;
    const start = offline.ctx.startRendering;
    offline.ctx.startRendering = () => start().then((rendered) => ((ended = true), rendered)); // the render ran to its end
    const done = renderSequence({
      song: songOf(sequence({ 0: steps })),
      kit: createKit([played]),
      stepsPerBar: 16,
      sampleRate: 1000,
      createContext: offline.createContext,
      loops,
      windowSeconds,
      ...extra,
    });
    return { done, offline, scheduled, hasEnded: () => ended };
  };

  it("starts the hits a little at a time, about a window or more before they sound, once it is going", async () => {
    const { done, scheduled } = run();
    await done;
    expect(scheduled.length).toBe(16); // one warm-up pass and three loops of four hits
    for (const { time, at } of scheduled.filter((hit) => hit.at > 0)) {
      // about a window ahead of where the render is, to the nearest block of 128 frames (0.128 s at this rate), and in any
      // case further than the 5 ms a late sample is moved on by
      expect(time - at).toBeGreaterThanOrEqual(1 - 128 / 1000);
      expect(time - at).toBeGreaterThan(TRIM_LEAD_SECONDS);
    }
    expect(scheduled.filter(({ at }) => at === 0).every(({ time }) => time < 2 + 1e-9)).toBe(true); // before the start: two windows
    expect(scheduled.some(({ at }) => at > 0)).toBe(true); // and the rest as it goes
  });

  it("never has more than a few windows' worth of hits waiting to sound", async () => {
    const { done, scheduled } = run({ steps: Array.from({ length: 16 }, (_, i) => i), loops: 4 });
    await done;
    expect(scheduled.length).toBe(16 * 5);
    let waiting = 0;
    for (const { at } of scheduled)
      waiting = Math.max(waiting, scheduled.filter((hit) => hit.at <= at && hit.time > at).length);
    expect(waiting).toBeLessThanOrEqual(24); // two windows of eight sixteenths a second, with the one in hand; not all 80
  });

  it("starts exactly the hits, at the same times and in the same order, as a render that is scheduled in one go", async () => {
    const windowed = run();
    const whole = run({ pausable: false });
    await Promise.all([windowed.done, whole.done]);
    expect(windowed.scheduled.map(({ time }) => time)).toEqual(whole.scheduled.map(({ time }) => time));
  });

  it("schedules everything before it starts when the browser cannot pause an offline context", async () => {
    const { done, scheduled } = run({ pausable: false });
    await done;
    expect(scheduled.every(({ at }) => at === 0)).toBe(true);
    expect(scheduled).toHaveLength(16);
  });

  it("fails, rather than leave the rest of the sequence unscheduled and silent, when a pause cannot be set", async () => {
    const offline = fakeOffline({ pausable: true });
    const set = offline.ctx.suspend.getMockImplementation();
    let calls = 0;
    offline.ctx.suspend.mockImplementation((time) =>
      calls++ === 1 ? Promise.reject(new Error("too late")) : set(time),
    );
    await expect(
      renderSequence({
        song: songOf(sequence({ 0: [0, 4, 8, 12] })),
        kit: createKit([sound("a")]),
        stepsPerBar: 16,
        sampleRate: 1000,
        createContext: offline.createContext,
        loops: 3,
        windowSeconds: 1,
      }),
    ).rejects.toThrow("too late");
  });

  it("has a pad's source stopped when the pad's next hit cuts it, a little after, and no earlier", async () => {
    const stops = [];
    const sample = { id: "s", name: "s", play: vi.fn(() => ({ stop: (time) => stops.push(time) })), setTrim() {} };
    const offline = fakeOffline({ pausable: true });
    await renderSequence({
      song: songOf(sequence({ 0: [0, 8] })), // 120 BPM: two hits a second apart, in a loop of two seconds
      kit: createKit([sample]),
      stepsPerBar: 16,
      sampleRate: 1000,
      createContext: offline.createContext,
      loops: 1,
      windowSeconds: 1,
    });
    // the hit at 0.01 is cut at 1.01, and so on; a stop is 0.1 s after the cut (the pad has no release)
    expect(stops.slice(0, 2)).toEqual([1.01 + 0.1, 2.01 + 0.1]);
    expect(stops).toHaveLength(3); // four hits, the last not cut by any
  });

  it("starts nothing more once the render has failed: a sound that throws does not throw again every window", async () => {
    const calls = [];
    const failing = {
      id: "a",
      name: "a",
      play: vi.fn((_ctx, _out, time) => {
        calls.push(time);
        if (calls.length === 6) throw new Error("a sound that broke");
      }),
    };
    const offline = fakeOffline({ pausable: true });
    const done = renderSequence({
      song: songOf(sequence({ 0: [0, 4, 8, 12] })),
      kit: createKit([failing]),
      stepsPerBar: 16,
      sampleRate: 1000,
      createContext: offline.createContext,
      loops: 8,
      windowSeconds: 1,
    });
    await expect(done).rejects.toThrow("a sound that broke");
    await new Promise((resolve) => setTimeout(resolve, 30)); // the render runs out; its remaining pauses only resume
    expect(calls).toHaveLength(6);
  });

  it("stops scheduling when cancelled, lets the render go with nothing to hear, and rejects as cancelled", async () => {
    const controller = new AbortController();
    const reports = [];
    const { done, offline, scheduled, hasEnded } = run({
      loops: 8,
      extra: {
        signal: controller.signal,
        onProgress: (fraction) => {
          reports.push(fraction);
          if (reports.length === 2) controller.abort();
        },
      },
    });
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    const scheduledAtAbort = scheduled.length;
    await new Promise((resolve) => setTimeout(resolve, 30)); // the render goes on to its end, unheard
    expect(scheduled).toHaveLength(scheduledAtAbort); // nothing more was started
    expect(reports).toHaveLength(2); // nor reported
    const master = offline.nodes[0];
    expect(master.disconnect).toHaveBeenCalled(); // so that what is left of the graph does no work
    await vi.waitFor(() => expect(hasEnded()).toBe(true)); // and it is not left paused for good: a browser never frees that
    expect(scheduled.length).toBeLessThan(16 + 4 * 8); // and most of it never existed
  });
});

describe("renderSequence, progress and cancel", () => {
  const render = (extra = {}, offlineOptions = { pausable: true }) => {
    const offline = fakeOffline(offlineOptions);
    const done = renderSequence({
      song: songOf(sequence({ 0: [0] }, {}, 2)),
      kit: createKit([sound("a")]),
      stepsPerBar: 16,
      sampleRate: 44100,
      createContext: (frames, rate) => offline.createContext(frames, rate),
      ...extra,
    });
    return { done, offline };
  };

  it("reports how far it has got, rising, at each pause, and ends on 1", async () => {
    const reports = [];
    const { done, offline } = render({ onProgress: (fraction) => reports.push(fraction) });
    await done;
    expect(reports.length).toBeGreaterThan(5);
    expect(reports).toEqual([...reports].sort((a, b) => a - b));
    expect(reports.at(-1)).toBe(1);
    expect(reports.slice(0, -1).every((fraction) => fraction > 0 && fraction < 1)).toBe(true);
    expect(offline.ctx.resume).toHaveBeenCalledTimes(reports.length - 1);
  });

  it("sets each pause a little before a block edge in seconds, all inside the render", async () => {
    const { done, offline } = render();
    await done;
    const times = offline.ctx.suspend.mock.calls.map((call) => call[0]);
    const frames = windowPauses(offline.made.frames, 44100);
    expect(times).toHaveLength(frames.length);
    times.forEach((time, i) => {
      expect(time * 44100).toBeGreaterThan(frames[i] - 128);
      expect(time * 44100).toBeLessThan(frames[i]);
    });
  });

  it("stops at the next pause when cancelled: rejects as cancelled, and reports nothing more", async () => {
    const controller = new AbortController();
    const reports = [];
    const { done } = render({
      signal: controller.signal,
      onProgress: (fraction) => {
        reports.push(fraction);
        if (reports.length === 2) controller.abort();
      },
    });
    // the abort comes from the report, so the render is cancelled between the second report and the next
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(reports).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reports).toHaveLength(2); // nothing is reported after it
  });

  it("when cancelled between pauses, is not over until the render has reached the next one", async () => {
    const offline = fakeOffline({ pausable: true });
    const reaches = [];
    // the pauses are driven by hand, and the render never ends by itself: it is only ever at a pause or running
    offline.ctx.suspend.mockImplementation(() => new Promise((reach) => reaches.push(reach)));
    offline.ctx.startRendering = () => new Promise(() => {});
    const controller = new AbortController();
    let settled = false;
    const done = renderSequence({
      song: songOf(sequence({ 0: [0] })),
      kit: createKit([sound("a")]),
      stepsPerBar: 16,
      sampleRate: 1000,
      createContext: offline.createContext,
      signal: controller.signal,
      windowSeconds: 1,
    });
    done.catch(() => {}).then(() => (settled = true));
    reaches[0](); // the first pause is reached and resumed
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(offline.ctx.resume).toHaveBeenCalledTimes(1);
    controller.abort(); // cancelled while it renders towards the second
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false); // still rendering, so still busy: another export may not start beside it
    reaches[1](); // the second pause is reached
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not start when it is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { done, offline } = render({ signal: controller.signal });
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(offline.ctx.suspend).not.toHaveBeenCalled();
  });

  it("renders in one go, reporting only the end, in a browser that cannot pause an offline context", async () => {
    const reports = [];
    const { done } = render({ onProgress: (fraction) => reports.push(fraction) }, { pausable: false });
    await done;
    expect(reports).toEqual([1]);
  });

  it("without a pause to stop at, a cancel waits for the render to end, then throws it away", async () => {
    const offline = fakeOffline();
    const render = offline.ctx.startRendering;
    let finish;
    offline.ctx.startRendering = () => new Promise((resolve) => (finish = resolve)).then(render);
    const controller = new AbortController();
    let settled = false;
    const done = renderSequence({
      song: songOf(sequence({ 0: [0] })),
      kit: createKit([sound("a")]),
      stepsPerBar: 16,
      sampleRate: 1000,
      createContext: offline.createContext,
      signal: controller.signal,
    });
    done.catch(() => {}).then(() => (settled = true));
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false); // still rendering, so still busy: no second render may start beside it
    finish();
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails with the error, rather than hang paused, when a pause cannot be resumed", async () => {
    const { done, offline } = render();
    offline.ctx.resume = vi.fn(async () => {
      throw new Error("cannot resume");
    });
    await expect(done).rejects.toThrow("cannot resume");
  });

  it("goes on rendering when reporting the progress throws: the report is only for the eye", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { done } = render({
      onProgress: () => {
        throw new Error("the button is gone");
      },
    });
    const audio = await done;
    expect(audio.channels).toHaveLength(2);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("works with no progress callback and no signal", async () => {
    const { done } = render();
    const audio = await done;
    expect(audio.channels).toHaveLength(2);
  });
});

describe("createExportAction", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const setup = (extra = {}) => {
    const onMessage = vi.fn();
    const onBusy = vi.fn();
    const run = vi.fn(async () => true);
    const press = createExportAction({ ready: () => Promise.resolve(), run, onMessage, onBusy, ...extra });
    return { press, run, onMessage, onBusy };
  };

  it("recovers, and can be pressed again, when taking the snapshot throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const snapshot = vi.fn(() => {
      if (fail) throw new Error("no song");
      return "song";
    });
    const { press, run, onMessage, onBusy } = setup({ snapshot });
    expect(await press()).toBe(false);
    expect(onMessage).toHaveBeenLastCalledWith("EXPORT FAILED");
    expect(onBusy).toHaveBeenLastCalledWith(false);
    fail = false;
    expect(await press()).toBe(true); // not stuck "working" on an export that never started
    expect(run).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("recovers, and can be pressed again, when the button's busy callback throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const onBusy = vi.fn((busy) => {
      if (busy && fail) throw new Error("no button");
    });
    const { press, run, onMessage } = setup({ onBusy });
    expect(await press()).toBe(false);
    expect(onMessage).toHaveBeenLastCalledWith("EXPORT FAILED");
    fail = false;
    expect(await press()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("says the samples could not be loaded, rather than that the export failed, when restoring them failed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const clearTimer = vi.fn();
    const { press, run, onMessage } = setup({ ready: () => Promise.reject(new Error("db")), clearTimer });
    expect(await press()).toBe(false);
    expect(onMessage).toHaveBeenLastCalledWith("SAMPLES FAILED TO LOAD");
    expect(run).not.toHaveBeenCalled();
    expect(clearTimer).toHaveBeenCalled(); // the wait's timer is not left running
    expect(error).toHaveBeenCalled(); // for the eye: the reason is in the console
    error.mockRestore();
  });

  it("says the same when asking whether they are back throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { press, onMessage } = setup({
      ready: () => {
        throw new Error("no store");
      },
    });
    expect(await press()).toBe(false);
    expect(onMessage).toHaveBeenLastCalledWith("SAMPLES FAILED TO LOAD");
    error.mockRestore();
  });

  it("takes its snapshot when it is pressed, before it waits for the samples, and hands the run that one", async () => {
    let state = "as pressed";
    let samplesBack;
    const snapshot = vi.fn(() => state);
    const { press, run } = setup({ snapshot, ready: () => new Promise((resolve) => (samplesBack = resolve)) });
    const done = press();
    state = "moved while it waited"; // a controller's tempo knob, say
    samplesBack();
    await done;
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ snapshot: "as pressed" }));
  });

  it("takes no snapshot for a press that only cancels", async () => {
    const snapshot = vi.fn(() => "x");
    const { press } = setup({ snapshot, ready: () => new Promise(() => {}) });
    press();
    await flush();
    await press(); // while it works: cancels
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it("runs the export once the samples are back, and shows it is busy only while it works", async () => {
    const { press, run, onBusy } = setup();
    expect(await press()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onBusy.mock.calls.map((call) => call[0])).toEqual([true, false]);
  });

  it("waits for the samples before it renders", async () => {
    let restored;
    const { press, run } = setup({ ready: () => new Promise((resolve) => (restored = resolve)) });
    const pressed = press();
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    restored();
    await pressed;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("says so, and renders nothing, when the samples do not come back in time, and can be pressed again", async () => {
    vi.useFakeTimers();
    const { press, run, onMessage, onBusy } = setup({ ready: () => new Promise(() => {}) });
    const pressed = press();
    await vi.advanceTimersByTimeAsync(READY_WAIT_MS);
    expect(await pressed).toBe(false);
    expect(onMessage).toHaveBeenCalledWith("SAMPLES STILL LOADING");
    expect(run).not.toHaveBeenCalled();
    expect(onBusy).toHaveBeenLastCalledWith(false);
    onMessage.mockClear();
    const again = press();
    await vi.advanceTimersByTimeAsync(READY_WAIT_MS);
    await again;
    expect(onMessage).toHaveBeenCalledWith("SAMPLES STILL LOADING"); // it is a new press, not a dead button
    vi.useRealTimers();
  });

  it("says so, and renders nothing, when restoring the samples failed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { press, run, onMessage, onBusy } = setup({ ready: () => Promise.reject(new Error("blocked")) });
    expect(await press()).toBe(false);
    expect(onMessage).toHaveBeenCalledWith("SAMPLES FAILED TO LOAD"); // the reason, not a bare "failed"
    error.mockRestore();
    expect(run).not.toHaveBeenCalled();
    expect(onBusy).toHaveBeenLastCalledWith(false);
  });

  it("says so, and can be pressed again, when the export throws", async () => {
    const { press, run, onMessage } = setup();
    run.mockRejectedValueOnce(new Error("boom"));
    expect(await press()).toBe(false);
    expect(onMessage).toHaveBeenCalledWith("EXPORT FAILED");
    expect(await press()).toBe(true);
  });

  it("cancels when pressed while it works: the run's signal aborts, a second press does not start another", async () => {
    let signal;
    let finish;
    const run = vi.fn((options) => {
      signal = options.signal;
      return new Promise((resolve) => (finish = resolve));
    });
    const { press, onBusy } = setup({ run });
    const first = press();
    await flush();
    expect(signal.aborted).toBe(false);
    expect(await press()).toBe(false);
    expect(signal.aborted).toBe(true);
    expect(await press()).toBe(false); // while it is stopping: nothing more
    expect(run).toHaveBeenCalledTimes(1);
    expect(onBusy).toHaveBeenCalledTimes(1); // still busy until the run has ended
    finish(false);
    await first;
    expect(onBusy.mock.calls.map((call) => call[0])).toEqual([true, false]);
  });

  it("tells the button it was asked to cancel, once, however often it is pressed", async () => {
    let finish;
    const run = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const onCancel = vi.fn();
    const { press } = setup({ run, onCancel });
    const first = press();
    await flush();
    expect(onCancel).not.toHaveBeenCalled();
    await press();
    await press();
    expect(onCancel).toHaveBeenCalledTimes(1);
    finish(false);
    await first;
    const second = press();
    await flush();
    await press();
    expect(onCancel).toHaveBeenCalledTimes(2); // a new export is cancelled afresh
    finish(false);
    await second;
  });

  it("can be pressed again after a cancel, and the new export is not already cancelled", async () => {
    const signals = [];
    let finish;
    const run = vi.fn(({ signal }) => {
      signals.push(signal);
      return new Promise((resolve) => (finish = resolve));
    });
    const { press } = setup({ run });
    const first = press();
    await flush();
    await press();
    finish(false);
    await first;
    const second = press();
    await flush();
    expect(signals[1].aborted).toBe(false);
    finish(true);
    expect(await second).toBe(true);
  });

  it("cancels while it waits for the samples: says so and renders nothing", async () => {
    const { press, run, onMessage, onBusy } = setup({ ready: () => new Promise(() => {}) });
    const first = press();
    await Promise.resolve();
    await press();
    expect(await first).toBe(false);
    expect(onMessage).toHaveBeenCalledWith("EXPORT CANCELLED");
    expect(run).not.toHaveBeenCalled();
    expect(onBusy).toHaveBeenLastCalledWith(false);
  });

  it("hands the run a way to report progress, and passes it on", async () => {
    const onProgress = vi.fn();
    const run = vi.fn(async (options) => {
      options.onProgress(0.5);
      return true;
    });
    const { press } = setup({ run, onProgress });
    await press();
    expect(onProgress).toHaveBeenCalledWith(0.5);
  });
});

describe("stemPads", () => {
  it("is the pads that have a step in the bars the sequence has, in pad order", () => {
    expect(stemPads(songOf(sequence({ 5: [0], 2: [3, 4], 9: [] })), 16)).toEqual([2, 5]);
  });

  it("leaves out a pad whose only steps are in bars the sequence does not have", () => {
    expect(stemPads(songOf(sequence({ 0: [0], 1: [20] }, {}, 1)), 16)).toEqual([0]);
    expect(stemPads(songOf(sequence({ 0: [0], 1: [20] }, {}, 2)), 16)).toEqual([0, 1]);
  });

  it("is nothing for a sequence with nothing in it", () => {
    expect(stemPads(songOf(sequence({})), 16)).toEqual([]);
  });
});

describe("stemName and stemsName", () => {
  const kit = createKit([sound("Kick"), sound("Closed Hat!"), sound("  ")]);
  const song = songOf(sequence({ 0: [0] }), { bpm: 100 });

  it("names a stem for the sequence, the options, the pad's number (from 1) and its sound", () => {
    expect(stemName(song, { loops: 1, channels: "stereo" }, kit, 0)).toBe("pad16-seq-01-100bpm-pad01-kick.wav");
    expect(stemName(song, { loops: 4, channels: "mono" }, kit, 1)).toBe(
      "pad16-seq-01-100bpm-x4-mono-pad02-closed-hat.wav",
    );
  });

  it("falls back to the pad's number alone when its sound has no name worth a file name", () => {
    expect(stemName(song, undefined, kit, 2)).toBe("pad16-seq-01-100bpm-pad03.wav");
  });

  it("keeps a loaded sample's name to letters and digits, accents taken off, and not too long", () => {
    const sampleKit = createKit([sound("Caja Ñandú (90s) — the extremely long file name of a sample.wav")]);
    const name = stemName(song, undefined, sampleKit, 0);
    expect(name).toMatch(/^pad16-seq-01-100bpm-pad01-[a-z0-9-]+\.wav$/);
    expect(name).toContain("caja-nandu-90s");
    expect(name.length).toBeLessThan(70);
    expect(name).not.toMatch(/--|-\.wav/);
  });

  it("gives two pads with the same sound two different names", () => {
    const twins = createKit([sound("Kick"), sound("Kick")]);
    expect(stemName(song, undefined, twins, 0)).not.toBe(stemName(song, undefined, twins, 1));
  });

  it("names the zip for the sequence and the options, as the file is", () => {
    expect(stemsName(song, { loops: 1, channels: "stereo" })).toBe("pad16-seq-01-100bpm-stems.zip");
    expect(stemsName(song, { loops: 2, channels: "mono" })).toBe("pad16-seq-01-100bpm-x2-mono-stems.zip");
  });

  it("leaves the name of the plain export as it was", () => {
    expect(exportName(song, { loops: 4, channels: "mono" })).toBe("pad16-seq-01-100bpm-x4-mono.wav");
  });
});

describe("planRender, for one pad's stem", () => {
  const kitOf = (...choke) => {
    const kit = createKit([sound("a"), sound("b"), sound("c")]);
    choke.forEach((group, pad) => kit.setSetting(pad, "choke", group));
    return kit;
  };
  const stemPlan = (pad, kit, pattern = { 0: [0, 8], 1: [4], 2: [12] }) =>
    planRender({ song: songOf(sequence(pattern)), kit, stepsPerBar: 16, sampleRate: 1000, pad });

  it("is the pad's own hits alone when it is in no choke group: another pad cannot cut it", () => {
    const plan = stemPlan(0, kitOf(0, 0, 0));
    expect(plan.hits.map(({ row, step }) => [row, step])).toEqual([
      [0, 0],
      [0, 8],
    ]);
    expect(plan.hits.some((hit) => hit.silent)).toBe(false);
  });

  it("adds, as silent hits, those of the pads in its choke group, which cut it", () => {
    const plan = stemPlan(0, kitOf(1, 1, 0));
    expect(plan.hits.map(({ row, step, silent }) => [row, step, Boolean(silent)])).toEqual([
      [0, 0, false],
      [1, 4, true],
      [0, 8, false],
    ]);
  });

  it("does not take a pad in another group, or in none, for one in its group", () => {
    const plan = stemPlan(0, kitOf(1, 2, 0));
    expect(plan.hits.every(({ row }) => row === 0)).toBe(true);
    expect(stemPlan(0, kitOf(0, 0, 0)).hits.every(({ row }) => row === 0)).toBe(true); // group 0 is no group
  });

  it("is the whole sequence, with no hit silent, when no pad is asked for", () => {
    const plan = planRender({
      song: songOf(sequence({ 0: [0], 1: [4] })),
      kit: kitOf(1, 1, 0),
      stepsPerBar: 16,
      sampleRate: 1000,
    });
    expect(plan.hits).toHaveLength(2);
    expect(plan.hits.some((hit) => "silent" in hit)).toBe(false);
  });

  it("is on the whole sequence's timeline, but schedules only the passes its own pad can be heard from", () => {
    const longTail = createKit([sound("a"), sample(1, { start: 0, end: 1 })]);
    longTail.setSetting(1, "release", 100); // a loaded sample's Release: 5 s, in a loop of 2 s: three more warm-up passes
    const song = songOf(sequence({ 0: [0], 1: [4] }));
    const whole = planRender({ song, kit: longTail, stepsPerBar: 16, sampleRate: 1000 });
    expect(whole.warmUp).toBe(4);
    expect(whole.skipped).toBe(0);
    const short = planRender({ song, kit: longTail, stepsPerBar: 16, sampleRate: 1000, pad: 0 });
    expect(short.warmUp).toBe(4); // the mix's, so its hits sound at the frames they do there
    expect(short.skipped).toBe(3); // but the pad's own tail is short: one warm-up pass is enough
    expect(short.first).toBe(whole.first);
    const long = planRender({ song, kit: longTail, stepsPerBar: 16, sampleRate: 1000, pad: 1 });
    expect(long.skipped).toBe(0);
  });

  it("leaves out a pass only when the pad's tail is gone by the file, twice its release away, not one release", () => {
    // Releases of 5 s (setting 100), 2.56 s (80: the setting is a cube, 5 s x (setting / 100)^3) and 0, in a loop of 2 s: the
    // mix warms up for 1 + ceil(5 / 2) = 4 passes
    const kit = createKit([sample(1), sample(1), sound("c")]);
    kit.setSetting(0, "release", 80);
    kit.setSetting(1, "release", 100);
    const song = songOf(sequence({ 0: [15], 1: [3], 2: [0] }));
    const skipped = (pad) => planRender({ song, kit, stepsPerBar: 16, sampleRate: 1000, pad }).skipped;
    expect(skipped(1)).toBe(0); // the longest release is the mix's own
    expect(skipped(0)).toBe(0); // one release would be 1 + ceil(2.56 / 2) = 3 passes and skip one: a tail of -61 dB is left out
    expect(skipped(2)).toBe(3); // a sound with no release needs the one pass
  });

  it("does not let a pad that only cuts it make it warm up for longer: its tail is the pad's own", () => {
    const longTail = createKit([sound("a"), sample(1, { start: 0, end: 1 })]);
    longTail.setSetting(1, "release", 100);
    longTail.setSetting(0, "choke", 1);
    longTail.setSetting(1, "choke", 1);
    const plan = planRender({
      song: songOf(sequence({ 0: [0], 1: [4] })),
      kit: longTail,
      stepsPerBar: 16,
      sampleRate: 1000,
      pad: 0,
    });
    expect(plan.skipped).toBe(3);
  });

  it("is the same length as the whole render: a stem lines up with the mix", () => {
    const kit = kitOf(1, 1, 0);
    const whole = planRender({ song: songOf(sequence({ 0: [0], 1: [4] })), kit, stepsPerBar: 16, sampleRate: 1000 });
    const stem = stemPlan(1, kit, { 0: [0], 1: [4] });
    expect([stem.first, stem.frames, stem.total]).toEqual([whole.first, whole.frames, whole.total]);
  });
});

describe("renderCost", () => {
  it("is more for a pad with more hits, and counts the passes", () => {
    const kit = createKit([sound("a"), sound("b")]);
    const plan = (pattern, loops) =>
      planRender({ song: songOf(sequence(pattern)), kit, stepsPerBar: 16, sampleRate: 1000, loops });
    expect(renderCost(plan({ 0: [0, 1, 2, 3] }, 1))).toBeGreaterThan(renderCost(plan({ 0: [0] }, 1)));
    expect(renderCost(plan({ 0: [0] }, 4))).toBeGreaterThan(renderCost(plan({ 0: [0] }, 1)));
  });

  it("counts only the passes a stem schedules: the empty ones before it cost next to nothing", () => {
    const kit = createKit([sound("a"), sample(1, { start: 0, end: 1 })]);
    kit.setSetting(1, "release", 100); // the mix warms up for four passes
    const song = songOf(sequence({ 0: [0], 1: [4] }));
    const stem = planRender({ song, kit, stepsPerBar: 16, sampleRate: 1000, pad: 0 });
    const whole = planRender({ song, kit, stepsPerBar: 16, sampleRate: 1000 });
    expect(stem.passes).toBe(whole.passes);
    expect(renderCost(stem)).toBe((stem.passes - 3) * 2); // one hit, in the passes from the fourth on
  });

  it("does not count a hit that only cuts: it makes no sound to compute", () => {
    const kit = createKit([sound("a"), sound("b")]);
    kit.setSetting(0, "choke", 1);
    kit.setSetting(1, "choke", 1);
    const song = songOf(sequence({ 0: [0], 1: [4, 5, 6, 7] }));
    const withCutters = planRender({ song, kit, stepsPerBar: 16, sampleRate: 1000, pad: 0 });
    const alone = planRender({ song: songOf(sequence({ 0: [0] })), kit, stepsPerBar: 16, sampleRate: 1000, pad: 0 });
    expect(renderCost(withCutters)).toBe(renderCost(alone));
  });
});

describe("renderSequence, one pad's stem", () => {
  const run = ({ pad, choke = [0, 0, 0], pattern = { 0: [0], 1: [4], 2: [8] }, ...extra } = {}) => {
    const sounds = [sound("a"), sound("b"), sound("c")];
    const kit = createKit(sounds);
    choke.forEach((group, row) => kit.setSetting(row, "choke", group));
    const offline = fakeOffline();
    const done = renderSequence({
      song: songOf(sequence(pattern)),
      kit,
      stepsPerBar: 16,
      sampleRate: 1000,
      createContext: offline.createContext,
      pad,
      ...extra,
    });
    return { done, sounds, offline };
  };
  const cutsAt = (offline, time) =>
    offline.nodes.filter((node) =>
      node.gain.setTargetAtTime.mock.calls.some((call) => call[0] === 0 && call[1] === time),
    ).length;

  it("plays only the pad's sound: the other pads' are never made", async () => {
    const { done, sounds } = run({ pad: 1 });
    await done;
    expect(sounds[1].play).toHaveBeenCalledTimes(2); // the warm-up pass and the kept one
    expect(sounds[0].play).not.toHaveBeenCalled();
    expect(sounds[2].play).not.toHaveBeenCalled();
  });

  it("is the whole mix when no pad is asked for", async () => {
    const { done, sounds } = run({});
    await done;
    for (const each of sounds) expect(each.play).toHaveBeenCalledTimes(2);
  });

  it("is cut by the pads of its choke group, without their sounds being made", async () => {
    const grouped = run({ pad: 0, choke: [1, 1, 0] });
    await grouped.done;
    expect(grouped.sounds[1].play).not.toHaveBeenCalled(); // pad 1 only cuts
    expect(cutsAt(grouped.offline, LEAD_SECONDS + 0.5)).toBe(1); // pad 0's voice, cut at pad 1's step (4 steps of 0.125 s)
    const apart = run({ pad: 0, choke: [1, 2, 0] });
    await apart.done;
    expect(cutsAt(apart.offline, LEAD_SECONDS + 0.5)).toBe(0); // another group: nothing cuts it there
  });

  it("is cut at its very start by a pad of its group with a higher number on the same step, and not by a lower one", async () => {
    // The voices that are heard: those connected to the master (a silent hit's voice goes to the sink)
    const zeroGains = (offline, time) =>
      offline.nodes.filter(
        (node) =>
          node.connect.mock.calls.some((call) => call[0] === offline.nodes[0]) &&
          node.gain.setValueAtTime.mock.calls.some((call) => call[0] === 0 && call[1] === time),
      ).length;
    const pattern = { 0: [4], 1: [4] };
    const first = run({ pad: 0, choke: [1, 1, 0], pattern });
    await first.done;
    expect(zeroGains(first.offline, LEAD_SECONDS + 0.5)).toBe(1); // pad 1 starts after it, on the step, and silences it
    const second = run({ pad: 1, choke: [1, 1, 0], pattern });
    await second.done;
    expect(zeroGains(second.offline, LEAD_SECONDS + 0.5)).toBe(0); // pad 0 was first: the one handled last is heard
  });

  it("is not cut by a pad that is in no group", async () => {
    const { done, offline } = run({ pad: 0, choke: [0, 0, 0] });
    await done;
    expect(cutsAt(offline, LEAD_SECONDS + 0.5)).toBe(0);
  });

  it("starts every hit at the very time it has in the mix, though it schedules fewer passes", async () => {
    const make = (pad) => {
      const sounds = [sound("a"), sample(1)];
      const kit = createKit(sounds);
      kit.setSetting(1, "release", 100); // 5 s in a loop of 2 s: the mix warms up for four passes
      const offline = fakeOffline();
      const done = renderSequence({
        song: songOf(sequence({ 0: [0, 8], 1: [4] })),
        kit,
        stepsPerBar: 16,
        sampleRate: 1000,
        createContext: offline.createContext,
        pad,
      });
      return { done, sounds };
    };
    const whole = make(undefined);
    const stem = make(0);
    await Promise.all([whole.done, stem.done]);
    const times = (made) => made.sounds[0].play.mock.calls.map((call) => call[2]);
    // The stem plays pad 0 in the last two passes of the mix's five (warm-up of four and the file's one)... and not before
    expect(times(stem).length).toBeLessThan(times(whole).length);
    expect(times(whole).slice(-times(stem).length)).toEqual(times(stem));
  });

  it("is as long as the whole render, with the same window, whichever pad it is", async () => {
    const whole = run({});
    const stem = run({ pad: 2 });
    await Promise.all([whole.done, stem.done]);
    expect(stem.offline.made.frames).toBe(whole.offline.made.frames);
  });

  it("is at the master volume, and straight to the output when it is asked not to clip", async () => {
    const { kit, offline } = (() => {
      const o = fakeOffline();
      return { kit: createKit([sound("a")]), offline: o };
    })();
    const base = offline.createContext;
    const shaper = { curve: null, oversample: "2x", connect: vi.fn() };
    await renderSequence({
      song: songOf(sequence({ 0: [0] }), { volume: 50 }),
      kit,
      stepsPerBar: 16,
      sampleRate: 1000,
      pad: 0,
      clip: false,
      createContext: (frames, rate) => Object.assign(base(frames, rate), { createWaveShaper: () => shaper }),
    });
    const [master] = offline.nodes;
    expect(master.gain.value).toBe(0.5);
    expect(master.connect).toHaveBeenCalledWith(offline.destination);
    expect(shaper.connect).not.toHaveBeenCalled();
  });

  it("clips as before when it is not asked not to", async () => {
    const offline = fakeOffline();
    const base = offline.createContext;
    const shaper = { curve: null, oversample: "2x", connect: vi.fn() };
    await renderSequence({
      song: songOf(sequence({ 0: [0] })),
      kit: createKit([sound("a")]),
      stepsPerBar: 16,
      sampleRate: 1000,
      createContext: (frames, rate) => Object.assign(base(frames, rate), { createWaveShaper: () => shaper }),
    });
    expect(shaper.connect).toHaveBeenCalledWith(offline.destination);
  });
});

describe("renderStems", () => {
  const kit = createKit([sound("Kick"), sound("Snare"), sound("Hat")]);
  const song = songOf(sequence({ 2: [0, 8], 0: [0, 4, 8, 12], 1: [4] }), { bpm: 100 });
  // A render that gives back a stereo file of the length the real one would, with the pad in every frame, and says how far it got.
  const fakeRender = () =>
    vi.fn(async ({ pad, sampleRate, onProgress }) => {
      onProgress?.(0.5);
      return { sampleRate, channels: [new Float32Array(4).fill(pad / 10), new Float32Array(4).fill(pad / 10)] };
    });
  const stems = (extra = {}) =>
    renderStems({
      song,
      kit,
      stepsPerBar: 16,
      sampleRate: 8000,
      loops: 2,
      channels: "stereo",
      render: fakeRender(),
      ...extra,
    });

  it("is one file for each pad that has steps, in pad order, named for it", async () => {
    const files = await stems();
    expect(files.map((file) => file.pad)).toEqual([0, 1, 2]);
    expect(files.map((file) => file.name)).toEqual([
      "pad16-seq-01-100bpm-x2-pad01-kick.wav",
      "pad16-seq-01-100bpm-x2-pad02-snare.wav",
      "pad16-seq-01-100bpm-x2-pad03-hat.wav",
    ]);
  });

  it("makes each stem a WAV at the rate asked for, of what that pad's render gave", async () => {
    const files = await stems();
    for (const file of files) {
      expect(file.wav).toBeInstanceOf(ArrayBuffer);
      const view = new DataView(file.wav);
      expect(view.getUint32(24, true)).toBe(8000);
      expect(view.getUint16(22, true)).toBe(2);
      // Frame 0 holds the pad's marker: 16-bit, the value the render gave
      expect(view.getInt16(44, true)).toBe(Math.round((file.pad / 10) * 32767));
    }
  });

  it("renders each pad on its own, at the master volume and not clipped, with the options it was given", async () => {
    const render = fakeRender();
    await stems({ render, channels: "mono" });
    expect(render).toHaveBeenCalledTimes(3);
    expect(render.mock.calls.map((call) => call[0].pad)).toEqual([0, 1, 2]);
    for (const [args] of render.mock.calls) {
      expect(args).toMatchObject({ clip: false, loops: 2, channels: "mono", sampleRate: 8000, stepsPerBar: 16 });
      expect(args.song).toBe(song);
      expect(args.kit).toBe(kit);
    }
  });

  it("reports progress as one fraction across all the renders, up to 1, never back", async () => {
    const seen = [];
    await stems({ onProgress: (fraction) => seen.push(fraction) });
    expect(seen.length).toBeGreaterThan(3);
    expect(seen[seen.length - 1]).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    for (const fraction of seen) expect(fraction).toBeGreaterThanOrEqual(0);
  });

  it("weighs a pad that has more to render more in that fraction", async () => {
    const seen = [];
    const render = vi.fn(async ({ onProgress, sampleRate }) => {
      onProgress?.(1);
      return { sampleRate, channels: [new Float32Array(2)] };
    });
    await stems({ render, onProgress: (fraction) => seen.push(fraction) });
    // pad 0 has four hits, pad 1 one, pad 2 two: the first stem's end is further on than a third of the whole
    expect(seen[0]).toBeGreaterThan(1 / 3);
  });

  it("stops at once for a cancel before it starts, and between two stems, rendering no more", async () => {
    const controller = new AbortController();
    controller.abort();
    const render = fakeRender();
    await expect(stems({ render, signal: controller.signal })).rejects.toSatisfy(wasCancelled);
    expect(render).not.toHaveBeenCalled();

    const later = new AbortController();
    const second = vi.fn(async ({ pad, sampleRate }) => {
      if (pad === 0) queueMicrotask(() => later.abort());
      return { sampleRate, channels: [new Float32Array(2)] };
    });
    await expect(stems({ render: second, signal: later.signal })).rejects.toSatisfy(wasCancelled);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("is cancelled by a cancel that comes while the last stem is encoded: nothing is handed back to be saved", async () => {
    const controller = new AbortController();
    const only = songOf(sequence({ 0: [0] }));
    const render = vi.fn(async ({ sampleRate }) => {
      queueMicrotask(() => controller.abort()); // the press lands as the render ends, before the encoding is done
      return { sampleRate, channels: [new Float32Array(2)] };
    });
    await expect(stems({ song: only, render, signal: controller.signal })).rejects.toSatisfy(wasCancelled);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("passes the signal to each render, so a cancel lands inside it too", async () => {
    const controller = new AbortController();
    const render = fakeRender();
    await stems({ render, signal: controller.signal });
    for (const [args] of render.mock.calls) expect(args.signal).toBe(controller.signal);
  });

  it("fails with the render's own error, and renders no more after it", async () => {
    const render = vi.fn(async () => {
      throw new Error("out of memory");
    });
    await expect(stems({ render })).rejects.toThrow("out of memory");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("is nothing for a sequence with nothing in it", async () => {
    const render = fakeRender();
    expect(await stems({ song: songOf(sequence({})), render })).toEqual([]);
    expect(render).not.toHaveBeenCalled();
  });

  it("hands back the pad, the name and the encoded file, and nothing else (not the render's channels)", async () => {
    const files = await stems();
    for (const file of files) expect(Object.keys(file).sort()).toEqual(["name", "pad", "wav"]);
  });
});

describe("renderStems, saying which stem it is on", () => {
  const kit = createKit([sound("Kick"), sound("Snare")]);
  const song = songOf(sequence({ 0: [0], 1: [4] }));
  const render = async ({ sampleRate }) => ({ sampleRate, channels: [new Float32Array(2)] });

  it("says the number of each stem, from 1, and how many there are, before it renders it", async () => {
    const seen = [];
    const order = [];
    await renderStems({
      song,
      kit,
      stepsPerBar: 16,
      sampleRate: 8000,
      onStem: (stem) => {
        seen.push(stem);
        order.push("stem");
      },
      render: async (args) => {
        order.push("render");
        return render(args);
      },
    });
    expect(seen).toEqual([
      { number: 1, count: 2 },
      { number: 2, count: 2 },
    ]);
    expect(order).toEqual(["stem", "render", "stem", "render"]);
  });
});

describe("exportStems", () => {
  const kit = createKit([sound("Kick"), sound("Snare")]);
  const song = songOf(sequence({ 0: [0, 8], 1: [4] }), { bpm: 100 });
  const render = vi.fn(async ({ sampleRate }) => ({
    sampleRate,
    channels: [Float32Array.of(0.5, -0.5), Float32Array.of(0, 0)],
  }));
  const run = (extra = {}) => {
    const onMessage = vi.fn();
    const save = vi.fn();
    const done = exportStems({ song, kit, stepsPerBar: 16, onMessage, save, render, supported: true, ...extra });
    return { done, onMessage, save };
  };
  // The entry count and the names in a zip, read from its directory
  const entriesOf = async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    const count = view.getUint16(end + 10, true);
    const names = [];
    let at = view.getUint32(end + 16, true);
    for (let i = 0; i < count; i++) {
      const nameLength = view.getUint16(at + 28, true);
      names.push(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)));
      at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    return names;
  };

  it("renders every pad's stem, zips them, saves the zip under its name, and says so", async () => {
    const { done, onMessage, save } = run();
    expect(await done).toBe(true);
    const [blob, name] = save.mock.calls[0];
    expect(name).toBe("pad16-seq-01-100bpm-stems.zip");
    expect(blob.type).toBe("application/zip");
    expect(await entriesOf(blob)).toEqual([
      "pad16-seq-01-100bpm-pad01-kick.wav",
      "pad16-seq-01-100bpm-pad02-snare.wav",
    ]);
    expect(onMessage.mock.calls.map((call) => call[0])).toEqual([
      "EXPORTING...",
      "EXPORTED pad16-seq-01-100bpm-stems.zip",
    ]);
  });

  it("makes each file a WAV at the rate asked for, of the channels asked for", async () => {
    const { done, save } = run({ sampleRate: 48000, options: { loops: 2, channels: "mono", files: "stems" } });
    await done;
    expect(save.mock.calls[0][1]).toBe("pad16-seq-01-100bpm-x2-mono-stems.zip");
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({ sampleRate: 48000, loops: 2, channels: "mono", clip: false }),
    );
  });

  it("is the plain stems, one loop in stereo, when it is told nothing", async () => {
    render.mockClear();
    const { done } = run();
    await done;
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ loops: 1, channels: "stereo", sampleRate: 44100 }));
  });

  it("passes on how far along it is, and which stem", async () => {
    const onProgress = vi.fn();
    const onStem = vi.fn();
    const { done } = run({ onProgress, onStem });
    await done;
    expect(onProgress).toHaveBeenLastCalledWith(1);
    expect(onStem.mock.calls.map((call) => call[0])).toEqual([
      { number: 1, count: 2 },
      { number: 2, count: 2 },
    ]);
  });

  it("says so, and renders nothing, in a browser that cannot render to a file or for a sequence with no steps", async () => {
    render.mockClear();
    const none = run({ supported: false });
    expect(await none.done).toBe(false);
    expect(none.onMessage).toHaveBeenCalledWith("EXPORT NOT SUPPORTED");
    const empty = run({ song: songOf(sequence({})) });
    expect(await empty.done).toBe(false);
    expect(empty.onMessage).toHaveBeenCalledWith("NOTHING TO EXPORT");
    expect(render).not.toHaveBeenCalled();
    expect(none.save).not.toHaveBeenCalled();
    expect(empty.save).not.toHaveBeenCalled();
  });

  it("is cancelled by a cancel in a render: nothing is saved, and it says so", async () => {
    const controller = new AbortController();
    const cancelling = vi.fn(async () => {
      controller.abort();
      throw new DOMException("Export cancelled", "AbortError");
    });
    const { done, onMessage, save } = run({ render: cancelling, signal: controller.signal });
    expect(await done).toBe(false);
    expect(onMessage).toHaveBeenLastCalledWith("EXPORT CANCELLED");
    expect(save).not.toHaveBeenCalled();
  });

  it("is cancelled by a cancel that comes after the stems are made and before the zip is saved", async () => {
    const controller = new AbortController();
    const late = vi.fn(async ({ sampleRate }) => {
      setTimeout(() => controller.abort(), 0); // after the encoding of the last stem, during the turn given to the event loop
      return { sampleRate, channels: [new Float32Array(2)] };
    });
    const { done, onMessage, save } = run({
      render: late,
      song: songOf(sequence({ 0: [0] })),
      signal: controller.signal,
    });
    expect(await done).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenLastCalledWith("EXPORT CANCELLED");
  });

  it("is cancelled by a cancel that lands in the turn given after the zip is made, which renderStems has already left", async () => {
    const controller = new AbortController();
    // The abort is timed to fall after renderStems' own last check and before this one: a timer started from a timer that was
    // started when the last stem reported (it runs before renderStems' turn, and its own timer after it).
    const onProgress = (fraction) => {
      if (fraction === 1) setTimeout(() => setTimeout(() => controller.abort(), 0), 0);
    };
    const { done, onMessage, save } = run({
      onProgress,
      signal: controller.signal,
      song: songOf(sequence({ 0: [0] })),
    });
    expect(await done).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenLastCalledWith("EXPORT CANCELLED");
  });

  it("says it failed, saving nothing, when a render fails or the file cannot be saved", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = run({
      render: async () => {
        throw new Error("out of memory");
      },
    });
    expect(await failing.done).toBe(false);
    expect(failing.onMessage).toHaveBeenLastCalledWith("EXPORT FAILED");
    expect(failing.save).not.toHaveBeenCalled();
    // `run` has started it, but nothing has been saved yet: the save is the last thing it does, after turns of the event loop
    const unsaved = run();
    unsaved.save.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(await unsaved.done).toBe(false);
    expect(unsaved.onMessage).toHaveBeenLastCalledWith("EXPORT FAILED");
    error.mockRestore();
  });
});

describe("stemsInfo against a real zip", () => {
  // What the dialog says the zip will weigh is checked against the zip the code makes, with real names and real files
  const kit = createKit([
    sound("Kick"),
    sound("Closed Hat!"),
    sound("A very long name for a sample that was loaded.wav"),
  ]);
  it.each([
    { loops: 1, channels: "stereo" },
    { loops: 2, channels: "mono" },
    { loops: 8, channels: "stereo" },
  ])("is within thirty bytes a file of the zip made with %o", async ({ loops, channels }) => {
    const song = songOf(sequence({ 0: [0], 1: [4], 2: [8] }, {}, 1), { bpm: 120 });
    const sampleRate = 1000;
    const options = { loops, channels, files: "stems" };
    const files = await renderStems({
      song,
      kit,
      stepsPerBar: 16,
      sampleRate,
      loops,
      channels,
      render: async () => {
        // A file of the length the dialog says, in the channels asked for
        const frames = exportInfo(song, options, 16, sampleRate).frames;
        return {
          sampleRate,
          channels: Array.from({ length: channels === "mono" ? 1 : 2 }, () => new Float32Array(frames)),
        };
      },
    });
    const real = zipParts(
      files.map((file) => ({ name: file.name, data: file.wav })),
      new Date(2026, 0, 1),
    ).reduce((sum, part) => sum + part.byteLength, 0);
    const estimate = stemsInfo(song, options, 16, sampleRate, files.length).bytes;
    expect(files).toHaveLength(3);
    expect(Math.abs(real - estimate)).toBeLessThanOrEqual(30 * files.length);
  });
});
