import { describe, expect, it } from "vitest";
import { pad2, sampleName } from "./format.js";

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
