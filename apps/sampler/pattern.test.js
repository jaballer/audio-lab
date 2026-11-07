import { describe, expect, it } from "vitest";
import { STARTER_BEAT, createPattern } from "./pattern.js";

describe("createPattern", () => {
  it("starts empty", () => {
    const pattern = createPattern(3, 4);
    expect(pattern.row(0)).toEqual([false, false, false, false]);
    expect(pattern.isOn(2, 3)).toBe(false);
  });

  it("toggles and sets single steps", () => {
    const pattern = createPattern(2, 4);
    pattern.toggle(1, 2);
    expect(pattern.isOn(1, 2)).toBe(true);
    pattern.toggle(1, 2);
    expect(pattern.isOn(1, 2)).toBe(false);
    pattern.set(0, 3, true);
    pattern.set(0, 3, true);
    expect(pattern.isOn(0, 3)).toBe(true);
  });

  it("keeps rows independent", () => {
    const pattern = createPattern(2, 4);
    pattern.set(0, 1, true);
    expect(pattern.row(1)).toEqual([false, false, false, false]);
  });

  it("starts from the given steps", () => {
    const pattern = createPattern(3, 8, { 0: [0, 4], 2: [7] });
    expect(pattern.row(0)).toEqual([true, false, false, false, true, false, false, false]);
    expect(pattern.row(1)).toEqual(new Array(8).fill(false));
    expect(pattern.isOn(2, 7)).toBe(true);
  });

  it("clears one row or everything", () => {
    const pattern = createPattern(2, 4, { 0: [0, 1], 1: [2] });
    pattern.clearRow(0);
    expect(pattern.row(0)).toEqual([false, false, false, false]);
    expect(pattern.isOn(1, 2)).toBe(true);
    pattern.clearAll();
    expect(pattern.row(1)).toEqual([false, false, false, false]);
  });

  it("hands out a copy of a row, not its own", () => {
    const pattern = createPattern(1, 4);
    pattern.row(0)[0] = true;
    expect(pattern.isOn(0, 0)).toBe(false);
  });
});

describe("STARTER_BEAT", () => {
  it("is a kick on the beat, a snare on 2 and 4, and eighth-note closed hats", () => {
    const pattern = createPattern(16, 16, STARTER_BEAT);
    const on = (row) => pattern.row(row).flatMap((v, i) => (v ? [i] : []));
    expect(on(0)).toEqual([0, 4, 8, 12]);
    expect(on(1)).toEqual([4, 12]);
    expect(on(2)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(on(3)).toEqual([]);
  });
});
