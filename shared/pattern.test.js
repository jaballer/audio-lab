import { describe, expect, it } from "vitest";
import { FULL_VELOCITY, MIN_VELOCITY, createPattern } from "./pattern.js";

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
