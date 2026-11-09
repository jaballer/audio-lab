import { describe, expect, it } from "vitest";
import { BIG_STEP, SHIFT_WHEEL_GAP_MS, dragTempo, keyTempo, wheelTempo } from "./knob-moves.js";

describe("dragTempo", () => {
  it("moves half a BPM per pixel and lands on a whole number", () => {
    expect(dragTempo(120, 10, false)).toBe(125);
    expect(dragTempo(120, 3, false)).toBe(122); // 121.5 rounds up
    expect(dragTempo(120, -10, false)).toBe(115);
  });

  it("rounds a tapped tempo to a whole number even with no movement", () => {
    expect(dragTempo(117.3, 0, false)).toBe(117);
  });

  it("moves a tenth of a BPM per pixel with Shift, in either direction", () => {
    expect(dragTempo(120, 3, true)).toBeCloseTo(120.3);
    expect(dragTempo(120, -3, true)).toBeCloseTo(119.7); // the first pixel down is not lost to rounding
  });
});

describe("wheelTempo", () => {
  it("steps one BPM, up for a scroll up", () => {
    expect(wheelTempo(120, { deltaY: -100 })).toBe(121);
    expect(wheelTempo(120, { deltaY: 100 })).toBe(119);
  });

  it("steps ten with Shift", () => {
    expect(wheelTempo(120, { deltaY: -100, shift: true })).toBe(130);
  });

  it("reads deltaX, where a browser puts a Shift+wheel", () => {
    expect(wheelTempo(120, { deltaX: -40, deltaY: 0, shift: true })).toBe(130);
    expect(wheelTempo(120, { deltaX: 40, deltaY: -0, shift: true })).toBe(110);
  });

  it("changes nothing when both deltas are zero", () => {
    expect(wheelTempo(120, { deltaX: 0, deltaY: 0 })).toBeNull();
  });

  it("drops a Shift+wheel that follows another too soon, but not a plain one", () => {
    expect(wheelTempo(120, { deltaY: -1, shift: true, sinceLastMs: SHIFT_WHEEL_GAP_MS - 1 })).toBeNull();
    expect(wheelTempo(120, { deltaY: -1, shift: true, sinceLastMs: SHIFT_WHEEL_GAP_MS })).toBe(130);
    expect(wheelTempo(120, { deltaY: -1, sinceLastMs: 5 })).toBe(121);
  });

  it("rounds a tapped tempo to a whole number", () => {
    expect(wheelTempo(117.3, { deltaY: -1 })).toBe(118);
  });
});

describe("keyTempo", () => {
  it("steps one BPM with the arrows, ten with Shift", () => {
    expect(["ArrowUp", "ArrowRight"].map((k) => keyTempo(120, k, false))).toEqual([121, 121]);
    expect(["ArrowDown", "ArrowLeft"].map((k) => keyTempo(120, k, false))).toEqual([119, 119]);
    expect(keyTempo(120, "ArrowUp", true)).toBe(120 + BIG_STEP);
    expect(keyTempo(120, "ArrowLeft", true)).toBe(120 - BIG_STEP);
  });

  it("steps ten with Page Up and Page Down, with or without Shift", () => {
    expect(keyTempo(120, "PageUp", false)).toBe(130);
    expect(keyTempo(120, "PageDown", true)).toBe(110);
  });

  it("rounds a tapped tempo to a whole number", () => {
    expect(keyTempo(117.3, "ArrowUp", false)).toBe(118);
    expect(keyTempo(117.3, "ArrowDown", false)).toBe(116);
  });

  it("returns null for other keys", () => {
    expect(keyTempo(120, "a", false)).toBeNull();
    expect(keyTempo(120, "Home", false)).toBeNull();
  });
});
