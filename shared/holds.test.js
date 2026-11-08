import { describe, expect, it } from "vitest";
import { createHolds } from "./holds.js";

describe("createHolds", () => {
  it("frees a note when its only holder lets go", () => {
    const holds = createHolds();
    holds.press(60, "midi");
    expect(holds.release(60, "midi")).toBe(true);
  });

  it("does not free a note that was never pressed", () => {
    expect(createHolds().release(60, "midi")).toBe(false);
  });

  it("does not free a note twice", () => {
    const holds = createHolds();
    holds.press(60, "midi");
    holds.release(60, "midi");
    expect(holds.release(60, "midi")).toBe(false);
  });

  it("keeps a note down while another source still holds it", () => {
    const holds = createHolds();
    holds.press(60, "midi");
    holds.press(60, "keyboard");

    expect(holds.release(60, "midi")).toBe(false); // the keyboard still has it
    expect(holds.release(60, "keyboard")).toBe(true);
  });

  it("does not matter which source lets go first", () => {
    const holds = createHolds();
    holds.press(60, "midi");
    holds.press(60, "keyboard");
    expect(holds.release(60, "keyboard")).toBe(false);
    expect(holds.release(60, "midi")).toBe(true);
  });

  it("counts a source once, however many times it presses the note", () => {
    // A controller that repeats a Note On must not need a Note Off for each.
    const holds = createHolds();
    holds.press(60, "midi");
    holds.press(60, "midi");
    expect(holds.release(60, "midi")).toBe(true);
  });

  it("ignores a release from a source that was not holding the note", () => {
    const holds = createHolds();
    holds.press(60, "midi");
    expect(holds.release(60, "keyboard")).toBe(false);
    expect(holds.release(60, "midi")).toBe(true); // still held until its own holder lets go
  });

  it("tells two fingers on one key apart", () => {
    const holds = createHolds();
    holds.press(60, "pointer-2");
    holds.press(60, "pointer-3");
    expect(holds.release(60, "pointer-2")).toBe(false);
    expect(holds.release(60, "pointer-3")).toBe(true);
  });

  it("keeps notes apart", () => {
    const holds = createHolds();
    holds.press(60, "midi");
    holds.press(64, "midi");
    expect(holds.release(60, "midi")).toBe(true);
    expect(holds.release(64, "midi")).toBe(true);
  });

  it("can press a note again after it was freed", () => {
    const holds = createHolds();
    holds.press(60, "midi");
    holds.release(60, "midi");
    holds.press(60, "midi");
    expect(holds.release(60, "midi")).toBe(true);
  });

  describe("releaseAll", () => {
    it("frees every note the source was holding and says which", () => {
      const holds = createHolds();
      holds.press(60, "midi-A");
      holds.press(64, "midi-A");
      expect(holds.releaseAll("midi-A").sort()).toEqual([60, 64]);
      expect(holds.release(60, "midi-A")).toBe(false); // nothing left to release
      expect(holds.release(64, "midi-A")).toBe(false);
    });

    it("leaves a note down that another source still holds, and does not report it", () => {
      const holds = createHolds();
      holds.press(60, "midi-A");
      holds.press(60, "midi-B");
      holds.press(64, "midi-A");
      expect(holds.releaseAll("midi-A")).toEqual([64]);
      expect(holds.release(60, "midi-B")).toBe(true); // B alone holds it now
    });

    it("lets a note be silenced by another source after the first one is gone", () => {
      // A device unplugged while holding a note must not keep that note down for good.
      const holds = createHolds();
      holds.press(60, "midi-A");
      holds.releaseAll("midi-A");
      holds.press(60, "midi-B");
      expect(holds.release(60, "midi-B")).toBe(true);
    });

    it("does nothing for a source that holds nothing", () => {
      const holds = createHolds();
      holds.press(60, "midi-A");
      expect(holds.releaseAll("midi-Z")).toEqual([]);
      expect(holds.release(60, "midi-A")).toBe(true);
    });
  });

  it("says whether a press made the note newly held, so only that one starts the sound", () => {
    const holds = createHolds();
    expect(holds.press(60, "midi")).toBe(true);
    expect(holds.press(60, "keyboard")).toBe(false); // already sounding
    expect(holds.press(60, "midi")).toBe(false); // the same source again
    expect(holds.press(62, "midi")).toBe(true);
  });
});
