import { describe, expect, it } from "vitest";
import { stickOffset } from "./stick.js";

describe("stickOffset", () => {
  it("rests in the centre", () => {
    expect(stickOffset({ bend: 0, mod: 0 })).toEqual({ x: 0, y: -0 });
  });

  it("moves sideways with bend, to full travel either way", () => {
    expect(stickOffset({ bend: 1, mod: 0 }).x).toBe(30);
    expect(stickOffset({ bend: -1, mod: 0 }).x).toBe(-30);
  });

  it("moves up (negative y) with mod", () => {
    expect(stickOffset({ bend: 0, mod: 127 }).y).toBe(-30);
    expect(stickOffset({ bend: 0, mod: 0 }).y).toBeCloseTo(0);
  });
});
