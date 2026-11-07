// Device profiles for the keys page (see shared/midi-devices.js). Each profile
// turns a parsed MIDI message into the events main.js reacts to:
//
//   { type: "noteOn",  note, velocity }
//   { type: "noteOff", note }
//   { type: "bend",    value }                     -1 .. 1
//   { type: "sustain", on }
//   { type: "mod",     value }                     0-127, joystick up
//   { type: "knob",    index, value }              index 0 is K1; value 0-127
//   { type: "pad",     note, velocity, channel }   channel is 1-16
//   { type: "cc",      controller, value }         any controller, for the CC readout
//
// A message can produce several events, in the order main.js should handle them.

const SUSTAIN_CC = 64;
const MOD_CC = 1; // joystick up (the mod wheel on most keyboards)
const DRUM_CHANNEL = 9; // MIDI channel 10, as a 0-15 number

// Any keyboard: notes, pitch bend, sustain pedal and mod, and every other
// controller shown on the CC readout.
export const keyboard = {
  id: "keyboard",
  match: () => true,
  translate(msg) {
    switch (msg.type) {
      case "noteOn":
        return [{ type: "noteOn", note: msg.note, velocity: msg.velocity }];
      case "noteOff":
        return [{ type: "noteOff", note: msg.note }];
      case "pitchBend":
        return [{ type: "bend", value: msg.value }];
      case "cc": {
        if (msg.controller === SUSTAIN_CC) return [{ type: "sustain", on: msg.value >= 64 }];
        const cc = { type: "cc", controller: msg.controller, value: msg.value };
        return msg.controller === MOD_CC ? [{ type: "mod", value: msg.value }, cc] : [cc];
      }
      default:
        return [];
    }
  },
};

// Knob CC numbers, captured from the hardware (K1 first). The controller's
// Program 1 sends CC 1-8, but K1 = CC 1 is also what the joystick's up axis
// sends, and MIDI can't tell them apart. Program 2 (hold Prog Select and press
// Pad 6) sends these instead, which keeps CC 1 free for the joystick.
const MPK_KNOB_CCS = [20, 21, 22, 23, 16, 17, 18, 19];

// AKAI MPK mini ("MPK mini 3", "MPK mini Play", "MPKmini2"): a keyboard plus
// eight knobs and eight pads. The pads send notes on channel 10; they are
// shown but don't play the synth.
export const mpkMini = {
  id: "mpk-mini",
  match: (name) => /mpk\s*mini/i.test(name),
  knobCcs: MPK_KNOB_CCS,
  translate(msg) {
    if (msg.channel === DRUM_CHANNEL && (msg.type === "noteOn" || msg.type === "noteOff")) {
      if (msg.type === "noteOff") return [];
      return [{ type: "pad", note: msg.note, velocity: msg.velocity, channel: msg.channel + 1 }];
    }
    const events = keyboard.translate(msg);
    if (msg.type === "cc") {
      const index = MPK_KNOB_CCS.indexOf(msg.controller);
      // The knob first, then the CC readout the keyboard profile produced.
      if (index >= 0) return [{ type: "knob", index, value: msg.value }, ...events];
    }
    return events;
  },
};

// Most specific first; `keyboard` matches anything, so it goes last.
export const PROFILES = [mpkMini, keyboard];
