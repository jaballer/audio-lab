import { describe, expect, it } from "vitest";
import { detented, exp, linear, squared } from "./scales.js";

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

describe("detented", () => {
  const s = detented(-100, 100, 6);

  it("maps the slider ends to the range ends, and the middle to the middle of the range", () => {
    expect(s.toValue(0)).toBe(-100);
    expect(s.toValue(100)).toBe(100);
    expect(s.toValue(50)).toBe(0);
  });

  it("gives the middle value over the whole stop, and not outside it", () => {
    // 6 per cent of half the travel is 3 slider steps either side of 50.
    for (const position of [47, 48, 49, 50, 51, 52, 53]) expect(s.toValue(position)).toBe(0);
    expect(s.toValue(46)).not.toBe(0);
    expect(s.toValue(54)).not.toBe(0);
  });

  it("is continuous at the edge of the stop: just past it the value is just past the middle", () => {
    expect(s.toValue(53.01)).toBeGreaterThan(0);
    expect(s.toValue(53.01)).toBeLessThan(0.1);
    expect(s.toValue(46.99)).toBeLessThan(0);
    expect(s.toValue(46.99)).toBeGreaterThan(-0.1);
  });

  it("rises with the slider and is the same distance from the middle on both sides", () => {
    let last = -Infinity;
    for (let position = 0; position <= 100; position += 0.5) {
      const value = s.toValue(position);
      expect(value).toBeGreaterThanOrEqual(last);
      expect(value + s.toValue(100 - position)).toBeCloseTo(0);
      last = value;
    }
  });

  it("takes any range, with its middle where the range's is", () => {
    const t = detented(10, 30, 10);
    expect(t.toValue(0)).toBe(10);
    expect(t.toValue(100)).toBe(30);
    expect(t.toValue(50)).toBe(20);
    expect(t.toValue(52)).toBe(20); // within the stop
  });

  it("has no stop with a width of 0 beyond the exact middle, and is linear then", () => {
    const t = detented(0, 100, 0);
    for (const position of [0, 10, 25, 50, 75, 90, 100]) expect(t.toValue(position)).toBeCloseTo(position);
  });

  it("round-trips outside the stop, and sends the middle value to the middle of the slider", () => {
    for (const position of [0, 17, 40, 46, 54, 60, 83, 100])
      expect(s.toSlider(s.toValue(position))).toBeCloseTo(position);
    expect(s.toSlider(0)).toBe(50);
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
