import { describe, expect, it } from "vitest";
import { FULL_VELOCITY, MIN_VELOCITY, createPattern, firstDifference } from "./pattern.js";

describe("createPattern", () => {
  it("starts empty", () => {
    const pattern = createPattern(3, 4);
    expect(pattern.row(0)).toEqual([false, false, false, false]);
    expect(pattern.isOn(2, 3)).toBe(false);
  });

  it("toggles and sets single steps", () => {
    const pattern = createPattern(2, 4);
    pattern.toggle(1, 2);
    expect(pattern.isOn(1, 2)).toBe(true);
    pattern.toggle(1, 2);
    expect(pattern.isOn(1, 2)).toBe(false);
    pattern.set(0, 3, true);
    pattern.set(0, 3, true);
    expect(pattern.isOn(0, 3)).toBe(true);
  });

  it("keeps rows independent", () => {
    const pattern = createPattern(2, 4);
    pattern.set(0, 1, true);
    expect(pattern.row(1)).toEqual([false, false, false, false]);
  });

  it("starts from the given steps", () => {
    const pattern = createPattern(3, 8, { 0: [0, 4], 2: [7] });
    expect(pattern.row(0)).toEqual([true, false, false, false, true, false, false, false]);
    expect(pattern.row(1)).toEqual(new Array(8).fill(false));
    expect(pattern.isOn(2, 7)).toBe(true);
  });

  it("clears one row or everything", () => {
    const pattern = createPattern(2, 4, { 0: [0, 1], 1: [2] });
    pattern.clearRow(0);
    expect(pattern.row(0)).toEqual([false, false, false, false]);
    expect(pattern.isOn(1, 2)).toBe(true);
    pattern.clearAll();
    expect(pattern.row(1)).toEqual([false, false, false, false]);
  });

  it("hands out a copy of a row, not its own", () => {
    const pattern = createPattern(1, 4);
    pattern.row(0)[0] = true;
    expect(pattern.isOn(0, 0)).toBe(false);
  });
});

describe("velocity", () => {
  it("is full for every step until it is set", () => {
    const pattern = createPattern(2, 4, { 0: [1] });
    expect(pattern.velocity(0, 1)).toBe(FULL_VELOCITY);
    expect(pattern.velocity(1, 3)).toBe(FULL_VELOCITY);
  });

  it("is set per step and row, and rounded and kept between 1 and 127", () => {
    const pattern = createPattern(2, 4, { 0: [0, 1], 1: [0] });
    pattern.setVelocity(0, 0, 64.4);
    pattern.setVelocity(0, 1, 500);
    pattern.setVelocity(1, 0, -3);
    expect(pattern.velocity(0, 0)).toBe(64);
    expect(pattern.velocity(0, 1)).toBe(FULL_VELOCITY);
    expect(pattern.velocity(1, 0)).toBe(MIN_VELOCITY);
  });

  it("cannot be set on a step that is off", () => {
    const pattern = createPattern(1, 4);
    pattern.setVelocity(0, 2, 40);
    pattern.set(0, 2, true);
    expect(pattern.velocity(0, 2)).toBe(FULL_VELOCITY);
  });

  it("is forgotten when the step is turned off, by a toggle, a row clear or a clear all", () => {
    const pattern = createPattern(2, 4, { 0: [0, 1], 1: [0] });
    pattern.setVelocity(0, 0, 30);
    pattern.toggle(0, 0);
    pattern.toggle(0, 0);
    expect(pattern.velocity(0, 0)).toBe(FULL_VELOCITY);
    pattern.setVelocity(0, 1, 30);
    pattern.clearRow(0);
    pattern.set(0, 1, true);
    expect(pattern.velocity(0, 1)).toBe(FULL_VELOCITY);
    pattern.setVelocity(1, 0, 30);
    pattern.clearAll();
    pattern.set(1, 0, true);
    expect(pattern.velocity(1, 0)).toBe(FULL_VELOCITY);
  });

  it("is set along with a step that is turned on, and replaced when set again on one that is on", () => {
    const pattern = createPattern(1, 4);
    pattern.set(0, 1, true, 70);
    expect(pattern.velocity(0, 1)).toBe(70);
    pattern.set(0, 1, true, 20);
    expect(pattern.velocity(0, 1)).toBe(20);
    pattern.set(0, 1, true); // no velocity given: the step is left as it is
    expect(pattern.velocity(0, 1)).toBe(20);
    pattern.set(0, 1, false, 99); // turning off forgets it, whatever is passed
    expect(pattern.velocity(0, 1)).toBe(FULL_VELOCITY);
  });

  it("starts from the given velocities, for steps that are on", () => {
    const pattern = createPattern(
      2,
      4,
      { 0: [1, 2] },
      { velocities: { 0: { 1: 40, 3: 40 }, 1: { 0: 40 }, 9: { 0: 40 } } },
    );
    expect(pattern.velocity(0, 1)).toBe(40);
    expect(pattern.velocity(0, 2)).toBe(FULL_VELOCITY);
    pattern.set(0, 3, true); // the entry for step 3 was for a step that was off
    expect(pattern.velocity(0, 3)).toBe(FULL_VELOCITY);
    expect(pattern.velocity(1, 0)).toBe(FULL_VELOCITY);
  });

  it("lists the velocities that are not full, in the shape it starts from", () => {
    const pattern = createPattern(3, 8, { 0: [0, 4], 2: [7] });
    expect(pattern.velocitySnapshot()).toEqual({});
    pattern.setVelocity(0, 4, 60);
    pattern.setVelocity(2, 7, 127);
    expect(pattern.velocitySnapshot()).toEqual({ 0: { 4: 60 } });
    const copy = createPattern(3, 8, pattern.snapshot(), { velocities: pattern.velocitySnapshot() });
    expect(copy.velocity(0, 4)).toBe(60);
  });

  it("does not change what the snapshot lists", () => {
    const pattern = createPattern(1, 4, { 0: [0, 2] });
    pattern.setVelocity(0, 0, 10);
    expect(pattern.snapshot()).toEqual({ 0: [0, 2] });
  });
});

describe("rows and state", () => {
  it("gives a row's state and puts it on another pad, velocities too", () => {
    const pattern = createPattern(3, 8, { 0: [1, 4] }, { velocities: { 0: { 4: 40 } } });
    expect(pattern.rowState(0)).toEqual({ length: 8, on: [1, 4], velocities: { 4: 40 } });
    pattern.replaceRow(2, pattern.rowState(0));
    expect(pattern.row(2)).toEqual(pattern.row(0));
    expect(pattern.velocity(2, 4)).toBe(40);
    expect(pattern.rowState(1)).toEqual({ length: 8, on: [], velocities: {} });
  });

  it("replaces what a row had, and reports one change only when something differs", () => {
    const changes = [];
    const pattern = createPattern(2, 4, { 1: [0, 2] }, { onChange: () => changes.push(1) });
    pattern.replaceRow(1, { on: [3], velocities: {} });
    expect(pattern.row(1)).toEqual([false, false, false, true]);
    expect(changes).toHaveLength(1);
    pattern.replaceRow(1, { on: [3], velocities: {} });
    expect(changes).toHaveLength(1);
  });

  it("ignores steps and velocities that are not in the row", () => {
    const pattern = createPattern(1, 4);
    pattern.replaceRow(0, { on: [1, 9, -1, 1.5, "2"], velocities: { 1: 30, 3: 30, 9: 30 } });
    expect(pattern.rowState(0)).toEqual({ length: 4, on: [1], velocities: { 1: 30 } });
  });

  it("copies a stretch of a row and puts it on another stretch, the rest of the row left alone", () => {
    const pattern = createPattern(2, 8, { 0: [0, 2, 5], 1: [6] }, { velocities: { 0: { 2: 40 } } });
    const bar = pattern.rowState(0, 0, 4); // steps 0-3 of pad 0
    expect(bar).toEqual({ length: 4, on: [0, 2], velocities: { 2: 40 } });
    pattern.replaceRow(0, bar, 4); // over steps 4-7 of the same pad
    expect(pattern.row(0)).toEqual([true, false, true, false, true, false, true, false]);
    expect(pattern.velocity(0, 6)).toBe(40);
    expect(pattern.row(0).slice(0, 4)).toEqual([true, false, true, false]); // the first stretch is as it was
    pattern.replaceRow(1, bar, 4);
    expect(pattern.row(1)).toEqual([false, false, false, false, true, false, true, false]);
  });

  it("clears the stretch it is pasted over, and does not run past the end of the row", () => {
    const pattern = createPattern(1, 8, { 0: [4, 5, 7] });
    pattern.replaceRow(0, { length: 4, on: [1], velocities: {} }, 4);
    expect(pattern.row(0)).toEqual([false, false, false, false, false, true, false, false]);
    pattern.replaceRow(0, { length: 4, on: [0, 3], velocities: {} }, 6); // only two steps are left
    expect(pattern.row(0).slice(6)).toEqual([true, false]);
    expect(pattern.rowState(0, 6, 4)).toEqual({ length: 2, on: [0], velocities: {} });
  });

  it("is restored whole from its state, with one change", () => {
    const changes = [];
    const pattern = createPattern(3, 8, { 0: [0, 4], 2: [7] }, { onChange: () => changes.push(1) });
    pattern.setVelocity(0, 4, 20);
    const saved = pattern.state();
    expect(saved).toEqual({ pattern: { 0: [0, 4], 2: [7] }, velocities: { 0: { 4: 20 } } });
    pattern.clearAll();
    pattern.set(1, 1, true, 99);
    changes.length = 0;
    pattern.restore(saved);
    expect(pattern.state()).toEqual(saved);
    expect(changes).toHaveLength(1);
    pattern.restore(saved);
    expect(changes).toHaveLength(1);
  });
});

describe("snapshot", () => {
  it("lists the steps that are on, per pad, and leaves empty pads out", () => {
    const pattern = createPattern(4, 8, { 0: [0, 4], 2: [7] });
    expect(pattern.snapshot()).toEqual({ 0: [0, 4], 2: [7] });
    expect(createPattern(4, 8).snapshot()).toEqual({});
  });

  it("is the shape createPattern starts from, so a pattern can be rebuilt from it", () => {
    const pattern = createPattern(16, 16, { 0: [0, 4, 8, 12], 1: [4, 12] });
    pattern.toggle(5, 3);
    const copy = createPattern(16, 16, pattern.snapshot());
    for (let row = 0; row < 16; row++) expect(copy.row(row)).toEqual(pattern.row(row));
  });
});

describe("onChange", () => {
  const setup = () => {
    const changes = [];
    const pattern = createPattern(2, 4, { 0: [1] }, { onChange: () => changes.push(1) });
    return { pattern, changes };
  };

  it("is not called while the pattern is being built", () => {
    expect(setup().changes).toHaveLength(0);
  });

  it("is called when a step is toggled or set to a different value", () => {
    const { pattern, changes } = setup();
    pattern.toggle(1, 2);
    pattern.set(1, 3, true);
    expect(changes).toHaveLength(2);
  });

  it("is not called when set does not change anything", () => {
    const { pattern, changes } = setup();
    pattern.set(0, 1, true); // already on
    pattern.set(1, 0, false); // already off
    expect(changes).toHaveLength(0);
  });

  it("is called when a clear removes something, and not when there was nothing to clear", () => {
    const { pattern, changes } = setup();
    pattern.clearRow(1);
    pattern.clearAll();
    expect(changes).toHaveLength(1); // only clearAll had a step to remove
    pattern.clearAll();
    expect(changes).toHaveLength(1);
  });

  it("is called when a velocity changes, and not when it stays the same or the step is off", () => {
    const { pattern, changes } = setup();
    pattern.setVelocity(0, 1, 80); // step 1 of row 0 is on in setup
    expect(changes).toHaveLength(1);
    pattern.setVelocity(0, 1, 80);
    pattern.setVelocity(1, 0, 80); // off
    expect(changes).toHaveLength(1);
  });

  it("is called after the pattern has changed", () => {
    const seen = [];
    const pattern = createPattern(1, 4, {}, { onChange: () => seen.push(pattern.isOn(0, 2)) });
    pattern.toggle(0, 2);
    expect(seen).toEqual([true]);
  });
});

describe("firstDifference", () => {
  const state = (pattern = {}, velocities = {}) => ({ pattern, velocities });

  it("is null for two states that are the same", () => {
    expect(firstDifference(state({ 0: [1, 2] }, { 0: { 2: 40 } }), state({ 0: [1, 2] }, { 0: { 2: 40 } }))).toBeNull();
    expect(firstDifference(state(), state())).toBeNull();
  });

  it("is the first step whose on or off is not the same", () => {
    expect(firstDifference(state({ 0: [1, 5] }), state({ 0: [1, 5, 9] }))).toEqual({ row: 0, step: 9 });
    expect(firstDifference(state({ 0: [1, 5] }), state({ 0: [5] }))).toEqual({ row: 0, step: 1 });
  });

  it("is the first step whose velocity is not the same, a step with none being at full", () => {
    expect(firstDifference(state({ 2: [3] }, { 2: { 3: 40 } }), state({ 2: [3] }, { 2: { 3: 90 } }))).toEqual({
      row: 2,
      step: 3,
    });
    expect(firstDifference(state({ 2: [3] }), state({ 2: [3] }, { 2: { 3: 90 } }))).toEqual({ row: 2, step: 3 });
    expect(firstDifference(state({ 2: [3] }), state({ 2: [3] }, { 2: { 3: FULL_VELOCITY } }))).toBeNull();
  });

  it("goes by the lowest pad first, then the earliest step, whatever order the keys come in", () => {
    const a = state({ 5: [2], 1: [8, 3] });
    const b = state({ 5: [], 1: [8] });
    expect(firstDifference(a, b)).toEqual({ row: 1, step: 3 });
    expect(firstDifference(state({ 10: [1], 9: [1] }), state({}))).toEqual({ row: 9, step: 1 });
  });

  it("works for pads that are in only one of the states", () => {
    expect(firstDifference(state({ 4: [7] }), state({}))).toEqual({ row: 4, step: 7 });
    expect(firstDifference(state({}), state({ 4: [7] }))).toEqual({ row: 4, step: 7 });
  });
});
