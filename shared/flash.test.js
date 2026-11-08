import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlasher } from "./flash.js";

const fakeElement = () => {
  const classes = new Set();
  return { classes, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createFlasher", () => {
  it("lights an element, then switches it off after the time", () => {
    const flash = createFlasher("hit", 100);
    const el = fakeElement();
    flash(el);
    expect(el.classes.has("hit")).toBe(true);
    vi.advanceTimersByTime(99);
    expect(el.classes.has("hit")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.classes.has("hit")).toBe(false);
  });

  it("starts the time over when an element is hit again while lit", () => {
    const flash = createFlasher("hit", 100);
    const el = fakeElement();
    flash(el);
    vi.advanceTimersByTime(60);
    flash(el);
    vi.advanceTimersByTime(60); // 120 ms after the first hit, 60 after the second
    expect(el.classes.has("hit")).toBe(true);
    vi.advanceTimersByTime(40);
    expect(el.classes.has("hit")).toBe(false);
  });

  it("times each element on its own", () => {
    const flash = createFlasher("hit", 100);
    const a = fakeElement();
    const b = fakeElement();
    flash(a);
    vi.advanceTimersByTime(60);
    flash(b);
    vi.advanceTimersByTime(40);
    expect(a.classes.has("hit")).toBe(false);
    expect(b.classes.has("hit")).toBe(true);
  });
});
