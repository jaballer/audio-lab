import { describe, expect, it } from "vitest";
import { bar, formatLcd } from "./lcd.js";

const idle = { last: null, bend: 0, mod: 0, sustain: false, lastCc: null, lastPad: null };

describe("bar", () => {
  it("fills a fixed-width meter in proportion", () => {
    expect(bar(0)).toBe("................");
    expect(bar(127)).toBe("################");
    expect(bar(64)).toBe("########........");
    expect(bar(64)).toHaveLength(16);
  });
});

describe("formatLcd", () => {
  it("shows placeholders before anything has happened", () => {
    expect(formatLcd(idle)).toEqual({
      note: "NOTE --",
      vel: "VEL  --",
      wheels: "BEND +0.00  MOD 0  SUS OFF",
      cc: "CC   --",
      pad: "PAD  --",
    });
  });

  it("shows the last note with its name, number and velocity", () => {
    const text = formatLcd({ ...idle, last: { note: 60, velocity: 100 } });
    expect(text.note).toBe("NOTE C4  (60)");
    expect(text.vel).toBe("VEL  #############... 100");
  });

  it("pads short note names so the number lines up", () => {
    expect(formatLcd({ ...idle, last: { note: 61, velocity: 1 } }).note).toBe("NOTE C#4 (61)");
  });

  it("shows bend in semitones, with a sign, and the mod and pedal state", () => {
    expect(formatLcd({ ...idle, bend: 0.5, mod: 90, sustain: true }).wheels).toBe("BEND +1.00  MOD 90  SUS ON");
    expect(formatLcd({ ...idle, bend: -1 }).wheels).toBe("BEND -2.00  MOD 0  SUS OFF");
  });

  it("zero-pads the controller number", () => {
    expect(formatLcd({ ...idle, lastCc: { cc: 7, value: 127 } }).cc).toBe("CC007 ################ 127");
  });

  it("shows the last pad hit", () => {
    const lastPad = { note: 36, velocity: 90, channel: 10 };
    expect(formatLcd({ ...idle, lastPad }).pad).toBe("PAD  NOTE 36  CH 10  VEL 90");
  });
});
