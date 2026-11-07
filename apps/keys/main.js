// MIDI keyboard test page, laid out like a compact 25-key controller: plays a
// simple synth from a MIDI keyboard (or the computer keyboard) and shows notes,
// velocity, joystick (pitch bend / mod), sustain pedal, pads and knobs.
//
// This file only wires the pieces together: the synth, the on-screen views
// (piano, LCD, pads, knobs) and the inputs (MIDI, computer keyboard).

import "../../shared/base.css";
import "./keys.css";
import { createAudioEngine } from "../../shared/audio.js";
import { createMidiAccess, wireMidiButton } from "../../shared/midi-access.js";
import { selectProfile } from "../../shared/midi-devices.js";
import { parseMidi } from "../../shared/midi-messages.js";
import { loadJson, saveJson } from "../../shared/storage.js";
import { PROFILES, mpkMini } from "./devices.js";
import { createHolds } from "./holds.js";
import { createKnobDials } from "./knob-dials.js";
import { createLcd } from "./lcd.js";
import { createPadGrid } from "./pad-grid.js";
import { createPadLearner } from "./pad-learner.js";
import { PARAMS, isChoice, knobChoice, knobPosition } from "./params.js";
import { createPiano } from "./piano.js";
import { DEFAULT_PARAMS, createSynth } from "./synth.js";

const $ = (id) => document.getElementById(id);

const COMPUTER_KEYS = "awsedftgyhuj" + "k"; // C .. C one octave up
const KEYBOARD_SOURCE = "keyboard";

// ---------- State ----------
let mod = 0;
let last = null; // { note, velocity }
let lastCc = null;
let lastPad = null; // { note, velocity, channel }

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

// ---------- Synth controls ----------
// Every slider, the waveform select and the hardware knobs are wired from the
// PARAMS table in params.js. These two setters are the one place a parameter
// changes, whether it came from the page, a knob or the defaults. Envelope and
// waveform changes apply to notes played after the change; cutoff, resonance
// and volume also move notes that are already sounding.
const controlEl = (p) => $(`${p.group}-${p.name}`);

// `position` is the slider position, 0-100.
function setSlider(p, position) {
  const value = p.toValue(position);
  synth.set(p.name, value);
  controlEl(p).value = position;
  $(`out-${p.name}`).textContent = p.format(value);
}

function setChoice(p, choice) {
  synth.set(p.name, choice);
  controlEl(p).value = choice;
}

for (const p of PARAMS) {
  const el = controlEl(p);
  if (isChoice(p)) {
    setChoice(p, synth.params[p.name]);
    el.addEventListener("change", () => setChoice(p, el.value));
  } else {
    setSlider(p, p.toSlider(synth.params[p.name]));
    el.addEventListener("input", () => setSlider(p, Number(el.value)));
  }
}

function applyKnob(index, midiValue) {
  const p = PARAMS[index];
  if (!p) return; // more knobs than parameters
  if (isChoice(p)) setChoice(p, knobChoice(midiValue, p.choices));
  else setSlider(p, knobPosition(midiValue));
}

// ---------- Views ----------
const lcd = createLcd({
  note: $("lcd-note"),
  vel: $("lcd-vel"),
  wheels: $("lcd-wheels"),
  cc: $("lcd-cc"),
  pad: $("lcd-pad"),
});

function renderLcd() {
  lcd.render({ last, bend: synth.bend, mod, sustain: synth.sustain, lastCc, lastPad });
}

const piano = createPiano($("piano"), { onNoteOn: noteOn, onNoteOff: noteOff });

const PAD_STORE_KEY = "keys.learned";
const padLearner = createPadLearner({
  load: () => loadJson(PAD_STORE_KEY),
  save: (data) => saveJson(PAD_STORE_KEY, data),
});
const padGrid = createPadGrid($("pads"), { notes: padLearner.notes });
const knobDials = createKnobDials($("knobs"), { ccs: mpkMini.knobCcs, labels: PARAMS.map((p) => p.name) });

// The joystick ball follows pitch bend (left/right) and mod (up).
const stickBall = $("stick-ball");
const STICK_TRAVEL = 30; // px

function renderStick() {
  stickBall.style.transform = `translate(${synth.bend * STICK_TRAVEL}px, ${-(mod / 127) * STICK_TRAVEL}px)`;
}

// ---------- Note handling ----------
// A note can be held from the MIDI keyboard, the computer keyboard and each finger
// on the piano at once, and sounds until the last of them lets go. `source` says
// which one this is.
const holds = createHolds();

function noteOn(note, velocity, source) {
  holds.press(note, source);
  last = { note, velocity };
  piano.press(note);
  synth.noteOn(note, velocity / 127);
  renderLcd();
}

function noteOff(note, source) {
  if (!holds.release(note, source)) return; // not held by this source, or others still hold it
  piano.release(note);
  synth.noteOff(note);
}

// A source that goes away without letting go (a window that lost focus, a MIDI
// device that was unplugged) ends all its notes at once.
function releaseSource(source) {
  for (const note of holds.releaseAll(source)) {
    piano.release(note);
    synth.noteOff(note);
  }
}

function setSustain(on) {
  synth.setSustain(on);
  renderLcd();
}

function setBend(value) {
  synth.setBend(value);
  renderStick();
  renderLcd();
}

// ---------- MIDI ----------
const midiBtn = $("midi-btn");
const midiStatus = $("midi-status");

// What to do for each event a device profile (devices.js) can produce.
const handlers = {
  noteOn: (e, source) => noteOn(e.note, e.velocity, source),
  noteOff: (e, source) => noteOff(e.note, source),
  bend: (e) => setBend(e.value),
  sustain: (e) => setSustain(e.on),
  mod: (e) => {
    mod = e.value;
    renderStick();
  },
  knob: (e) => {
    knobDials.turn(e.index, e.value);
    // The on-screen controls jump to the knob's position as soon as it is turned.
    applyKnob(e.index, e.value);
  },
  pad: (e) => {
    const slot = padLearner.slotFor(e.note);
    if (slot >= 0) padGrid.hit(slot, e.note, e.velocity);
    lastPad = { note: e.note, velocity: e.velocity, channel: e.channel };
    renderLcd();
  },
  cc: (e) => {
    lastCc = { cc: e.controller, value: e.value };
    renderLcd();
  },
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
  for (const source of midiSources) if (!connected.has(source)) releaseSource(source);
  midiSources = connected;
}

function handleMidi(input, data) {
  const profile = selectProfile(PROFILES, input.name);
  const source = midiSource(input);
  for (const event of profile.translate(parseMidi(data))) handlers[event.type](event, source);
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
const keyDown = new Map(); // event.code -> note

window.addEventListener("keydown", (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const i = COMPUTER_KEYS.indexOf(e.key.toLowerCase());
  if (i < 0 || keyDown.has(e.code)) return;
  const note = piano.base + 12 + i;
  keyDown.set(e.code, note);
  noteOn(note, 100, KEYBOARD_SOURCE);
});

window.addEventListener("keyup", (e) => {
  const note = keyDown.get(e.code);
  if (note === undefined) return;
  keyDown.delete(e.code);
  noteOff(note, KEYBOARD_SOURCE);
});

// A key let go while the page is in the background never sends its keyup (Alt-Tab,
// a notification, switching tabs), so its note would sound until the key was
// pressed again. Let them all go when the page loses focus.
function releaseKeyboard() {
  releaseSource(KEYBOARD_SOURCE);
  keyDown.clear();
}
window.addEventListener("blur", releaseKeyboard);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") releaseKeyboard();
});

renderLcd();
renderStick();
