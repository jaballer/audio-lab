import { describe, expect, it } from "vitest";
import { selectProfile } from "../../shared/midi-devices.js";
import { parseMidi } from "../../shared/midi-messages.js";
import { CONTROLS, PROFILES, generic, launchpad } from "./devices.js";

const noteOn = (note, velocity = 100, channel = 0) => parseMidi([0x90 | channel, note, velocity]);
const cc = (controller, value = 127) => parseMidi([0xb0, controller, value]);

describe("profile selection", () => {
  it("picks the Launchpad by name, ignoring case", () => {
    expect(selectProfile(PROFILES, "Launchpad")).toBe(launchpad);
    expect(selectProfile(PROFILES, "Launchpad Mini")).toBe(launchpad);
    expect(selectProfile(PROFILES, "my LAUNCHPAD s")).toBe(launchpad);
    expect(selectProfile(PROFILES, "Launchpad Mini MK1")).toBe(launchpad);
    expect(selectProfile(PROFILES, "Launchpad Mini MK2 MIDI 1")).toBe(launchpad);
    expect(selectProfile(PROFILES, "Launchpad S MIDI 1")).toBe(launchpad);
  });

  // The connected controller: ALSA names it "Launchpad Mini 9", and Firefox on Linux
  // reports the "client:port nn:n" form, so the match cannot be anchored to the end.
  it("picks the Launchpad Mini 9 however the browser spells its port", () => {
    for (const name of [
      "Launchpad Mini 9",
      "Launchpad Mini 9 MIDI 1",
      "Launchpad Mini 9:Launchpad Mini 9 MIDI 1 28:0",
      "Launchpad Mini 10",
      "Launchpad Mini 12:Launchpad Mini 12 MIDI 1 32:0",
      "2- Launchpad Mini",
      "MIDIIN2 (Launchpad Mini)",
      "Launchpad Mini:Launchpad Mini MIDI 1 24:0",
      "Launchpad S:Launchpad S MIDI 1 20:0",
    ]) {
      expect(selectProfile(PROFILES, name)).toBe(launchpad);
    }
  });

  it("falls back for newer and unrecognized Launchpads, including their MIDI ports", () => {
    for (const name of [
      "Launchpad Mk2",
      "Launchpad Pro",
      "Launchpad Pro MK3",
      "Launchpad X",
      "Launchpad Mini MK3",
      "Launchpad Mini MK3 MIDI 1",
      "Launchpad S MK3",
      "Launchpad 99",
      "Launchpad MKII",
      "Launchpad RGB",
      "Launchpad Mini RGB",
      "Launchpad Mini 9 RGB",
      "Launchpad Open",
    ]) {
      expect(selectProfile(PROFILES, name)).toBe(generic);
      expect(launchpad.match(name)).toBe(false);
    }
  });

  it("gives any other controller the generic profile", () => {
    expect(selectProfile(PROFILES, "IAC Driver Bus")).toBe(generic);
    expect(selectProfile(PROFILES, "")).toBe(generic);
  });
});

describe("launchpad.translate", () => {
  // Notes are row * 16 + column, row 0 at the top; pad 1 is the bottom-left of the 4x4 block.
  const PAD_NOTES = [
    [112, 113, 114, 115], // pads 1-4, bottom row
    [96, 97, 98, 99], // pads 5-8
    [80, 81, 82, 83], // pads 9-12
    [64, 65, 66, 67], // pads 13-16, top row of the block
  ].flat();

  it("maps the 4x4 block in the bottom-left to pads 1-16", () => {
    PAD_NOTES.forEach((note, index) => {
      expect(launchpad.translate(noteOn(note, 90))).toEqual([{ type: "pad", index, velocity: 90 }]);
    });
  });

  it("maps the top two rows to steps 1-16", () => {
    const stepNotes = [0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23];
    stepNotes.forEach((note, index) => {
      expect(launchpad.translate(noteOn(note))).toEqual([{ type: "step", index }]);
    });
  });

  it("ignores every other pad on the grid", () => {
    const mapped = new Set([...PAD_NOTES, 0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23]);
    for (let note = 0; note < 128; note++) {
      if (!mapped.has(note)) expect(launchpad.translate(noteOn(note))).toEqual([]);
    }
  });

  it("reports the velocity as sent, and ignores releases", () => {
    expect(launchpad.translate(noteOn(112, 1))[0].velocity).toBe(1);
    expect(launchpad.translate(noteOn(112, 127))[0].velocity).toBe(127);
    expect(launchpad.translate(parseMidi([0x90, 112, 0]))).toEqual([]); // Note On, velocity 0
    expect(launchpad.translate(parseMidi([0x80, 112, 64]))).toEqual([]);
  });

  it("does not care which MIDI channel the Launchpad uses", () => {
    expect(launchpad.translate(noteOn(112, 100, 5))).toHaveLength(1);
  });

  it("maps the round buttons on the top edge to the controls, left to right", () => {
    const names = [104, 105, 106, 107, 108, 109, 110, 111].map((c) => launchpad.translate(cc(c))[0].name);
    expect(names).toEqual(["start", "stop", "record", "clearPad", "clearAll", "tap", "tempoDown", "tempoUp"]);
    expect(new Set(names)).toEqual(new Set(CONTROLS));
  });

  it("acts on the press of a button, not its release or other controllers", () => {
    expect(launchpad.translate(cc(106, 0))).toEqual([]);
    expect(launchpad.translate(cc(103))).toEqual([]);
    expect(launchpad.translate(cc(112))).toEqual([]);
    expect(launchpad.translate(cc(106, 1))).toEqual([{ type: "control", name: "record" }]);
  });

  it("ignores messages that are not notes or controllers", () => {
    expect(launchpad.translate(parseMidi([0xe0, 0, 64]))).toEqual([]);
  });
});

describe("generic.translate", () => {
  it("plays pads 1-16 from notes 36-51, keeping the velocity", () => {
    expect(generic.translate(noteOn(36, 64))).toEqual([{ type: "pad", index: 0, velocity: 64 }]);
    expect(generic.translate(noteOn(51, 127))).toEqual([{ type: "pad", index: 15, velocity: 127 }]);
  });

  it("ignores notes below the first pad", () => {
    expect(generic.translate(noteOn(35))).toEqual([]);
    expect(generic.translate(noteOn(0))).toEqual([]);
  });

  it("does not know how many pads the app has, so it keeps counting past 16", () => {
    expect(generic.translate(noteOn(52))).toEqual([{ type: "pad", index: 16, velocity: 100 }]);
  });

  it("ignores releases, controllers and the Launchpad's step keys and buttons", () => {
    expect(generic.translate(parseMidi([0x80, 40, 64]))).toEqual([]);
    expect(generic.translate(parseMidi([0x90, 40, 0]))).toEqual([]);
    expect(generic.translate(cc(106))).toEqual([]);
    expect(generic.translate(noteOn(5))).toEqual([]);
  });

  it("has no lights", () => {
    expect(generic.lights).toBeUndefined();
  });
});

describe("launchpad.lights", () => {
  // LED colour = 16 * green + red + 12.
  const OFF = 12;
  const RED_LOW = 13;
  const RED = 15;
  const GREEN_LOW = 28;
  const GREEN_MED = 44;
  const GREEN = 60;
  const AMBER_LOW = 29;
  const AMBER = 63;

  const idle = {
    padCount: 16,
    steps: 16,
    selected: 0,
    flashing: new Set(),
    stepsOn: new Array(16).fill(false),
    playing: false,
    playheadStep: -1,
    recording: false,
  };
  const byKey = (messages) => new Map(messages.map(([status, data1, value]) => [`${status}:${data1}`, value]));
  const colour = (state, status, data1) => byKey(launchpad.lights(state)).get(`${status}:${data1}`);

  it("lights 16 pads, 16 steps and 8 buttons, in that order, once each", () => {
    const messages = launchpad.lights(idle);
    expect(messages).toHaveLength(40);
    expect(messages.slice(0, 16).every(([status]) => status === 0x90)).toBe(true);
    expect(messages.slice(16, 32).every(([status]) => status === 0x90)).toBe(true);
    expect(messages.slice(32).map(([status, data1]) => [status, data1])).toEqual(
      [104, 105, 106, 107, 108, 109, 110, 111].map((c) => [0xb0, c]),
    );
    expect(byKey(messages).size).toBe(40);
  });

  it("lights each pad at its own note, pad 1 first", () => {
    expect(launchpad.lights(idle)[0].slice(0, 2)).toEqual([0x90, 112]);
    expect(launchpad.lights(idle)[15].slice(0, 2)).toEqual([0x90, 67]);
  });

  it("shows the selected pad green and the rest dim red", () => {
    const state = { ...idle, selected: 5 }; // pad 6: note 97
    expect(colour(state, 0x90, 97)).toBe(GREEN_MED);
    expect(colour(state, 0x90, 112)).toBe(RED_LOW);
  });

  it("flashes a hit pad: bright red, or amber when it is the selected one", () => {
    const state = { ...idle, selected: 0, flashing: new Set([0, 1]) };
    expect(colour(state, 0x90, 112)).toBe(AMBER); // pad 1, selected
    expect(colour(state, 0x90, 113)).toBe(RED); // pad 2
  });

  it("shows steps that are on red, the playhead green, and both amber", () => {
    const stepsOn = idle.stepsOn.map((_, i) => i === 1 || i === 2);
    const state = { ...idle, stepsOn, playing: true, playheadStep: 2 };
    expect(colour(state, 0x90, 0)).toBe(OFF); // step 1
    expect(colour(state, 0x90, 1)).toBe(RED); // step 2, on
    expect(colour(state, 0x90, 2)).toBe(AMBER); // step 3, on and playing
    expect(colour(state, 0x90, 3)).toBe(OFF);
    expect(colour({ ...state, stepsOn: idle.stepsOn }, 0x90, 2)).toBe(GREEN); // step 3, playing only
    expect(colour(state, 0x90, 16)).toBe(OFF); // step 9, second row
  });

  it("hides a stale playhead while stopped", () => {
    expect(colour({ ...idle, playheadStep: 2 }, 0x90, 2)).toBe(OFF);
  });

  it("lights PLAY and REC to show their state, and the other buttons steadily", () => {
    expect(colour(idle, 0xb0, 104)).toBe(GREEN_LOW);
    expect(colour({ ...idle, playing: true }, 0xb0, 104)).toBe(GREEN);
    expect(colour(idle, 0xb0, 106)).toBe(RED_LOW);
    expect(colour({ ...idle, recording: true }, 0xb0, 106)).toBe(RED);
    expect([105, 107, 108, 110, 111].map((c) => colour(idle, 0xb0, c))).toEqual(new Array(5).fill(AMBER_LOW));
    expect(colour(idle, 0xb0, 109)).toBe(GREEN_LOW);
  });

  it("resets with a controller-0 message", () => {
    expect(launchpad.reset).toEqual([0xb0, 0, 0]);
  });
});
