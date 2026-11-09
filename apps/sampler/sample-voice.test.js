import { describe, expect, it, vi } from "vitest";
import {
  MAX_SAMPLE_BYTES,
  EDGE_FADE_SECONDS,
  TRIM_LEAD_SECONDS,
  MAX_SAMPLE_SECONDS,
  REASONS,
  createSampleSound,
  decodeSample,
  probeDuration,
} from "./sample-voice.js";

const bytes = (length) => new ArrayBuffer(length);
const audioBuffer = (seconds, length = 100) => ({ duration: seconds, length });

describe("createSampleSound", () => {
  const setup = () => {
    const sources = [];
    const ctx = {
      createBufferSource: () => {
        const source = { buffer: null, connect: vi.fn(), start: vi.fn() };
        sources.push(source);
        return source;
      },
    };
    return { ctx, sources };
  };

  it("carries what the pad editor shows about it: length, channels and the file's size (not a sample rate, which is the context's)", () => {
    const buffer = { duration: 0.5, numberOfChannels: 2, sampleRate: 48000, length: 24000 };
    const sound = createSampleSound({ id: "s", name: "S", buffer, bytes: 1234 });
    expect(sound.info).toEqual({ seconds: 0.5, channels: 2, bytes: 1234 });
  });

  it("has the shape of a built-in sound", () => {
    const sound = createSampleSound({ id: "sample-3", name: "Kick", buffer: audioBuffer(1) });
    expect(sound).toMatchObject({ id: "sample-3", name: "Kick" });
    expect(sound.play).toBeTypeOf("function");
  });

  it("plays its buffer into the output at the time given", () => {
    const { ctx, sources } = setup();
    const buffer = audioBuffer(1);
    const out = { name: "out" };
    createSampleSound({ id: "s", name: "S", buffer }).play(ctx, out, 2.5);
    expect(sources[0].buffer).toBe(buffer);
    expect(sources[0].connect).toHaveBeenCalledWith(out);
    expect(sources[0].start).toHaveBeenCalledWith(2.5);
  });

  it("plays at its own pitch unless a rate is given, and then at that playback rate", () => {
    const sources = [];
    const ctx = {
      createBufferSource: () => {
        const source = { buffer: null, playbackRate: { value: 1 }, connect: vi.fn(), start: vi.fn() };
        sources.push(source);
        return source;
      },
    };
    const sound = createSampleSound({ id: "s", name: "S", buffer: audioBuffer(1) });
    sound.play(ctx, {}, 0);
    sound.play(ctx, {}, 0, { rate: 2 });
    sound.play(ctx, {}, 0, { rate: 0.5 });
    expect(sources.map((source) => source.playbackRate.value)).toEqual([1, 2, 0.5]);
  });

  it("makes a source of its own for every hit, so hits overlap", () => {
    const { ctx, sources } = setup();
    const sound = createSampleSound({ id: "s", name: "S", buffer: audioBuffer(1) });
    sound.play(ctx, {}, 0);
    sound.play(ctx, {}, 0.1);
    expect(sources).toHaveLength(2);
    expect(sources[0].buffer).toBe(sources[1].buffer);
  });
});

describe("a trimmed sample", () => {
  // A context that records the source and the gain stage between it and the output. Its clock is well behind the
  // times the tests schedule at, so a hit is never moved on by the lead (the lead has tests of its own below).
  function recordingContext(currentTime = -1) {
    const sources = [];
    const stages = [];
    return {
      sources,
      stages,
      ctx: {
        currentTime,
        createBufferSource: () => {
          const source = { buffer: null, playbackRate: { value: 1 }, connect: vi.fn(), start: vi.fn() };
          sources.push(source);
          return source;
        },
        createGain: () => {
          const stage = {
            gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
            connect: vi.fn(),
          };
          stages.push(stage);
          return stage;
        },
      },
    };
  }
  const buffer = (seconds = 2) => ({
    duration: seconds,
    numberOfChannels: 1,
    length: seconds * 100,
    getChannelData: () => new Float32Array(seconds * 100),
  });
  const make = (trim, seconds) => createSampleSound({ id: "s", name: "S", buffer: buffer(seconds), bytes: 10, trim });

  it("plays all of it, straight to the output, with no extra node, until it is trimmed", () => {
    const { ctx, sources, stages } = recordingContext();
    const out = { name: "out" };
    make().play(ctx, out, 1);
    expect(stages).toHaveLength(0);
    expect(sources[0].connect).toHaveBeenCalledWith(out);
    expect(sources[0].start).toHaveBeenCalledWith(1);
  });

  it("starts the source at the trim's offset and plays only its length", () => {
    const { ctx, sources } = recordingContext();
    make({ start: 0.25, end: 0.75 }, 2).play(ctx, {}, 3);
    expect(sources[0].start).toHaveBeenCalledWith(3, 0.5, 1);
  });

  it("plays through a stage of its own into the output, faded in where it starts and out where it stops", () => {
    const { ctx, sources, stages } = recordingContext();
    const out = { name: "out" };
    make({ start: 0.25, end: 0.75 }, 2).play(ctx, out, 3);
    const [stage] = stages;
    expect(sources[0].connect).toHaveBeenCalledWith(stage);
    expect(stage.connect).toHaveBeenCalledWith(out);
    expect(stage.gain.setValueAtTime.mock.calls).toEqual([
      [0, 3], // silent as it starts
      [1, 3 + 1 - EDGE_FADE_SECONDS], // full until the fade out begins
    ]);
    expect(stage.gain.linearRampToValueAtTime.mock.calls).toEqual([
      [1, 3 + EDGE_FADE_SECONDS],
      [0, 3 + 1],
    ]);
  });

  it("fades in only when it does not start at the start of the file, and out only when it does not end at the end", () => {
    const fromStart = recordingContext();
    make({ start: 0, end: 0.5 }, 2).play(fromStart.ctx, {}, 0);
    expect(fromStart.stages[0].gain.setValueAtTime.mock.calls[0]).toEqual([1, 0]); // no fade in: it starts as the file does
    expect(fromStart.stages[0].gain.linearRampToValueAtTime.mock.calls).toEqual([[0, 1]]);
    const toEnd = recordingContext();
    make({ start: 0.5, end: 1 }, 2).play(toEnd.ctx, {}, 0);
    expect(toEnd.stages[0].gain.linearRampToValueAtTime.mock.calls).toEqual([[1, EDGE_FADE_SECONDS]]); // no fade out
  });

  it("takes the pitch into account: a sample played faster is over sooner", () => {
    const { ctx, sources, stages } = recordingContext();
    make({ start: 0, end: 0.5 }, 2).play(ctx, {}, 0, { rate: 2 });
    expect(sources[0].playbackRate.value).toBe(2);
    expect(sources[0].start).toHaveBeenCalledWith(0, 0, 1); // the length is in the sample's own time
    expect(stages[0].gain.linearRampToValueAtTime.mock.calls).toEqual([[0, 0.5]]); // heard for half a second
  });

  it("keeps a fade to half of a very short window, so the fades meet and do not overlap", () => {
    const { ctx, stages } = recordingContext();
    make({ start: 0.5, end: 0.5025 }, 2).play(ctx, {}, 0); // a 5 ms window
    const [fadeIn, fadeOut] = stages[0].gain.linearRampToValueAtTime.mock.calls;
    expect(fadeIn[1]).toBeCloseTo(0.0025, 9); // half the window, not a quarter
    expect(fadeOut[1]).toBeCloseTo(0.005, 9);
    expect(stages[0].gain.setValueAtTime.mock.calls[1][1]).toBeCloseTo(0.0025, 9); // held at full where the fade out begins
  });

  it("holds the gain at full until the fade out begins, in the time it is heard (a pitched sample)", () => {
    const { ctx, stages } = recordingContext();
    make({ start: 0.25, end: 0.75 }, 2).play(ctx, {}, 10, { rate: 0.5 }); // 1 s of sample, 2 s heard
    const [, hold] = stages[0].gain.setValueAtTime.mock.calls;
    expect(hold).toEqual([1, 10 + 2 - EDGE_FADE_SECONDS]);
    expect(stages[0].gain.linearRampToValueAtTime.mock.calls.at(-1)).toEqual([0, 12]);
    // and at double speed, when it is over in half the time
    const fast = recordingContext();
    make({ start: 0.25, end: 0.75 }, 2).play(fast.ctx, {}, 10, { rate: 2 });
    expect(fast.stages[0].gain.setValueAtTime.mock.calls[1]).toEqual([1, 10 + 0.5 - EDGE_FADE_SECONDS]);
  });

  describe("the lead a trimmed hit starts with", () => {
    const window = { start: 0.25, end: 0.75 }; // 1 s of a 2 s sample

    it("is moved on to a few milliseconds ahead of the clock when it would start at or before it", () => {
      const now = recordingContext(10);
      make(window, 2).play(now.ctx, {}, 10); // at "now", as a live hit is
      expect(now.sources[0].start).toHaveBeenCalledWith(10 + TRIM_LEAD_SECONDS, 0.5, 1);
      const late = recordingContext(10);
      make(window, 2).play(late.ctx, {}, 9.99); // already late, as a sequenced step can be
      expect(late.sources[0].start.mock.calls[0][0]).toBeCloseTo(10 + TRIM_LEAD_SECONDS, 9);
    });

    it("moves the fades with it, so the window is faded where it really starts and stops", () => {
      const { ctx, stages } = recordingContext(10);
      make(window, 2).play(ctx, {}, 10);
      const start = 10 + TRIM_LEAD_SECONDS;
      expect(stages[0].gain.setValueAtTime.mock.calls[0]).toEqual([0, start]);
      expect(stages[0].gain.linearRampToValueAtTime.mock.calls.at(-1)[1]).toBeCloseTo(start + 1, 9);
    });

    it("leaves a hit that is already further ahead exactly where it was", () => {
      const { ctx, sources } = recordingContext(10);
      make(window, 2).play(ctx, {}, 10.5);
      expect(sources[0].start).toHaveBeenCalledWith(10.5, 0.5, 1);
    });

    it("does not touch an untrimmed sample, which a late start only shortens by the time it was late", () => {
      const { ctx, sources } = recordingContext(10);
      make(undefined, 2).play(ctx, {}, 10);
      expect(sources[0].start).toHaveBeenCalledWith(10);
    });

    it("copes with a context that reports no time", () => {
      const { ctx, sources } = recordingContext();
      delete ctx.currentTime;
      make(window, 2).play(ctx, {}, 0);
      expect(sources[0].start).toHaveBeenCalledWith(TRIM_LEAD_SECONDS, 0.5, 1);
    });
  });

  it("is changed with setTrim, which gives back what it became, kept possible, and plays that from then on", () => {
    const { ctx, sources } = recordingContext();
    const sound = make(undefined, 2);
    expect(sound.setTrim({ start: -3, end: 0.5 })).toEqual({ start: 0, end: 0.5 });
    expect(sound.trim).toEqual({ start: 0, end: 0.5 });
    sound.play(ctx, {}, 0);
    expect(sources[0].start).toHaveBeenCalledWith(0, 0, 1);
  });

  it("holds back the handle that is being moved", () => {
    const sound = make({ start: 0.2, end: 0.6 }, 2);
    expect(sound.setTrim({ start: 0.9, end: 0.6 }, "start").end).toBe(0.6);
    expect(sound.setTrim({ start: 0.2, end: 0.1 }, "end").start).toBe(0.2);
  });

  it("starts from a saved trim, and from all of it when that is not usable", () => {
    expect(make({ start: 0.1, end: 0.4 }, 2).trim).toEqual({ start: 0.1, end: 0.4 });
    expect(make({ start: 0.9, end: 0.1 }, 2).trim).toEqual({ start: 0, end: 1 });
    expect(make("junk", 2).trim).toEqual({ start: 0, end: 1 });
  });

  it("makes its outline once, when asked, and gives the same one again", () => {
    const getChannelData = vi.fn(() => new Float32Array(200));
    const sound = createSampleSound({
      id: "s",
      name: "S",
      buffer: { duration: 2, numberOfChannels: 1, length: 200, getChannelData },
      bytes: 1,
    });
    expect(getChannelData).not.toHaveBeenCalled();
    const first = sound.peaks();
    expect(first).toHaveLength(800);
    expect(sound.peaks()).toBe(first);
    expect(getChannelData).toHaveBeenCalledTimes(1);
  });

  it("knows its length, for the view", () => {
    expect(make(undefined, 3).duration).toBe(3);
  });
});

describe("decodeSample", () => {
  const ctxDecoding = (result) => ({ decodeAudioData: vi.fn(async () => result) });

  it("gives back the decoded buffer", async () => {
    const buffer = audioBuffer(2);
    const result = await decodeSample(ctxDecoding(buffer), bytes(10));
    expect(result).toEqual({ ok: true, buffer });
  });

  it("decodes a copy, so the original bytes are still there to be stored", async () => {
    const ctx = ctxDecoding(audioBuffer(1));
    const original = bytes(10);
    await decodeSample(ctx, original);
    expect(ctx.decodeAudioData.mock.calls[0][0]).not.toBe(original);
    expect(ctx.decodeAudioData.mock.calls[0][0].byteLength).toBe(10);
  });

  it("refuses nothing, and does not try to decode it", async () => {
    const ctx = ctxDecoding(audioBuffer(1));
    expect(await decodeSample(ctx, bytes(0))).toEqual({ ok: false, reason: REASONS.empty });
    expect(await decodeSample(ctx, null)).toEqual({ ok: false, reason: REASONS.empty });
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
  });

  it("refuses a file over the size cap, and does not try to decode it", async () => {
    const ctx = ctxDecoding(audioBuffer(1));
    expect(await decodeSample(ctx, bytes(MAX_SAMPLE_BYTES + 1))).toEqual({ ok: false, reason: REASONS.bytes });
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
    expect((await decodeSample(ctx, bytes(MAX_SAMPLE_BYTES))).ok).toBe(true);
  });

  it("says so when the bytes are not audio, instead of throwing", async () => {
    const ctx = { decodeAudioData: vi.fn(async () => Promise.reject(new DOMException("bad", "EncodingError"))) };
    expect(await decodeSample(ctx, bytes(10))).toEqual({ ok: false, reason: REASONS.notAudio });
    const throwing = {
      decodeAudioData: () => {
        throw new TypeError("not a function");
      },
    };
    expect(await decodeSample(throwing, bytes(10))).toEqual({ ok: false, reason: REASONS.notAudio });
  });

  it("refuses audio with nothing in it, and audio that is too long", async () => {
    expect(await decodeSample(ctxDecoding(audioBuffer(0, 0)), bytes(10))).toEqual({ ok: false, reason: REASONS.empty });
    expect(await decodeSample(ctxDecoding(null), bytes(10))).toEqual({ ok: false, reason: REASONS.empty });
    expect(await decodeSample(ctxDecoding(audioBuffer(MAX_SAMPLE_SECONDS + 0.5)), bytes(10))).toEqual({
      ok: false,
      reason: REASONS.seconds,
    });
    expect((await decodeSample(ctxDecoding(audioBuffer(MAX_SAMPLE_SECONDS)), bytes(10))).ok).toBe(true);
  });
});

describe("probeDuration", () => {
  // A stand-in for the media element and the URLs: `reply(audio)` is what the element does once it has a source.
  function env({ reply, timeoutMs = 50 } = {}) {
    const audio = {
      preload: "",
      onloadedmetadata: null,
      onerror: null,
      duration: NaN,
      removeAttribute: vi.fn(),
      load: vi.fn(),
      set src(value) {
        this._src = value;
        queueMicrotask(() => reply?.(audio));
      },
    };
    return {
      audio,
      revokeUrl: vi.fn(),
      env: { createAudio: () => audio, createUrl: () => "blob:x", revokeUrl: vi.fn(), timeoutMs },
    };
  }

  it("gives the length the element reads from the header", async () => {
    const { env: e, audio } = env({
      reply: (a) => {
        a.duration = 3.25;
        a.onloadedmetadata();
      },
    });
    expect(await probeDuration({}, e)).toBe(3.25);
    expect(audio.preload).toBe("metadata");
  });

  it("gives up the file and the URL when it is done", async () => {
    const { env: e, audio } = env({
      reply: (a) => {
        a.duration = 1;
        a.onloadedmetadata();
      },
    });
    await probeDuration({}, e);
    expect(e.revokeUrl).toHaveBeenCalledWith("blob:x");
    // Dropping the source is not enough to make the element let go of the file: load() with none is.
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.load).toHaveBeenCalled();
  });

  it("is null when the length is not known (a stream's Infinity, or NaN)", async () => {
    for (const duration of [Infinity, NaN, -1]) {
      const { env: e } = env({
        reply: (a) => {
          a.duration = duration;
          a.onloadedmetadata();
        },
      });
      expect(await probeDuration({}, e)).toBeNull();
    }
  });

  it("is null when the browser cannot read the file, or says nothing in time", async () => {
    expect(await probeDuration({}, env({ reply: (a) => a.onerror() }).env)).toBeNull();
    expect(await probeDuration({}, env({ reply: undefined, timeoutMs: 5 }).env)).toBeNull();
  });

  it("is null, not an error, when there is no media element or URL support", async () => {
    const throwing = {
      createUrl: () => {
        throw new TypeError("no URL");
      },
    };
    expect(await probeDuration({}, throwing)).toBeNull();
    expect(
      await probeDuration(
        {},
        {
          createUrl: () => "blob:x",
          revokeUrl: () => {},
          createAudio: () => {
            throw new ReferenceError("no Audio");
          },
        },
      ),
    ).toBeNull();
  });
});

describe("a sample with an envelope", () => {
  const setup = () => {
    const sources = [];
    const stages = [];
    const ctx = {
      currentTime: 0,
      createBufferSource: () => {
        const source = { buffer: null, connect: vi.fn(), start: vi.fn(), playbackRate: { value: 1 } };
        sources.push(source);
        return source;
      },
      createGain: () => {
        const stage = {
          gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        };
        stages.push(stage);
        return stage;
      },
    };
    return { ctx, sources, stages };
  };
  const sample = (seconds = 2, trim) => createSampleSound({ id: "s", name: "S", buffer: audioBuffer(seconds), trim });
  const envelope = { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.4 };

  it("plays through a gain stage of its own into the output, ramped through the shape from its start", () => {
    const { ctx, sources, stages } = setup();
    const out = { name: "out" };
    sample().play(ctx, out, 3, { envelope });
    expect(stages).toHaveLength(1);
    expect(sources[0].connect).toHaveBeenCalledWith(stages[0]);
    expect(stages[0].connect).toHaveBeenCalledWith(out);
    const gain = stages[0].gain;
    expect(gain.setValueAtTime).toHaveBeenCalledWith(0, 3);
    const ramps = gain.linearRampToValueAtTime.mock.calls.map(([level, time]) => [level, Number(time.toFixed(6))]);
    expect(ramps).toEqual([
      [1, 3.1],
      [0.5, 3.3],
      [0.5, 4.6],
      [0, 5],
    ]);
    expect(sources[0].start).toHaveBeenCalledWith(3);
  });

  it("adds no stage when there is no envelope", () => {
    const { ctx, sources, stages } = setup();
    const out = { name: "out" };
    sample().play(ctx, out, 3);
    expect(stages).toHaveLength(0);
    expect(sources[0].connect).toHaveBeenCalledWith(out);
  });

  it("lays the envelope over the time the sample is heard: a higher pitch is shorter, so the release is nearer the start", () => {
    const { ctx, stages } = setup();
    sample(2).play(ctx, {}, 0, { rate: 2, envelope: { release: 0.5 } }); // heard for 1 s
    const ramps = stages[0].gain.linearRampToValueAtTime.mock.calls.map(([level, time]) => [level, time]);
    expect(ramps).toEqual([
      [1, 0.5],
      [0, 1],
    ]);
  });

  it("lays it over the trimmed part, from where the trimmed hit starts (after the lead), in front of the trim's fades", () => {
    const { ctx, sources, stages } = setup();
    const out = { name: "out" };
    ctx.currentTime = 10;
    sample(4, { start: 0.25, end: 0.75 }).play(ctx, out, 10, { envelope: { release: 0.5 } }); // 2 s of it
    const [trimStage, envelopeStage] = [stages[1], stages[0]]; // the envelope's is made first, the trim's after it
    expect(envelopeStage.connect).toHaveBeenCalledWith(out);
    expect(trimStage.connect).toHaveBeenCalledWith(envelopeStage);
    const start = 10 + TRIM_LEAD_SECONDS;
    expect(envelopeStage.gain.setValueAtTime).toHaveBeenCalledWith(1, start);
    const ramps = envelopeStage.gain.linearRampToValueAtTime.mock.calls.map(([level, time]) => [
      level,
      Number(time.toFixed(6)),
    ]);
    expect(ramps).toEqual([
      [1, Number((start + 1.5).toFixed(6))],
      [0, Number((start + 2).toFixed(6))],
    ]);
    expect(sources[0].start).toHaveBeenCalledWith(start, 1, 2);
  });
});
