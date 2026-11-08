// MPC Sample companion page: shows what the device's pads are doing (hits, velocity,
// pressure, bank) so you can check it is talking to the browser.
//
// This file only wires the pieces together: MIDI in, the board, and the views.

import "../../shared/base.css";
import "./mpc-sample.css";
import { createAppHeader } from "../../shared/app-header.js";
import { createMidiAccess, wireMidiButton } from "../../shared/midi-access.js";
import { createMidiRouter } from "../../shared/midi-devices.js";
import { isMpcSample } from "../../shared/mpc-sample.js";
import { createBankStrip } from "./bank-strip.js";
import { createBoard } from "./board.js";
import { PROFILES } from "./devices.js";
import { createLcd } from "./lcd.js";
import { createPadGrid } from "./pad-grid.js";

const $ = (id) => document.getElementById(id);

const header = createAppHeader($("header"), {
  brand: { name: "MPC ", accent: "SAMPLE" },
  sub: "Companion",
  back: { href: "./", label: "Sampler" },
});

const board = createBoard();
const grid = createPadGrid($("pads"));
const strip = createBankStrip($("banks"));
const lcd = createLcd([$("lcd-status"), $("lcd-pad"), $("lcd-vel")]);

let connected = false; // is an MPC Sample among the MIDI inputs?

function draw() {
  const snapshot = board.snapshot();
  grid.render(snapshot);
  strip.render(snapshot);
  lcd.render({ connected, last: snapshot.last });
}

// Pressure arrives in floods while a pad is held, so draw at most once a frame.
let frame = 0;
function schedule() {
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

function apply(event) {
  board.apply(event);
  schedule();
}

wireMidiButton(
  header.midiButton,
  createMidiAccess({
    onMessage: createMidiRouter(PROFILES, { padDown: apply, padUp: apply, padPressure: apply }),
    onStatus: header.setMidiStatus,
    onChange(_access, inputs) {
      const wasConnected = connected;
      connected = inputs.some((input) => isMpcSample(input.name));
      if (wasConnected && !connected) board.releaseAll();
      schedule();
    },
  }),
);

draw();
