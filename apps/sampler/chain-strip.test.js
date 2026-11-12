import { describe, expect, it } from "vitest";
import { entryCells, loopTitle, neighbourEntry } from "./chain-strip.js";

const entry = (sequence, repeats = 1) => ({ sequence, repeats });

describe("entryCells", () => {
  const entries = [entry(0), entry(2, 3), entry(1, 16)];

  it("has a cell for each entry, in order, with its sequence as the number on its face", () => {
    expect(entryCells(entries, 0).map(({ index, label }) => [index, label])).toEqual([
      [0, "1"],
      [1, "3"],
      [2, "2"],
    ]);
  });

  it("says how many times an entry goes round, and nothing for one that goes round once", () => {
    expect(entryCells(entries, 0).map(({ times }) => times)).toEqual(["", "×3", "×16"]);
  });

  it("presses in the entry that is selected, and no other", () => {
    expect(entryCells(entries, 1).map(({ pressed }) => pressed)).toEqual([false, true, false]);
    expect(entryCells(entries, 7).map(({ pressed }) => pressed)).toEqual([false, false, false]);
  });

  it("marks the entry that is playing, and says its time round in place of how many there are", () => {
    const cells = entryCells(entries, 0, { entry: 1, rep: 1 });
    expect(cells.map(({ playing }) => playing)).toEqual([false, true, false]);
    expect(cells.map(({ times }) => times)).toEqual(["", "2/3", "×16"]);
  });

  it("is both pressed in and marked when the entry selected is the one playing", () => {
    const [cell] = entryCells(entries, 0, { entry: 0, rep: 0 });
    expect(cell).toMatchObject({ pressed: true, playing: true });
  });

  it("marks nothing when the song is not playing", () => {
    expect(entryCells(entries, 0).every(({ playing }) => !playing)).toBe(true);
    expect(entryCells(entries, 0, null).every(({ playing }) => !playing)).toBe(true);
  });

  it("shows nothing but the mark for a playing entry that goes round once", () => {
    const [first] = entryCells(entries, 0, { entry: 0, rep: 0 });
    expect(first).toMatchObject({ playing: true, times: "" });
  });

  it("names each cell for a screen reader: its place, its sequence and its times, and whether it is playing", () => {
    expect(entryCells(entries, 0).map(({ name }) => name)).toEqual([
      "Entry 1, sequence 1, once",
      "Entry 2, sequence 3, 3 times",
      "Entry 3, sequence 2, 16 times",
    ]);
    const playing = entryCells(entries, 0, { entry: 1, rep: 2 });
    expect(playing[1].name).toBe("Entry 2, sequence 3, 3 times, playing, time 3 of 3");
    expect(entryCells(entries, 0, { entry: 0, rep: 0 })[0].name).toBe("Entry 1, sequence 1, once, playing");
  });

  it("has no cells for no entries", () => {
    expect(entryCells([], 0)).toEqual([]);
  });
});

describe("neighbourEntry", () => {
  it("moves the selection one entry along the row with the arrow keys, and stops at the ends", () => {
    expect(neighbourEntry(2, "ArrowLeft", 5)).toBe(1);
    expect(neighbourEntry(2, "ArrowRight", 5)).toBe(3);
    expect(neighbourEntry(0, "ArrowLeft", 5)).toBe(0);
    expect(neighbourEntry(4, "ArrowRight", 5)).toBe(4);
  });

  it("takes the up and down arrows as left and right: the row wraps, and a person does not know where it does", () => {
    expect(neighbourEntry(2, "ArrowUp", 5)).toBe(1);
    expect(neighbourEntry(2, "ArrowDown", 5)).toBe(3);
  });

  it("goes to the first and the last with Home and End", () => {
    expect(neighbourEntry(3, "Home", 5)).toBe(0);
    expect(neighbourEntry(1, "End", 5)).toBe(4);
  });

  it("is -1 for any other key, so it is left to do what it does", () => {
    for (const key of ["Enter", " ", "Tab", "a", "PageDown", "Escape"]) expect(neighbourEntry(2, key, 5)).toBe(-1);
  });

  it("stays on the one entry there is", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) expect(neighbourEntry(0, key, 1)).toBe(0);
  });
});

describe("loopTitle", () => {
  it("says what Loop does as it is: the song goes round again at its end when on, and stops there when off", () => {
    expect(loopTitle(true)).toMatch(/^On: .*goes round again/);
    expect(loopTitle(false)).toMatch(/^Off: .*stops/);
  });
});
