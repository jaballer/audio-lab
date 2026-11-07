import { describe, expect, it } from "vitest";
import { describeMessage, formatLine, toHex } from "./describe.js";

describe("toHex", () => {
  it("prints bytes as two uppercase hex digits", () => {
    expect(toHex([0x90, 0x24, 0x7f])).toBe("90 24 7F");
    expect(toHex(new Uint8Array([0x80, 0x05, 0x00]))).toBe("80 05 00");
  });

  it("cuts a long message short and says how long it was", () => {
    const sysex = [0xf0, ...Array(30).fill(1), 0xf7];
    expect(toHex(sysex)).toMatch(/^F0( 01){15} \.\.\. \(32 bytes\)$/);
  });
});

describe("describeMessage", () => {
  it("describes a note on with its name, number and velocity, and counts the channel from 1", () => {
    expect(describeMessage([0x90, 36, 127])).toEqual({
      kind: "note",
      name: "Note On",
      channel: 1,
      detail: "C2 (36)  vel 127",
      hex: "90 24 7F",
      hit: { note: 36, velocity: 127 },
    });
  });

  it("calls a note on with velocity 0 a note off, as parseMidi does; the hex still shows what was sent", () => {
    const entry = describeMessage([0x90, 36, 0]);
    expect(entry.name).toBe("Note Off");
    expect(entry.hex).toBe("90 24 00");
    expect(entry.hit).toBeUndefined();
  });

  it("puts the drum channel (10) where a controller prints it", () => {
    expect(describeMessage([0x99, 38, 90]).channel).toBe(10);
  });

  it("describes a control change", () => {
    expect(describeMessage([0xb0, 74, 12])).toMatchObject({ kind: "cc", channel: 1, detail: "CC 74  value 12" });
  });

  it("describes pitch bend as -1 to 1", () => {
    expect(describeMessage([0xe0, 0, 64])).toMatchObject({ kind: "bend", detail: "0.000" });
  });

  it("describes key pressure and channel pressure as pressure", () => {
    expect(describeMessage([0xa0, 42, 68])).toMatchObject({
      kind: "pressure",
      name: "Key Pressure",
      detail: "F#2 (42)  pressure 68",
    });
    expect(describeMessage([0xd0, 90])).toMatchObject({
      kind: "pressure",
      name: "Channel Pressure",
      detail: "pressure 90",
    });
  });

  it("describes a program change", () => {
    expect(describeMessage([0xc0, 5])).toMatchObject({ kind: "program", detail: "program 5" });
  });

  it("describes system messages with no channel", () => {
    expect(describeMessage([0xf8])).toEqual({ kind: "system", name: "Clock", channel: null, detail: "", hex: "F8" });
    expect(describeMessage([0xfe]).name).toBe("Active Sensing");
  });

  it("describes sysex by its length", () => {
    expect(describeMessage([0xf0, 1, 2, 3, 0xf7])).toMatchObject({ name: "SysEx", detail: "5 bytes" });
  });

  it("names a system status it does not know instead of hiding it", () => {
    expect(describeMessage([0xf4])).toMatchObject({ kind: "system", name: "Unknown 0xF4" });
  });
});

describe("formatLine", () => {
  it("lines up time, channel, name, detail and bytes for pasting", () => {
    const entry = { time: 1234, ...describeMessage([0x90, 36, 127]) };
    expect(formatLine(entry)).toBe("    1.234s  ch 1  Note On          C2 (36)  vel 127           90 24 7F");
  });

  it("leaves the channel blank for system messages and trims the empty detail", () => {
    const line = formatLine({ time: 0, ...describeMessage([0xf8]) });
    expect(line).toBe("    0.000s  ch    Clock                                       F8");
  });
});
