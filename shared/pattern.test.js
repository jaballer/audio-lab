import { describe, expect, it } from "vitest";
import { createPattern } from "./pattern.js";

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

describe("snapshot", () => {
  it("lists the steps that are on, per pad, and leaves empty pads out", () => {
    const pattern = createPattern(4, 8, { 0: [0, 4], 2: [7] });
    expect(pattern.snapshot()).toEqual({ 0: [0, 4], 2: [7] });
    expect(createPattern(4, 8).snapshot()).toEqual({});
  });

  it("is the shape createPattern starts from, so a pattern can be rebuilt from it", () => {
    const pattern = createPattern(16, 16, { 0: [0, 4, 8, 12], 1: [4, 12] });
    pattern.toggle(5, 3);
    const copy = createPattern(16, 16, pattern.snapshot());
    for (let row = 0; row < 16; row++) expect(copy.row(row)).toEqual(pattern.row(row));
  });
});

describe("onChange", () => {
  const setup = () => {
    const changes = [];
    const pattern = createPattern(2, 4, { 0: [1] }, { onChange: () => changes.push(1) });
    return { pattern, changes };
  };

  it("is not called while the pattern is being built", () => {
    expect(setup().changes).toHaveLength(0);
  });

  it("is called when a step is toggled or set to a different value", () => {
    const { pattern, changes } = setup();
    pattern.toggle(1, 2);
    pattern.set(1, 3, true);
    expect(changes).toHaveLength(2);
  });

  it("is not called when set does not change anything", () => {
    const { pattern, changes } = setup();
    pattern.set(0, 1, true); // already on
    pattern.set(1, 0, false); // already off
    expect(changes).toHaveLength(0);
  });

  it("is called when a clear removes something, and not when there was nothing to clear", () => {
    const { pattern, changes } = setup();
    pattern.clearRow(1);
    pattern.clearAll();
    expect(changes).toHaveLength(1); // only clearAll had a step to remove
    pattern.clearAll();
    expect(changes).toHaveLength(1);
  });

  it("is called after the pattern has changed", () => {
    const seen = [];
    const pattern = createPattern(1, 4, {}, { onChange: () => seen.push(pattern.isOn(0, 2)) });
    pattern.toggle(0, 2);
    expect(seen).toEqual([true]);
  });
});
