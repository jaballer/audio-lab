import { describe, expect, it, vi } from "vitest";
import {
  LEAD_SECONDS,
  MAX_TAIL_SECONDS,
  encodeWav,
  exportName,
  exportSequence,
  hasSteps,
  heardSeconds,
  hitsOf,
  renderSequence,
  tailSeconds,
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
    const hits = hitsOf(sequence({ 2: [4, 0], 0: [4] }, { 2: { 4: 50 } }));
    expect(hits).toEqual([
      { step: 0, row: 2, velocity: 127 },
      { step: 4, row: 0, velocity: 127 },
      { step: 4, row: 2, velocity: 50 },
    ]);
  });

  it("is empty for an empty sequence", () => {
    expect(hitsOf(sequence({}))).toEqual([]);
  });
});

describe("hasSteps", () => {
  it("is whether the sequence showing has anything on", () => {
    expect(hasSteps(songOf(sequence({})))).toBe(false);
    expect(hasSteps(songOf(sequence({ 0: [] })))).toBe(false);
    expect(hasSteps(songOf(sequence({ 0: [3] })))).toBe(true);
    expect(hasSteps({ ...songOf(sequence({})), sequences: [sequence({}), sequence({ 1: [0] })], current: 1 })).toBe(
      true,
    );
  });
});

describe("the tail", () => {
  it("is as long as a built-in sound rings, for a built-in sound", () => {
    expect(heardSeconds(sound("kick"))).toBe(1.5);
  });

  it("is a sample's trimmed length at its pitch: an octave down is twice as long, a trim shorter", () => {
    expect(heardSeconds(sample(4))).toBeCloseTo(4);
    expect(heardSeconds(sample(4), -12)).toBeCloseTo(8);
    expect(heardSeconds(sample(4, { start: 0.25, end: 0.75 }))).toBeCloseTo(2);
  });

  it("is the longest of the pads used, and not those that are not used", () => {
    const kit = createKit([sound("a"), sample(6), sample(9)]);
    expect(tailSeconds([{ row: 0 }, { row: 1 }], kit)).toBeCloseTo(6);
    expect(tailSeconds([{ row: 0 }], kit)).toBe(1.5);
  });

  it("stops at a limit, and is nothing for no hits", () => {
    const kit = createKit([sample(10)]);
    kit.setSetting(0, "pitch", -24);
    expect(tailSeconds([{ row: 0 }], kit)).toBe(MAX_TAIL_SECONDS);
    expect(tailSeconds([], kit)).toBe(0);
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
        gain: { value: 1, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
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

  it("plays each step that is on at its time (a sixteenth at the song's tempo), after the lead", async () => {
    const { render, sounds } = setup(sequence({ 0: [0, 4], 1: [8] }));
    await render();
    // 120 BPM: a sixteenth is 0.125 s
    expect(sounds[0].play.mock.calls.map((call) => call[2])).toEqual([LEAD_SECONDS, LEAD_SECONDS + 0.5]);
    expect(sounds[1].play.mock.calls.map((call) => call[2])).toEqual([LEAD_SECONDS + 1]);
    expect(sounds[2].play).not.toHaveBeenCalled();
  });

  it("plays at the song's tempo, not another", async () => {
    const { render, sounds } = setup(sequence({ 0: [4] }), { bpm: 60 });
    await render();
    expect(sounds[0].play.mock.calls[0][2]).toBeCloseTo(LEAD_SECONDS + 4 * 0.25);
  });

  it("runs the master at the volume on the page, through the clipper when the context has one", async () => {
    const { render, offline } = setup(sequence({ 0: [0] }), { volume: 50 });
    await render();
    const master = offline.nodes[0];
    expect(master.gain.value).toBe(0.5);
    expect(master.connect).toHaveBeenCalledWith(offline.destination); // no waveshaper in the stand-in: straight out
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

  it("is as long as the sequence and the tail, and starts on the first step (the lead is cut off)", async () => {
    const { render, offline } = setup(sequence({ 0: [0] }, {}, 2)); // 2 bars of 16 steps at 0.125 s = 4 s
    const audio = await render();
    expect(offline.made.rate).toBe(1000);
    expect(offline.made.frames).toBe(Math.ceil((LEAD_SECONDS + 4 + 1.5) * 1000));
    expect(audio.channels).toHaveLength(2);
    expect(audio.channels[0]).toHaveLength(offline.made.frames - LEAD_SECONDS * 1000);
    expect(audio.channels[0][0]).toBe(LEAD_SECONDS * 1000); // frame 10 of the render is now the first
    expect(audio.channels[1][0]).toBe(1000 + LEAD_SECONDS * 1000);
    expect(audio.sampleRate).toBe(1000);
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
