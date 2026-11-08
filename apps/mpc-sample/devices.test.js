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

describe("mpcSample.messages, for playing pads", () => {
  it("plays a pad with a note on its note, and releases it with a note off", () => {
    expect(mpcSample.messages.padOn(0, 0, 100)).toEqual([0x90, 36, 100]);
    expect(mpcSample.messages.padOff(0, 0)).toEqual([0x80, 36, 0]);
    expect(mpcSample.messages.padOn(15, 1, 64)).toEqual([0x90, 67, 64]);
  });

  it("round-trips through translate: what is sent comes back as the same pad", () => {
    for (const [index, bank] of [
      [0, 0],
      [7, 3],
      [15, 7],
    ]) {
      const [event] = mpcSample.translate(parseMidi(mpcSample.messages.padOn(index, bank, 90)));
      expect(event).toMatchObject({ type: "padDown", index, bank, velocity: 90 });
    }
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
    expect(mpcSample.translate(parseMidi([0xfe]))).toEqual([]); // active sensing
  });
});

// Captured: Play sends Start (FA) and then a clock stream, Stop sends Stop (FC) and the clock
// ends. Clock only runs while playing. These are single bytes, so they need no SysEx permission.
describe("mpcSample.translate: transport", () => {
  it("reports Start, Continue and Stop", () => {
    expect(mpcSample.translate(parseMidi([0xfa]))).toEqual([{ type: "transportStart" }]);
    expect(mpcSample.translate(parseMidi([0xfb]))).toEqual([{ type: "transportContinue" }]);
    expect(mpcSample.translate(parseMidi([0xfc]))).toEqual([{ type: "transportStop" }]);
  });

  it("reports each clock tick", () => {
    expect(mpcSample.translate(parseMidi([0xf8]))).toEqual([{ type: "clock" }]);
  });

  // Captured: Play sends position 0 and Shift + Play (Continue) sends the place it resumes
  // from (10 sixteenths, about 2.5 beats in). It is a 14-bit value, low seven bits first.
  it("reports the song position, in sixteenth notes", () => {
    expect(mpcSample.translate(parseMidi([0xf2, 0, 0]))).toEqual([{ type: "songPosition", position: 0 }]);
    expect(mpcSample.translate(parseMidi([0xf2, 10, 0]))).toEqual([{ type: "songPosition", position: 10 }]);
    expect(mpcSample.translate(parseMidi([0xf2, 0x7f, 0x01]))).toEqual([{ type: "songPosition", position: 255 }]);
  });
});

describe("mpcSample.messages", () => {
  it("has the real-time Start and Stop bytes for the Play and Stop lamps", () => {
    expect(mpcSample.messages.play).toEqual([0xfa]);
    expect(mpcSample.messages.stop).toEqual([0xfc]);
  });
});
