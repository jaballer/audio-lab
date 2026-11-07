import { describe, expect, it, vi } from "vitest";
import { PAD_SLOTS, createPadLearner } from "./pad-learner.js";

const learner = (saved = null) => {
  const save = vi.fn();
  return { pads: createPadLearner({ load: () => saved, save }), save };
};

describe("createPadLearner", () => {
  it("learns notes into slots in the order they are first hit", () => {
    const { pads } = learner();
    expect(pads.slotFor(36)).toBe(0);
    expect(pads.slotFor(37)).toBe(1);
    expect(pads.slotFor(36)).toBe(0);
    expect(pads.notes).toEqual([36, 37]);
  });

  it("treats a note 8 above or below a learned one as the same pad", () => {
    const { pads } = learner({ pads: [36, 37] });
    expect(pads.slotFor(44)).toBe(0);
    expect(pads.slotFor(29)).toBe(1);
    expect(pads.notes).toEqual([36, 37]);
  });

  it("returns -1 once every slot is taken, and learns nothing more", () => {
    const { pads, save } = learner();
    for (let i = 0; i < PAD_SLOTS; i++) pads.slotFor(40 + i * 3);
    save.mockClear();
    expect(pads.slotFor(99)).toBe(-1);
    expect(pads.notes).toHaveLength(PAD_SLOTS);
    expect(save).not.toHaveBeenCalled();
  });

  it("saves only when it learns a new note, as { pads: [...] }", () => {
    const { pads, save } = learner();
    pads.slotFor(36);
    pads.slotFor(36);
    pads.slotFor(44);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ pads: [36] });
  });

  it("restores saved notes", () => {
    const { pads } = learner({ pads: [48, 49] });
    expect(pads.notes).toEqual([48, 49]);
    expect(pads.slotFor(49)).toBe(1);
  });

  it("ignores saved data that is missing, malformed or too long", () => {
    expect(learner(null).pads.notes).toEqual([]);
    expect(learner({ pads: "nope" }).pads.notes).toEqual([]);
    expect(learner({ pads: [36, "x", 37.5, 38] }).pads.notes).toEqual([36, 38]);
    expect(learner({ pads: Array.from({ length: 20 }, (_, i) => i) }).pads.notes).toHaveLength(PAD_SLOTS);
  });

  it("hands out a copy of the notes, not its own list", () => {
    const { pads } = learner();
    pads.slotFor(36);
    pads.notes.push(99);
    expect(pads.notes).toEqual([36]);
  });
});
