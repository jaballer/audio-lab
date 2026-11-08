import { describe, expect, it } from "vitest";
import { selectProfile } from "../../shared/midi-devices.js";
import { parseMidi } from "../../shared/midi-messages.js";
import { PROFILES, mpcSample } from "./devices.js";

const noteOn = (note, velocity = 100, channel = 0) => parseMidi([0x90 | channel, note, velocity]);
const noteOff = (note) => parseMidi([0x80, note, 0]);
const aftertouch = (note, pressure) => parseMidi([0xa0, note, pressure]);

describe("page profile selection", () => {
  it("picks the MPC Sample by port name, and nothing else", () => {
    expect(selectProfile(PROFILES, "MPC Sample MIDI 1")).toBe(mpcSample);
    expect(selectProfile(PROFILES, "MPC Sample:MPC Sample MIDI 1 28:0")).toBe(mpcSample);
    expect(selectProfile(PROFILES, "MPC One")).toBeNull();
    expect(selectProfile(PROFILES, "Launchpad Mini")).toBeNull();
  });
});

describe("mpcSample.translate", () => {
  it("reports a hit with its pad, bank, note and velocity", () => {
    expect(mpcSample.translate(noteOn(54, 101))).toEqual([
      { type: "padDown", index: 2, bank: 1, note: 54, velocity: 101 },
    ]);
  });

  it("reports a release with the pad it belongs to", () => {
    expect(mpcSample.translate(noteOff(36))).toEqual([{ type: "padUp", index: 0, bank: 0, note: 36 }]);
    // Note On with velocity 0 is how some devices send a release.
    expect(mpcSample.translate(parseMidi([0x90, 51, 0]))).toEqual([{ type: "padUp", index: 15, bank: 0, note: 51 }]);
  });

  it("reports the pressure on a held pad", () => {
    expect(mpcSample.translate(aftertouch(39, 104))).toEqual([
      { type: "padPressure", index: 3, bank: 0, note: 39, pressure: 104 },
    ]);
  });

  it("does not care which MIDI channel the pads use", () => {
    expect(mpcSample.translate(noteOn(36, 100, 9))).toHaveLength(1);
  });

  // Banks F-H wrap past note 127 round to the lowest notes (captured: bank F pad 16 is note 3).
  it("reads the low notes as the last banks, for hits, releases and pressure", () => {
    expect(mpcSample.translate(noteOn(3, 127))).toEqual([
      { type: "padDown", index: 15, bank: 5, note: 3, velocity: 127 },
    ]);
    expect(mpcSample.translate(noteOff(20))).toEqual([{ type: "padUp", index: 0, bank: 7, note: 20 }]);
    expect(mpcSample.translate(aftertouch(35, 10))).toEqual([
      { type: "padPressure", index: 15, bank: 7, note: 35, pressure: 10 },
    ]);
  });

  it("ignores every other kind of message", () => {
    expect(mpcSample.translate(parseMidi([0xb0, 7, 64]))).toEqual([]);
    expect(mpcSample.translate(parseMidi([0xf8, 0, 0]))).toEqual([]);
  });
});
