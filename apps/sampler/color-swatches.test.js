import { describe, expect, it } from "vitest";
import { nextSwatch } from "./color-swatches.js";

describe("nextSwatch", () => {
  it("moves along with the arrow keys, either way", () => {
    expect(nextSwatch(3, "ArrowRight", 9)).toBe(4);
    expect(nextSwatch(3, "ArrowDown", 9)).toBe(4);
    expect(nextSwatch(3, "ArrowLeft", 9)).toBe(2);
    expect(nextSwatch(3, "ArrowUp", 9)).toBe(2);
  });

  it("wraps round at the ends", () => {
    expect(nextSwatch(8, "ArrowRight", 9)).toBe(0);
    expect(nextSwatch(0, "ArrowLeft", 9)).toBe(8);
  });

  it("goes to the ends with Home and End", () => {
    expect(nextSwatch(4, "Home", 9)).toBe(0);
    expect(nextSwatch(4, "End", 9)).toBe(8);
  });

  it("is null for a key that is not for this", () => {
    expect(nextSwatch(4, "a", 9)).toBeNull();
    expect(nextSwatch(4, "Tab", 9)).toBeNull();
    expect(nextSwatch(4, "Enter", 9)).toBeNull();
  });
});
