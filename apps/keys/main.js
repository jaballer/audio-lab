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
import { parseMidi } from "../../shared/midi-messages.js";
import { loadJson, saveJson } from "../../shared/storage.js";
import { createKnobDials } from "./knob-dials.js";
import { createLcd } from "./lcd.js";
import { createPadGrid } from "./pad-grid.js";
import { createPadLearner } from "./pad-learner.js";
import { PARAMS, isChoice, knobChoice, knobPosition } from "./params.js";
import { createPiano } from "./piano.js";
import { DEFAULT_PARAMS, createSynth } from "./synth.js";

const $ = (id) => document.getElementById(id);

const COMPUTER_KEYS = "awsedftgyhuj" + "k"; // C .. C one octave up

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

// Knob CC numbers, captured from the hardware (K1 first). The controller's
// Program 1 sends CC 1-8, but K1 = CC 1 is also what the joystick's up axis
// sends, and MIDI can't tell them apart. Program 2 (hold Prog Select and press
// Pad 6) sends these instead, which keeps CC 1 free for the joystick.
const KNOB_CCS = [20, 21, 22, 23, 16, 17, 18, 19];

const PAD_STORE_KEY = "keys.learned";
const padLearner = createPadLearner({
  load: () => loadJson(PAD_STORE_KEY),
  save: (data) => saveJson(PAD_STORE_KEY, data),
});
const padGrid = createPadGrid($("pads"), { notes: padLearner.notes });
const knobDials = createKnobDials($("knobs"), { ccs: KNOB_CCS, labels: PARAMS.map((p) => p.name) });

// The joystick ball follows pitch bend (left/right) and mod (up).
const stickBall = $("stick-ball");
const STICK_TRAVEL = 30; // px

function renderStick() {
  stickBall.style.transform = `translate(${synth.bend * STICK_TRAVEL}px, ${-(mod / 127) * STICK_TRAVEL}px)`;
}

// ---------- Note handling ----------
function noteOn(note, velocity) {
  last = { note, velocity };
  piano.press(note);
  synth.noteOn(note, velocity / 127);
  renderLcd();
}

function noteOff(note) {
  if (!piano.release(note)) return; // it was not down
  synth.noteOff(note);
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

function handleMidi(data) {
  const msg = parseMidi(data);
  if (msg.type === "pitchBend") return setBend(msg.value);
  if (msg.type === "cc") {
    const { controller, value } = msg;
    if (controller === 64) return setSustain(value >= 64);
    if (controller === 1) {
      mod = value; // joystick up
      renderStick();
    }
    const knob = KNOB_CCS.indexOf(controller);
    if (knob >= 0) {
      knobDials.turn(knob, value);
      // The on-screen controls jump to the knob's position as soon as it is turned.
      applyKnob(knob, value);
    }
    lastCc = { cc: controller, value };
    return renderLcd();
  }
  // The MPK mini's pads use channel 10: show them, but don't play the synth.
  if (msg.channel === 9) {
    if (msg.type === "noteOn") {
      const slot = padLearner.slotFor(msg.note);
      if (slot >= 0) padGrid.hit(slot, msg.note, msg.velocity);
      lastPad = { note: msg.note, velocity: msg.velocity, channel: msg.channel + 1 };
      renderLcd();
    }
    return;
  }
  if (msg.type === "noteOn") noteOn(msg.note, msg.velocity);
  else if (msg.type === "noteOff") noteOff(msg.note);
}

wireMidiButton(
  midiBtn,
  createMidiAccess({
    onMessage: (_input, data) => handleMidi(data),
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
  noteOn(note, 100);
});

window.addEventListener("keyup", (e) => {
  const note = keyDown.get(e.code);
  if (note === undefined) return;
  keyDown.delete(e.code);
  noteOff(note);
});

renderLcd();
renderStick();
