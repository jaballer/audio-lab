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
    const seconds = (trim, duration) => (trim.end - trim.start) * duration;
    const atStart = clampTrim({ start: 0, end: 0 }, 2, "end");
    expect(atStart.start).toBe(0);
    expect(seconds(atStart, 2)).toBeGreaterThanOrEqual(MIN_TRIM_SECONDS - 1e-9);
    const atEnd = clampTrim({ start: 1, end: 1 }, 2, "start");
    expect(atEnd.end).toBe(1);
    expect(seconds(atEnd, 2)).toBeGreaterThanOrEqual(MIN_TRIM_SECONDS - 1e-9);
  });

  it("gives way at the edge it is pushed against, whichever handle is moved", () => {
    const gap = 0.0025; // 5 ms of 2 s
    expect(clampTrim({ start: 0, end: 0 }, 2, "start")).toEqual({ start: 0, end: gap }); // start cannot go below 0
    expect(clampTrim({ start: 1, end: 1 }, 2, "end")).toEqual({ start: 1 - gap, end: 1 }); // end cannot go above 1
    expect(clampTrim({ start: 1, end: 1 }, 2, "start")).toEqual({ start: 1 - gap, end: 1 });
    expect(clampTrim({ start: 0, end: 0 }, 2, "end")).toEqual({ start: 0, end: gap });
  });

  it("is never shorter than the shortest window after rounding: 4.8 ms of a 3 s sample was possible", () => {
    const trim = clampTrim({ start: 0.7327, end: 0.1071 }, 3, "end");
    expect((trim.end - trim.start) * 3).toBeGreaterThanOrEqual(MIN_TRIM_SECONDS - 1e-9);
  });

  it("holds for a spread of trims, handles and sample lengths", () => {
    // A small deterministic generator, so a failure can be reproduced.
    let seed = 12345;
    const next = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 3000; i++) {
      const duration = [0.02, 0.1, 0.5, 1.7, 3, 10][Math.floor(next() * 6)];
      const trim = { start: next() * 1.4 - 0.2, end: next() * 1.4 - 0.2 };
      const moved = [undefined, "start", "end"][Math.floor(next() * 3)];
      const result = clampTrim(trim, duration, moved);
      expect(result.start).toBeGreaterThanOrEqual(0);
      expect(result.end).toBeLessThanOrEqual(1);
      expect(result.start).toBeLessThan(result.end);
      expect((result.end - result.start) * duration).toBeGreaterThanOrEqual(MIN_TRIM_SECONDS - 1e-9);
      expect(clampTrim(result, duration, moved)).toEqual(result); // and a trim that is possible stays as it is
    }
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
