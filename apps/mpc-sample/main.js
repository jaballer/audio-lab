// MPC Sample companion page: shows what the device's pads and transport are doing (hits,
// velocity, pressure, bank, play/stop, tempo) so you can check it is talking to the browser.
//
// The pads also play the sampler's 16 sounds through the browser, so they can be tried without
// a sampler or a synth plugged in.
//
// This file only wires the pieces together: MIDI in, the state, and the views.

import "../../shared/base.css";
import "./mpc-sample.css";
import { createAppHeader } from "../../shared/app-header.js";
import { createSiteHeader } from "../../shared/site-header.js";
import { createAudioEngine } from "../../shared/audio.js";
import { createAudioNotice } from "../../shared/audio-notice.js";
import { createMidiAccess, wireMidiButton } from "../../shared/midi-access.js";
import { createMidiRouter } from "../../shared/midi-devices.js";
import { isMpcSample } from "../../shared/mpc-sample.js";
import { createBankStrip } from "./bank-strip.js";
import { CLOCK_TICK_MS, DEFAULT_BPM, createClockMaster } from "./clock-master.js";
import { createBoard } from "./board.js";
import { PROFILES, mpcSample } from "./devices.js";
import { createLcd } from "./lcd.js";
import { createPadGrid } from "./pad-grid.js";
import { createPadSound } from "./pad-sound.js";
import { SOUNDS } from "../../shared/sounds.js";
import { loadJson, saveJson } from "../../shared/storage.js";
import { createTransport, normalizeSequence } from "./transport.js";
import { createTransportLights } from "./transport-lights.js";

const $ = (id) => document.getElementById(id);

const site = createSiteHeader($("site-header"), { current: "mpc-sample" });
createAppHeader($("header"), {
  brand: { name: "MPC ", accent: "SAMPLE" },
  sub: "Companion",
});

const SOUND_VOLUME = 0.8; // the sampler's default volume

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

const audioNotice = createAudioNotice($("audio-notice"));
// The page may be opened with the device already plugged in, and a MIDI hit does not count as
// the click a browser needs before it lets audio start, so unlock on the first click or key.
const audio = createAudioEngine({
  volume: SOUND_VOLUME,
  onStateChange: (state) => audioNotice.update(state),
});
audio.unlockOnInteraction();

const board = createBoard();
const transport = createTransport({
  loopBars: sequence.bars,
  numerator: sequence.numerator,
  denominator: sequence.denominator,
});
const grid = createPadGrid($("pads"));
const strip = createBankStrip($("banks"));
const playLamp = $("lamp-play");
const stopLamp = $("lamp-stop");
const lights = createTransportLights({ play: playLamp, stop: stopLamp });
const lcd = createLcd([$("lcd-status"), $("lcd-pad"), $("lcd-vel"), $("lcd-transport")]);

let connected = false; // is an MPC Sample among the MIDI inputs?
let output = null; // its MIDI output port, for the Play and Stop lamps
// The device only plays while it is sent clock (see clock-master.js), so Play starts one.
const clockMaster = createClockMaster({
  send: (bytes, time) => output?.send(bytes, time),
  clear: () => output?.clear?.(),
  startMessage: mpcSample.messages.play,
});

function draw() {
  const snapshot = board.snapshot();
  const transportState = transport.snapshot();
  grid.render(snapshot);
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

// The timer runs only while the page is sending clock, so an idle page wakes nothing.
let clockTimer = null;
function startClock(bpm) {
  clockMaster.start(bpm, performance.now());
  clockTimer ??= setInterval(() => clockMaster.tick(performance.now()), CLOCK_TICK_MS);
}
function haltClock() {
  clockMaster.halt();
  clearInterval(clockTimer);
  clockTimer = null;
}

// The lamps follow what the device reports, not these clicks, so the page never claims a
// state the device did not confirm.
// A device already playing (started from its own button) or already being started from here is
// left alone: a second Start would restart it. The tempo is the one the device was heard at,
// else the one the page last sent (the device forgets its own tempo when it echoes our Start).
playLamp.addEventListener("click", () => {
  const { state, bpm } = transport.snapshot();
  if (!output || state === "playing" || clockMaster.running) return;
  startClock(bpm ?? clockMaster.lastBpm ?? DEFAULT_BPM);
});
stopLamp.addEventListener("click", () => {
  haltClock();
  output?.send(mpcSample.messages.stop);
});

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
  saveJson(SEQUENCE_STORE_KEY, sequence);
  schedule();
}
for (const control of [barsInput, beatsInput, noteSelect]) control.addEventListener("change", changeSequence);

// The clock ends when the device stops, so now and then ask whether it went quiet. If it did,
// the clock this page sends ends too, or a later Play would start over a stream still running.
const STALE_CHECK_MS = 250;
setInterval(() => {
  if (!transport.expire(performance.now())) return;
  haltClock();
  schedule();
}, STALE_CHECK_MS);

const padSound = createPadSound({ audio, sounds: SOUNDS });
function playPad(event) {
  applyToBoard(event);
  // A hit while audio is still locked is dropped (see pad-sound.js): point at the notice.
  if (!padSound.hit(event) && !audio.running) audioNotice.nudge();
}

const handlers = {
  padDown: playPad,
  padUp: applyToBoard,
  padPressure: applyToBoard,
  transportStart: applyToTransport,
  transportContinue: applyToTransport,
  songPosition: applyToTransport,
  // However it stopped (a button on the device, or its clock running out), the ticks end too.
  transportStop: (event) => {
    haltClock();
    applyToTransport(event);
  },
  // The tick's own arrival time, not when this runs, so a busy page does not skew the tempo.
  clock: (event, _input, time) => applyToTransport({ ...event, time }),
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
      output = [...access.outputs.values()].find((p) => p.state !== "disconnected" && isMpcSample(p.name)) ?? null;
      playLamp.disabled = stopLamp.disabled = !output;
      if (!output) haltClock();
      schedule();
    },
  }),
);

draw();
