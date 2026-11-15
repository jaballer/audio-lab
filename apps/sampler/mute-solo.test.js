import { describe, expect, it, vi } from "vitest";
import { createMuteSolo, isAudible } from "./mute-solo.js";

describe("isAudible", () => {
  it("hears every pad when nothing is muted or soloed", () => {
    expect(isAudible(2, { muted: new Set(), soloed: new Set() })).toBe(true);
  });

  it("silences a muted pad", () => {
    expect(isAudible(2, { muted: new Set([2]), soloed: new Set() })).toBe(false);
  });

  it("hears only the soloed pads while any is soloed", () => {
    const state = { muted: new Set(), soloed: new Set([1, 4]) };
    expect(isAudible(1, state)).toBe(true);
    expect(isAudible(4, state)).toBe(true);
    expect(isAudible(2, state)).toBe(false);
  });

  it("lets the mute win over a solo of the same pad", () => {
    expect(isAudible(1, { muted: new Set([1]), soloed: new Set([1]) })).toBe(false);
  });
});

describe("createMuteSolo", () => {
  it("starts with every pad heard", () => {
    const state = createMuteSolo(4);
    expect([0, 1, 2, 3].every((pad) => state.isAudible(pad))).toBe(true);
  });

  it("toggles a mute on and off", () => {
    const state = createMuteSolo(4);
    state.toggleMute(1);
    expect(state.isMuted(1)).toBe(true);
    expect(state.isAudible(1)).toBe(false);
    state.toggleMute(1);
    expect(state.isMuted(1)).toBe(false);
    expect(state.isAudible(1)).toBe(true);
  });

  it("silences the pads that are not soloed, without muting them", () => {
    const state = createMuteSolo(4);
    state.toggleSolo(2);
    expect(state.isAudible(2)).toBe(true);
    expect(state.isAudible(0)).toBe(false);
    expect(state.isMuted(0)).toBe(false);
  });

  it("brings the pads back as they were when the last solo is cleared", () => {
    const state = createMuteSolo(4);
    state.toggleMute(3);
    state.toggleSolo(2);
    state.toggleSolo(2);
    expect(state.isAudible(0)).toBe(true);
    expect(state.isAudible(3)).toBe(false); // still muted by its own flag
  });

  it("can solo more than one pad", () => {
    const state = createMuteSolo(4);
    state.toggleSolo(0);
    state.toggleSolo(1);
    expect(state.isAudible(0) && state.isAudible(1)).toBe(true);
    expect(state.isAudible(2)).toBe(false);
  });

  it("reports the pad that was toggled and the pads a solo switched", () => {
    const onChange = vi.fn();
    const state = createMuteSolo(3, { onChange });
    state.toggleSolo(1);
    expect(onChange.mock.calls.map(([pad]) => pad).sort()).toEqual([0, 1, 2]);
    onChange.mockClear();
    state.toggleMute(0); // already silent by the solo: only its own button changed
    expect(onChange.mock.calls.map(([pad]) => pad)).toEqual([0]);
  });

  it("ignores a pad that does not exist", () => {
    const onChange = vi.fn();
    const state = createMuteSolo(2, { onChange });
    state.toggleMute(5);
    state.toggleSolo(-1);
    expect(onChange).not.toHaveBeenCalled();
    expect(state.isAudible(5)).toBe(false);
  });
});
