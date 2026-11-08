// MIDI keyboard test page, laid out like a compact 25-key controller: plays a
// simple synth from a MIDI keyboard (or the computer keyboard) and shows notes,
// velocity, joystick (pitch bend / mod), sustain pedal, pads and knobs.
//
// This file only wires the pieces together: the synth, the page's state
// (controller.js), the on-screen views (piano, LCD, pads, knobs, joystick,
// synth controls) and the inputs (MIDI, computer keyboard).

import "../../shared/base.css";
import "./keys.css";
import { createAudioEngine } from "../../shared/audio.js";
import { createMidiAccess, wireMidiButton } from "../../shared/midi-access.js";
import { selectProfile } from "../../shared/midi-devices.js";
import { parseMidi } from "../../shared/midi-messages.js";
import { loadJson, saveJson } from "../../shared/storage.js";
import { createComputerKeys } from "./computer-keys.js";
import { createKeysController } from "./controller.js";
import { PROFILES, mpkMini } from "./devices.js";
import { createKnobDials } from "./knob-dials.js";
import { createLcd } from "./lcd.js";
import { createPadGrid } from "./pad-grid.js";
import { createPadLearner } from "./pad-learner.js";
import { GROUPS, PARAMS } from "./params.js";
import { createPiano } from "./piano.js";
import { createStick } from "./stick.js";
import { createSynthPanel } from "./synth-panel.js";
import { DEFAULT_PARAMS, createSynth } from "./synth.js";

const $ = (id) => document.getElementById(id);

const KEYBOARD_SOURCE = "keyboard";
const KEYBOARD_VELOCITY = 100; // a computer key has no velocity of its own

// ---------- Audio ----------
const audioStatus = $("audio-status");

const audio = createAudioEngine({
  volume: DEFAULT_PARAMS.volume,
  onStateChange: (state) => {
    audioStatus.textContent = state === "running" ? "Audio: on" : "Audio: click the page to enable";
  },
});
audio.unlockOnInteraction(); // a MIDI message alone can't start audio

const synth = createSynth(audio);

// ---------- State ----------
// Envelope and waveform changes apply to notes played after the change; cutoff,
// resonance and volume also move notes that are already sounding. Every
// parameter change goes through the controller, whether it came from a slider,
// a hardware knob or the defaults.
//
// The callbacks use the views below, which are built after this: that is fine
// because the controller reports nothing until something happens.
const keys = createKeysController({
  synth,
  params: PARAMS,
  onChange: render,
  onNoteDown: (note) => piano.press(note),
  onNoteUp: (note) => piano.release(note),
  onSlider: (param, position, text) => panel.showSlider(param, position, text),
  onChoice: (param, choice) => panel.showChoice(param, choice),
});

// ---------- Views ----------
const lcd = createLcd({
  note: $("lcd-note"),
  vel: $("lcd-vel"),
  wheels: $("lcd-wheels"),
  cc: $("lcd-cc"),
  pad: $("lcd-pad"),
});

const stick = createStick($("stick-ball"));

function render() {
  const state = keys.getState();
  lcd.render(state);
  stick.render(state);
}

const piano = createPiano($("piano"), {
  onNoteOn: (note, velocity, source) => keys.noteOn(note, velocity, source),
  onNoteOff: (note, source) => keys.noteOff(note, source),
});

const PAD_STORE_KEY = "keys.learned";
const padLearner = createPadLearner({
  load: () => loadJson(PAD_STORE_KEY),
  save: (data) => saveJson(PAD_STORE_KEY, data),
});
const padGrid = createPadGrid($("pads"), { notes: padLearner.notes });
const knobDials = createKnobDials($("knobs"), { ccs: mpkMini.knobCcs, labels: PARAMS.map((p) => p.name) });

const panel = createSynthPanel($("synth"), {
  params: PARAMS,
  groups: GROUPS,
  onSlider: (param, position) => keys.setSlider(param, position),
  onChoice: (param, choice) => keys.setChoice(param, choice),
});

// ---------- MIDI ----------
const midiBtn = $("midi-btn");
const midiStatus = $("midi-status");

// What to do for each event a device profile (devices.js) can produce.
const handlers = {
  noteOn: (e, input) => keys.noteOn(e.note, e.velocity, midiSource(input)),
  noteOff: (e, input) => keys.noteOff(e.note, midiSource(input)),
  bend: (e) => keys.setBend(e.value),
  sustain: (e) => keys.setSustain(e.on),
  mod: (e) => keys.setMod(e.value),
  knob: (e) => {
    knobDials.turn(e.index, e.value);
    // The on-screen controls jump to the knob's position as soon as it is turned.
    keys.applyKnob(e.index, e.value);
  },
  pad: (e) => {
    const slot = padLearner.slotFor(e.note);
    if (slot >= 0) padGrid.hit(slot, e.note, e.velocity);
    keys.showPad({ note: e.note, velocity: e.velocity, channel: e.channel });
  },
  cc: (e) => keys.showCc(e.controller, e.value),
};

// Each connected device is its own note holder: with two keyboards holding the
// same note, the first one's Note Off must not stop it.
const midiSource = (input) => `midi-${input.id ?? input.name}`;
let midiSources = new Set(); // the holders of the inputs connected at the last scan

// Called after every scan of the MIDI ports. A device that is gone can no longer
// send its Note Offs, so let go of what it held, or those notes would sound until
// the page was reloaded, and no other device could end them.
function handleMidiChange(_access, inputs) {
  const connected = new Set(inputs.map(midiSource));
  for (const source of midiSources) if (!connected.has(source)) keys.releaseSource(source);
  midiSources = connected;
}

function handleMidi(input, data) {
  const profile = selectProfile(PROFILES, input.name);
  for (const event of profile.translate(parseMidi(data))) handlers[event.type](event, input);
}

wireMidiButton(
  midiBtn,
  createMidiAccess({
    onMessage: handleMidi,
    onChange: handleMidiChange,
    onStatus: (text) => (midiStatus.textContent = text),
  }),
);

// ---------- Computer keyboard ----------
const computerKeys = createComputerKeys({
  target: window,
  getBase: () => piano.base,
  onNoteOn: (note) => keys.noteOn(note, KEYBOARD_VELOCITY, KEYBOARD_SOURCE),
  onNoteOff: (note) => keys.noteOff(note, KEYBOARD_SOURCE),
});

// Keys and fingers let go while the page is in the background never send their
// keyup / pointerup (Alt-Tab, a notification, switching tabs), so their notes
// would sound until the same key was pressed again. When the page loses focus or
// is hidden, let go of everything held from the computer keyboard or the piano.
function releaseHeld() {
  keys.releaseSource(KEYBOARD_SOURCE);
  computerKeys.reset();
  piano.releasePointers();
}
window.addEventListener("blur", releaseHeld);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") releaseHeld();
});

// ---------- Init ----------
keys.syncParams();
render();
