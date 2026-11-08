// The companion page's device profile (see shared/midi-devices.js). Unlike the sampler's,
// it keeps what a test page needs: releases, the pressure on a held pad, and the raw
// note, so the page can show what the device really sent. Events:
//
//   { type: "padDown",     index, bank, note, velocity }   index 0 is pad 1, bank 0 is bank A
//   { type: "padUp",       index, bank, note }
//   { type: "padPressure", index, bank, note, pressure }   poly aftertouch on a held pad
//
// There is only this profile: a port that is not an MPC Sample gets no profile, so the
// router ignores whatever else is plugged in.

import { isMpcSample, padFromNote } from "../../shared/mpc-sample.js";

const KINDS = { noteOn: "padDown", noteOff: "padUp", polyAftertouch: "padPressure" };

export const mpcSample = {
  id: "mpc-sample",
  match: isMpcSample,
  translate(msg) {
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
