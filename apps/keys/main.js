// MIDI keyboard test page, laid out like a compact 25-key controller: plays a
// simple synth from a MIDI keyboard (or the computer keyboard) and shows notes,
// velocity, joystick (pitch bend / mod), sustain pedal, pads and knobs.

import "../../shared/base.css";
import "./keys.css";
import { createMidiAccess, wireMidiButton } from "../../shared/midi-access.js";
import { startEnvelope, releaseEnvelope } from "./envelope.js";

const $ = (id) => document.getElementById(id);

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
const isBlack = (n) => [1, 3, 6, 8, 10].includes(n % 12);

const SPAN = 24; // the piano shows 25 keys: two octaves plus the top C
const BEND_RANGE = 2; // semitones
const COMPUTER_KEYS = "awsedftgyhuj" + "k"; // C .. C one octave up

// ---------- State ----------
let base = 48; // lowest note shown (a C)
let ctx = null;
let master = null;
let bend = 0; // -1 .. 1
let mod = 0;
let sustain = false;
let last = null; // { note, velocity }
let lastCc = null;
let lastPad = null; // { note, velocity, channel }
const held = new Set(); // notes physically down
const sustained = new Set(); // released but kept alive by the pedal
const voices = new Map(); // note -> { osc, filter, gain }
const env = { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.25 }; // seconds, sustain 0-1
// Tone: waveform, low-pass cutoff (Hz), resonance (dB) and master volume (0-1 gain).
const tone = { wave: "triangle", cutoff: 16000, resonance: 0, volume: 0.5 };
const WAVES = ["sine", "triangle", "square", "sawtooth"];

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

function renderAudioStatus() {
  audioStatus.textContent = ctx?.state === "running" ? "Audio: on" : "Audio: click the page to enable";
}

function ensureAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    ctx.onstatechange = renderAudioStatus;
    master = ctx.createGain();
    master.gain.value = tone.volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  renderAudioStatus();
}

// Browsers only start audio after a click or key press on the page, and a MIDI
// message doesn't count. So unlock it on the first real interaction, ahead of
// the first note: otherwise a MIDI keyboard can play silently.
for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, ensureAudio, { capture: true });
renderAudioStatus();

const freq = (note) => 440 * 2 ** ((note - 69) / 12);

function startVoice(note, velocity) {
  ensureAudio();
  stopVoice(note, 0.02);
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = tone.wave; // like the envelope, the waveform is read as the note starts
  osc.frequency.value = freq(note);
  osc.detune.value = bend * BEND_RANGE * 100;

  // Each voice has its own low-pass filter between the oscillator and its
  // envelope. Cutoff and resonance are changed live on all sounding voices.
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = tone.cutoff;
  filter.Q.value = tone.resonance; // for a low-pass filter Q is in dB, not a plain ratio

  const gain = ctx.createGain();
  const peak = 0.15 + 0.5 * velocity;
  startEnvelope(gain.gain, t, env, peak); // each voice reads the sliders as it starts
  osc.connect(filter).connect(gain).connect(master);
  osc.start(t);
  voices.set(note, { osc, filter, gain });
}

function stopVoice(note, release = env.release) {
  const v = voices.get(note);
  if (!v) return;
  voices.delete(note);
  const t = ctx.currentTime;
  releaseEnvelope(v.gain.gain, t, release);
  v.osc.stop(t + release + 0.02);
}

// ---------- Envelope sliders ----------
// Time sliders run 0-100 but map exponentially to seconds, so there is fine
// control over short times (5 ms) as well as long ones (3 s).
const TIME_MIN = 0.005;
const TIME_MAX = 3;
const sliderToTime = (v) => TIME_MIN * (TIME_MAX / TIME_MIN) ** (v / 100);
const timeToSlider = (t) => (100 * Math.log(t / TIME_MIN)) / Math.log(TIME_MAX / TIME_MIN);
const formatTime = (t) => (t < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(2)} s`);

const ENV_CONTROLS = {
  attack: { toValue: sliderToTime, toSlider: timeToSlider, format: formatTime },
  decay: { toValue: sliderToTime, toSlider: timeToSlider, format: formatTime },
  sustain: { toValue: (v) => v / 100, toSlider: (s) => s * 100, format: (s) => `${Math.round(s * 100)}%` },
  release: { toValue: sliderToTime, toSlider: timeToSlider, format: formatTime },
};

const ENV_NAMES = Object.keys(ENV_CONTROLS); // attack, decay, sustain, release = knobs K1-K4

// The one place an envelope value changes, whether it came from a slider, a
// knob or the defaults. `position` is the slider position, 0-100.
// Changes apply to notes played after the change; notes already sounding
// keep the envelope they started with.
function setEnvSlider(name, position) {
  const control = ENV_CONTROLS[name];
  env[name] = control.toValue(position);
  $(`env-${name}`).value = position;
  $(`out-${name}`).textContent = control.format(env[name]);
}

for (const name of ENV_NAMES) {
  setEnvSlider(name, ENV_CONTROLS[name].toSlider(env[name]));
  $(`env-${name}`).addEventListener("input", (e) => setEnvSlider(name, Number(e.target.value)));
}

// ---------- Tone controls ----------
// Same idea as the envelope: each control converts a 0-100 slider position to a
// real value (and back), and says how to display it.
const CUTOFF_MIN = 60; // Hz
const CUTOFF_MAX = 16000; // Hz
const RESONANCE_MAX = 24; // dB

const TONE_CONTROLS = {
  // Exponential, because pitch is: equal slider steps should be equal musical steps.
  cutoff: {
    toValue: (p) => CUTOFF_MIN * (CUTOFF_MAX / CUTOFF_MIN) ** (p / 100),
    toSlider: (hz) => (100 * Math.log(hz / CUTOFF_MIN)) / Math.log(CUTOFF_MAX / CUTOFF_MIN),
    format: (hz) => (hz < 1000 ? `${Math.round(hz)} Hz` : `${(hz / 1000).toFixed(1)} kHz`),
  },
  resonance: {
    toValue: (p) => (p / 100) * RESONANCE_MAX,
    toSlider: (db) => (db / RESONANCE_MAX) * 100,
    format: (db) => `${db.toFixed(1)} dB`,
  },
  // Squared so the lower half of the slider has finer control, like a real fader.
  volume: {
    toValue: (p) => (p / 100) ** 2,
    toSlider: (gain) => Math.sqrt(gain) * 100,
    format: (gain) => `${Math.round(Math.sqrt(gain) * 100)}%`,
  },
};

const TONE_NAMES = Object.keys(TONE_CONTROLS); // cutoff, resonance, volume

// Push a changed tone value to the audio graph. Cutoff and resonance move
// smoothly (setTargetAtTime) instead of jumping, which would click.
function applyTone(name) {
  if (!ctx) return; // nothing is playing yet; new notes and ensureAudio read `tone`
  const t = ctx.currentTime;
  if (name === "volume") master.gain.setTargetAtTime(tone.volume, t, 0.01);
  if (name === "cutoff") voices.forEach((v) => v.filter.frequency.setTargetAtTime(tone.cutoff, t, 0.01));
  if (name === "resonance") voices.forEach((v) => v.filter.Q.setTargetAtTime(tone.resonance, t, 0.01));
}

function setToneSlider(name, position) {
  const control = TONE_CONTROLS[name];
  tone[name] = control.toValue(position);
  $(`tone-${name}`).value = position;
  $(`out-${name}`).textContent = control.format(tone[name]);
  applyTone(name);
}

// Waveform is a choice, not a range, so it is a <select>. A knob picks one of
// the four by splitting its 0-127 travel into quarters.
const waveSelect = $("tone-wave");
function setWave(index) {
  tone.wave = WAVES[index];
  waveSelect.value = tone.wave;
}
waveSelect.addEventListener("change", () => setWave(WAVES.indexOf(waveSelect.value)));
setWave(WAVES.indexOf(tone.wave));

for (const name of TONE_NAMES) {
  setToneSlider(name, TONE_CONTROLS[name].toSlider(tone[name]));
  $(`tone-${name}`).addEventListener("input", (e) => setToneSlider(name, Number(e.target.value)));
}

// What each knob does, K1 first.
const KNOB_FUNCTIONS = [...ENV_NAMES, "wave", ...TONE_NAMES];

function applyKnob(index, value) {
  const name = KNOB_FUNCTIONS[index];
  const position = (value / 127) * 100;
  if (ENV_NAMES.includes(name)) setEnvSlider(name, position);
  else if (name === "wave") setWave(Math.min(WAVES.length - 1, Math.floor(value / (128 / WAVES.length))));
  else setToneSlider(name, position);
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
  sustained.delete(note);
  held.add(note);
  last = { note, velocity };
  shiftTo(note);
  keyEls.get(note)?.classList.add("down");
  startVoice(note, velocity / 127);
  renderLcd();
}

function noteOff(note) {
  if (!held.delete(note)) return;
  keyEls.get(note)?.classList.remove("down");
  if (sustain) sustained.add(note);
  else stopVoice(note);
}

function setSustain(on) {
  sustain = on;
  if (!on) {
    sustained.forEach((n) => stopVoice(n));
    sustained.clear();
  }
  renderLcd();
}

function setBend(value) {
  bend = value;
  if (ctx) voices.forEach((v) => v.osc.detune.setTargetAtTime(bend * BEND_RANGE * 100, ctx.currentTime, 0.01));
  renderStick();
  renderLcd();
}

// ---------- Display ----------
const bar = (value, max = 127, width = 16) => {
  const n = Math.round((value / max) * width);
  return "#".repeat(n) + ".".repeat(width - n);
};

function renderLcd() {
  lcdNote.textContent = last ? `NOTE ${noteName(last.note).padEnd(3)} (${last.note})` : "NOTE --";
  lcdVel.textContent = last ? `VEL  ${bar(last.velocity)} ${last.velocity}` : "VEL  --";
  const b = (bend * BEND_RANGE).toFixed(2);
  lcdWheels.textContent = `BEND ${bend >= 0 ? "+" : ""}${b}  MOD ${mod}  SUS ${sustain ? "ON" : "OFF"}`;
  lcdCc.textContent = lastCc ? `CC${String(lastCc.cc).padStart(3, "0")} ${bar(lastCc.value)} ${lastCc.value}` : "CC   --";
  lcdPad.textContent = lastPad
    ? `PAD  NOTE ${lastPad.note}  CH ${lastPad.channel}  VEL ${lastPad.velocity}`
    : "PAD  --";
}

// ---------- Joystick, pads and knobs ----------
// The joystick ball follows pitch bend (left/right) and mod (up).
const stickBall = $("stick-ball");
const STICK_TRAVEL = 30; // px

function renderStick() {
  stickBall.style.transform = `translate(${bend * STICK_TRAVEL}px, ${-(mod / 127) * STICK_TRAVEL}px)`;
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
    `<span class="knob-fn">${KNOB_FUNCTIONS[i] ?? ""}</span>`;
  $("knobs").appendChild(cell);
  dialEls.push(cell.querySelector(".dial"));
}

function turnKnob(index, value) {
  dialEls[index].style.setProperty("--a", `${-135 + (value / 127) * 270}deg`);
}

// ---------- MIDI ----------
const midiBtn = $("midi-btn");
const midiStatus = $("midi-status");

function handleMidi([status, d1, d2]) {
  const type = status & 0xf0;
  const channel = status & 0x0f;
  if (type === 0xe0) return setBend(((d2 << 7) | d1) / 8192 - 1);
  if (type === 0xb0) {
    if (d1 === 64) return setSustain(d2 >= 64);
    if (d1 === 1) {
      mod = d2; // joystick up
      renderStick();
    }
    const knob = KNOB_CCS.indexOf(d1);
    if (knob >= 0) {
      turnKnob(knob, d2);
      // The on-screen controls jump to the knob's position as soon as it is turned.
      applyKnob(knob, d2);
    }
    lastCc = { cc: d1, value: d2 };
    return renderLcd();
  }
  // The MPK mini's pads use channel 10: show them, but don't play the synth.
  if (channel === 9) {
    if (type === 0x90 && d2 > 0) {
      const slot = padSlot(d1);
      if (slot >= 0) hitPad(slot, d1, d2);
      lastPad = { note: d1, velocity: d2, channel: channel + 1 };
      renderLcd();
    }
    return;
  }
  if (type === 0x90 && d2 > 0) noteOn(d1, d2);
  else if (type === 0x80 || type === 0x90) noteOff(d1);
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
