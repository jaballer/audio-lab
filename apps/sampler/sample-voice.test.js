import { describe, expect, it, vi } from "vitest";
import { MAX_SAMPLE_BYTES, MAX_SAMPLE_SECONDS, REASONS, createSampleSound, decodeSample } from "./sample-voice.js";

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
