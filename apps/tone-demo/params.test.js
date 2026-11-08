import { describe, expect, it } from "vitest";
import { DEFAULT_ECHO_TIME, ECHO_TIMES, formatPercent, formatSeconds, PARAMS } from "./params.js";

describe("formatPercent", () => {
  it("rounds a 0-1 amount to a whole percent", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.3)).toBe("30%");
    expect(formatPercent(0.666)).toBe("67%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("PARAMS", () => {
  it("keeps every default inside its range", () => {
    for (const p of Object.values(PARAMS)) {
      expect(p.value).toBeGreaterThanOrEqual(p.min);
      expect(p.value).toBeLessThanOrEqual(p.max);
    }
  });
});

describe("formatSeconds", () => {
  it("reads short times in milliseconds and long ones in seconds", () => {
    expect(formatSeconds(0.05)).toBe("50 ms");
    expect(formatSeconds(0.3)).toBe("300 ms");
    expect(formatSeconds(1)).toBe("1.0 s");
    expect(formatSeconds(4)).toBe("4.0 s");
  });
});

describe("release", () => {
  it("spans 50 ms to 4 s across the slider", () => {
    expect(PARAMS.release.toValue(PARAMS.release.min)).toBeCloseTo(0.05);
    expect(PARAMS.release.toValue(PARAMS.release.max)).toBeCloseTo(4);
  });

  it("starts at 300 ms", () => {
    expect(PARAMS.release.toValue(PARAMS.release.value)).toBeCloseTo(0.3);
  });
});

describe("feedback", () => {
  it("never reaches 1, where the echo would not die away", () => {
    expect(PARAMS.feedback.max).toBeLessThan(1);
  });
});

describe("ECHO_TIMES", () => {
  it("includes the default", () => {
    expect(ECHO_TIMES.map((t) => t.value)).toContain(DEFAULT_ECHO_TIME);
  });
});
