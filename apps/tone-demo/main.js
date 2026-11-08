// Tone.js demo page: a polyphonic synth into a feedback delay.
//
// This is the only page that imports Tone.js. Keep it out of shared/ and the
// other apps, or the library ends up in their bundles too.
//
// The shared audio engine uses the context Tone built, and Tone's output goes into
// audio.master, so the rule "all audio goes through shared/audio.js" still holds.
// This file only wires the pieces together; it has no logic worth a unit test.

import * as Tone from "tone";
import "../../shared/base.css";
import "./tone-demo.css";
import { createAudioEngine } from "../../shared/audio.js";
import { createAppHeader } from "../../shared/app-header.js";
import { createSiteHeader } from "../../shared/site-header.js";
import { noteName } from "../../shared/notes.js";
import { COMPUTER_KEYS, createComputerKeys } from "../../shared/computer-keys.js";
import { createHolds } from "../../shared/holds.js";

const $ = (id) => document.getElementById(id);

const WAVES = ["sine", "triangle", "square", "sawtooth"];
const FIRST_NOTE = 60; // middle C
const NOTE_COUNT = COMPUTER_KEYS.length; // one octave plus the top C, one note per computer key
const OCTAVE = 12;
const DELAY_TIME = "8n";
const DELAY_FEEDBACK = 0.4;

createSiteHeader($("site-header"), { current: "tone-demo", midi: false }); // no MIDI on this page
const header = createAppHeader($("header"), {
  brand: { name: "TONE", accent: "DEMO" },
  sub: "Tone.js on the shared audio engine",
  audioStatus: true,
});

// ---------- Audio ----------
const audio = createAudioEngine({
  volume: Number($("volume").value),
  // Not a plain AudioContext handed to Tone: Tone's setup throws on one in Firefox, see audio.js.
  createContext: () => Tone.getContext().rawContext,
  onStateChange: (state) => {
    header.setAudioStatus(state === "running" ? "Audio: on" : "Audio: click the page to enable");
  },
});
audio.unlockOnInteraction();

// The page's settings. Every change goes through setWave / setDelay, whether it
// comes from the controls or from the defaults, so the sound and the controls agree.
const settings = { wave: "triangle", delay: Number($("delay").value) };
let voice = null; // { synth, delay }, built on the first note

// Built on first use, after the first interaction has started the context.
function ensureVoice() {
  if (voice) return voice;
  audio.ensure();
  const delay = new Tone.FeedbackDelay(DELAY_TIME, DELAY_FEEDBACK).connect(audio.master);
  const synth = new Tone.PolySynth(Tone.Synth).connect(delay);
  voice = { synth, delay };
  applySettings();
  return voice;
}

function applySettings() {
  if (!voice) return;
  voice.synth.set({ oscillator: { type: settings.wave } });
  voice.delay.wet.value = settings.delay;
}

function setWave(wave) {
  settings.wave = wave;
  applySettings();
}

function setDelay(amount) {
  settings.delay = amount;
  applySettings();
}

// ---------- Controls ----------
for (const wave of WAVES) {
  const option = new Option(wave, wave, false, wave === settings.wave);
  $("wave").append(option);
}
$("wave").addEventListener("change", (e) => setWave(e.target.value));
$("delay").addEventListener("input", (e) => setDelay(Number(e.target.value)));
$("volume").addEventListener("input", (e) => audio.setVolume(Number(e.target.value)));

// ---------- Keys ----------
// A key sounds from the moment it goes down until it is let go, by pointer, by Enter / Space on
// the focused key, or by the computer keyboard. The same note can be held from more than one of
// those at once (two fingers on one key count separately), so it sounds until the last lets go:
// each holds it under its own source.
const FOCUSED_SOURCES = ["focused Enter", "focused Space"]; // Enter and Space can be held together
const focusedSource = (e) => FOCUSED_SOURCES[e.key === " " ? 1 : 0];
const COMPUTER = "computer keyboard";
const pointerSource = (e) => `pointer ${e.pointerId}`;
const pointerSources = new Set(); // the pointers now down, to let go of them when the page is left
const holds = createHolds();
const keyButtons = new Map(); // note -> its button, to light it however it was played

function press(note, source) {
  if (!holds.press(note, source)) return; // already sounding, held by another source or this one
  keyButtons.get(note).classList.add("is-down");
  ensureVoice().synth.triggerAttack(noteName(note));
}

function stop(note) {
  keyButtons.get(note).classList.remove("is-down");
  voice.synth.triggerRelease(noteName(note));
}

function release(note, source) {
  if (holds.release(note, source)) stop(note); // false while another source still holds it
}

// A source that goes away without letting go (the page lost focus) frees what it held.
function releaseSource(source) {
  for (const note of holds.releaseAll(source)) stop(note);
}

for (let note = FIRST_NOTE; note < FIRST_NOTE + NOTE_COUNT; note++) {
  const key = document.createElement("button");
  key.type = "button";
  key.className = "btn tone-key";
  key.textContent = noteName(note);
  const letter = document.createElement("span");
  letter.className = "tone-key-letter";
  letter.textContent = COMPUTER_KEYS[note - FIRST_NOTE].toUpperCase();
  key.append(letter);
  keyButtons.set(note, key);

  key.addEventListener("pointerdown", (e) => {
    key.setPointerCapture(e.pointerId); // so the pointer-up arrives even if it slid off the key
    pointerSources.add(pointerSource(e));
    press(note, pointerSource(e));
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    key.addEventListener(type, (e) => {
      release(note, pointerSource(e));
      pointerSources.delete(pointerSource(e));
    });
  }
  key.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    press(note, focusedSource(e));
  });
  key.addEventListener("keyup", (e) => {
    if (e.key === "Enter" || e.key === " ") release(note, focusedSource(e));
  });
  key.addEventListener("blur", () => FOCUSED_SOURCES.forEach((source) => release(note, source)));

  $("keys").append(key);
}

// The computer keyboard plays the same keys: A W S E D F T G Y H U J K, as on the keys page.
// A letter typed while a menu or slider has focus is for that control, not for a note.
const computerKeys = createComputerKeys({
  target: window,
  getBase: () => FIRST_NOTE - OCTAVE, // the keys play the octave above the base
  onNoteOn: (note) => press(note, COMPUTER),
  onNoteOff: (note) => release(note, COMPUTER),
  ignore: (e) => e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement,
});

// A key held while the page goes to the background (Alt-Tab, a notification,
// another tab) never sends its keyup / pointerup, so its note would sound until
// the same key was pressed again. Let go of everything when the page loses focus
// or is hidden, as the keys page does.
function releaseAll() {
  for (const source of [...FOCUSED_SOURCES, COMPUTER, ...pointerSources]) releaseSource(source);
  pointerSources.clear();
  computerKeys.reset(); // so the same letter can be pressed again, its keyup never having come
}
window.addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") releaseAll();
});
