// The pad sampler and step sequencer. This file only wires the pieces together:
// the sampler (state and actions, controller.js), the views (pads, steps, LCD,
// tempo knob) and the inputs (mouse, computer keyboard, MIDI).

import "../../shared/base.css";
import "../../shared/step-keys.css";
import "./sampler.css";
import { createAudioEngine } from "../../shared/audio.js";
import { createAudioNotice } from "../../shared/audio-notice.js";
import { togglePower } from "../../shared/power.js";
import { createAppHeader } from "../../shared/app-header.js";
import { createSiteHeader } from "../../shared/site-header.js";
import { wireMidiButton } from "../../shared/midi-access.js";
import { loadJson, saveJson } from "../../shared/storage.js";
import { DEFAULT_VOLUME, createSampler } from "./controller.js";
import { createLcd } from "./lcd.js";
import { pad2 } from "./format.js";
import { BAR_CHOICES, MAX_BARS, PAD_COUNT, SEQUENCE_COUNT, STEPS, STEP_GROUP } from "./layout.js";
import { createMidi } from "./midi.js";
import { createPadGrid, padForKey } from "./pads.js";
import { SONG_KEY, createSongSaver, parseSong } from "./song.js";
import { SOUNDS } from "../../shared/sounds.js";
import { createStepKeys } from "../../shared/step-keys.js";
import { createTempoKnob } from "./tempo-knob.js";
import { BPM_MAX, BPM_MIN } from "../../shared/tempo.js";

const $ = (id) => document.getElementById(id);

const site = createSiteHeader($("site-header"), { current: "sampler" });
const header = createAppHeader($("header"), {
  brand: { name: "PAD", accent: "16" },
  sub: "Digital Sampler & Sequencer",
  onPower: () => togglePower(audio),
});

const volInput = $("vol");
const playBtn = $("play");
const recBtn = $("rec");

// ---------- Saved song ----------
// The pattern, tempo and volume come back on the next visit. This is read first
// because the audio engine takes its starting level from the saved volume.
// With nothing usable saved (first visit, blocked storage), the page starts
// from the starter beat as it always did.
const song = parseSong(loadJson(SONG_KEY), {
  rows: PAD_COUNT,
  steps: STEPS,
  maxBars: MAX_BARS,
  sequenceCount: SEQUENCE_COUNT,
});

const saver = createSongSaver({
  read: () => sampler.getSong(),
  save: (data) => saveJson(SONG_KEY, data),
});
window.addEventListener("pagehide", () => saver.flush());

// ---------- Audio and sequencer ----------
// The notice comes first: the engine reports its state as soon as it is told to
// listen, and that first report is what shows the notice on a fresh load.
const audioNotice = createAudioNotice($("audio-notice"));
const audio = createAudioEngine({
  volume: (song ? song.volume : DEFAULT_VOLUME) / 100,
  onStateChange: (state) => {
    audioNotice.update(state);
    header.setPowered(state === "running");
  },
});
audio.unlockOnInteraction(); // so a Launchpad hit on a return visit isn't silent

// The callbacks below use the views and `midi`, which are built after this. That
// is fine because the sampler reports nothing until something happens.
const sampler = createSampler({
  audio,
  sounds: SOUNDS,
  steps: STEPS,
  maxBars: MAX_BARS,
  sequenceCount: SEQUENCE_COUNT,
  song,
  onChange: render,
  onMessage: (text) => lcd.showMessage(text),
  onPadHit(index) {
    padGrid.flash(index);
    midi.padHit(index);
  },
  onPadPlayed(index) {
    padGrid.light(index);
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
const stepKeys = createStepKeys($("steps"), {
  steps: STEPS,
  group: STEP_GROUP,
  onToggle: (step) => sampler.toggleStep(step),
});
const seqPrev = $("seq-prev");
const seqNext = $("seq-next");
const seqNumber = $("seq-number");
seqPrev.addEventListener("click", () => sampler.setSequence(sampler.getState().sequence - 1));
seqNext.addEventListener("click", () => sampler.setSequence(sampler.getState().sequence + 1));
const stepsPrev = $("steps-prev");
const stepsNext = $("steps-next");
const stepsRange = $("steps-range");
stepsPrev.addEventListener("click", () => sampler.setPage(sampler.getState().page - 1));
stepsNext.addEventListener("click", () => sampler.setPage(sampler.getState().page + 1));

// One button per length, the chosen one lit, like the length keys on a sampler.
const barButtons = BAR_CHOICES.map((bars) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-small btn-led";
  button.textContent = String(bars);
  button.setAttribute("aria-label", bars === 1 ? "1 bar" : `${bars} bars`);
  button.addEventListener("click", () => sampler.setBars(bars));
  $("bars").appendChild(button);
  return { bars, button };
});

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
  seqNumber.textContent = pad2(state.sequence + 1);
  seqPrev.disabled = state.sequence === 0;
  seqNext.disabled = state.sequence === state.sequenceCount - 1;
  for (const { bars, button } of barButtons) button.setAttribute("aria-pressed", String(bars === state.bars));
  stepsRange.textContent = `Bar ${state.page + 1} of ${state.bars}`;
  stepsPrev.disabled = state.page === 0;
  stepsNext.disabled = state.page === state.bars - 1;
  volInput.value = String(state.volume);
  playBtn.setAttribute("aria-pressed", String(state.playing));
  recBtn.setAttribute("aria-pressed", String(state.recording));
  // Armed (waiting for Play) blinks; once the sequence runs, the lamp stays lit.
  recBtn.classList.toggle("armed", state.recording && !state.playing);
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
  triggerPad(idx, velocity) {
    // Only MIDI comes through here: a click or key press has already unlocked
    // audio (unlockOnInteraction), so this is the hit that would be silent.
    if (!audio.running) audioNotice.nudge();
    sampler.triggerPad(idx, velocity);
  },
  padCount: PAD_COUNT,
  steps: STEPS,
  onStatus: site.setMidiStatus,
  onLog: site.log,
});

wireMidiButton(site.midiButton, midi);

// ---------- Init ----------
sampler.selectPad(0);
