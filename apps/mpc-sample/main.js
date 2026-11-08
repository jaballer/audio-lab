// MPC Sample companion page: shows what the device's pads and transport are doing (hits,
// velocity, pressure, bank, play/stop, tempo) so you can check it is talking to the browser,
// and has Play and Stop buttons that ask the device to start or stop.
//
// The pads also play the sampler's 16 sounds through the browser, so they can be tried without
// a sampler or a synth plugged in; the Sound button turns that off (the device has its own
// sound, which would double up).
//
// This file only wires the pieces together: MIDI in and out, the state, and the views.

import "../../shared/base.css";
import "./mpc-sample.css";
import { createAppHeader } from "../../shared/app-header.js";
import { createAudioEngine } from "../../shared/audio.js";
import { createMidiAccess, wireMidiButton } from "../../shared/midi-access.js";
import { createMidiRouter } from "../../shared/midi-devices.js";
import { isMpcSample } from "../../shared/mpc-sample.js";
import { createBankStrip } from "./bank-strip.js";
import { createBoard } from "./board.js";
import { PROFILES, mpcSample } from "./devices.js";
import { createLcd } from "./lcd.js";
import { createPadGrid } from "./pad-grid.js";
import { SOUNDS, playSound } from "../../shared/sounds.js";
import { loadJson, saveJson } from "../../shared/storage.js";
import { createTransport, normalizeSequence, toggleAction } from "./transport.js";
import { createTransportLights } from "./transport-lights.js";

const $ = (id) => document.getElementById(id);

const header = createAppHeader($("header"), {
  brand: { name: "MPC ", accent: "SAMPLE" },
  sub: "Companion",
  back: { href: "./", label: "Sampler" },
});

const SOUND_VOLUME = 0.8; // the sampler's default volume
const MIDI_VELOCITY_MAX = 127;

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

// The page may be opened with the device already plugged in, and a MIDI hit does not count as
// the click a browser needs before it lets audio start, so unlock on the first click or key.
const audio = createAudioEngine({ volume: SOUND_VOLUME });
audio.unlockOnInteraction();

const SOUND_STORE_KEY = "mpc-sample.sound";
const soundButton = $("sound-btn");
let soundOn = loadJson(SOUND_STORE_KEY) !== false; // on unless it was turned off
function showSound() {
  soundButton.setAttribute("aria-pressed", String(soundOn));
  soundButton.textContent = soundOn ? "On" : "Off";
}
showSound();
soundButton.addEventListener("click", () => {
  soundOn = !soundOn;
  showSound();
  saveJson(SOUND_STORE_KEY, soundOn);
});

const board = createBoard();
const transport = createTransport({
  loopBars: sequence.bars,
  numerator: sequence.numerator,
  denominator: sequence.denominator,
});
const grid = createPadGrid($("pads"));
const strip = createBankStrip($("banks"));
const lights = createTransportLights({ play: $("lamp-play"), stop: $("lamp-stop") });
const lcd = createLcd([$("lcd-status"), $("lcd-pad"), $("lcd-vel"), $("lcd-transport")]);
const playButton = $("play-btn");
const stopButton = $("stop-btn");

let connected = false; // is an MPC Sample among the MIDI inputs?
let output = null; // its MIDI output port, for the Play and Stop buttons

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

// The lamps follow what the device reports, not these buttons, so the page never claims a
// state the device did not confirm.
function send(message) {
  output?.send(message);
}
playButton.addEventListener("click", () => send(mpcSample.messages.play));
stopButton.addEventListener("click", () => send(mpcSample.messages.stop));

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

// Space plays or stops, as on the sampler page. A focused button or field keeps its own Space.
window.addEventListener("keydown", (event) => {
  const inControl = event.target instanceof Element && event.target.closest("button, a, input, select, textarea");
  if (event.code !== "Space" || event.repeat || inControl) return;
  event.preventDefault();
  send(mpcSample.messages[toggleAction(transport.snapshot().state)]);
});

// The clock ends when the device stops, so now and then ask whether it went quiet. This only
// redraws; nothing is scheduled by it.
const STALE_CHECK_MS = 250;
setInterval(() => {
  if (transport.expire(performance.now())) schedule();
}, STALE_CHECK_MS);

// Every bank plays the same 16 sounds: a pad is the same pad whichever bank it is in.
function playPad(event) {
  applyToBoard(event);
  if (soundOn) playSound(audio, SOUNDS[event.index], event.velocity / MIDI_VELOCITY_MAX);
}

const handlers = {
  padDown: playPad,
  padUp: applyToBoard,
  padPressure: applyToBoard,
  transportStart: applyToTransport,
  transportContinue: applyToTransport,
  songPosition: applyToTransport,
  transportStop: applyToTransport,
  // The tick's own arrival time, not when this runs, so a busy page does not skew the tempo.
  clock: (event, _input, time) => applyToTransport({ ...event, time }),
};

wireMidiButton(
  header.midiButton,
  createMidiAccess({
    onMessage: createMidiRouter(PROFILES, handlers),
    onStatus: header.setMidiStatus,
    onChange(access, inputs) {
      const wasConnected = connected;
      connected = inputs.some((input) => isMpcSample(input.name));
      // An unplugged device cannot send the release or the Stop it owed us.
      if (wasConnected && !connected) {
        board.releaseAll();
        transport.reset();
      }
      output = [...access.outputs.values()].find((p) => p.state !== "disconnected" && isMpcSample(p.name)) ?? null;
      playButton.disabled = stopButton.disabled = !output;
      schedule();
    },
  }),
);

draw();
