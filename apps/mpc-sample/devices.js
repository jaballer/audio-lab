// The companion page's device profile (see shared/midi-devices.js). Unlike the sampler's,
// it keeps what a test page needs: releases, the pressure on a held pad, the raw note, and
// the transport, so the page can show what the device really sent. Events:
//
//   { type: "padDown",     index, bank, note, velocity }   index 0 is pad 1, bank 0 is bank A
//   { type: "padUp",       index, bank, note }
//   { type: "padPressure", index, bank, note, pressure }   poly aftertouch on a held pad
//   { type: "transportStart" } / { type: "transportContinue" } / { type: "transportStop" }
//   { type: "clock" }                                      one of 24 ticks per beat
//   { type: "songPosition", position }                     where it plays from, in sixteenth notes
//
// Captured from the device: Play sends Start, position 0, MMC SysEx and then a clock stream.
// Shift + Play (Continue) sends Continue and the position it resumes from. Stop sends Stop
// and the clock ends. These are real-time bytes, which the browser delivers without the SysEx
// permission, so the MMC copies are left unread.
//
// Reference notes on the device's MIDI settings and what its guide leaves out: docs/mpc-sample.md
//
// `messages.padOn` and `padOff` are what the sequencer sends to play a pad (docs/mpc-sample.md, "notes sent
// to it"): channel 1 is enough, whatever channel is sent the device plays it and echoes it back on its own.
//
// There is only this profile: a port that is not an MPC Sample gets no profile, so the
// router ignores whatever else is plugged in.

import { isMpcSample, noteForPad, padFromNote } from "../../shared/mpc-sample.js";

const KINDS = { noteOn: "padDown", noteOff: "padUp", polyAftertouch: "padPressure" };

const SONG_POSITION = 0xf2; // 14 bits, low seven first, in sixteenth notes (six clock ticks each)

const REALTIME = { 0xf8: "clock", 0xfa: "transportStart", 0xfb: "transportContinue", 0xfc: "transportStop" };

export const mpcSample = {
  id: "mpc-sample",
  match: isMpcSample,
  messages: {
    padOn: (index, bank, velocity) => [0x90, noteForPad(index, bank), velocity],
    padOff: (index, bank) => [0x80, noteForPad(index, bank), 0],
  },

  translate(msg) {
    if (msg.type === "other") {
      if (msg.status === SONG_POSITION) return [{ type: "songPosition", position: msg.data1 | (msg.data2 << 7) }];
      const type = REALTIME[msg.status];
      return type ? [{ type }] : [];
    }
    const type = KINDS[msg.type];
    if (!type) return [];
    const { index, bank } = padFromNote(msg.note);
    const event = { type, index, bank, note: msg.note };
    if (type === "padDown") event.velocity = msg.velocity;
    if (type === "padPressure") event.pressure = msg.pressure;
    return [event];
  },
};

export const PROFILES = [mpcSample];
