import { describe, expect, it } from "vitest";
import { sequenceKeys } from "./sequence-row.js";

describe("sequenceKeys", () => {
  it("gives a key for each sequence, numbered from 1", () => {
    expect(sequenceKeys(3, 0).map((key) => key.label)).toEqual(["1", "2", "3"]);
    expect(sequenceKeys(3, 0).map((key) => key.index)).toEqual([0, 1, 2]);
  });

  it("names each for a screen reader, since a number alone says little out of its row", () => {
    expect(sequenceKeys(2, 0).map((key) => key.name)).toEqual(["Sequence 1", "Sequence 2"]);
  });

  it("presses in the one that is showing, and only that one", () => {
    expect(sequenceKeys(4, 2).map((key) => key.pressed)).toEqual([false, false, true, false]);
    expect(sequenceKeys(4, 0).map((key) => key.pressed)).toEqual([true, false, false, false]);
  });

  it("presses none in when the sequence showing is not one of them", () => {
    expect(sequenceKeys(3, 5).some((key) => key.pressed)).toBe(false);
    expect(sequenceKeys(3, -1).some((key) => key.pressed)).toBe(false);
  });

  it("is empty for no sequences", () => {
    expect(sequenceKeys(0, 0)).toEqual([]);
  });

  it("has one key for a beat of one sequence, pressed in", () => {
    expect(sequenceKeys(1, 0)).toEqual([{ index: 0, label: "1", name: "Sequence 1", pressed: true }]);
  });
});
