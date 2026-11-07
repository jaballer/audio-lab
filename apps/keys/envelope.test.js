import { describe, expect, it } from "vitest";
import { releaseEnvelope, startEnvelope } from "./envelope.js";

// An AudioParam stand-in that records every scheduling call, in order.
function fakeParam(value = 0) {
  const calls = [];
  const record =
    (name) =>
    (...args) =>
      calls.push([name, ...args]);
  return {
    value,
    calls,
    setValueAtTime: record("setValueAtTime"),
    linearRampToValueAtTime: record("linearRampToValueAtTime"),
    setTargetAtTime: record("setTargetAtTime"),
    cancelScheduledValues: record("cancelScheduledValues"),
  };
}

describe("startEnvelope", () => {
  it("starts from silence, ramps to the peak, then decays toward the sustain level", () => {
    const param = fakeParam();
    startEnvelope(param, 2, { attack: 0.1, decay: 0.3, sustain: 0.5 }, 0.8);

    expect(param.calls[0]).toEqual(["setValueAtTime", 0, 2]);
    expect(param.calls[1]).toEqual(["linearRampToValueAtTime", 0.8, 2.1]);
    const [name, target, start, timeConstant] = param.calls[2];
    expect(name).toBe("setTargetAtTime");
    expect(target).toBeCloseTo(0.4);
    expect(start).toBeCloseTo(2.1);
    expect(timeConstant).toBeCloseTo(0.1); // decay / 3
  });
});

describe("releaseEnvelope", () => {
  it("fades from the current level to silence over the release time", () => {
    const param = fakeParam(0.37);
    releaseEnvelope(param, 5, 0.25);

    expect(param.calls).toEqual([
      ["cancelScheduledValues", 5],
      ["setValueAtTime", 0.37, 5],
      ["linearRampToValueAtTime", 0, 5.25],
    ]);
  });
});
