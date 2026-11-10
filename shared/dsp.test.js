import { describe, expect, it, vi } from "vitest";
import { envelope, filtered, noise, sweep } from "./dsp.js";

function fakeContext(sampleRate = 8000) {
  return {
    sampleRate,
    createBuffer: vi.fn((_channels, length, rate) => ({
      sampleRate: rate,
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: () => ({ buffer: null }),
    createBiquadFilter: () => ({ type: "lowpass", frequency: { value: 0 }, Q: { value: 0 } }),
  };
}

describe("envelope", () => {
  it("jumps to the peak at the start and decays exponentially to near silence", () => {
    const param = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
    envelope(null, param, 2, 0.8, 0.5);
    expect(param.setValueAtTime).toHaveBeenCalledWith(0.8, 2);
    expect(param.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 2.5);
  });
});

describe("sweep", () => {
  it("holds the start value before the sweep and ramps exponentially to the end value over the duration", () => {
    const param = { value: 440, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
    sweep(param, 150, 40, 2, 0.15);
    expect(param.value).toBe(150);
    expect(param.setValueAtTime).toHaveBeenCalledWith(150, 2);
    expect(param.exponentialRampToValueAtTime).toHaveBeenCalledWith(40, 2.15);
  });
});

describe("filtered", () => {
  it("makes a filter of the given kind, frequency and Q", () => {
    const filter = filtered(fakeContext(), "highpass", 1200, 2);
    expect(filter).toMatchObject({ type: "highpass", frequency: { value: 1200 }, Q: { value: 2 } });
  });

  it("defaults Q to 1", () => {
    expect(filtered(fakeContext(), "bandpass", 500).Q.value).toBe(1);
  });
});

describe("noise", () => {
  it("is one second of noise, shared by every source at the same sample rate", () => {
    const ctx = fakeContext(11025);
    const a = noise(ctx);
    const b = noise(ctx);
    expect(ctx.createBuffer).toHaveBeenCalledTimes(1);
    expect(ctx.createBuffer).toHaveBeenCalledWith(1, 11025, 11025);
    expect(a.buffer).toBe(b.buffer);
  });

  it("is made again for a context with another sample rate", () => {
    const first = noise(fakeContext(22050));
    const second = noise(fakeContext(44100));
    expect(second.buffer).not.toBe(first.buffer);
    expect(second.buffer.sampleRate).toBe(44100);
  });
});
