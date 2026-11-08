import { describe, expect, it } from "vitest";
import { createPattern } from "../../shared/pattern.js";
import { STARTER_BEAT } from "./starter-beat.js";

describe("STARTER_BEAT", () => {
  it("is a kick on the beat, a snare on 2 and 4, and eighth-note closed hats", () => {
    const pattern = createPattern(16, 16, STARTER_BEAT);
    const on = (row) => pattern.row(row).flatMap((v, i) => (v ? [i] : []));
    expect(on(0)).toEqual([0, 4, 8, 12]);
    expect(on(1)).toEqual([4, 12]);
    expect(on(2)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(on(3)).toEqual([]);
  });
});
