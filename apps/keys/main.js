// MIDI keyboard test page, laid out like a compact 25-key controller: plays a
// simple synth from a MIDI keyboard (or the computer keyboard) and shows notes,
// velocity, joystick (pitch bend / mod), sustain pedal and knobs.
//
// This file only wires the pieces together: the synth, the page's state
// (controller.js), the on-screen views (piano, LCD, knobs, joystick) and the inputs (MIDI, computer keyboard).

import "../../shared/base.css";
import "./keys.css";
import "../../shared/piano.css";
import { createAppHeader } from "../../shared/app-header.js";
import { createSiteHeader } from "../../shared/site-header.js";
import { createAudioEngine } from "../../shared/audio.js";
import { createAudioNotice } from "../../shared/audio-notice.js";
import { togglePower } from "../../shared/power.js";
import { createMidiAccess, wireMidiButton } from "../../shared/midi-access.js";
import { createMidiRouter } from "../../shared/midi-devices.js";
import { createComputerKeys } from "../../shared/computer-keys.js";
import { createKeysController } from "./controller.js";
import { PROFILES, mpkMini } from "./devices.js";
import { createKnobDials } from "./knob-dials.js";
import { createLcd } from "./lcd.js";
import { PARAMS, choiceLabel, knobForChoice, positionKnob } from "./params.js";
import { createPiano } from "../../shared/piano.js";
import { createStick } from "./stick.js";
import { DEFAULT_PARAMS, createSynth } from "./synth.js";

const $ = (id) => document.getElementById(id);

const KEYBOARD_SOURCE = "keyboard";
const KEYBOARD_VELOCITY = 100; // a computer key has no velocity of its own

const site = createSiteHeader($("site-header"), { current: "keys" });
const header = createAppHeader($("header"), {
  brand: { name: "KEYS" },
  sub: "MIDI keyboard test",
  onPower: () => togglePower(audio),
});

// ---------- Audio ----------
const audioNotice = createAudioNotice($("audio-notice"));
const audio = createAudioEngine({
  volume: DEFAULT_PARAMS.volume,
  onStateChange: (state) => {
    audioNotice.update(state);
    header.setPowered(state === "running");
  },
});
audio.unlockOnInteraction(); // a MIDI message alone can't start audio

const synth = createSynth(audio);

// ---------- State ----------
// Envelope and waveform changes apply to notes played after the change; cutoff,
// resonance and volume also move notes that are already sounding. Every
// parameter change goes through the controller, whether it came from a dial,
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
  onSlider: (param, position, text) => {
    knobDials.turn(PARAMS.indexOf(param), positionKnob(position), text);
  },
  onChoice: (param, choice) => {
    const index = PARAMS.indexOf(param);
    // A dial already inside this choice's part of the travel stays where it is, so
    // it keeps following the hand instead of snapping to the middle. The text is set
    // every time: the dial moves itself while dragged, without knowing the choice's name.
    knobDials.turn(index, knobForChoice(knobDials.value(index), choice, param.choices), choiceLabel(choice));
  },
});

// ---------- Views ----------
const lcd = createLcd({
  note: $("lcd-note"),
  vel: $("lcd-vel"),
  wheels: $("lcd-wheels"),
  knob: $("lcd-knob"),
  cc: $("lcd-cc"),
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

// A dial dragged with the mouse takes the same road as a hardware knob.
const knobDials = createKnobDials($("knobs"), {
  ccs: mpkMini.knobCcs,
  labels: PARAMS.map((p) => p.name),
  onChange: (index, value) => keys.applyKnob(index, value),
});

// ---------- MIDI ----------
// MIDI cannot unlock audio (only a click or key press does), so a note that arrives
// while sound is still off makes no sound: point at the notice.
const nudgeIfSilent = () => {
  if (!audio.running) audioNotice.nudge();
};

// What to do for each event a device profile (devices.js) can produce.
const handlers = {
  noteOn: (e, input) => {
    nudgeIfSilent();
    keys.noteOn(e.note, e.velocity, midiSource(input));
  },
  noteOff: (e, input) => keys.noteOff(e.note, midiSource(input)),
  bend: (e) => keys.setBend(e.value),
  sustain: (e) => keys.setSustain(e.on),
  mod: (e) => keys.setMod(e.value),
  knob: (e) => {
    // The dial shows the knob's own position, even where a choice knob stays on one choice.
    knobDials.turn(e.index, e.value);
    // The synth and the LCD follow the knob as soon as it is turned.
    keys.applyKnob(e.index, e.value);
  },
  // The page has no pads. The profile still claims the controller's channel-10 notes as
  // pad events, so a hit is dropped here instead of playing the synth as a key.
  pad: () => {},
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

wireMidiButton(
  site.midiButton,
  createMidiAccess({
    onMessage: createMidiRouter(PROFILES, handlers),
    onChange: handleMidiChange,
    onStatus: site.setMidiStatus,
    onLog: site.log,
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
