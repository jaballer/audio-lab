import { describe, expect, it, vi } from "vitest";
import {
  MAX_SAMPLE_BYTES,
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
