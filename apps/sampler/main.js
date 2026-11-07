// The pad sampler and step sequencer. This file only wires the pieces together:
// the pattern and transport (the sequencer), the views (pads, steps, LCD, tempo
// knob) and the inputs (mouse, computer keyboard, MIDI).

import "../../shared/base.css";
import "./sampler.css";
import { createAudioEngine } from "../../shared/audio.js";
import { wireMidiButton } from "../../shared/midi-access.js";
import { loadJson, saveJson } from "../../shared/storage.js";
import { createAudioNotice } from "./audio-notice.js";
import { createLcd, pad2 } from "./lcd.js";
import { createMidi } from "./midi.js";
import { STARTER_BEAT, createPattern } from "./pattern.js";
import { createPadGrid, padForKey } from "./pads.js";
import { SONG_KEY, createSongSaver, parseSong } from "./song.js";
import { SOUNDS } from "./sounds.js";
import { createStepKeys } from "./steps.js";
import { createTempoKnob } from "./tempo-knob.js";
import { BPM_MAX, BPM_MIN, createTapTempo, nearestStep } from "./tempo.js";
import { createTransport } from "./transport.js";

const STEPS = 16;
const PAD_COUNT = SOUNDS.length; // 16 pads in a 4x4 grid

const $ = (id) => document.getElementById(id);

// ---------- State ----------
let selected = 0;
let recording = false;

const volInput = $("vol");
const playBtn = $("play");
const recBtn = $("rec");

// ---------- Saved song ----------
// The pattern, tempo and volume come back on the next visit. This is read first
// because the audio engine takes its starting level from the volume slider.
// With nothing usable saved (first visit, blocked storage), the page starts
// from the starter beat as it always did.
const saved = parseSong(loadJson(SONG_KEY), { rows: PAD_COUNT, steps: STEPS });
if (saved) volInput.value = String(saved.volume);

const saver = createSongSaver({
  read: () => ({ bpm: transport.bpm, volume: Number(volInput.value), pattern: pattern.snapshot() }),
  save: (song) => saveJson(SONG_KEY, song),
});
window.addEventListener("pagehide", () => saver.flush());

// ---------- Audio and sequencer ----------
// The notice comes first: the engine reports its state as soon as it is told to
// listen, and that first report is what shows the notice on a fresh load.
const audioNotice = createAudioNotice($("audio-notice"));
const audio = createAudioEngine({
  volume: Number(volInput.value) / 100,
  onStateChange: (state) => audioNotice.update(state),
});
audio.unlockOnInteraction(); // so a Launchpad hit on a return visit isn't silent

const pattern = createPattern(PAD_COUNT, STEPS, saved ? saved.pattern : STARTER_BEAT, {
  onChange: () => saver.schedule(),
});

const transport = createTransport({
  audio,
  steps: STEPS,
  bpm: saved?.bpm,
  onStep(step, time, heard) {
    const { ctx, master } = audio;
    SOUNDS.forEach((sound, row) => {
      if (pattern.isOn(row, step) && !heard.has(row)) sound.play(ctx, master, time);
    });
  },
});

// ---------- Views ----------
const lcd = createLcd({
  lines: [$("lcd-1"), $("lcd-2"), $("lcd-3")],
  message: $("lcd-msg"),
  ruler: $("ruler"),
  steps: STEPS,
});

function renderLcd() {
  lcd.render({
    playing: transport.playing,
    recording,
    selected,
    soundName: SOUNDS[selected].name,
    bpm: transport.bpm,
    playheadStep: transport.playheadStep,
    steps: STEPS,
    stepsOn: pattern.row(selected),
  });
  midi.refresh();
}

const padGrid = createPadGrid($("pads"), { sounds: SOUNDS, onTrigger: (idx) => triggerPad(idx) });
const stepKeys = createStepKeys($("steps"), { steps: STEPS, onToggle: (i) => toggleStep(i) });
const knob = createTempoKnob($("knob"), { min: BPM_MIN, max: BPM_MAX, getBpm: () => transport.bpm, onChange: setBpm });

function refreshSteps() {
  stepKeys.refresh({ on: pattern.row(selected), soundName: SOUNDS[selected].name });
}

// ---------- Pads ----------
function selectPad(idx) {
  selected = idx;
  padGrid.select(idx);
  refreshSteps();
  renderLcd();
}

// velocity is 0-1; a quieter hit plays through its own gain stage.
function triggerPad(idx, velocity = 1) {
  const ctx = audio.ensure();
  let out = audio.master;
  if (velocity < 1) {
    out = ctx.createGain();
    out.gain.value = Math.max(velocity, 0.05);
    out.connect(audio.master);
  }
  SOUNDS[idx].play(ctx, out, ctx.currentTime);
  padGrid.flash(idx);
  midi.padHit(idx);
  if (recording && transport.playing) recordHit(idx);
  selectPad(idx);
}

// Live recording: quantize the hit to the nearest 16th step.
function recordHit(idx) {
  const step = nearestStep({
    now: audio.ctx.currentTime,
    playheadTime: transport.playheadTime,
    playheadStep: transport.playheadStep,
    bpm: transport.bpm,
    steps: STEPS,
  });
  if (step < 0) return;
  pattern.set(idx, step, true);
  transport.markHeard(idx, step); // it was just played live: don't sound it again at a slow tempo
}

// ---------- Steps ----------
function toggleStep(i) {
  pattern.toggle(selected, i);
  refreshSteps();
  renderLcd();
}

// ---------- Transport ----------
// The playhead follows the audio clock, so it is painted every animation frame
// rather than from the scheduler's timer.
function paintLoop() {
  if (!transport.playing) return;
  if (transport.poll()) {
    stepKeys.paintPlayhead(transport.playing, transport.playheadStep);
    renderLcd();
  }
  requestAnimationFrame(paintLoop);
}

function start() {
  if (!transport.start()) return; // already playing
  playBtn.setAttribute("aria-pressed", "true");
  requestAnimationFrame(paintLoop);
  renderLcd();
}

function stop() {
  transport.stop();
  playBtn.setAttribute("aria-pressed", "false");
  stepKeys.paintPlayhead(transport.playing, transport.playheadStep);
  renderLcd();
}

playBtn.addEventListener("click", start);
$("stop").addEventListener("click", stop);

function toggleRec() {
  recording = !recording;
  recBtn.setAttribute("aria-pressed", String(recording));
  lcd.showMessage(recording ? (transport.playing ? "REC ON - HIT PADS" : "REC ARMED - PRESS PLAY") : "REC OFF");
  renderLcd();
}

function clearPad() {
  pattern.clearRow(selected);
  refreshSteps();
  lcd.showMessage(`PAD ${pad2(selected + 1)} CLEARED`);
  renderLcd();
}

function clearAll() {
  pattern.clearAll();
  refreshSteps();
  lcd.showMessage("ALL PADS CLEARED");
  renderLcd();
}

recBtn.addEventListener("click", toggleRec);
$("clear").addEventListener("click", clearPad);
$("clear-all").addEventListener("click", clearAll);

// ---------- Tempo ----------
function setBpm(value) {
  knob.render(transport.setBpm(value));
  renderLcd();
  saver.schedule();
}

const taps = createTapTempo();
$("tap").addEventListener("click", tapTempo);
function tapTempo() {
  const bpm = taps.tap(performance.now());
  if (bpm === null) {
    lcd.showMessage("TAP AGAIN...");
  } else {
    setBpm(bpm);
    lcd.showMessage("TAP TEMPO");
  }
}

// ---------- Volume ----------
volInput.addEventListener("input", () => {
  audio.setVolume(Number(volInput.value) / 100);
  lcd.showMessage(`VOLUME ${volInput.value}`);
  saver.schedule();
});

// ---------- Keyboard ----------
window.addEventListener("keydown", (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.code === "Space") {
    if (document.activeElement?.tagName === "BUTTON") return; // let the button click
    e.preventDefault();
    transport.playing ? stop() : start();
    return;
  }

  const idx = padForKey(e.key.toLowerCase());
  if (idx >= 0) triggerPad(idx);
});

// ---------- MIDI ----------
const midiBtn = $("midi-btn");
const midiStatus = $("midi-status");

const midi = createMidi({
  padCount: PAD_COUNT,
  steps: STEPS,
  triggerPad(idx, velocity) {
    // Only MIDI comes through here: a click or key press has already unlocked
    // audio (unlockOnInteraction), so this is the hit that would be silent.
    if (!audio.running) audioNotice.nudge();
    triggerPad(idx, velocity);
  },
  toggleStep,
  start,
  stop,
  toggleRec,
  clearPad,
  clearAll,
  tapTempo,
  nudgeTempo: (delta) => setBpm(transport.bpm + delta),
  getState: () => ({
    selected,
    stepsOn: pattern.row(selected),
    playheadStep: transport.playheadStep,
    playing: transport.playing,
    recording,
  }),
  onStatus: (text) => (midiStatus.textContent = text),
});

wireMidiButton(midiBtn, midi);

// ---------- Init ----------
// Not setBpm: showing the starting tempo is not a change, so it shouldn't save.
knob.render(transport.bpm);
selectPad(0);
