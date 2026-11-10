import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOT_MS, SHUTDOWN_MS, createPowerSequence, phaseFor, sweepStep } from "./power-sequence.js";

describe("sweepStep", () => {
  it("starts at the bottom-left pad and ends at the top-right", () => {
    expect(sweepStep(3, 0, 4)).toBe(0);
    expect(sweepStep(0, 3, 4)).toBe(6);
  });

  it("gives pads on one diagonal the same step", () => {
    expect(sweepStep(2, 1, 4)).toBe(sweepStep(3, 2, 4));
  });
});

describe("phaseFor", () => {
  it("boots from off, and turns a shutdown back into a boot", () => {
    expect(phaseFor("off", true)).toBe("booting");
    expect(phaseFor("shutdown", true)).toBe("booting");
  });

  it("shuts down from on, and turns a boot back into a shutdown", () => {
    expect(phaseFor("on", false)).toBe("shutdown");
    expect(phaseFor("booting", false)).toBe("shutdown");
  });

  it("stays put when power already matches", () => {
    expect(phaseFor("on", true)).toBe("on");
    expect(phaseFor("booting", true)).toBe("booting");
    expect(phaseFor("off", false)).toBe("off");
    expect(phaseFor("shutdown", false)).toBe("shutdown");
  });
});

describe("createPowerSequence", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts off, and does not announce that", () => {
    const onPhase = vi.fn();
    expect(createPowerSequence({ onPhase }).phase).toBe("off");
    expect(onPhase).not.toHaveBeenCalled();
  });

  it("boots, then settles to on", () => {
    const onPhase = vi.fn();
    const power = createPowerSequence({ onPhase });
    power.set(true);
    expect(onPhase).toHaveBeenLastCalledWith("booting");
    vi.advanceTimersByTime(BOOT_MS);
    expect(onPhase.mock.calls.map(([p]) => p)).toEqual(["booting", "on"]);
  });

  it("shuts down, then settles to off", () => {
    const onPhase = vi.fn();
    const power = createPowerSequence({ onPhase });
    power.set(true);
    vi.advanceTimersByTime(BOOT_MS);
    power.set(false);
    vi.advanceTimersByTime(SHUTDOWN_MS);
    expect(power.phase).toBe("off");
    expect(onPhase.mock.calls.map(([p]) => p)).toEqual(["booting", "on", "shutdown", "off"]);
  });

  it("turns around at once when power flips mid-boot, and the old timer does not fire", () => {
    const onPhase = vi.fn();
    const power = createPowerSequence({ onPhase });
    power.set(true);
    vi.advanceTimersByTime(BOOT_MS / 2);
    power.set(false);
    vi.advanceTimersByTime(BOOT_MS / 2);
    expect(power.phase).toBe("shutdown");
    vi.advanceTimersByTime(SHUTDOWN_MS);
    expect(onPhase.mock.calls.map(([p]) => p)).toEqual(["booting", "shutdown", "off"]);
  });

  it("ignores a repeat of the power it already has", () => {
    const onPhase = vi.fn();
    const power = createPowerSequence({ onPhase });
    power.set(false);
    power.set(true);
    power.set(true);
    expect(onPhase).toHaveBeenCalledTimes(1);
  });
});
