// Device profiles for the sampler (see shared/midi-devices.js). A profile turns
// a parsed MIDI message into the events midi.js reacts to, and may also say how
// to light the controller:
//
//   { type: "pad",     index, velocity }   index 0 is pad 1; velocity 1-127
//                                          (a profile may add `bank`; the app does not use it yet)
//   { type: "step",    index }             index 0 is step 1
//   { type: "control", name }              one of CONTROLS
//
// A profile does not know how many pads or steps the app has, so `index` can be
// past the last one; the app ignores those.
//
// A profile with `lights(state)` also drives the controller's LEDs: it returns
// the raw `[status, data1, value]` messages that make the controller mirror the
// app, and `reset` is the message that turns every LED off. `match` is used for
// the controller's output port as well as its input.

import { PORT_DECORATION } from "../../shared/midi-devices.js";
import { isMpcSample, padFromNote } from "../../shared/mpc-sample.js";
import { PAD_COLUMNS, PAD_ROWS, STEPS, padColumn, padIndex, padRow } from "./layout.js";

// What the transport and edit buttons can ask for.
export const CONTROLS = ["start", "stop", "record", "clearPad", "clearAll", "tap", "tempoDown", "tempoUp"];

// Launchpad LED colour = velocity of a Note On: 16 * green + red + 12 (green/red 0-3).
const color = (green, red) => 16 * green + red + 12;
const OFF = color(0, 0);
const RED_LOW = color(0, 1);
const RED = color(0, 3);
const GREEN_LOW = color(1, 0);
const GREEN_MED = color(2, 0);
const GREEN = color(3, 0);
const AMBER_LOW = color(1, 1);
const AMBER = color(3, 3);

const NOTE_ON = 0x90;
const CC = 0xb0;

// Round buttons along the top edge (controllers 104-111, left to right).
const TOP_BUTTONS = [
  { cc: 104, control: "start", color: (s) => (s.playing ? GREEN : GREEN_LOW) },
  { cc: 105, control: "stop", color: () => AMBER_LOW },
  { cc: 106, control: "record", color: (s) => (s.recording ? RED : RED_LOW) },
  { cc: 107, control: "clearPad", color: () => AMBER_LOW },
  { cc: 108, control: "clearAll", color: () => AMBER_LOW },
  { cc: 109, control: "tap", color: () => GREEN_LOW },
  { cc: 110, control: "tempoDown", color: () => AMBER_LOW },
  { cc: 111, control: "tempoUp", color: () => AMBER_LOW },
];

// The original Launchpad's grid is 8x8 and a note is `row * 16 + column`, with
// row 0 at the top. The bottom-left block (the app's pad grid, pad 1 in the
// bottom-left corner) plays the pads and the top rows are the step keys.
const GRID_SIZE = 8;
const ROW_STRIDE = 16;
const FIRST_PAD_ROW = GRID_SIZE - PAD_ROWS;
const STEP_ROWS = Math.ceil(STEPS / GRID_SIZE);

const gridNote = (row, column) => row * ROW_STRIDE + column;
const padNote = (index) => gridNote(FIRST_PAD_ROW + padRow(index), padColumn(index));
const stepNote = (index) => gridNote(Math.floor(index / GRID_SIZE), index % GRID_SIZE);

// The profile is for the original-layout Launchpads: plain, S and Mini (optionally
// MK1/MK2). ALSA also appends an instance number to the name ("Launchpad Mini 9", and
// "Launchpad Mini 10" once the number passes one digit). Newer models (Pro, X, MK3, ...) use
// other mappings, so they fall back to the generic profile.
//
// This is a whitelist: after the model only a known port decoration may follow, so a model
// name this list does not know ("Launchpad MKII", "Launchpad RGB", a future model) falls
// back instead of being taken for the bare "Launchpad". Not anchored to the end of the name:
// Firefox on Linux reports ports as "client:port MIDI 1 28:0", and Windows adds a "2- "
// prefix.
const LAUNCHPAD_MODEL = String.raw`\blaunchpad(?:\s+(?:s|mini(?:\s+mk\s*[12])?)(?:\s+\d+)?|(?:\s+\d)?)`;
const LAUNCHPAD_NAME = new RegExp(LAUNCHPAD_MODEL + PORT_DECORATION, "i");

export const launchpad = {
  id: "launchpad",
  match: (name) => LAUNCHPAD_NAME.test(name),
  reset: [CC, 0, 0],

  translate(msg) {
    if (msg.type === "noteOn") {
      const row = Math.floor(msg.note / ROW_STRIDE);
      const col = msg.note % ROW_STRIDE;
      if (row >= FIRST_PAD_ROW && row < GRID_SIZE && col < PAD_COLUMNS)
        return [{ type: "pad", index: padIndex(row - FIRST_PAD_ROW, col), velocity: msg.velocity }];
      if (row < STEP_ROWS && col < GRID_SIZE) return [{ type: "step", index: row * GRID_SIZE + col }];
      return [];
    }
    // The button's release sends value 0; only the press counts.
    if (msg.type === "cc" && msg.value > 0) {
      const button = TOP_BUTTONS.find((b) => b.cc === msg.controller);
      return button ? [{ type: "control", name: button.control }] : [];
    }
    return [];
  },

  // state: { padCount, steps, selected, flashing (Set of pad indexes), stepsOn,
  // playing, playheadStep, recording }. Pads first, then steps, then buttons.
  lights(state) {
    const messages = [];

    for (let idx = 0; idx < state.padCount; idx++) {
      const isSelected = idx === state.selected;
      let c = isSelected ? GREEN_MED : RED_LOW;
      if (state.flashing.has(idx)) c = isSelected ? AMBER : RED;
      messages.push([NOTE_ON, padNote(idx), c]);
    }

    for (let i = 0; i < state.steps; i++) {
      const on = state.stepsOn[i];
      const now = state.playing && i === state.playheadStep;
      messages.push([NOTE_ON, stepNote(i), on && now ? AMBER : now ? GREEN : on ? RED : OFF]);
    }

    for (const button of TOP_BUTTONS) messages.push([CC, button.cc, button.color(state)]);

    return messages;
  },
};

// Any other controller: notes 36-51 (the General MIDI drum map) play pads
// 1-16, and the hit's velocity sets the volume.
const FIRST_PAD_NOTE = 36;

// Akai MPC Sample: every pad bank plays the same 16 pads, and the bank is reported beside
// the pad. What its notes are, and how its port is recognised, is in shared/mpc-sample.js.
export const mpcSample = {
  id: "mpc-sample",
  match: isMpcSample,
  translate(msg) {
    if (msg.type !== "noteOn") return [];
    const { index, bank } = padFromNote(msg.note);
    return [{ type: "pad", index, velocity: msg.velocity, bank }];
  },
};

export const generic = {
  id: "generic",
  match: () => true,
  translate(msg) {
    if (msg.type === "noteOn" && msg.note >= FIRST_PAD_NOTE) {
      return [{ type: "pad", index: msg.note - FIRST_PAD_NOTE, velocity: msg.velocity }];
    }
    return [];
  },
};

// Most specific first; `generic` matches anything, so it goes last.
export const PROFILES = [launchpad, mpcSample, generic];
