import { describe, expect, it } from "vitest";
import { BANK_COUNT, FIRST_PAD_NOTE, PADS_PER_BANK, isMpcSample, noteForPad, padFromNote } from "./mpc-sample.js";

describe("isMpcSample", () => {
  // ALSA names the port "MPC Sample MIDI 1"; Firefox on Linux adds the client name and
  // "client:port" numbers, and Windows can prefix "2- ".
  it("accepts the port however the browser spells it", () => {
    for (const name of [
      "MPC Sample",
      "mpc sample",
      "MPC Sample MIDI 1",
      "MPC Sample:MPC Sample MIDI 1 28:0",
      "MPC Sample MIDI 1 28:0",
      "MPC Sample 2",
      "2- MPC Sample",
      "MIDIIN2 (MPC Sample)",
    ]) {
      expect(isMpcSample(name), name).toBe(true);
    }
  });

  it("rejects other MPCs and unknown Sample variants", () => {
    for (const name of ["MPC One", "MPC Live II", "MPC Key 37", "MPC Studio", "MPC Sampler", "MPC Sample Pro", ""]) {
      expect(isMpcSample(name), name).toBe(false);
    }
  });
});

describe("padFromNote", () => {
  // Captured from the device: bank A is notes 36-51 and bank B starts at 52, pad 1 first.
  it("reads the pad as its position in the bank", () => {
    expect(padFromNote(36)).toEqual({ index: 0, bank: 0 });
    expect(padFromNote(51)).toEqual({ index: 15, bank: 0 });
    expect(padFromNote(52)).toEqual({ index: 0, bank: 1 });
    expect(padFromNote(67)).toEqual({ index: 15, bank: 1 });
  });

  // Captured from banks E-H: 8 banks of 16 would pass note 127, so the device wraps round
  // to 0. Bank F pad 1 is 116 and its pad 16 is 3; bank H runs from 20 to 35.
  it("reads banks E-F as the same 16-note step", () => {
    expect(padFromNote(68)).toEqual({ index: 0, bank: 2 });
    expect(padFromNote(100)).toEqual({ index: 0, bank: 4 });
    expect(padFromNote(115)).toEqual({ index: 15, bank: 4 });
    expect(padFromNote(116)).toEqual({ index: 0, bank: 5 });
  });

  it("wraps past note 127 back to 0, so the last banks use the lowest notes", () => {
    expect(padFromNote(127)).toEqual({ index: 11, bank: 5 });
    expect(padFromNote(0)).toEqual({ index: 12, bank: 5 });
    expect(padFromNote(3)).toEqual({ index: 15, bank: 5 }); // bank F pad 16
    expect(padFromNote(4)).toEqual({ index: 0, bank: 6 }); // bank G pad 1
    expect(padFromNote(19)).toEqual({ index: 15, bank: 6 });
    expect(padFromNote(20)).toEqual({ index: 0, bank: 7 }); // bank H pad 1
    expect(padFromNote(35)).toEqual({ index: 15, bank: 7 });
  });

  it("gives every note its own pad in its own bank", () => {
    const seen = new Set();
    for (let note = 0; note < 128; note++) {
      const { index, bank } = padFromNote(note);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(PADS_PER_BANK);
      expect(bank).toBeLessThan(BANK_COUNT);
      seen.add(`${bank}:${index}`);
    }
    expect(seen.size).toBe(128);
  });
});

describe("noteForPad", () => {
  it("is the note a pad sends, wrapped like the device", () => {
    expect(noteForPad(0, 0)).toBe(FIRST_PAD_NOTE);
    expect(noteForPad(15, 0)).toBe(51);
    expect(noteForPad(0, 1)).toBe(52);
    expect(noteForPad(15, 5)).toBe(3); // bank F pad 16, not the impossible 131
    expect(noteForPad(0, 7)).toBe(20);
    expect(noteForPad(15, 7)).toBe(35);
  });

  it("undoes padFromNote for every note", () => {
    for (let note = 0; note < 128; note++) {
      const { index, bank } = padFromNote(note);
      expect(noteForPad(index, bank)).toBe(note);
    }
  });
});
