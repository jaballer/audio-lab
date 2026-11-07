import "../../shared/base.css";
import "./sampler.css";
import { createAudioEngine } from "../../shared/audio.js";
import { wireMidiButton } from "../../shared/midi-access.js";
import { SOUNDS } from "./sounds.js";
import { createMidi } from "./midi.js";

const STEPS = 16;
const PAD_COUNT = SOUNDS.length; // 16 pads in a 4x4 grid
const BPM_MIN = 40;
const BPM_MAX = 240;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;

// Keyboard rows mirror the pad grid: top row of keys = top row of pads.
const KEY_ROWS = ["1234", "qwer", "asdf", "zxcv"];

const $ = (id) => document.getElementById(id);

// ---------- State ----------
let selected = 0;
let bpm = 100;
let playing = false;
let recording = false;
let timer = null;
let nextStep = 0;
let nextTime = 0;
let playheadStep = -1;
let playheadTime = 0;
const visualQueue = [];

const pattern = SOUNDS.map(() => new Array(STEPS).fill(false));
// Starter beat so Play makes noise right away.
[0, 4, 8, 12].forEach((i) => (pattern[0][i] = true)); // kick
[4, 12].forEach((i) => (pattern[1][i] = true)); // snare
[0, 2, 4, 6, 8, 10, 12, 14].forEach((i) => (pattern[2][i] = true)); // closed hat

// ---------- Elements ----------
const lcd1 = $("lcd-1");
const lcd2 = $("lcd-2");
const lcd3 = $("lcd-3");
const lcdMsg = $("lcd-msg");
const rulerEl = $("ruler");
const padsEl = $("pads");
const stepsEl = $("steps");
const knob = $("knob");
const volInput = $("vol");
const playBtn = $("play");
const recBtn = $("rec");

const pad2 = (n) => String(n).padStart(2, "0");

// ---------- Audio ----------
const audio = createAudioEngine({ volume: Number(volInput.value) / 100 });
audio.unlockOnInteraction(); // so a Launchpad hit on a return visit isn't silent

// ---------- LCD ----------
const rulerCells = [];
for (let i = 0; i < STEPS; i++) {
  const c = document.createElement("span");
  rulerEl.appendChild(c);
  rulerCells.push(c);
}

let msgTimer = null;
function setMessage(text) {
  lcdMsg.textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => (lcdMsg.textContent = ""), 1600);
}

function renderLcd() {
  const state = playing ? "PLAYING" : "STOPPED";
  lcd1.textContent = `SEQ 01  ${state}${recording ? "  REC" : ""}`;
  lcd2.textContent = `PAD ${pad2(selected + 1)}  ${SOUNDS[selected].name}`;
  const stepLabel = playheadStep >= 0 && playing ? pad2(playheadStep + 1) : "--";
  lcd3.textContent = `BPM ${bpm.toFixed(1)}  STEP ${stepLabel}/${STEPS}`;
  rulerCells.forEach((c, i) => {
    c.classList.toggle("on", pattern[selected][i]);
    c.classList.toggle("now", playing && i === playheadStep);
  });
  midi.refresh();
}

// ---------- Pads ----------
const padEls = [];

for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 4; c++) {
    const idx = (3 - r) * 4 + c; // pad 1 sits bottom-left
    const key = KEY_ROWS[r][c];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pad";
    btn.setAttribute("aria-label", `Pad ${idx + 1}, ${SOUNDS[idx].name}, key ${key.toUpperCase()}`);
    btn.innerHTML =
      `<span class="num">${idx + 1}</span>` +
      `<span class="key">${key}</span>` +
      `<span class="name">${SOUNDS[idx].name}</span>`;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      triggerPad(idx);
    });
    // Keyboard activation (Enter/Space on a focused pad) fires click with detail 0.
    btn.addEventListener("click", (e) => {
      if (e.detail === 0) triggerPad(idx);
    });
    padsEl.appendChild(btn);
    padEls[idx] = btn;
  }
}

function flash(idx) {
  const el = padEls[idx];
  el.classList.add("hit");
  setTimeout(() => el.classList.remove("hit"), 110);
}

function selectPad(idx) {
  selected = idx;
  padEls.forEach((el, i) => el.classList.toggle("selected", i === idx));
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
  flash(idx);
  midi.padHit(idx);
  if (recording && playing) recordHit(idx);
  selectPad(idx);
}

// Live recording: quantize the hit to the nearest 16th step.
function recordHit(idx) {
  const stepDur = 60 / bpm / 4;
  const sincePlayhead = audio.ctx.currentTime - playheadTime;
  const step = sincePlayhead > stepDur / 2 ? (playheadStep + 1) % STEPS : playheadStep;
  if (step >= 0) pattern[idx][step] = true;
}

// ---------- Step keys ----------
const stepCells = [];

let group = null;
for (let i = 0; i < STEPS; i++) {
  if (i % 4 === 0) {
    group = document.createElement("div");
    group.className = "step-group";
    stepsEl.appendChild(group);
  }
  const cell = document.createElement("div");
  cell.className = "cell";
  const led = document.createElement("span");
  led.className = "led";
  led.setAttribute("aria-hidden", "true");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "step";
  btn.textContent = String(i + 1);
  btn.addEventListener("click", () => toggleStep(i));
  cell.append(led, btn);
  group.appendChild(cell);
  stepCells.push({ cell, btn });
}

function toggleStep(i) {
  pattern[selected][i] = !pattern[selected][i];
  refreshSteps();
  renderLcd();
}

function refreshSteps() {
  stepCells.forEach(({ cell, btn }, i) => {
    const on = pattern[selected][i];
    cell.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", `${SOUNDS[selected].name} step ${i + 1}${on ? ", on" : ", off"}`);
  });
}

function paintPlayheadCells() {
  stepCells.forEach(({ cell }, i) => cell.classList.toggle("now", playing && i === playheadStep));
}

// ---------- Transport ----------
function scheduler() {
  const { ctx, master } = audio;
  while (nextTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
    SOUNDS.forEach((s, row) => {
      if (pattern[row][nextStep]) s.play(ctx, master, nextTime);
    });
    visualQueue.push({ step: nextStep, time: nextTime });
    nextTime += 60 / bpm / 4; // 16th notes
    nextStep = (nextStep + 1) % STEPS;
  }
}

function paintLoop() {
  if (!playing) return;
  let moved = false;
  while (visualQueue.length && visualQueue[0].time <= audio.ctx.currentTime) {
    const { step, time } = visualQueue.shift();
    playheadStep = step;
    playheadTime = time;
    moved = true;
  }
  if (moved) {
    paintPlayheadCells();
    renderLcd();
  }
  requestAnimationFrame(paintLoop);
}

function start() {
  if (playing) return;
  const ctx = audio.ensure();
  playing = true;
  nextStep = 0;
  nextTime = ctx.currentTime + 0.05;
  playheadStep = -1;
  timer = setInterval(scheduler, LOOKAHEAD_MS);
  playBtn.setAttribute("aria-pressed", "true");
  requestAnimationFrame(paintLoop);
  renderLcd();
}

function stop() {
  playing = false;
  clearInterval(timer);
  visualQueue.length = 0;
  playheadStep = -1;
  playBtn.setAttribute("aria-pressed", "false");
  paintPlayheadCells();
  renderLcd();
}

playBtn.addEventListener("click", start);
$("stop").addEventListener("click", stop);

function toggleRec() {
  recording = !recording;
  recBtn.setAttribute("aria-pressed", String(recording));
  setMessage(recording ? (playing ? "REC ON - HIT PADS" : "REC ARMED - PRESS PLAY") : "REC OFF");
  renderLcd();
}

function clearPad() {
  pattern[selected].fill(false);
  refreshSteps();
  setMessage(`PAD ${pad2(selected + 1)} CLEARED`);
  renderLcd();
}

function clearAll() {
  pattern.forEach((row) => row.fill(false));
  refreshSteps();
  setMessage("ALL PADS CLEARED");
  renderLcd();
}

recBtn.addEventListener("click", toggleRec);
$("clear").addEventListener("click", clearPad);
$("clear-all").addEventListener("click", clearAll);

// ---------- Tempo knob ----------
function setBpm(value) {
  bpm = Math.round(Math.min(BPM_MAX, Math.max(BPM_MIN, value)) * 10) / 10;
  const angle = ((bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * 270 - 135;
  knob.style.transform = `rotate(${angle}deg)`;
  knob.setAttribute("aria-valuenow", String(Math.round(bpm)));
  knob.setAttribute("aria-valuetext", `${bpm.toFixed(1)} BPM`);
  renderLcd();
}

let drag = null;
knob.addEventListener("pointerdown", (e) => {
  knob.setPointerCapture(e.pointerId);
  drag = { y: e.clientY, bpm };
});
knob.addEventListener("pointermove", (e) => {
  if (drag) setBpm(drag.bpm + (drag.y - e.clientY) * 0.5);
});
const endDrag = () => (drag = null);
knob.addEventListener("pointerup", endDrag);
knob.addEventListener("pointercancel", endDrag);
knob.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    setBpm(bpm + (e.deltaY < 0 ? 1 : -1));
  },
  { passive: false },
);
knob.addEventListener("keydown", (e) => {
  const big = e.shiftKey ? 10 : 1;
  const moves = { ArrowUp: big, ArrowRight: big, ArrowDown: -big, ArrowLeft: -big, PageUp: 10, PageDown: -10 };
  if (e.key in moves) {
    e.preventDefault();
    setBpm(bpm + moves[e.key]);
  } else if (e.key === "Home") {
    e.preventDefault();
    setBpm(BPM_MIN);
  } else if (e.key === "End") {
    e.preventDefault();
    setBpm(BPM_MAX);
  }
});

// Tap tempo: average the last few intervals; reset after a 2 second gap.
let taps = [];
$("tap").addEventListener("click", tapTempo);
function tapTempo() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  taps = taps.slice(-5);
  if (taps.length >= 2) {
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setBpm(60000 / avg);
    setMessage("TAP TEMPO");
  } else {
    setMessage("TAP AGAIN...");
  }
}

// ---------- Volume ----------
volInput.addEventListener("input", () => {
  audio.setVolume(Number(volInput.value) / 100);
  setMessage(`VOLUME ${volInput.value}`);
});

// ---------- Keyboard ----------
window.addEventListener("keydown", (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.code === "Space") {
    if (document.activeElement?.tagName === "BUTTON") return; // let the button click
    e.preventDefault();
    playing ? stop() : start();
    return;
  }

  const k = e.key.toLowerCase();
  for (let r = 0; r < 4; r++) {
    const c = KEY_ROWS[r].indexOf(k);
    if (c !== -1) {
      triggerPad((3 - r) * 4 + c);
      return;
    }
  }
});

// ---------- MIDI ----------
const midiBtn = $("midi-btn");
const midiStatus = $("midi-status");

const midi = createMidi({
  padCount: PAD_COUNT,
  steps: STEPS,
  triggerPad,
  toggleStep,
  start,
  stop,
  toggleRec,
  clearPad,
  clearAll,
  tapTempo,
  nudgeTempo: (delta) => setBpm(bpm + delta),
  getState: () => ({
    selected,
    stepsOn: pattern[selected],
    playheadStep,
    playing,
    recording,
  }),
  onStatus: (text) => (midiStatus.textContent = text),
});

wireMidiButton(midiBtn, midi);

// ---------- Init ----------
setBpm(bpm);
selectPad(0);
