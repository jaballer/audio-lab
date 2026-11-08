import { describe, expect, it } from "vitest";
import { formatPercent, PARAMS } from "./params.js";

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
