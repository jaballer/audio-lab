import { describe, expect, it } from "vitest";
import { createHolds } from "./holds.js";

describe("createHolds", () => {
  it("frees a note when its only holder lets go", () => {
    const holds = createHolds();
    holds.press(60, "midi");
    expect(holds.isDown(60)).toBe(true);
    expect(holds.release(60, "midi")).toBe(true);
    expect(holds.isDown(60)).toBe(false);
  });

  it("does not free a note that was never pressed", () => {
    expect(createHolds().release(60, "midi")).toBe(false);
  });

  it("keeps a note down while another source still holds it", () => {
    const holds = createHolds();
    holds.press(60, "midi");
    holds.press(60, "keyboard");

    expect(holds.release(60, "midi")).toBe(false); // the keyboard still has it
    expect(holds.isDown(60)).toBe(true);
    expect(holds.release(60, "keyboard")).toBe(true);
    expect(holds.isDown(60)).toBe(false);
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
    expect(holds.isDown(60)).toBe(true);
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
    expect(holds.isDown(64)).toBe(true);
  });

  it("can press a note again after it was freed", () => {
    const holds = createHolds();
    holds.press(60, "midi");
    holds.release(60, "midi");
    holds.press(60, "midi");
    expect(holds.isDown(60)).toBe(true);
    expect(holds.release(60, "midi")).toBe(true);
  });
});
