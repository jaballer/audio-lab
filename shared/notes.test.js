import { describe, expect, it } from "vitest";
import { isBlack, noteName } from "./notes.js";

describe("noteName", () => {
  it("names notes with the octave, middle C being C4", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(69)).toBe("A4");
    expect(noteName(61)).toBe("C#4");
    expect(noteName(36)).toBe("C2");
    expect(noteName(0)).toBe("C-1");
  });
});

describe("isBlack", () => {
  it("is true for the five sharps in each octave", () => {
    const blacks = [61, 63, 66, 68, 70];
    expect(blacks.every(isBlack)).toBe(true);
  });

  it("is false for the white keys", () => {
    const whites = [60, 62, 64, 65, 67, 69, 71];
    expect(whites.some(isBlack)).toBe(false);
  });
});
