import { describe, expect, it } from "vitest";
import { KEY_ROWS, padForKey, padLabel, padPressAction } from "./pads.js";

describe("padForKey", () => {
  it("maps the bottom key row to pads 1-4 (indexes 0-3)", () => {
    expect(["z", "x", "c", "v"].map(padForKey)).toEqual([0, 1, 2, 3]);
  });

  it("maps the top key row to the top pad row, pads 13-16", () => {
    expect(["1", "2", "3", "4"].map(padForKey)).toEqual([12, 13, 14, 15]);
  });

  it("maps the middle rows to pads 5-12", () => {
    expect(["a", "s", "d", "f"].map(padForKey)).toEqual([4, 5, 6, 7]);
    expect(["q", "w", "e", "r"].map(padForKey)).toEqual([8, 9, 10, 11]);
  });

  it("covers all 16 pads exactly once", () => {
    const pads = KEY_ROWS.join("").split("").map(padForKey);
    expect([...pads].sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
  });

  it("returns -1 for keys that are not pads", () => {
    expect(padForKey("p")).toBe(-1);
    expect(padForKey(" ")).toBe(-1);
    expect(padForKey("Q")).toBe(-1); // callers lower-case first
  });
});

describe("padLabel", () => {
  it("says which pad, what it plays and its key, in capitals", () => {
    expect(padLabel({ index: 0, name: "Kick", key: "z" })).toBe("Pad 1, Kick, key Z");
  });

  it("ends with the colour's name when the pad has one, in lower case, and not for none", () => {
    expect(padLabel({ index: 2, name: "C.Hat", key: "c", color: 5 })).toBe("Pad 3, C.Hat, key C, blue");
    expect(padLabel({ index: 2, name: "C.Hat", key: "c", color: 0 })).toBe("Pad 3, C.Hat, key C");
    expect(padLabel({ index: 2, name: "C.Hat", key: "c" })).toBe("Pad 3, C.Hat, key C");
  });
});

describe("padPressAction", () => {
  it("plays the pad on a plain press", () => {
    expect(padPressAction({ shift: false })).toBe("play");
    expect(padPressAction({})).toBe("play");
    expect(padPressAction()).toBe("play"); // a caller that passes no modifiers
  });

  it("edits the pad, without playing it, when Shift is held", () => {
    expect(padPressAction({ shift: true })).toBe("edit");
  });
});
