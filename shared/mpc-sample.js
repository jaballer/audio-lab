// What is known about the Akai MPC Sample's MIDI, shared by the sampler's profile and the
// companion page. No DOM, nothing at import time.
//
// Captured from the device over USB (channel 1): its 16 pads send notes 36-51 in bank A and
// the next block of 16 in each following bank (bank B starts at 52), pad 1 first. It has 8
// banks, 128 pads in all, which would pass note 127, so the notes wrap round to 0: bank E
// is 100-115, bank F starts at 116 and its last four pads are notes 0-3, bank G runs 4-19
// and bank H 20-35. Every MIDI note is exactly one pad in one bank.

import { PORT_DECORATION } from "./midi-devices.js";

export const FIRST_PAD_NOTE = 36; // pad 1 of bank A
export const PADS_PER_BANK = 16; // the hardware's pads per bank, not any app's pad count
export const BANK_COUNT = 8;
const MIDI_NOTES = 128;

// A whitelist: after "MPC Sample" only a known port decoration may follow, so another model
// ("MPC Sample Pro", a future one) is not taken for it. ALSA says "MPC Sample MIDI 1";
// Firefox on Linux adds "client:port".
const MPC_SAMPLE_NAME = new RegExp(String.raw`\bmpc\s+sample(?:\s+\d+)?` + PORT_DECORATION, "i");

export const isMpcSample = (portName) => MPC_SAMPLE_NAME.test(portName);

// Which pad (0 is pad 1) and bank (0 is bank A) a MIDI note (0-127) belongs to.
export function padFromNote(note) {
  const offset = (note - FIRST_PAD_NOTE + MIDI_NOTES) % MIDI_NOTES;
  return { index: offset % PADS_PER_BANK, bank: Math.floor(offset / PADS_PER_BANK) };
}

// The note a pad sends: the inverse of padFromNote.
export function noteForPad(index, bank) {
  return (FIRST_PAD_NOTE + bank * PADS_PER_BANK + index) % MIDI_NOTES;
}
