import { describe, expect, it } from "vitest";
import { PAD_COLUMNS, PAD_COUNT, PAD_ROWS, STEPS, STEP_GROUP, padColumn, padIndex, padRow } from "./layout.js";
import { KEY_ROWS } from "./pads.js";
import { SOUNDS } from "./sounds.js";

describe("layout", () => {
  it("has a pad for every sound and a sound for every pad", () => {
    expect(SOUNDS).toHaveLength(PAD_COUNT);
  });

  it("has a computer key for every pad", () => {
    expect(KEY_ROWS).toHaveLength(PAD_ROWS);
    for (const row of KEY_ROWS) expect(row).toHaveLength(PAD_COLUMNS);
  });

  it("splits the steps into whole groups", () => {
    expect(STEPS % STEP_GROUP).toBe(0);
  });
});

describe("pad positions", () => {
  it("puts pad 1 bottom-left and the highest pad top-right", () => {
    expect(padIndex(PAD_ROWS - 1, 0)).toBe(0);
    expect(padIndex(0, PAD_COLUMNS - 1)).toBe(PAD_COUNT - 1);
  });

  it("numbers along each row, left to right", () => {
    expect(padIndex(PAD_ROWS - 1, 1)).toBe(1);
    expect(padIndex(PAD_ROWS - 2, 0)).toBe(PAD_COLUMNS);
  });

  it("is undone by padRow and padColumn, for every pad", () => {
    for (let index = 0; index < PAD_COUNT; index++) {
      expect(padIndex(padRow(index), padColumn(index))).toBe(index);
    }
  });
});
