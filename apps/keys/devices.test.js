import { describe, expect, it } from "vitest";
import { parseMidi } from "../../shared/midi-messages.js";
import { selectProfile } from "../../shared/midi-devices.js";
import { PROFILES, keyboard, mpkMini } from "./devices.js";

// Translate raw MIDI bytes, as the page does.
const bytes = (profile, ...data) => profile.translate(parseMidi(data));

describe("keyboard profile", () => {
  it("plays notes", () => {
    expect(bytes(keyboard, 0x90, 60, 100)).toEqual([{ type: "noteOn", note: 60, velocity: 100 }]);
    expect(bytes(keyboard, 0x80, 60, 0)).toEqual([{ type: "noteOff", note: 60 }]);
    expect(bytes(keyboard, 0x90, 60, 0)).toEqual([{ type: "noteOff", note: 60 }]);
  });

  it("reports pitch bend", () => {
    expect(bytes(keyboard, 0xe0, 0, 0)).toEqual([{ type: "bend", value: -1 }]);
  });

  it("treats CC 64 as the sustain pedal, down from 64 up, with no CC readout", () => {
    expect(bytes(keyboard, 0xb0, 64, 127)).toEqual([{ type: "sustain", on: true }]);
    expect(bytes(keyboard, 0xb0, 64, 64)).toEqual([{ type: "sustain", on: true }]);
    expect(bytes(keyboard, 0xb0, 64, 63)).toEqual([{ type: "sustain", on: false }]);
  });

  it("treats CC 1 as mod, then shows it on the CC readout", () => {
    expect(bytes(keyboard, 0xb0, 1, 90)).toEqual([
      { type: "mod", value: 90 },
      { type: "cc", controller: 1, value: 90 },
    ]);
  });

  it("shows any other controller on the CC readout only, including the MPK's knob numbers", () => {
    expect(bytes(keyboard, 0xb0, 99, 5)).toEqual([{ type: "cc", controller: 99, value: 5 }]);
    expect(bytes(keyboard, 0xb0, 20, 64)).toEqual([{ type: "cc", controller: 20, value: 64 }]);
  });

  it("plays channel-10 notes like any other, since a plain keyboard has no pads", () => {
    expect(bytes(keyboard, 0x99, 36, 90)).toEqual([{ type: "noteOn", note: 36, velocity: 90 }]);
  });

  it("ignores messages it has no use for", () => {
    expect(bytes(keyboard, 0xc0, 5)).toEqual([]);
    expect(bytes(keyboard, 0xf8)).toEqual([]);
  });
});

describe("mpkMini profile", () => {
  it("shows channel-10 note-ons as pad hits (channel 10, 1-based) without playing the synth", () => {
    expect(bytes(mpkMini, 0x99, 36, 90)).toEqual([{ type: "pad", note: 36, velocity: 90, channel: 10 }]);
  });

  it("ignores channel-10 note-offs, including a note-on with velocity 0", () => {
    expect(bytes(mpkMini, 0x89, 36, 0)).toEqual([]);
    expect(bytes(mpkMini, 0x99, 36, 0)).toEqual([]);
  });

  it("plays notes on other channels", () => {
    expect(bytes(mpkMini, 0x90, 60, 100)).toEqual([{ type: "noteOn", note: 60, velocity: 100 }]);
    expect(bytes(mpkMini, 0x80, 60, 0)).toEqual([{ type: "noteOff", note: 60 }]);
  });

  it("maps CCs 20-23 and 16-19 to knobs K1-K8, then shows the CC", () => {
    const ccs = [20, 21, 22, 23, 16, 17, 18, 19];
    expect(mpkMini.knobCcs).toEqual(ccs);
    ccs.forEach((cc, index) => {
      expect(bytes(mpkMini, 0xb0, cc, 64)).toEqual([
        { type: "knob", index, value: 64 },
        { type: "cc", controller: cc, value: 64 },
      ]);
    });
  });

  it("keeps CC 1 for the joystick, not a knob", () => {
    expect(bytes(mpkMini, 0xb0, 1, 90).map((e) => e.type)).toEqual(["mod", "cc"]);
  });

  it("still handles sustain and pitch bend, on any channel", () => {
    expect(bytes(mpkMini, 0xb0, 64, 127)).toEqual([{ type: "sustain", on: true }]);
    expect(bytes(mpkMini, 0xe9, 0, 64)).toEqual([{ type: "bend", value: 0 }]);
    expect(bytes(mpkMini, 0xb9, 20, 10).map((e) => e.type)).toEqual(["knob", "cc"]);
  });
});

describe("PROFILES", () => {
  const profileFor = (name) => selectProfile(PROFILES, name).id;

  it("picks the MPK mini by its port names", () => {
    expect(profileFor("MPK mini 3")).toBe("mpk-mini");
    expect(profileFor("MPK mini Play MIDI 1")).toBe("mpk-mini");
    expect(profileFor("MPKmini2")).toBe("mpk-mini");
    expect(profileFor("mpk MINI")).toBe("mpk-mini");
  });

  it("gives every other device the plain keyboard profile", () => {
    expect(profileFor("Launchpad")).toBe("keyboard");
    expect(profileFor("USB MIDI Keyboard")).toBe("keyboard");
    expect(profileFor("")).toBe("keyboard");
    expect(profileFor(undefined)).toBe("keyboard");
  });
});
