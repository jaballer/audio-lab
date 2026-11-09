import { describe, expect, it } from "vitest";
import { formatSampleInfo, formatSize, pad2, sampleName } from "./format.js";

describe("pad2", () => {
  it("zero-pads to two digits", () => {
    expect(pad2(3)).toBe("03");
    expect(pad2(16)).toBe("16");
  });
});

describe("sampleName", () => {
  it("is the file's name without its extension", () => {
    expect(sampleName("kick.wav")).toBe("kick");
    expect(sampleName("My Snare.01.mp3")).toBe("My Snare.01");
  });

  it("is kept short, and tidy", () => {
    expect(sampleName("a very long recording name.wav")).toBe("a very long");
    expect(sampleName("  spaced    out  .ogg")).toBe("spaced out");
  });

  it("falls back to a name when there is nothing usable", () => {
    expect(sampleName(".wav")).toBe("Sample");
    expect(sampleName("")).toBe("Sample");
    expect(sampleName(undefined)).toBe("Sample");
  });
});

describe("formatSize", () => {
  it("is bytes, kilobytes or megabytes, whichever is nearest", () => {
    expect(formatSize(812)).toBe("812 B");
    expect(formatSize(22 * 1024)).toBe("22 KB");
    expect(formatSize(1.4 * 1024 * 1024)).toBe("1.4 MB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5 MB");
  });

  it("is empty for what is not a size", () => {
    for (const value of [undefined, null, NaN, -1, "big"]) expect(formatSize(value)).toBe("");
  });
});

describe("formatSampleInfo", () => {
  it("says a pad with no sample plays a built-in sound", () => {
    expect(formatSampleInfo(null)).toBe("Built-in sound");
    expect(formatSampleInfo(undefined)).toBe("Built-in sound");
  });

  it("gives a sample's length, channels and size", () => {
    expect(formatSampleInfo({ seconds: 0.4, channels: 1, bytes: 22 * 1024 })).toBe("0.40 s, mono, 22 KB");
    expect(formatSampleInfo({ seconds: 2.5, channels: 2, bytes: 1.2 * 1024 * 1024 })).toBe("2.50 s, stereo, 1.2 MB");
    expect(formatSampleInfo({ seconds: 1, channels: 6, bytes: 100 })).toBe("1.00 s, 6 channels, 100 B");
  });

  it("leaves out what is not known, and still says it is a sample", () => {
    expect(formatSampleInfo({ bytes: 2048 })).toBe("2 KB");
    expect(formatSampleInfo({ seconds: 0.001, channels: 1 })).toBe("<0.01 s, mono");
    expect(formatSampleInfo({})).toBe("Sample");
  });
});
