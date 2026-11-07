// MIDI keyboard test page: plays a simple synth from a MIDI keyboard (or the
// computer keyboard) and shows notes, velocity, pitch bend, mod wheel,
// sustain pedal and knob/CC activity.

import "./style.css";
import "./keyboard.css";

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
const held = new Set(); // notes physically down
const sustained = new Set(); // released but kept alive by the pedal
const voices = new Map(); // note -> { osc, gain }

// ---------- Elements ----------
const pianoEl = $("piano");
const lcdNote = $("lcd-note");
const lcdVel = $("lcd-vel");
const lcdWheels = $("lcd-wheels");
const lcdCc = $("lcd-cc");
const keyEls = new Map();

// ---------- Audio ----------
function ensureAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
}

const freq = (note) => 440 * 2 ** ((note - 69) / 12);

function startVoice(note, velocity) {
  ensureAudio();
  stopVoice(note, 0.02);
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq(note);
  osc.detune.value = bend * BEND_RANGE * 100;
  const gain = ctx.createGain();
  const peak = 0.15 + 0.5 * velocity;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(peak * 0.6, t + 0.3);
  osc.connect(gain).connect(master);
  osc.start(t);
  voices.set(note, { osc, gain });
}

function stopVoice(note, release = 0.25) {
  const v = voices.get(note);
  if (!v) return;
  voices.delete(note);
  const t = ctx.currentTime;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.0001), t);
  v.gain.gain.exponentialRampToValueAtTime(0.0001, t + release);
  v.osc.stop(t + release + 0.02);
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
}

// ---------- MIDI ----------
const midiBtn = $("midi-btn");
const midiStatus = $("midi-status");
let access = null;

function handleMidi([status, d1, d2]) {
  const type = status & 0xf0;
  const channel = status & 0x0f;
  if (type === 0xe0) return setBend(((d2 << 7) | d1) / 8192 - 1);
  if (type === 0xb0) {
    if (d1 === 64) return setSustain(d2 >= 64);
    if (d1 === 1) mod = d2;
    lastCc = { cc: d1, value: d2 };
    return renderLcd();
  }
  // The MPK mini's pads use channel 10; this page is for the keys.
  if (channel === 9) return;
  if (type === 0x90 && d2 > 0) noteOn(d1, d2);
  else if (type === 0x80 || type === 0x90) noteOff(d1);
}

function rescan() {
  const inputs = [...access.inputs.values()].filter((i) => i.state !== "disconnected" && !/through/i.test(i.name));
  inputs.forEach((input) => (input.onmidimessage = (e) => handleMidi(e.data)));
  midiStatus.textContent = inputs.length ? `MIDI: ${inputs.map((i) => i.name).join(", ")}` : "MIDI: no device";
}

async function connect() {
  if (!navigator.requestMIDIAccess) {
    midiStatus.textContent = "MIDI: use Chrome or Edge";
    return;
  }
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    midiStatus.textContent = "MIDI: permission denied";
    return;
  }
  access.onstatechange = rescan;
  rescan();
  midiBtn.hidden = true;
}

midiBtn.addEventListener("click", connect);

// Reconnect silently on later visits if permission was already granted.
navigator.permissions
  ?.query({ name: "midi" })
  .then((p) => p.state === "granted" && connect())
  .catch(() => {});

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
