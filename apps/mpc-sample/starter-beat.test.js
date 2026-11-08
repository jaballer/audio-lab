import { describe, expect, it } from "vitest";
import { createPattern } from "../../shared/pattern.js";
import { PAD_COUNT } from "./sequencer.js";
import { STARTER_BEAT } from "./starter-beat.js";

describe("STARTER_BEAT", () => {
  it("is a boom on beats 1 and 3 and a tap on 2 and 4, on pads 1 and 2 of bank A", () => {
    const pattern = createPattern(PAD_COUNT, 16, STARTER_BEAT);
    const on = (row) => pattern.row(row).flatMap((v, i) => (v ? [i] : []));
    expect(on(0)).toEqual([0, 8]);
    expect(on(1)).toEqual([4, 12]);
    expect(on(2)).toEqual([]);
  });
});
