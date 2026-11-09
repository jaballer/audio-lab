import { describe, expect, it, vi } from "vitest";
import {
  LEAD_SECONDS,
  MAX_WARM_UP_PASSES,
  READY_WAIT_MS,
  createExportAction,
  encodeWav,
  exportName,
  exportSequence,
  hasSteps,
  hitsOf,
  renderSequence,
} from "./export-wav.js";
import { createKit } from "./kit.js";

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
function fakeOffline() {
  const nodes = [];
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
    startRendering: async () => ({
      numberOfChannels: 2,
      sampleRate: made.rate,
      getChannelData: (channel) => Float32Array.from({ length: made.frames }, (_, i) => i + channel * 1000),
    }),
  };
  return {
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
    expect(render).toHaveBeenCalledWith({ song: expect.anything(), kit, stepsPerBar: 16 });
    const [blob, name] = save.mock.calls[0];
    expect(name).toBe("pad16-seq-01-120bpm.wav");
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + 2 * 2); // a header and one frame of two channels
    expect(onMessage.mock.calls.map((call) => call[0])).toEqual(["EXPORTING...", "EXPORTED pad16-seq-01-120bpm.wav"]);
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

describe("createExportAction", () => {
  const setup = (extra = {}) => {
    const onMessage = vi.fn();
    const onBusy = vi.fn();
    const run = vi.fn(async () => true);
    const press = createExportAction({ ready: () => Promise.resolve(), run, onMessage, onBusy, ...extra });
    return { press, run, onMessage, onBusy };
  };

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
    const { press, run, onMessage, onBusy } = setup({ ready: () => Promise.reject(new Error("blocked")) });
    expect(await press()).toBe(false);
    expect(onMessage).toHaveBeenCalledWith("EXPORT FAILED");
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

  it("says it is already exporting when pressed while it works, and does not start a second", async () => {
    let finish;
    const run = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const { press, onMessage } = setup({ run });
    const first = press();
    await Promise.resolve();
    await Promise.resolve();
    expect(await press()).toBe(false);
    expect(onMessage).toHaveBeenCalledWith("ALREADY EXPORTING");
    finish(true);
    await first;
    expect(run).toHaveBeenCalledTimes(1);
  });
});
