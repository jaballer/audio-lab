import { describe, expect, it } from "vitest";
import { parseMidi } from "./midi-messages.js";

describe("parseMidi", () => {
  it("reads a note on", () => {
    expect(parseMidi([0x90, 60, 100])).toEqual({ type: "noteOn", channel: 0, note: 60, velocity: 100 });
  });

  it("treats a note on with velocity 0 as a note off", () => {
    expect(parseMidi([0x90, 60, 0]).type).toBe("noteOff");
  });

  it("reads a note off", () => {
    expect(parseMidi([0x80, 60, 64])).toEqual({ type: "noteOff", channel: 0, note: 60, velocity: 64 });
  });

  it("reads the channel from the low nibble (channel 10 is 9)", () => {
    expect(parseMidi([0x99, 36, 90])).toMatchObject({ type: "noteOn", channel: 9 });
  });

  it("reads a control change", () => {
    expect(parseMidi([0xb0, 64, 127])).toEqual({ type: "cc", channel: 0, controller: 64, value: 127 });
  });

  it("scales pitch bend to -1..1 with the centre at 0", () => {
    expect(parseMidi([0xe0, 0, 0]).value).toBe(-1);
    expect(parseMidi([0xe0, 0, 64]).value).toBe(0);
    expect(parseMidi([0xe0, 127, 127]).value).toBeCloseTo(1, 3);
  });

  it("reads key pressure (polyphonic aftertouch), as the MPC Sample pads send it", () => {
    expect(parseMidi([0xa0, 42, 68])).toEqual({ type: "polyAftertouch", channel: 0, note: 42, pressure: 68 });
  });

  it("reads channel pressure, which has one data byte", () => {
    expect(parseMidi([0xd3, 90])).toEqual({ type: "channelPressure", channel: 3, pressure: 90 });
  });

  it("reads a program change, which has one data byte", () => {
    expect(parseMidi([0xc1, 5])).toEqual({ type: "programChange", channel: 1, program: 5 });
  });

  it("passes other messages through as `other`", () => {
    expect(parseMidi([0xf8])).toMatchObject({ type: "other", status: 0xf8 });
  });
});
