// MIDI keyboard test page, laid out like a compact 25-key controller: plays a
// simple synth from a MIDI keyboard (or the computer keyboard) and shows notes,
// velocity, joystick (pitch bend / mod), sustain pedal, pads and knobs.

import "../../shared/base.css";
import "./keys.css";
import { createAudioEngine } from "../../shared/audio.js";
import { createMidiAccess, wireMidiButton } from "../../shared/midi-access.js";
import { parseMidi } from "../../shared/midi-messages.js";
import { PARAMS, isChoice, knobChoice, knobPosition } from "./params.js";
import { BEND_RANGE, DEFAULT_PARAMS, createSynth } from "./synth.js";

const $ = (id) => document.getElementById(id);

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
const isBlack = (n) => [1, 3, 6, 8, 10].includes(n % 12);

const SPAN = 24; // the piano shows 25 keys: two octaves plus the top C
const COMPUTER_KEYS = "awsedftgyhuj" + "k"; // C .. C one octave up

// ---------- State ----------
let base = 48; // lowest note shown (a C)
let mod = 0;
let last = null; // { note, velocity }
let lastCc = null;
let lastPad = null; // { note, velocity, channel }
const held = new Set(); // notes physically down

// ---------- Elements ----------
const pianoEl = $("piano");
const lcdNote = $("lcd-note");
const lcdVel = $("lcd-vel");
const lcdWheels = $("lcd-wheels");
const lcdCc = $("lcd-cc");
const lcdPad = $("lcd-pad");
const keyEls = new Map();

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

// ---------- Piano ----------
function shiftTo(note) {
  if (note >= base && note <= base + SPAN) return; // already visible
  const next = Math.min(Math.floor(note / 12) * 12, 96);
  if (next === base) return;
  base = next;
  renderPiano();
}

function renderPiano() {
  pianoEl.textContent = "";
  keyEls.clear();
  const whiteCount = Array.from({ length: SPAN + 1 }, (_, i) => base + i).filter((n) => !isBlack(n)).length;
  const w = 100 / whiteCount;
  let whiteIndex = 0;

  for (let i = 0; i <= SPAN; i++) {
    const note = base + i;
    const el = document.createElement("div");
    el.dataset.note = note;
    if (isBlack(note)) {
      el.className = "key-black";
      el.style.width = `${w * 0.62}%`;
      el.style.left = `${whiteIndex * w - w * 0.31}%`;
    } else {
      el.className = "key-white";
      if (note % 12 === 0) el.innerHTML = `<span class="label">${noteName(note)}</span>`;
      whiteIndex++;
    }
    el.classList.toggle("down", held.has(note));
    pianoEl.appendChild(el);
    keyEls.set(note, el);
  }
}

// Mouse / touch on the on-screen keys.
let pointerNote = null;
pianoEl.addEventListener("pointerdown", (e) => {
  const el = e.target.closest("[data-note]");
  if (!el) return;
  e.preventDefault();
  pointerNote = Number(el.dataset.note);
  noteOn(pointerNote, 100);
});
window.addEventListener("pointerup", () => {
  if (pointerNote !== null) noteOff(pointerNote);
  pointerNote = null;
});

// ---------- Note handling ----------
function noteOn(note, velocity) {
  held.add(note);
  last = { note, velocity };
  shiftTo(note);
  keyEls.get(note)?.classList.add("down");
  synth.noteOn(note, velocity / 127);
  renderLcd();
}

function noteOff(note) {
  if (!held.delete(note)) return;
  keyEls.get(note)?.classList.remove("down");
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

// ---------- Display ----------
const bar = (value, max = 127, width = 16) => {
  const n = Math.round((value / max) * width);
  return "#".repeat(n) + ".".repeat(width - n);
};

function renderLcd() {
  const { bend, sustain } = synth;
  lcdNote.textContent = last ? `NOTE ${noteName(last.note).padEnd(3)} (${last.note})` : "NOTE --";
  lcdVel.textContent = last ? `VEL  ${bar(last.velocity)} ${last.velocity}` : "VEL  --";
  const b = (bend * BEND_RANGE).toFixed(2);
  lcdWheels.textContent = `BEND ${bend >= 0 ? "+" : ""}${b}  MOD ${mod}  SUS ${sustain ? "ON" : "OFF"}`;
  lcdCc.textContent = lastCc
    ? `CC${String(lastCc.cc).padStart(3, "0")} ${bar(lastCc.value)} ${lastCc.value}`
    : "CC   --";
  lcdPad.textContent = lastPad
    ? `PAD  NOTE ${lastPad.note}  CH ${lastPad.channel}  VEL ${lastPad.velocity}`
    : "PAD  --";
}

// ---------- Joystick, pads and knobs ----------
// The joystick ball follows pitch bend (left/right) and mod (up).
const stickBall = $("stick-ball");
const STICK_TRAVEL = 30; // px

function renderStick() {
  stickBall.style.transform = `translate(${synth.bend * STICK_TRAVEL}px, ${-(mod / 127) * STICK_TRAVEL}px)`;
}

// Knob CC numbers, captured from the hardware (K1 first). The controller's
// Program 1 sends CC 1-8, but K1 = CC 1 is also what the joystick's up axis
// sends, and MIDI can't tell them apart. Program 2 (hold Prog Select and press
// Pad 6) sends these instead, which keeps CC 1 free for the joystick.
const KNOB_CCS = [20, 21, 22, 23, 16, 17, 18, 19];

// Pad notes are not known yet, so the page learns them: the first 8 pad notes
// you hit fill pads 1-8 in order, and are remembered in this browser.
const STORE_KEY = "keys.learned";
const learned = { pads: [] }; // pad note numbers, indexed by pad slot

try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY));
  for (const key of Object.keys(learned)) {
    if (Array.isArray(saved?.[key])) learned[key] = saved[key].filter(Number.isInteger).slice(0, 8);
  }
} catch {
  /* storage unavailable or corrupt: start fresh */
}

function learnSlot(list, id) {
  let slot = list.indexOf(id);
  if (slot < 0 && list.length < 8) {
    list.push(id);
    slot = list.length - 1;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(learned));
    } catch {
      /* ignore */
    }
  }
  return slot; // -1 when all 8 slots are taken by other ids
}

// Pad bank B usually sends notes 8 away from bank A, so treat those as the same pad.
function padSlot(note) {
  for (const n of [note, note - 8, note + 8]) {
    const slot = learned.pads.indexOf(n);
    if (slot >= 0) return slot;
  }
  return learnSlot(learned.pads, note);
}

// Pads: 4 x 2 with pads 1-4 on the bottom row, like the hardware.
const padEls = [];
const padTimers = [];
for (const idx of [4, 5, 6, 7, 0, 1, 2, 3]) {
  const el = document.createElement("div");
  el.className = "pad";
  el.innerHTML = `<span class="lbl">${idx + 1}</span><span class="nt">${learned.pads[idx] ?? ""}</span>`;
  $("pads").appendChild(el);
  padEls[idx] = el;
}

function hitPad(slot, note, velocity) {
  const el = padEls[slot];
  el.style.setProperty("--v", velocity / 127);
  el.querySelector(".nt").textContent = note;
  el.classList.add("hit");
  clearTimeout(padTimers[slot]);
  padTimers[slot] = setTimeout(() => el.classList.remove("hit"), 140);
}

// Knobs: 4 x 2. The pointer sweeps 270 degrees as the value goes 0-127.
const dialEls = [];
for (let i = 0; i < KNOB_CCS.length; i++) {
  const cell = document.createElement("div");
  cell.className = "knob-cell";
  cell.innerHTML =
    `<div class="dial"></div>` +
    `<span class="knob-name">K${i + 1}</span>` +
    `<span class="knob-cc">CC ${KNOB_CCS[i]}</span>` +
    `<span class="knob-fn">${PARAMS[i]?.name ?? ""}</span>`;
  $("knobs").appendChild(cell);
  dialEls.push(cell.querySelector(".dial"));
}

function turnKnob(index, value) {
  dialEls[index].style.setProperty("--a", `${-135 + (value / 127) * 270}deg`);
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
      turnKnob(knob, value);
      // The on-screen controls jump to the knob's position as soon as it is turned.
      applyKnob(knob, value);
    }
    lastCc = { cc: controller, value };
    return renderLcd();
  }
  // The MPK mini's pads use channel 10: show them, but don't play the synth.
  if (msg.channel === 9) {
    if (msg.type === "noteOn") {
      const slot = padSlot(msg.note);
      if (slot >= 0) hitPad(slot, msg.note, msg.velocity);
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
  const note = base + 12 + i;
  keyDown.set(e.code, note);
  noteOn(note, 100);
});

window.addEventListener("keyup", (e) => {
  const note = keyDown.get(e.code);
  if (note === undefined) return;
  keyDown.delete(e.code);
  noteOff(note);
});

renderPiano();
renderLcd();
renderStick();
