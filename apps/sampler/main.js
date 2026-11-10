// The pad sampler and step sequencer. This file only wires the pieces together:
// the sampler (state and actions, controller.js), the views (pads, steps, LCD,
// tempo knob) and the inputs (mouse, computer keyboard, MIDI).

import "../../shared/base.css";
import "../../shared/step-keys.css";
import "../../shared/light-show.css";
import "./sampler.css";
import { createAudioEngine } from "../../shared/audio.js";
import { createAudioNotice } from "../../shared/audio-notice.js";
import { setAttr, setDisabledMany, setText } from "../../shared/dom-updates.js";
import { createLightShow } from "../../shared/light-show-view.js";
import { bandLevels, beatPhase, rmsLevel, smoothLevel } from "../../shared/light-show.js";
import { togglePower } from "../../shared/power.js";
import { createAppHeader } from "../../shared/app-header.js";
import { enableOffline } from "../../shared/offline.js";
import { createSiteHeader } from "../../shared/site-header.js";
import { wireMidiButton } from "../../shared/midi-access.js";
import { loadJson, saveJson } from "../../shared/storage.js";
import { DEFAULT_VOLUME, createSampler } from "./controller.js";
import { createExportDialog } from "./export-dialog.js";
import { exportDialogModel } from "./export-dialog-state.js";
import { normalizeExportOptions } from "./export-options.js";
import { canRenderOffline, createExportAction, exportSampleRate, exportSequence, exportStems } from "./export-wav.js";
import { padColorCss } from "./pad-colors.js";
import { createKit } from "./kit.js";
import { pitchToRate } from "./pad-settings.js";
import { createLcd } from "./lcd.js";
import { createPadDrawer, moveKeepingFocus } from "./pad-drawer.js";
import { formatPadTitle, formatSampleInfo, formatStepsHeading, pad2 } from "./format.js";
import { BAR_CHOICES, MAX_BARS, PAD_COUNT, SEQUENCE_COUNT, STEPS, STEP_GROUP } from "./layout.js";
import { createMidi } from "./midi.js";
import { createColorSwatches } from "./color-swatches.js";
import { createPadGrid, padForKeyEvent, padPressAction } from "./pads.js";
import {
  MAX_PROJECT_BYTES,
  REASONS as PROJECT_REASONS,
  collectSamples,
  installProject,
  parseProject,
  projectBlob,
  projectFileName,
} from "./project.js";
import { SAMPLES_KEY, createSamples, isSamplesMap } from "./samples.js";
import { createSampleLoader } from "./sample-loader.js";
import { createSettingsSliders } from "./settings-sliders.js";
import { createTrimView } from "./trim-view.js";
import { SONG_BACKUP_KEY, SONG_KEY, backUpUnusable, createSongSaver, parseSong } from "./song.js";
import { createBlobStore } from "../../shared/blob-store.js";
import { createDisclosure } from "../../shared/disclosure.js";
import { saveBlob } from "../../shared/download.js";
import { createStorageBudget } from "../../shared/storage-budget.js";
import { SOUNDS } from "../../shared/sounds.js";
import { createStepKeys } from "../../shared/step-keys.js";
import { createTempoKnob } from "./tempo-knob.js";
import { createVelocityBars } from "./velocity-bars.js";
import { createVolumeKnob } from "./volume-knob.js";
import { BPM_MAX, BPM_MIN } from "../../shared/tempo.js";

const $ = (id) => document.getElementById(id);
const SAMPLES_BACKUP_KEY = `${SAMPLES_KEY}:backup`;

// Kept samples are decoded at the start of the visit, with an offline context: the real one only exists after the
// first click or key, and until then (or until it had decoded them) the pads would play their built-in sounds.
// A browser without OfflineAudioContext waits for the real one.
const decodesEarly = typeof OfflineAudioContext === "function";
const RESTORE_SAMPLE_RATE = 48000; // a typical output rate; the real context resamples when it plays

const site = createSiteHeader($("site-header"), { current: "sampler" });
enableOffline($("update-notice"));
const header = createAppHeader($("header"), {
  brand: { name: "PAD", accent: "16" },
  sub: "Digital Sampler & Sequencer",
  tools: site.midiTools,
  onPower: () => togglePower(audio),
  actions: [
    { label: "Export", title: "Save the sequence as a WAV file", popup: "dialog", onPress: () => openExport() },
    {
      label: "Save",
      title: "Save the whole beat and its samples as a project file you can open again",
      onPress: () => saveProject(),
    },
    { label: "Open", title: "Open a project file, replacing the beat on the page", onPress: () => openProjectPicker() },
  ],
});

// The Export dialog, built below with the rest of export; the song can change (a MIDI knob) before it exists.
let exportDialog = null;

// ---------- Light show ----------
// A glow on the desk behind the machine: it pulses with the tempo and runs from blue to red with how loud the
// output is. Kept between visits; off by default for a person who asked their system for less motion.
const LIGHTS_KEY = "pad-sampler:lights";
const lightsOnStored = loadJson(LIGHTS_KEY);
const lights = createLightShow($("light-show"), { read: readLights });
const lightsButton = $("lights");
lightsButton.addEventListener("click", () => toggleLights());
let lightLevel = 0;
let lastLightFrame = 0;
let stepSeen = { step: -1, at: 0 };
const LEVEL_WINDOW = 512; // the last samples read for loudness: about 10 ms, quick enough to follow each hit
let timeBuffer = null; // allocated once the analyser exists, at its size
let freqBuffer = null;
const FLASH_FALLBACK = "#fff0d8"; // a pad with no colour of its own bursts warm white

function flashLight(index) {
  if (!lights.isOn) return;
  const color = padColorCss(kit.settings(index).color) ?? FLASH_FALLBACK;
  lights.flash({ ...padGrid.center(index), color });
}

function readLights() {
  const now = performance.now();
  const analyser = audio.running ? audio.analyser : null;
  let heard = 0;
  let bands = { low: 0, high: 0 };
  if (analyser) {
    timeBuffer ??= new Float32Array(analyser.fftSize);
    freqBuffer ??= new Uint8Array(analyser.frequencyBinCount);
    analyser.getFloatTimeDomainData(timeBuffer);
    analyser.getByteFrequencyData(freqBuffer);
    heard = rmsLevel(timeBuffer.subarray(timeBuffer.length - LEVEL_WINDOW));
    bands = bandLevels(freqBuffer, audio.ctx.sampleRate);
  }
  lightLevel = smoothLevel(lightLevel, heard, lastLightFrame ? now - lastLightFrame : 0);
  lastLightFrame = now;
  const state = sampler.getState();
  // The step in the whole sequence: `playheadStep` is only the one on the bar shown (-1 in any other), which would
  // stop the beat from showing while a longer sequence plays through the bars not on screen.
  const step = state.playing ? state.playheadPosition : -1;
  if (step !== stepSeen.step) stepSeen = { step, at: now }; // stopped, the step is -1: a restart is a new step
  const playing = state.playing && audio.running && step >= 0;
  const phase = playing ? beatPhase({ step, sinceStepMs: now - stepSeen.at, bpm: state.bpm }) : 0;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  return {
    level: lightLevel,
    phase,
    playing,
    beat: Math.floor(step / 4),
    bpm: state.bpm,
    timeMs: now,
    still,
    ...bands,
  };
}

function setLights(on) {
  lights.setOn(on);
  lastLightFrame = 0;
  lightLevel = 0; // not the loudness from before it was switched off: the first frame would show it for a second
  setAttr(lightsButton, "aria-pressed", String(on));
}
function toggleLights() {
  setLights(!lights.isOn);
  saveJson(LIGHTS_KEY, lights.isOn);
}

const playBtn = $("play");
const recBtn = $("rec");

// ---------- Saved song ----------
// The pattern, tempo and volume come back on the next visit. This is read first
// because the audio engine takes its starting level from the saved volume.
// With nothing usable saved (first visit, blocked storage), the page starts
// from the starter beat as it always did.
const storedSong = loadJson(SONG_KEY);
const song = parseSong(storedSong, {
  rows: PAD_COUNT,
  steps: STEPS,
  maxBars: MAX_BARS,
  sequenceCount: SEQUENCE_COUNT,
});

// A song this page cannot read (from a newer page, or damaged) is kept under another key before the first edit
// saves over it, and so is a samples map. The page starts from the starter beat and no samples, as before.
backUpUnusable(storedSong, song, SONG_BACKUP_KEY, saveJson);
const storedSamples = loadJson(SAMPLES_KEY);
backUpUnusable(storedSamples, isSamplesMap(storedSamples), SAMPLES_BACKUP_KEY, saveJson);

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
    // Where kept samples cannot be decoded before the first click (see `samples` below), do it then.
    if (state === "running" && !decodesEarly) samples.restore();
    // The export is made at the rate the context runs at, which is known once it exists.
    if (exportDialog?.isOpen) refreshExportDialog();
  },
});
audio.unlockOnInteraction(); // so a Launchpad hit on a return visit isn't silent

// The callbacks below use the views and `midi`, which are built after this. That
// is fine because the sampler reports nothing until something happens.
// What each pad plays: the built-in sound, or a sample loaded onto it (see `samples` below).
const kit = createKit(SOUNDS, {
  settings: song ? song.padSettings : {}, // each pad's gain, pitch, choke group and colour, kept with the song
  onChange(index, what) {
    if (what === "sound") padGrid.setName(index, kit.get(index).name, !kit.isDefault(index));
    if (what === "setting") padGrid.setColor(index, kit.settings(index).color);
    sampler.kitChanged(what); // rebuilds the queued steps for a new sound, saves for a setting (see the controller)
    render(); // the LCD shows the selected pad's sound, and Default Sound is for a pad that has changed
    // An Export dialog that is open says how much memory its render takes, which depends on the sounds (a loaded sample's
    // release adds warm-up passes): the saved samples come back pad by pad after the page opens, and a dialog opened before
    // they have would keep an estimate made from the built-in sounds.
    if (exportDialog?.isOpen) refreshExportDialog();
  },
});

const sampler = createSampler({
  audio,
  kit,
  steps: STEPS,
  maxBars: MAX_BARS,
  sequenceCount: SEQUENCE_COUNT,
  song,
  onChange: render,
  onMessage: say,
  onPadHit(index) {
    padGrid.flash(index);
    flashLight(index);
    midi.padHit(index);
  },
  onPadPlayed(index) {
    padGrid.light(index);
    flashLight(index);
    midi.padHit(index);
  },
  onSongChange() {
    saver.schedule();
    if (exportDialog?.isOpen) refreshExportDialog(); // a tempo knob on a controller can move while it is open
  },
});

// ---------- Project file ----------
// The browser's own storage can be cleared (by the person, or under disk pressure), so the whole beat can also be
// kept as a file (project.js): Save downloads it, Open replaces what is on the page with one. Open writes the project
// where the page keeps its own and starts the page again, which reads it as it does on any visit, so nothing that
// is live (a playing sequence, the sounds on the pads, the undo history) has to be taken apart and put back.
// One Save or Open at a time: two clicks would read the samples twice, and two Opens would write over each other.
let projectBusy = false;
async function withProjectLock(work) {
  if (projectBusy) return;
  projectBusy = true;
  let reloading = false;
  try {
    reloading = await work();
  } finally {
    if (!reloading) projectBusy = false; // a page that is starting again stays busy until it has
  }
}

const saveProject = () =>
  withProjectLock(async () => {
    const { samples: kept } = await collectSamples({ map: loadJson(SAMPLES_KEY), store: blobs, padCount: PAD_COUNT });
    // A pad that plays a sample which is not in the page's storage (it was loaded with storage blocked or full, or
    // the browser cleared the bytes) cannot go in the file: say so rather than let a person think it did.
    const included = new Set(kept.map(({ pad }) => pad));
    const left = Array.from({ length: PAD_COUNT }, (_, pad) => pad).filter(
      (pad) => !kit.isDefault(pad) && !included.has(pad),
    );
    saveBlob(projectBlob({ song: sampler.getSong(), samples: kept }), projectFileName(new Date()));
    say(left.length ? `PROJECT SAVED, ${left.length} SAMPLE${left.length === 1 ? "" : "S"} NOT KEPT` : "PROJECT SAVED");
    return false;
  });

const projectInput = $("project-file");
const openProjectPicker = () => projectInput.click();
const openProject = (file) =>
  withProjectLock(async () => {
    if (file.size > MAX_PROJECT_BYTES) return say(PROJECT_REASONS.tooBig);
    let bytes;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      return say(PROJECT_REASONS.damaged);
    }
    const project = parseProject(bytes, {
      rows: PAD_COUNT,
      steps: STEPS,
      maxBars: MAX_BARS,
      sequenceCount: SEQUENCE_COUNT,
    });
    if (!project.ok) return say(project.reason);
    // Nothing is undoable once the page starts again, so ask first.
    if (!window.confirm("Open this project? The beat and samples on the page now will be replaced.")) return false;
    // The page being replaced writes nothing more of its own: not a waiting song change, nor a sample still loading.
    saver.cancel();
    samples.freeze();
    const kept = await installProject(project, {
      store: blobs,
      readMap: () => loadJson(SAMPLES_KEY),
      writeMap: (map) => saveJson(SAMPLES_KEY, map),
      writeSong: (song) => saveJson(SONG_KEY, song),
      padCount: PAD_COUNT,
    });
    if (!kept) {
      samples.freeze(false);
      say("PROJECT NOT OPENED: STORAGE FULL");
      return false;
    }
    saver.cancel(); // (again: a change made while it was being written would be flushed as the page unloads)
    location.reload();
    return true;
  });
projectInput.addEventListener("change", () => {
  const [file] = projectInput.files;
  projectInput.value = ""; // so the same file can be chosen again
  if (file) openProject(file);
});

// ---------- Views ----------
// A short message goes on the LCD, and, for the eye, in the pad editor too: the LCD is out of sight when the editor
// is under the pads. (Both are declared below; this is only called once the page is running.)
function say(text) {
  lcd.showMessage(text);
  padDrawer.showMessage(text);
}

const lcd = createLcd({
  lines: [$("lcd-1"), $("lcd-2"), $("lcd-3")],
  message: $("lcd-msg"),
  ruler: $("ruler"),
  progress: $("lcd-progress"),
  steps: STEPS,
});

// A press on a pad, by a pointer or a computer key: it plays, or (with Shift) selects the pad and opens the editor.
// A pointer press leaves focus where it is, on the pad; a key opens the editor the way the Edit Pad button does, with
// focus on its heading, since the keyboard has no other way into it from here.
function pressPad(index, modifiers, { viaKey = false } = {}) {
  if (padPressAction(modifiers) === "edit") {
    sampler.selectPad(index);
    if (viaKey) padDrawer.openAndFocus();
    else padDrawer.open();
  } else {
    sampler.triggerPad(index);
  }
}

const padGrid = createPadGrid($("pads"), {
  sounds: SOUNDS,
  onTrigger: pressPad,
});
// The colours saved with the song, on the pads from the start.
for (let index = 0; index < kit.length; index++) padGrid.setColor(index, kit.settings(index).color);

// Samples on the pads: kept in this browser (IndexedDB for the files, localStorage for which pad has which).
const blobs = createBlobStore();
const samples = createSamples({
  kit,
  audio,
  restoreContext: () => (decodesEarly ? new OfflineAudioContext(1, 1, RESTORE_SAMPLE_RATE) : audio.ensure()),
  store: blobs,
  budget: createStorageBudget(),
  readMap: () => loadJson(SAMPLES_KEY),
  writeMap: (map) => saveJson(SAMPLES_KEY, map),
  onMessage: say,
});
// The pad editor: a drawer for the selected pad's sound and settings, opened with Edit Pad and remembered.
const DRAWER_KEY = "pad-sampler:drawer";
const padDrawer = createPadDrawer({
  element: $("pad-drawer"),
  toggle: $("edit-pad"),
  close: $("pad-drawer-close"),
  title: $("pad-drawer-title"),
  info: $("pad-drawer-info"),
  message: $("pad-drawer-msg"),
  onToggle: (open) => saveJson(DRAWER_KEY, open),
});

const colorSwatches = createColorSwatches($("pad-colors"), {
  onChange: (index) => sampler.setPadSetting("color", index),
});
const settingsSliders = createSettingsSliders($("pad-settings"), {
  names: ["gain", "pitch", "choke"],
  onChange: (name, value) => sampler.setPadSetting(name, value),
});
// The envelope of a loaded sample (attack, decay, sustain, release).
const envelopeSliders = createSettingsSliders($("pad-envelope"), {
  names: ["attack", "decay", "sustain", "release"],
  fallbackFocus: $("load-sample"), // where focus goes if they are disabled (a built-in sound came back) while one has it
  onChange: (name, value) => sampler.setPadSetting(name, value),
});
// The waveform and the Start and End of the selected pad's sample, in the pad editor.
const trimView = createTrimView($("pad-trim"), {
  fallbackFocus: $("load-sample"), // where focus goes if the view is hidden (a sample was taken off) while it is in it
  onChange(trim, moved) {
    samples.setTrim(sampler.getState().selected, trim, moved);
    render();
  },
});
const sampleLoader = createSampleLoader({
  pads: $("pads"),
  input: $("sample-file"),
  loadButton: $("load-sample"),
  resetButton: $("reset-sound"),
  getSelected: () => sampler.getState().selected,
  onFile: (index, file) => {
    // The pad it was meant for is the one to show and to hit next, chosen now: loads can finish in any order.
    sampler.selectPad(index);
    return samples.load(index, file);
  },
  onReset: async (index) => {
    await samples.reset(index);
    render(); // Default Sound goes dim, even when the pad was already playing its built-in sound
  },
});
const stepKeys = createStepKeys($("steps"), {
  steps: STEPS,
  group: STEP_GROUP,
  onToggle: (step) => sampler.toggleStep(step),
});
const velocityBars = createVelocityBars($("velocity"), {
  steps: STEPS,
  group: STEP_GROUP,
  onChange: (step, value, options) => sampler.setStepVelocity(step, value, options),
});
const seqPrev = $("seq-prev");
const seqNext = $("seq-next");
const seqNumber = $("seq-number");
seqPrev.addEventListener("click", () => sampler.setSequence(sampler.getState().sequence - 1));
seqNext.addEventListener("click", () => sampler.setSequence(sampler.getState().sequence + 1));
const stepsPrev = $("steps-prev");
const stepsNext = $("steps-next");
const stepsRange = $("steps-range");
const stepsRangeText = $("steps-range-text");
stepsPrev.addEventListener("click", () => sampler.setPage(sampler.getState().page - 1));
stepsNext.addEventListener("click", () => sampler.setPage(sampler.getState().page + 1));

// One button per length, in a joined group, the chosen one pressed in (a dark face: see .seq-lengths in sampler.css).
const barButtons = BAR_CHOICES.map((bars) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-small";
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

const volumeKnob = createVolumeKnob($("vol"), {
  min: 0,
  max: 100,
  getValue: () => sampler.getState().volume,
  onChange: (volume) => sampler.setVolume(volume),
});

// Every view is drawn from the sampler's state, so it cannot disagree with it.
function render() {
  const state = sampler.getState();
  const soundName = kit.get(state.selected).name;
  padGrid.select(state.selected);
  padDrawer.refresh({
    title: formatPadTitle(state.selected, soundName),
    info: formatSampleInfo(kit.get(state.selected).info),
  });
  const sound = kit.get(state.selected);
  // A built-in sound has no waveform. The envelope and the pitch decide the curve drawn on it.
  trimView.refresh(typeof sound.setTrim === "function" ? sound : null, {
    envelope: kit.envelope(state.selected),
    rate: pitchToRate(state.padSettings.pitch),
  });
  settingsSliders.refresh({ settings: state.padSettings, sampleEnabled: !kit.isDefault(state.selected) });
  envelopeSliders.refresh({ settings: state.padSettings, sampleEnabled: !kit.isDefault(state.selected) });
  colorSwatches.refresh({ color: state.padSettings.color });
  // A sample that is kept but could not be restored this visit can still be removed.
  sampleLoader.setResetEnabled(!kit.isDefault(state.selected) || samples.isKept(state.selected));
  setText($("steps-toggle"), formatStepsHeading(soundName));
  stepKeys.refresh({ on: state.stepsOn, soundName, first: state.page * STEPS });
  // Focus on a button that goes disabled moves to a neighbour (see dom-updates.js), so keys keep working.
  setDisabledMany([
    [undoBtn, !state.canUndo, [redoBtn, $("copy")]],
    [redoBtn, !state.canRedo, [undoBtn, $("copy")]],
  ]);
  setAttr(undoBtn, "title", state.canUndo ? "" : "Nothing to undo");
  setAttr(redoBtn, "title", state.canRedo ? "" : "Nothing to redo");
  velocityBars.refresh({
    on: state.stepsOn,
    velocities: state.stepVelocities,
    soundName,
    first: state.page * STEPS, // so the labels name the step of the sequence the keyboard changes
  });
  stepKeys.paintPlayhead(state.playing, state.playheadStep);
  knob.render(state.bpm);
  setText(seqNumber, pad2(state.sequence + 1));
  setDisabledMany([
    [seqPrev, state.sequence === 0, seqNext],
    [seqNext, state.sequence === state.sequenceCount - 1, seqPrev],
  ]);
  for (const { bars, button } of barButtons) setAttr(button, "aria-pressed", String(bars === state.bars));
  setText(stepsRange, `Bar ${state.page + 1} of ${state.bars}`);
  setText(stepsRangeText, `Bar ${state.page + 1}/${state.bars}`);
  setDisabledMany([
    [stepsPrev, state.page === 0, [stepsNext, barButtons[0].button]],
    [stepsNext, state.page === state.bars - 1, [stepsPrev, barButtons[0].button]],
  ]);
  volumeKnob.render(state.volume);
  setAttr(playBtn, "aria-pressed", String(state.playing));
  setAttr(recBtn, "aria-pressed", String(state.recording));
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
$("copy").addEventListener("click", sampler.copySteps);
$("paste").addEventListener("click", sampler.pasteSteps);
const undoBtn = $("undo");
const redoBtn = $("redo");
undoBtn.addEventListener("click", sampler.undo);
redoBtn.addEventListener("click", sampler.redo);
$("tap").addEventListener("click", sampler.tapTempo);
// ---------- Export ----------
// The sequence showing, rendered offline and saved as a WAV file (export-wav.js decides when it may run and what it
// renders). The machine header's Export button opens a dialog for the choices (the mix or a stem for each pad in a zip,
// loops, stereo or mono), which are kept
// between visits; the dialog says how long and how big the file will be, shows how far a long render has got, and
// cancels it. A message goes to the dialog as well as the LCD: the LCD is behind the dialog, and out of reach of a
// screen reader while it is open.
const EXPORT_KEY = "pad-sampler:export";
let exportOptions = normalizeExportOptions(loadJson(EXPORT_KEY));

// While the dialog is open the LCD is behind it and a screen reader cannot reach it, so what is said goes to the dialog;
// the one that matters afterwards (EXPORTED ...) is said on the LCD once the dialog has closed.
let exportMessage = "";
function sayExport(text) {
  exportMessage = text;
  exportDialog.showMessage(text);
  if (!exportDialog.isOpen) say(text);
}

// The rate an export is made at: the one the page's audio runs at, so that what is saved is what is heard (a loaded sample is
// resampled into a context at another rate, and the file's would be a second resampling), or 44.1 kHz before there is audio.
const exportRate = () => exportSampleRate(audio.ctx?.sampleRate);

function refreshExportDialog() {
  exportDialog.refresh(
    exportDialogModel({
      song: sampler.getSong(),
      kit,
      options: exportOptions,
      stepsPerBar: STEPS,
      sampleRate: exportRate(),
      supported: canRenderOffline(),
    }),
  );
}

exportDialog = createExportDialog($("export-dialog"), {
  opener: header.actionButtons[0],
  onChange(options) {
    exportOptions = normalizeExportOptions(options);
    saveJson(EXPORT_KEY, exportOptions);
    exportDialog.setOptions(exportOptions);
    refreshExportDialog();
  },
  // Saved: the dialog's work is done. Anything else (nothing to export, cancelled, failed) stays on it, with what was said.
  async onExport() {
    if (!(await pressExport())) return;
    exportDialog.close();
    say(exportMessage);
  },
  onCancel: () => pressExport(), // pressed again while it works, the action cancels
});
exportDialog.setOptions(exportOptions);

const pressExport = createExportAction({
  snapshot: () => ({ song: sampler.getSong(), options: exportOptions, sampleRate: exportRate() }),
  ready: () => restoring,
  run: ({ signal, onProgress, snapshot }) => {
    const make = snapshot.options.files === "stems" ? exportStems : exportSequence;
    return make({
      song: snapshot.song,
      // Taken here, once the saved samples are back (`ready` has been waited for): a kit snapshot at the press could hold
      // the built-in sound of a pad whose sample is still being restored. Stems are many renders of this one kit and song,
      // which is why both are snapshots: stems made from two states would not add up.
      kit: kit.snapshot(),
      stepsPerBar: STEPS,
      options: snapshot.options,
      sampleRate: snapshot.sampleRate,
      onMessage: sayExport,
      save: saveBlob,
      signal,
      onProgress,
      onStem: (stem) => exportDialog.setStem(stem), // (only the stems say it)
    });
  },
  onMessage: sayExport,
  onProgress: (fraction) => exportDialog.setProgress(fraction),
  onCancel: () => exportDialog.setCancelling(), // a browser that cannot pause the render finishes it first
  onBusy(busy) {
    exportDialog.setBusy(busy);
    if (!busy) refreshExportDialog(); // the song may have moved while it rendered
  },
});

function openExport() {
  refreshExportDialog();
  exportDialog.open();
}

// ---------- Keyboard ----------
window.addEventListener("keydown", (e) => {
  if (exportDialog.isOpen) return; // the dialog has the keys: pads, Space and undo are behind it
  // Ctrl or Cmd + Z undoes, with Shift redoes (Ctrl + Y too, as on Windows).
  if ((e.metaKey || e.ctrlKey) && !e.altKey) {
    const key = e.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    e.preventDefault();
    if (key === "y" || e.shiftKey) sampler.redo();
    else sampler.undo();
    return;
  }
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.code === "Space") {
    if (document.activeElement?.tagName === "BUTTON") return; // let the button click
    e.preventDefault();
    if (sampler.getState().playing) sampler.stop();
    else sampler.start();
    return;
  }

  const index = padForKeyEvent(e);
  if (index >= 0) pressPad(index, { shift: e.shiftKey }, { viaKey: true });
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

// ---------- The step editor can be hidden ----------
// Its heading stays: the keys, the velocity bars and the edit tools go. The bar arrows live with the Bars keys, so they stay. Remembered, and shown by default.
const STEPS_KEY = "pad-sampler:steps";
createDisclosure({
  toggle: $("steps-toggle"),
  regions: [$("step-tools"), $("step-body")],
  open: loadJson(STEPS_KEY, true) !== false,
  onToggle: (open) => saveJson(STEPS_KEY, open),
});

// The pad editor's Tune and Envelope sections can be hidden too, each remembered, and shown by default. The button is
// the section's heading, and what it hides is the sliders.
for (const [toggle, region, key] of [
  ["tune-toggle", "pad-settings", "pad-sampler:tune"],
  ["envelope-toggle", "pad-envelope", "pad-sampler:envelope"],
]) {
  createDisclosure({
    toggle: $(toggle),
    regions: [$(region)],
    open: loadJson(key, true) !== false,
    onToggle: (open) => saveJson(key, open),
  });
}

// ---------- Where the pad editor goes ----------
// Beside the machine when the window is wide enough, otherwise under the pads, where it takes the place the
// Load Sample buttons used to have. The one element is moved, as the display is above. Both together want 1310px
// (the machine's 980, the drawer's 290, a 16px gap and the page's side padding), so from 1180px up the machine
// gives up some width while the drawer is open (850px at the breakpoint; its own layout holds down to 800) and
// takes it back when the drawer closes. Below that the machine keeps its width and the drawer goes under the pads.
const dock = window.matchMedia("(min-width: 1180px)");
function placeDrawer() {
  const home = dock.matches ? document.querySelector(".sampler-stage") : $("pads").closest(".pad-panel");
  moveKeepingFocus($("pad-drawer"), home);
}
placeDrawer();
dock.addEventListener("change", placeDrawer);
if (loadJson(DRAWER_KEY, false) === true) padDrawer.open(); // as it was left

// ---------- Init ----------
// Kept samples back on their pads, before the first click or key. Export waits for it, so it never renders the
// built-in sounds where a saved sample is about to be.
const restoring = decodesEarly ? samples.restore() : Promise.resolve();
sampler.selectPad(0);
setLights(
  typeof lightsOnStored === "boolean"
    ? lightsOnStored
    : !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
);
