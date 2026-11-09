import { describe, expect, it } from "vitest";
import { FULL_TRIM, MIN_TRIM_SECONDS, clampTrim, isFullTrim, nearestHandle, parseTrim, trimWindow } from "./trim.js";

describe("clampTrim", () => {
  it("leaves a possible trim as it is", () => {
    expect(clampTrim({ start: 0.2, end: 0.7 }, 2)).toEqual({ start: 0.2, end: 0.7 });
  });

  it("keeps both ends inside the sample", () => {
    expect(clampTrim({ start: -1, end: 5 }, 2)).toEqual(FULL_TRIM);
    expect(clampTrim({ start: 0.5, end: 9 }, 2)).toEqual({ start: 0.5, end: 1 });
  });

  it("is all of the sample for what is not numbers", () => {
    for (const trim of [undefined, null, {}, { start: "a", end: NaN }]) expect(clampTrim(trim, 2)).toEqual(FULL_TRIM);
  });

  it("holds back the handle that is being moved, so the other stays put", () => {
    const gap = MIN_TRIM_SECONDS / 2;
    const end = clampTrim({ start: 0.6, end: 0.3 }, 2, "end"); // the end dragged back past the start
    expect(end.start).toBe(0.6);
    expect(end.end).toBeCloseTo(0.6 + gap, 3);
    const start = clampTrim({ start: 0.9, end: 0.5 }, 2, "start"); // the start dragged on past the end
    expect(start.end).toBe(0.5);
    expect(start.start).toBeCloseTo(0.5 - gap, 3);
  });

  it("never leaves less than the shortest window, even against an edge", () => {
    const gap = MIN_TRIM_SECONDS / 2;
    const atStart = clampTrim({ start: 0, end: 0 }, 2, "end");
    expect(atStart.end - atStart.start).toBeGreaterThanOrEqual(gap - 1e-4);
    const atEnd = clampTrim({ start: 1, end: 1 }, 2, "start");
    expect(atEnd.end).toBe(1);
    expect(atEnd.end - atEnd.start).toBeGreaterThanOrEqual(gap - 1e-4);
  });

  it("does not trim a sample that is shorter than the shortest window", () => {
    expect(clampTrim({ start: 0.2, end: 0.4 }, MIN_TRIM_SECONDS / 2)).toEqual(FULL_TRIM);
    expect(clampTrim({ start: 0.2, end: 0.4 }, 0)).toEqual(FULL_TRIM);
  });

  it("rounds to a hundredth of a percent, so saved values are short", () => {
    expect(clampTrim({ start: 0.123456789, end: 0.987654321 }, 2)).toEqual({ start: 0.1235, end: 0.9877 });
  });
});

describe("trimWindow", () => {
  it("is the offset and length in seconds", () => {
    expect(trimWindow({ start: 0.25, end: 0.75 }, 4)).toEqual({ offset: 1, length: 2 });
    expect(trimWindow(FULL_TRIM, 3)).toEqual({ offset: 0, length: 3 });
  });
});

describe("parseTrim", () => {
  it("gives back a trim that was saved", () => {
    expect(parseTrim({ start: 0.1, end: 0.9 })).toEqual({ start: 0.1, end: 0.9 });
  });

  it("is all of the sample for what is not a usable trim", () => {
    const bad = [
      undefined,
      null,
      "x",
      5,
      [],
      {},
      { start: 0.5 },
      { start: "a", end: 1 },
      { start: -0.1, end: 1 },
      { start: 0, end: 1.5 },
      { start: 0.5, end: 0.5 },
      { start: 0.8, end: 0.2 },
      { start: NaN, end: 1 },
    ];
    for (const stored of bad) expect(parseTrim(stored)).toEqual(FULL_TRIM);
  });
});

describe("isFullTrim", () => {
  it("is true only for all of the sample", () => {
    expect(isFullTrim(FULL_TRIM)).toBe(true);
    expect(isFullTrim({ start: 0.1, end: 1 })).toBe(false);
    expect(isFullTrim({ start: 0, end: 0.9 })).toBe(false);
  });
});

describe("nearestHandle", () => {
  it("is the handle nearer the press", () => {
    const trim = { start: 0.2, end: 0.8 };
    expect(nearestHandle(trim, 0.1)).toBe("start");
    expect(nearestHandle(trim, 0.3)).toBe("start");
    expect(nearestHandle(trim, 0.7)).toBe("end");
    expect(nearestHandle(trim, 0.95)).toBe("end");
  });

  it("is the start for a press exactly between them, and works for a narrow window and a full one", () => {
    expect(nearestHandle({ start: 0.2, end: 0.8 }, 0.5)).toBe("start");
    expect(nearestHandle({ start: 0.49, end: 0.51 }, 0.505)).toBe("end");
    expect(nearestHandle(FULL_TRIM, 0.4)).toBe("start");
    expect(nearestHandle(FULL_TRIM, 0.6)).toBe("end");
  });
});
