import { describe, expect, it } from "vitest";
import { pad2 } from "./format.js";

describe("pad2", () => {
  it("zero-pads to two digits", () => {
    expect(pad2(3)).toBe("03");
    expect(pad2(16)).toBe("16");
  });
});
