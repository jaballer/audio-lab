import { describe, expect, it } from "vitest";
import { createPointerNotes } from "./pointer-notes.js";

describe("createPointerNotes", () => {
  it("remembers the note each pointer is holding, and hands it back on release", () => {
    const pointers = createPointerNotes();
    pointers.press(1, 60);
    pointers.press(2, 64);
    expect(pointers.release(1)).toBe(60);
    expect(pointers.release(2)).toBe(64);
  });

  it("has nothing to release for a pointer that is not down", () => {
    const pointers = createPointerNotes();
    expect(pointers.release(9)).toBeUndefined();
    pointers.press(1, 60);
    pointers.release(1);
    expect(pointers.release(1)).toBeUndefined(); // already let go
  });

  it("does not let one pointer's release touch another's note", () => {
    const pointers = createPointerNotes();
    pointers.press(1, 60);
    pointers.press(2, 64);
    pointers.release(1);
    expect(pointers.release(2)).toBe(64);
  });

  it("hands back the note a pointer was still holding when it presses again", () => {
    // Its pointerup never arrived: the caller has to end that note or it stays held.
    const pointers = createPointerNotes();
    expect(pointers.press(1, 60)).toBeUndefined();
    expect(pointers.press(1, 64)).toBe(60);
    expect(pointers.release(1)).toBe(64);
  });

  it("returns note 0 as a note, not as nothing", () => {
    const pointers = createPointerNotes();
    pointers.press(1, 0);
    expect(pointers.release(1)).toBe(0);
  });

  it("lets go of every pointer at once and says which notes", () => {
    const pointers = createPointerNotes();
    pointers.press(1, 60);
    pointers.press(2, 64);
    expect(pointers.releaseAll()).toEqual([
      [1, 60],
      [2, 64],
    ]);
    expect(pointers.release(1)).toBeUndefined();
    expect(pointers.releaseAll()).toEqual([]);
  });
});
