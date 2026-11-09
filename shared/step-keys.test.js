import { describe, expect, it } from "vitest";
import { lastShownIndex } from "./step-keys.js";

describe("lastShownIndex", () => {
  it("is the last key whose step exists", () => {
    expect(lastShownIndex([true, false, true, undefined, undefined])).toBe(2);
    expect(lastShownIndex([false, false, false, false])).toBe(3);
  });

  it("is -1 when no key is shown, and ignores entries beyond the keys there are", () => {
    expect(lastShownIndex([undefined, undefined])).toBe(-1);
    expect(lastShownIndex([])).toBe(-1);
    expect(lastShownIndex([true, true, true], 2)).toBe(1);
  });
});
