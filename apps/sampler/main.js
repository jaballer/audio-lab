// The pad sampler and step sequencer. This file only wires the pieces together:
// the sampler (state and actions, controller.js), the views (pads, steps, LCD,
// tempo knob) and the inputs (mouse, computer keyboard, MIDI).

import "../../shared/base.css";
import "../../shared/step-keys.css";
import "./sampler.css";
import { createAudioEngine } from "../../shared/audio.js";
import { createAudioNotice } from "../../shared/audio-notice.js";
import { setAttr, setDisabledMany, setText } from "../../shared/dom-updates.js";
import { togglePower } from "../../shared/power.js";
import { createAppHeader } from "../../shared/app-header.js";
import { createSiteHeader } from "../../shared/site-header.js";
import { wireMidiButton } from "../../shared/midi-access.js";
import { loadJson, saveJson } from "../../shared/storage.js";
import { DEFAULT_VOLUME, createSampler } from "./controller.js";
import { createExportAction, exportSequence } from "./export-wav.js";
import { createKit } from "./kit.js";
import { pitchToRate } from "./pad-settings.js";
import { createLcd } from "./lcd.js";
import { createPadDrawer, moveKeepingFocus } from "./pad-drawer.js";
import { formatPadTitle, formatSampleInfo, pad2 } from "./format.js";
import { BAR_CHOICES, MAX_BARS, PAD_COUNT, SEQUENCE_COUNT, STEPS, STEP_GROUP } from "./layout.js";
import { createMidi } from "./midi.js";
import { createColorSwatches } from "./color-swatches.js";
import { createPadGrid, padForKey, padPressAction } from "./pads.js";
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
import { BPM_MAX, BPM_MIN } from "../../shared/tempo.js";

const $ = (id) => document.getElementById(id);
const SAMPLES_BACKUP_KEY = `${SAMPLES_KEY}:backup`;

// Kept samples are decoded at the start of the visit, with an offline context: the real one only exists after the
// first click or key, and until then (or until it had decoded them) the pads would play their built-in sounds.
// A browser without OfflineAudioContext waits for the real one.
const decodesEarly = typeof OfflineAudioContext === "function";
const RESTORE_SAMPLE_RATE = 48000; // a typical output rate; the real context resamples when it plays

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
    midi.padHit(index);
  },
  onPadPlayed(index) {
    padGrid.light(index);
    midi.padHit(index);
  },
  onSongChange: () => saver.schedule(),
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
  steps: STEPS,
});

const padGrid = createPadGrid($("pads"), {
  sounds: SOUNDS,
  onTrigger(index, modifiers) {
    if (padPressAction(modifiers) === "edit") {
      sampler.selectPad(index);
      padDrawer.open(); // opened by code, so focus stays on the pad
    } else {
      sampler.triggerPad(index);
    }
  },
});
// The colours saved with the song, on the pads from the start.
for (let index = 0; index < kit.length; index++) padGrid.setColor(index, kit.settings(index).color);

// Samples on the pads: kept in this browser (IndexedDB for the files, localStorage for which pad has which).
const samples = createSamples({
  kit,
  audio,
  restoreContext: () => (decodesEarly ? new OfflineAudioContext(1, 1, RESTORE_SAMPLE_RATE) : audio.ensure()),
  store: createBlobStore(),
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
  onChange: (step, value) => sampler.setStepVelocity(step, value),
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
  setDisabledMany([
    [stepsPrev, state.page === 0, [stepsNext, barButtons[0].button]],
    [stepsNext, state.page === state.bars - 1, [stepsPrev, barButtons[0].button]],
  ]);
  if (volInput.value !== String(state.volume)) volInput.value = String(state.volume);
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
// Export WAV: the sequence showing, rendered offline and saved as a file (export-wav.js decides when it may run).
const exportBtn = $("export");
exportBtn.addEventListener(
  "click",
  createExportAction({
    ready: () => restoring,
    run: () => exportSequence({ song: sampler.getSong(), kit, stepsPerBar: STEPS, onMessage: say, save: saveBlob }),
    onMessage: say,
    onBusy(busy) {
      setText(exportBtn, busy ? "Exporting…" : "Export WAV");
      setAttr(exportBtn, "aria-busy", String(busy));
    },
  }),
);
volInput.addEventListener("input", () => sampler.setVolume(Number(volInput.value)));

// ---------- Keyboard ----------
window.addEventListener("keydown", (e) => {
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

// ---------- Reading order ----------
// Side by side the pads come first (left), in one column the display does (top). Keyboard and
// screen-reader order follow the document, not CSS `order`, so the markup is moved to match.
// 800px is the same breakpoint as in sampler.css.
const narrow = window.matchMedia("(max-width: 800px)");
function placeConsole() {
  const body = $("pads").closest(".body");
  const consolePanel = body.querySelector(".console");
  if (narrow.matches) body.prepend(consolePanel);
  else body.append(consolePanel);
}
placeConsole();
narrow.addEventListener("change", placeConsole);

// ---------- The step editor can be hidden ----------
// Its heading stays: the keys, the velocity bars, the bar arrows and the edit tools go. Remembered, and shown by default.
const STEPS_KEY = "pad-sampler:steps";
createDisclosure({
  toggle: $("steps-toggle"),
  regions: [$("step-tools"), $("step-nav"), $("step-body")],
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
