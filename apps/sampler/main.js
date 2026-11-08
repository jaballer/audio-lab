// The pad sampler and step sequencer. This file only wires the pieces together:
// the sampler (state and actions, controller.js), the views (pads, steps, LCD,
// tempo knob) and the inputs (mouse, computer keyboard, MIDI).

import "../../shared/base.css";
import "./sampler.css";
import { createAudioEngine } from "../../shared/audio.js";
import { createAppHeader } from "../../shared/app-header.js";
import { wireMidiButton } from "../../shared/midi-access.js";
import { loadJson, saveJson } from "../../shared/storage.js";
import { DEFAULT_VOLUME, createSampler } from "./controller.js";
import { createLcd } from "./lcd.js";
import { PAD_COUNT, STEPS } from "./layout.js";
import { createMidi } from "./midi.js";
import { createPadGrid, padForKey } from "./pads.js";
import { SONG_KEY, createSongSaver, parseSong } from "./song.js";
import { SOUNDS } from "../../shared/sounds.js";
import { createStepKeys } from "./steps.js";
import { createTempoKnob } from "./tempo-knob.js";
import { BPM_MAX, BPM_MIN } from "./tempo.js";

const $ = (id) => document.getElementById(id);

const header = createAppHeader($("header"), {
  brand: { name: "PAD", accent: "16" },
  sub: "Digital Sampler & Sequencer",
  powerLed: true,
});

const volInput = $("vol");
const playBtn = $("play");
const recBtn = $("rec");

// ---------- Saved song ----------
// The pattern, tempo and volume come back on the next visit. This is read first
// because the audio engine takes its starting level from the saved volume.
// With nothing usable saved (first visit, blocked storage), the page starts
// from the starter beat as it always did.
const song = parseSong(loadJson(SONG_KEY), { rows: PAD_COUNT, steps: STEPS });

const saver = createSongSaver({
  read: () => sampler.getSong(),
  save: (data) => saveJson(SONG_KEY, data),
});
window.addEventListener("pagehide", () => saver.flush());

// ---------- Audio and sequencer ----------
const audio = createAudioEngine({ volume: (song ? song.volume : DEFAULT_VOLUME) / 100 });
audio.unlockOnInteraction(); // so a Launchpad hit on a return visit isn't silent

// The callbacks below use the views and `midi`, which are built after this. That
// is fine because the sampler reports nothing until something happens.
const sampler = createSampler({
  audio,
  sounds: SOUNDS,
  steps: STEPS,
  song,
  onChange: render,
  onMessage: (text) => lcd.showMessage(text),
  onPadHit(index) {
    padGrid.flash(index);
    midi.padHit(index);
  },
  onSongChange: () => saver.schedule(),
});

// ---------- Views ----------
const lcd = createLcd({
  lines: [$("lcd-1"), $("lcd-2"), $("lcd-3")],
  message: $("lcd-msg"),
  ruler: $("ruler"),
  steps: STEPS,
});

const padGrid = createPadGrid($("pads"), { sounds: SOUNDS, onTrigger: (index) => sampler.triggerPad(index) });
const stepKeys = createStepKeys($("steps"), { steps: STEPS, onToggle: (step) => sampler.toggleStep(step) });
const knob = createTempoKnob($("knob"), {
  min: BPM_MIN,
  max: BPM_MAX,
  getBpm: () => sampler.getState().bpm,
  onChange: (bpm) => sampler.setBpm(bpm),
});

// Every view is drawn from the sampler's state, so it cannot disagree with it.
function render() {
  const state = sampler.getState();
  const soundName = SOUNDS[state.selected].name;
  padGrid.select(state.selected);
  stepKeys.refresh({ on: state.stepsOn, soundName });
  stepKeys.paintPlayhead(state.playing, state.playheadStep);
  knob.render(state.bpm);
  volInput.value = String(state.volume);
  playBtn.setAttribute("aria-pressed", String(state.playing));
  recBtn.setAttribute("aria-pressed", String(state.recording));
  lcd.render({ ...state, soundName, steps: STEPS });
  midi.refresh();
  if (state.playing) startPaintLoop();
}

// The playhead follows the audio clock, so it is painted every animation frame
// rather than from the scheduler's timer.
let painting = false;

function startPaintLoop() {
  if (painting) return;
  painting = true;
  requestAnimationFrame(paintLoop);
}

function paintLoop() {
  if (!sampler.getState().playing) {
    painting = false;
    return;
  }
  if (sampler.poll()) render();
  requestAnimationFrame(paintLoop);
}

// ---------- Buttons ----------
playBtn.addEventListener("click", sampler.start);
$("stop").addEventListener("click", sampler.stop);
recBtn.addEventListener("click", sampler.toggleRec);
$("clear").addEventListener("click", sampler.clearPad);
$("clear-all").addEventListener("click", sampler.clearAll);
$("tap").addEventListener("click", sampler.tapTempo);
volInput.addEventListener("input", () => sampler.setVolume(Number(volInput.value)));

// ---------- Keyboard ----------
window.addEventListener("keydown", (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.code === "Space") {
    if (document.activeElement?.tagName === "BUTTON") return; // let the button click
    e.preventDefault();
    if (sampler.getState().playing) sampler.stop();
    else sampler.start();
    return;
  }

  const index = padForKey(e.key.toLowerCase());
  if (index >= 0) sampler.triggerPad(index);
});

// ---------- MIDI ----------
const midi = createMidi({
  ...sampler,
  padCount: PAD_COUNT,
  steps: STEPS,
  onStatus: header.setMidiStatus,
  onLog: header.log,
});

wireMidiButton(header.midiButton, midi);

// ---------- Init ----------
sampler.selectPad(0);
