// The companion page's device profile (see shared/midi-devices.js). Unlike the sampler's,
// it keeps what a test page needs: releases, the pressure on a held pad, the raw note, and
// the transport, so the page can show what the device really sent. Events:
//
//   { type: "padDown",     index, bank, note, velocity }   index 0 is pad 1, bank 0 is bank A
//   { type: "padUp",       index, bank, note }
//   { type: "padPressure", index, bank, note, pressure }   poly aftertouch on a held pad
//   { type: "transportStart" } / { type: "transportContinue" } / { type: "transportStop" }
//   { type: "clock" }                                      one of 24 ticks per beat
//
// Captured from the device: Play sends Start (with a song position and MMC SysEx beside it)
// and then a clock stream, Stop sends Stop and the clock ends. Start, Stop and clock are
// single real-time bytes, which the browser delivers without the SysEx permission, so the
// MMC copies are left unread.
//
// `messages` are what the page's own buttons send to the device's output port.
//
// There is only this profile: a port that is not an MPC Sample gets no profile, so the
// router ignores whatever else is plugged in.

import { isMpcSample, padFromNote } from "../../shared/mpc-sample.js";

const KINDS = { noteOn: "padDown", noteOff: "padUp", polyAftertouch: "padPressure" };

const REALTIME = { 0xf8: "clock", 0xfa: "transportStart", 0xfb: "transportContinue", 0xfc: "transportStop" };

export const mpcSample = {
  id: "mpc-sample",
  match: isMpcSample,
  messages: { play: [0xfa], stop: [0xfc] },

  translate(msg) {
    if (msg.type === "other") {
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
