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
import "../../shared/piano.css";
import "./tone-demo.css";
import { createAudioEngine } from "../../shared/audio.js";
import { createAudioNotice } from "../../shared/audio-notice.js";
import { togglePower } from "../../shared/power.js";
import { createAppHeader } from "../../shared/app-header.js";
import { createSiteHeader } from "../../shared/site-header.js";
import { noteName } from "../../shared/notes.js";
import { COMPUTER_KEYS, createComputerKeys } from "../../shared/computer-keys.js";
import { createHolds } from "../../shared/holds.js";
import { createPiano } from "../../shared/piano.js";
import { PARAMS } from "./params.js";

const $ = (id) => document.getElementById(id);

const WAVES = ["sine", "triangle", "square", "sawtooth"];
const FIRST_NOTE = 60; // middle C
const OCTAVE = 12;
const DELAY_TIME = "8n";
const DELAY_FEEDBACK = 0.4;

createSiteHeader($("site-header"), { current: "tone-demo", midi: false }); // no MIDI on this page
const header = createAppHeader($("header"), {
  brand: { name: "TONE", accent: "DEMO" },
  sub: "Tone.js on the shared audio engine",
  onPower: () => togglePower(audio),
});

// ---------- Audio ----------
const audioNotice = createAudioNotice($("audio-notice"));
const audio = createAudioEngine({
  volume: PARAMS.volume.value,
  // Not a plain AudioContext handed to Tone: Tone's setup throws on one in Firefox, see audio.js.
  createContext: () => Tone.getContext().rawContext,
  onStateChange: (state) => {
    audioNotice.update(state);
    header.setPowered(state === "running");
  },
});
audio.unlockOnInteraction();

// The page's settings. Every change goes through setWave / setDelay, whether it
// comes from the controls or from the defaults, so the sound and the controls agree.
const settings = { wave: "triangle", delay: PARAMS.delay.value };
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

// Whether the menu got its focus from the mouse or touch. A pointer user picking a wave expects
// the keys to play next, but the menu keeps focus (even when the same option is picked again, so
// there is no `change` to blur on). A keyboard user who tabbed to it is using it. Judge by the last
// input device: clicking the label focuses the menu without a pointerdown on the menu itself.
let lastInputWasPointer = false;
const waveControl = $("wave").closest("label");
window.addEventListener(
  "pointerdown",
  (e) => {
    lastInputWasPointer = true;
    // Clicking a menu that already has focus (tabbed to) sends no new `focus` event.
    if (waveControl.contains(e.target) || document.activeElement === $("wave")) {
      menuFocusedByPointer = true;
    }
  },
  true,
);
window.addEventListener("keydown", () => (lastInputWasPointer = false), true);
let menuFocusedByPointer = false;
$("wave").addEventListener("focus", () => (menuFocusedByPointer = lastInputWasPointer));
$("wave").addEventListener("blur", () => (menuFocusedByPointer = false));

// A pointer-focused menu gives its focus to the first note key, and the key must not also run the
// menu's own type-ahead (which could change the wave).
function menuClaimsKey(e) {
  if (!(e.target instanceof HTMLSelectElement)) return false;
  // Arrows, Enter and Escape are not note keys: they always belong to the menu.
  const isNoteKey = e.key.length === 1 && COMPUTER_KEYS.includes(e.key.toLowerCase());
  if (!menuFocusedByPointer || !isNoteKey) return true;
  e.preventDefault();
  e.target.blur();
  return false;
}

// A slider's range, default and readout come from PARAMS, so the HTML holds no numbers.
function bindSlider(id, onChange) {
  const param = PARAMS[id];
  const input = $(id);
  Object.assign(input, { min: param.min, max: param.max, step: param.step, value: param.value });
  const show = () => ($(`${id}-value`).textContent = param.format(Number(input.value)));
  input.addEventListener("input", () => {
    onChange(Number(input.value));
    show();
  });
  show();
}
bindSlider("delay", setDelay);
bindSlider("volume", (v) => audio.setVolume(v));

// ---------- Keys ----------
// A key sounds from the moment it goes down until it is let go, by the on-screen piano or by
// the computer keyboard. The same note can be held from more than one of those at once (two
// fingers on one key count separately), so it sounds until the last lets go: each holds it
// under its own source.
const COMPUTER = "computer keyboard";
const holds = createHolds();

function press(note, source) {
  if (!audio.powered) return; // muted now, but a held note would be heard at power on
  if (!holds.press(note, source)) return; // already sounding, held by another source or this one
  piano.press(note);
  ensureVoice().synth.triggerAttack(noteName(note));
}

function stop(note) {
  piano.release(note);
  voice.synth.triggerRelease(noteName(note));
}

function release(note, source) {
  if (holds.release(note, source)) stop(note); // false while another source still holds it
}

// A source that goes away without letting go (the page lost focus) frees what it held.
function releaseSource(source) {
  for (const note of holds.releaseAll(source)) stop(note);
}

const piano = createPiano($("keys"), {
  base: FIRST_NOTE,
  onNoteOn: (note, _velocity, source) => press(note, source),
  onNoteOff: (note, source) => release(note, source),
});

// The computer keyboard plays the same keys: A W S E D F T G Y H U J K, as on the keys page.
// A letter typed in the menu after tabbing to it is for the menu (type-ahead), not for a note. A
// slider takes no letters, so it never blocks the keys: clicking one must not silence the keyboard.
const computerKeys = createComputerKeys({
  target: window,
  getBase: () => FIRST_NOTE - OCTAVE, // the keys play the octave above the base
  onNoteOn: (note) => press(note, COMPUTER),
  onNoteOff: (note) => release(note, COMPUTER),
  ignore: menuClaimsKey,
});

// A key held while the page goes to the background (Alt-Tab, a notification,
// another tab) never sends its keyup / pointerup, so its note would sound until
// the same key was pressed again. Let go of everything when the page loses focus
// or is hidden, as the keys page does.
function releaseAll() {
  releaseSource(COMPUTER);
  piano.releasePointers();
  computerKeys.reset(); // so the same letter can be pressed again, its keyup never having come
}
window.addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") releaseAll();
});
