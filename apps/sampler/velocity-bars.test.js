import { describe, expect, it } from "vitest";
import { velocityAfterKey, velocityFromPosition } from "./velocity-bars.js";

describe("velocityFromPosition", () => {
  it("is full at the top of the bar and the softest at the bottom", () => {
    expect(velocityFromPosition(0, 60)).toBe(127);
    expect(velocityFromPosition(60, 60)).toBe(1);
  });

  it("is in proportion in between", () => {
    expect(velocityFromPosition(30, 60)).toBe(64);
    expect(velocityFromPosition(15, 60)).toBe(96);
  });

  it("counts a pointer beyond either end as that end", () => {
    expect(velocityFromPosition(-20, 60)).toBe(127);
    expect(velocityFromPosition(500, 60)).toBe(1);
  });

  it("is full for a bar with no height, rather than not a number", () => {
    expect(velocityFromPosition(5, 0)).toBe(127);
    expect(velocityFromPosition(5, NaN)).toBe(127);
  });
});

describe("velocityAfterKey", () => {
  it("moves one step with the arrows and a page with Page Up and Down", () => {
    expect(velocityAfterKey("ArrowUp", 50)).toBe(51);
    expect(velocityAfterKey("ArrowRight", 50)).toBe(51);
    expect(velocityAfterKey("ArrowDown", 50)).toBe(49);
    expect(velocityAfterKey("ArrowLeft", 50)).toBe(49);
    expect(velocityAfterKey("PageUp", 50)).toBe(66);
    expect(velocityAfterKey("PageDown", 50)).toBe(34);
  });

  it("goes to the ends with Home and End", () => {
    expect(velocityAfterKey("Home", 50)).toBe(1);
    expect(velocityAfterKey("End", 50)).toBe(127);
  });

  it("stops at the ends of the range", () => {
    expect(velocityAfterKey("ArrowUp", 127)).toBe(127);
    expect(velocityAfterKey("PageDown", 5)).toBe(1);
  });

  it("is null for a key that is not for a bar", () => {
    expect(velocityAfterKey("a", 50)).toBeNull();
    expect(velocityAfterKey("Tab", 50)).toBeNull();
  });
});
