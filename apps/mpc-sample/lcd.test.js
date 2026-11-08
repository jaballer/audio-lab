import { describe, expect, it } from "vitest";
import { formatLcd } from "./lcd.js";

const last = { index: 2, bank: 1, note: 54, velocity: 101, pressure: 0, hits: 3 };

describe("formatLcd", () => {
  it("asks for MIDI before the device is found", () => {
    expect(formatLcd({ connected: false, last: null })).toEqual([
      "MPC SAMPLE: NOT FOUND",
      "CONNECT MIDI AND PLUG IT IN",
      "",
    ]);
  });

  it("invites a pad hit once connected", () => {
    expect(formatLcd({ connected: true, last: null })).toEqual(["MPC SAMPLE: READY", "HIT A PAD", ""]);
  });

  it("shows the last hit: pad, bank, note, velocity, pressure and count", () => {
    expect(formatLcd({ connected: true, last })).toEqual([
      "MPC SAMPLE: READY",
      "PAD 03  BANK B  NOTE 54",
      "VEL 101  PRESS 000  HITS 3",
    ]);
  });

  it("keeps the last hit on screen after the device goes away", () => {
    expect(formatLcd({ connected: false, last })[0]).toBe("MPC SAMPLE: NOT FOUND");
    expect(formatLcd({ connected: false, last })[1]).toBe("PAD 03  BANK B  NOTE 54");
  });

  it("pads small numbers so the columns stay put", () => {
    const text = formatLcd({ connected: true, last: { ...last, index: 0, velocity: 6, pressure: 44 } });
    expect(text[1]).toBe("PAD 01  BANK B  NOTE 54");
    expect(text[2]).toBe("VEL 006  PRESS 044  HITS 3");
  });
});
