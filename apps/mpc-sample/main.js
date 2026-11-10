// MPC Sample companion page: shows what the device's pads and transport are doing (hits,
// velocity, pressure, bank, play/stop, tempo) so you can check it is talking to the browser.
//
// The page makes no sound: the device plays its own samples. Below the pads is a step sequencer that
// follows the device's clock and sends it a note for each step that is on.
//
// This file only wires the pieces together: MIDI in, the state, and the views.

import "../../shared/base.css";
import "../../shared/step-keys.css";
import "./mpc-sample.css";
import { createAppHeader } from "../../shared/app-header.js";
import { enableOffline } from "../../shared/offline.js";
import { createSiteHeader } from "../../shared/site-header.js";
import { createStepKeys } from "../../shared/step-keys.js";
import { createMidiAccess, wireMidiButton } from "../../shared/midi-access.js";
import { createMidiRouter } from "../../shared/midi-devices.js";
import { isMpcSample } from "../../shared/mpc-sample.js";
import { createBankStrip } from "./bank-strip.js";
import { bankLabel, createBoard } from "./board.js";
import { PROFILES, mpcSample } from "./devices.js";
import { createLcd } from "./lcd.js";
import { createPadGrid } from "./pad-grid.js";
import { STARTER_BEAT } from "./starter-beat.js";
import { createSequencer, rowFor, stepCount } from "./sequencer.js";
import { loadJson, saveJson } from "../../shared/storage.js";
import { createTransport, normalizeSequence } from "./transport.js";
import { createTransportLights } from "./transport-lights.js";

const $ = (id) => document.getElementById(id);

const site = createSiteHeader($("site-header"), { current: "mpc-sample" });
enableOffline($("update-notice"));
createAppHeader($("header"), {
  brand: { name: "MPC ", accent: "SAMPLE" },
  sub: "Companion",
  tools: site.midiTools,
});

const SEQUENCE_STORE_KEY = "mpc-sample.sequence";
const barsInput = $("seq-bars");
const beatsInput = $("seq-beats");
const noteSelect = $("seq-note");

// The device does not say how long its sequence is or what its time signature is, so they are
// settings, kept between visits. Anything saved that is not valid falls back to 1 bar of 4/4.
let sequence = normalizeSequence(loadJson(SEQUENCE_STORE_KEY));
function showSequence() {
  barsInput.value = String(sequence.bars);
  beatsInput.value = String(sequence.numerator);
  noteSelect.value = String(sequence.denominator);
}
showSequence();

const board = createBoard();
const transport = createTransport({
  loopBars: sequence.bars,
  numerator: sequence.numerator,
  denominator: sequence.denominator,
});
// The pad whose step keys are shown, in the bank it was picked in.
let selected = { bank: 0, index: 0 };
const grid = createPadGrid($("pads"), {
  onSelect(index) {
    selected = { bank: board.snapshot().bank, index };
    drawSteps();
    schedule();
  },
});
const strip = createBankStrip($("banks"));
const playLamp = $("lamp-play");
const stopLamp = $("lamp-stop");
const lights = createTransportLights({ play: playLamp, stop: stopLamp });
const lcd = createLcd([$("lcd-status"), $("lcd-pad"), $("lcd-vel"), $("lcd-transport")]);

let connected = false; // is an MPC Sample among the MIDI inputs?
let output = null; // its MIDI output port, for the notes the step keys send
function draw() {
  const snapshot = board.snapshot();
  const transportState = transport.snapshot();
  grid.render({ ...snapshot, selected: selected.bank === snapshot.bank ? selected.index : -1 });
  strip.render(snapshot);
  lights.render(transportState);
  lcd.render({ connected, last: snapshot.last, transport: transportState });
}

// Pressure and clock arrive in floods, so draw at most once a frame.
let frame = 0;
function schedule() {
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

function applyToBoard(event) {
  board.apply(event);
  schedule();
}

function applyToTransport(event) {
  transport.apply(event);
  schedule();
}

// The step sequencer sends the device notes on the same beat grid as the clock above. Its times are
// in the clock's domain, performance.now() / 1000, which is also what Web MIDI timestamps use.
const sequencer = createSequencer({
  clock: { now: () => performance.now() / 1000 },
  send: (bytes, time) => output?.send(bytes, time),
  clear: () => output?.clear?.(),
  messages: mpcSample.messages,
  steps: stepCount(sequence),
  bpm: sequence.bpm,
  pattern: STARTER_BEAT,
});

// The step keys show 16 steps at a time, so a longer sequence is shown a page of them at a time.
const STEPS_PER_PAGE = 16;
let stepPage = 0;
const stepKeys = createStepKeys($("seq-steps"), {
  steps: STEPS_PER_PAGE,
  onToggle(key) {
    sequencer.toggle(rowFor(selected.bank, selected.index), stepPage * STEPS_PER_PAGE + key);
    drawSteps();
  },
});
const stepsPrev = $("seq-prev");
const stepsNext = $("seq-next");

const lastPage = () => Math.ceil(sequencer.steps / STEPS_PER_PAGE) - 1;

function drawSteps() {
  const first = stepPage * STEPS_PER_PAGE;
  const row = rowFor(selected.bank, selected.index);
  const on = Array.from({ length: STEPS_PER_PAGE }, (_, key) =>
    first + key < sequencer.steps ? sequencer.isOn(row, first + key) : undefined,
  );
  const pad = `Pad ${selected.index + 1}, bank ${bankLabel(selected.bank)}`;
  stepKeys.refresh({ on, soundName: pad, first });
  $("seq-title").textContent = `Step keys \u00b7 ${pad}`;
  $("seq-range").textContent =
    `Steps ${first + 1}-${Math.min(first + STEPS_PER_PAGE, sequencer.steps)} of ${sequencer.steps}`;
  stepsPrev.disabled = stepPage === 0;
  stepsNext.disabled = first + STEPS_PER_PAGE >= sequencer.steps;
  drawPlayhead();
}

function drawPlayhead() {
  stepKeys.paintPlayhead(sequencer.playing, sequencer.playheadStep - stepPage * STEPS_PER_PAGE);
}

// The playhead follows the clock, so it is painted every animation frame while playing.
let painting = false;
function paintLoop() {
  if (!sequencer.playing) {
    painting = false;
    drawSteps();
    return;
  }
  if (sequencer.poll()) drawPlayhead();
  requestAnimationFrame(paintLoop);
}
function startPaintLoop() {
  if (painting) return;
  painting = true;
  requestAnimationFrame(paintLoop);
}

stepsPrev.addEventListener("click", () => {
  stepPage = Math.max(0, stepPage - 1);
  drawSteps();
});
stepsNext.addEventListener("click", () => {
  stepPage = Math.min(lastPage(), stepPage + 1);
  drawSteps();
});
$("seq-clear-pad").addEventListener("click", () => {
  sequencer.clearRow(rowFor(selected.bank, selected.index));
  drawSteps();
});
$("seq-clear-all").addEventListener("click", () => {
  sequencer.clearAll();
  drawSteps();
});

// The device is the clock: its Start, Continue and ticks drive the steps (followDevice below). The page
// sends no clock of its own, because the device distorted while following it (docs/mpc-sample.md).
function stopPlayback() {
  sequencer.stop();
  drawSteps();
}

// A Start comes from the device's own Play button, so the pattern follows the clock it then sends.
// A Continue resumes where the device was: at the song position it reports (which can arrive before or
// after the Continue), or else where the pattern stopped.
let reportedPosition = null;
function followDevice(from) {
  if (!sequencer.follow(from)) return;
  if (reportedPosition !== null) sequencer.seek(reportedPosition);
  reportedPosition = null;
  site.log("Following the device's clock");
  startPaintLoop();
  drawSteps();
}

window.addEventListener("pagehide", stopPlayback);

// A field left empty or out of range goes back to the last good value instead of being used.
function changeSequence() {
  sequence = normalizeSequence(
    {
      bars: Number(barsInput.value),
      numerator: Number(beatsInput.value),
      denominator: Number(noteSelect.value),
    },
    sequence,
  );
  showSequence();
  transport.setLoopBars(sequence.bars);
  transport.setSignature(sequence.numerator, sequence.denominator);
  sequencer.setSteps(stepCount(sequence));
  stepPage = Math.min(stepPage, lastPage());
  saveJson(SEQUENCE_STORE_KEY, sequence);
  drawSteps();
  schedule();
}
for (const control of [barsInput, beatsInput, noteSelect]) control.addEventListener("change", changeSequence);

// The clock ends when the device stops, so now and then ask whether it went quiet. If it did, the steps
// stop with it.
const STALE_CHECK_MS = 250;
setInterval(() => {
  if (!transport.expire(performance.now())) return;
  stopPlayback();
  schedule();
}, STALE_CHECK_MS);

const handlers = {
  padDown: applyToBoard,
  padUp: applyToBoard,
  padPressure: applyToBoard,
  transportStart: (event) => {
    reportedPosition = null; // a Start begins at 0, whatever was reported before
    applyToTransport(event);
    followDevice();
  },
  transportContinue: (event) => {
    applyToTransport(event);
    followDevice("continue");
  },
  songPosition: (event) => {
    applyToTransport(event);
    if (sequencer.following) sequencer.seek(event.position);
    else reportedPosition = event.position;
  },
  // However it stopped (a button on the device, or its clock running out), the ticks end too.
  transportStop: (event) => {
    stopPlayback();
    applyToTransport(event);
  },
  // The tick's own arrival time, not when this runs, so a busy page does not skew the tempo.
  clock: (event, _input, time) => {
    applyToTransport({ ...event, time });
    // The page's tempo and bars run from ticks alone, so follow them too if no Start was heard (it can
    // come before the page is listening). Step 0 then lands on the first tick heard, not the device's bar.
    if (transport.snapshot().state === "playing") followDevice();
    // The device's own clock (started from its Play button) steps the pattern.
    sequencer.tick(time, transport.snapshot().bpm ?? sequencer.bpm);
  },
};

wireMidiButton(
  site.midiButton,
  createMidiAccess({
    onMessage: createMidiRouter(PROFILES, handlers),
    onStatus: site.setMidiStatus,
    onLog: site.log,
    onChange(access, inputs) {
      const wasConnected = connected;
      connected = inputs.some((input) => isMpcSample(input.name));
      // An unplugged device cannot send the release or the Stop it owed us.
      if (wasConnected && !connected) {
        board.releaseAll();
        transport.reset();
      }
      const next = [...access.outputs.values()].find((p) => p.state !== "disconnected" && isMpcSample(p.name)) ?? null;
      // Stop while the old port is still the output, so the pad-offs reach it when MIDI was only switched off (its port
      // is still there). An unplugged port is already gone from the browser's list and cannot take them.
      const stopFirst = !next && output?.state !== "disconnected";
      if (stopFirst) stopPlayback();
      output = next;
      if (!output && !stopFirst) stopPlayback();
      schedule();
    },
  }),
);

draw();
drawSteps();
