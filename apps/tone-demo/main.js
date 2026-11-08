// Tone.js demo page: a polyphonic synth into a feedback delay.
//
// This is the only page that imports Tone.js. Keep it out of shared/ and the
// other apps, or the library ends up in their bundles too.
//
// Tone is pointed at the shared AudioContext and its output goes into
// audio.master, so the rule "all audio goes through shared/audio.js" still holds.
// This file only wires the pieces together; it has no logic worth a unit test.

import * as Tone from "tone";
import "../../shared/base.css";
import "./tone-demo.css";
import { createAudioEngine } from "../../shared/audio.js";
import { createAppHeader } from "../../shared/app-header.js";
import { createSiteHeader } from "../../shared/site-header.js";
import { noteName } from "../../shared/notes.js";

const $ = (id) => document.getElementById(id);

const WAVES = ["sine", "triangle", "square", "sawtooth"];
const FIRST_NOTE = 60; // middle C
const NOTE_COUNT = 13; // one octave plus the top C
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
  onStateChange: (state) => {
    header.setAudioStatus(state === "running" ? "Audio: on" : "Audio: click the page to enable");
  },
});
audio.unlockOnInteraction();

// The page's settings. Every change goes through setWave / setDelay, whether it
// comes from the controls or from the defaults, so the sound and the controls agree.
const settings = { wave: "triangle", delay: Number($("delay").value) };
let voice = null; // { synth, delay }, built on the first note

// Built on first use: Tone must be pointed at the shared context before it
// creates any node, and that context does not exist until the first interaction.
// Importing Tone has already made it a context of its own (its Transport and
// Destination exports need one), so dispose of that one when swapping: otherwise
// it stays open, unused, and takes up one of the browser's limited audio contexts.
function ensureVoice() {
  if (voice) return voice;
  Tone.setContext(audio.ensure(), true);
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
// A key sounds from the moment it goes down until it is let go, by pointer or by
// Enter / Space. `held` keeps a lost pointer-up from leaving a note stuck.
const held = new Set();

function press(note) {
  if (held.has(note)) return;
  held.add(note);
  ensureVoice().synth.triggerAttack(noteName(note));
}

function release(note) {
  if (!held.delete(note)) return;
  voice.synth.triggerRelease(noteName(note));
}

for (let note = FIRST_NOTE; note < FIRST_NOTE + NOTE_COUNT; note++) {
  const key = document.createElement("button");
  key.type = "button";
  key.className = "btn tone-key";
  key.textContent = noteName(note);

  key.addEventListener("pointerdown", (e) => {
    key.setPointerCapture(e.pointerId); // so the pointer-up arrives even if it slid off the key
    press(note);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    key.addEventListener(type, () => release(note));
  }
  key.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    press(note);
  });
  key.addEventListener("keyup", (e) => {
    if (e.key === "Enter" || e.key === " ") release(note);
  });
  key.addEventListener("blur", () => release(note));

  $("keys").append(key);
}

// A key held while the page goes to the background (Alt-Tab, a notification,
// another tab) never sends its keyup / pointerup, so its note would sound until
// the same key was pressed again. Let go of everything when the page loses focus
// or is hidden, as the keys page does.
function releaseAll() {
  for (const note of [...held]) release(note);
}
window.addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") releaseAll();
});
