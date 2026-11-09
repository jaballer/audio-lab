import { describe, expect, it } from "vitest";
import { computePeaks } from "./waveform.js";

const buffer = (...channels) => ({
  length: channels[0].length,
  numberOfChannels: channels.length,
  getChannelData: (i) => Float32Array.from(channels[i]),
});

describe("computePeaks", () => {
  it("gives the lowest and highest value of each slice", () => {
    const peaks = computePeaks(buffer([0, 0.5, -0.25, 1, -1, 0.1, 0, 0]), 4);
    expect(Array.from(peaks)).toEqual([0, 0.5, -0.25, 1, -1, 0.10000000149011612, 0, 0]);
  });

  it("counts every channel", () => {
    const peaks = computePeaks(buffer([0.1, 0.1, 0.1, 0.1], [-0.9, 0, 0, 0.8]), 2);
    expect(peaks[0]).toBeCloseTo(-0.9);
    expect(peaks[1]).toBeCloseTo(0.1);
    expect(peaks[2]).toBeCloseTo(0);
    expect(peaks[3]).toBeCloseTo(0.8);
  });

  it("has a value in every column even when the sample has fewer samples than columns", () => {
    const peaks = computePeaks(buffer([0.5, -0.5]), 8);
    expect(peaks).toHaveLength(16);
    for (let column = 0; column < 8; column++) expect(peaks[column * 2]).toBeLessThanOrEqual(peaks[column * 2 + 1]);
    expect(Math.max(...peaks)).toBeCloseTo(0.5);
    expect(Math.min(...peaks)).toBeCloseTo(-0.5);
  });

  it("is flat for silence and for a buffer with nothing in it", () => {
    expect(Array.from(computePeaks(buffer([0, 0, 0, 0]), 2))).toEqual([0, 0, 0, 0]);
    expect(Array.from(computePeaks(buffer([]), 3))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("does not change what it was given", () => {
    const channel = [0.2, -0.2, 0.4, -0.4];
    const b = buffer(channel);
    computePeaks(b, 2);
    expect(channel).toEqual([0.2, -0.2, 0.4, -0.4]);
  });
});
