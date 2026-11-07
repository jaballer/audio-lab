import { describe, expect, it } from "vitest";
import { exp, linear, squared } from "./scales.js";

describe("linear", () => {
  const s = linear(10, 30);

  it("maps the slider ends to the range ends", () => {
    expect(s.toValue(0)).toBe(10);
    expect(s.toValue(100)).toBe(30);
    expect(s.toValue(50)).toBe(20);
  });
});

describe("exp", () => {
  const s = exp(60, 16000);

  it("maps the slider ends to the range ends", () => {
    expect(s.toValue(0)).toBeCloseTo(60);
    expect(s.toValue(100)).toBeCloseTo(16000);
  });

  it("moves by equal ratios per slider step", () => {
    const ratio = s.toValue(30) / s.toValue(20);
    expect(s.toValue(80) / s.toValue(70)).toBeCloseTo(ratio);
  });
});

describe("squared", () => {
  const s = squared();

  it("gives finer control in the lower half", () => {
    expect(s.toValue(50)).toBeCloseTo(0.25);
    expect(s.toValue(100)).toBe(1);
  });
});

describe.each([
  ["linear", linear(0, 24)],
  ["exp", exp(0.005, 3)],
  ["squared", squared()],
])("%s", (_name, s) => {
  it("round-trips toValue and toSlider", () => {
    for (const position of [0, 17, 50, 83, 100]) {
      expect(s.toSlider(s.toValue(position))).toBeCloseTo(position);
    }
  });
});
