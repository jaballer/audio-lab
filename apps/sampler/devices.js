// Device profiles for the sampler (see shared/midi-devices.js). A profile turns
// a parsed MIDI message into the events midi.js reacts to, and may also say how
// to light the controller:
//
//   { type: "pad",     index, velocity }   index 0 is pad 1; velocity 1-127
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
// row 0 at the top. The bottom-left 4x4 block plays the pads (pad 1 in the
// bottom-left corner) and the top two rows are the 16 step keys.
const padNote = (index) => (7 - (index >> 2)) * 16 + (index & 3);
const stepNote = (index) => (index >> 3) * 16 + (index & 7);

export const launchpad = {
  id: "launchpad",
  match: (name) => /launchpad/i.test(name),
  reset: [CC, 0, 0],

  translate(msg) {
    if (msg.type === "noteOn") {
      const row = msg.note >> 4;
      const col = msg.note & 15;
      if (row >= 4 && row <= 7 && col <= 3)
        return [{ type: "pad", index: (7 - row) * 4 + col, velocity: msg.velocity }];
      if (row <= 1 && col <= 7) return [{ type: "step", index: row * 8 + col }];
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
export const PROFILES = [launchpad, generic];
