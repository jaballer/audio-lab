import { describe, expect, it, vi } from "vitest";
import { createConsoleLog, formatTime } from "./console-log.js";

const AT = new Date(2026, 10, 8, 9, 5, 3).getTime();

describe("createConsoleLog", () => {
  it("keeps entries oldest first, with a level that defaults to info", () => {
    const log = createConsoleLog({ now: () => AT });
    log.add("one");
    log.add("two", "error");
    expect(log.entries()).toEqual([
      { time: AT, level: "info", text: "one" },
      { time: AT, level: "error", text: "two" },
    ]);
  });

  it("drops the oldest entries past the limit", () => {
    const log = createConsoleLog({ limit: 2 });
    for (const text of ["a", "b", "c"]) log.add(text);
    expect(log.entries().map((e) => e.text)).toEqual(["b", "c"]);
  });

  it("tells its owner on every add and on clear, so the view can redraw", () => {
    const onChange = vi.fn();
    const log = createConsoleLog({ onChange });
    log.add("one");
    log.clear();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(log.entries()).toEqual([]);
  });

  it("works without an onChange", () => {
    expect(() => createConsoleLog().add("one")).not.toThrow();
  });

  it("writes one line per entry for copying", () => {
    const log = createConsoleLog({ now: () => AT });
    log.add("Inputs (1): MPK mini");
    log.add("Permission denied", "warn");
    expect(log.toText()).toBe("09:05:03 INFO Inputs (1): MPK mini\n09:05:03 WARN Permission denied");
  });
});

describe("formatTime", () => {
  it("pads hours, minutes and seconds to two digits", () => {
    expect(formatTime(AT)).toBe("09:05:03");
  });
});
