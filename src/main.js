import "./style.css";
import { SOUNDS } from "./sounds.js";

const STEPS = 16;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;

let ctx = null;
let master = null;

const pattern = SOUNDS.map(() => new Array(STEPS).fill(false));
// A starter beat so Play makes noise right away.
[0, 4, 8, 12].forEach((i) => (pattern[0][i] = true)); // kick
[4, 12].forEach((i) => (pattern[1][i] = true)); // snare
[0, 2, 4, 6, 8, 10, 12, 14].forEach((i) => (pattern[2][i] = true)); // hat

function ensureAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = Number(volInput.value) / 100;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
}

// ---- Pads ----
const padsEl = document.getElementById("pads");
const padEls = new Map();

SOUNDS.forEach((s) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pad";
  btn.innerHTML = `<span class="name">${s.name}</span><kbd>${s.key.toUpperCase()}</kbd>`;
  btn.addEventListener("pointerdown", () => triggerPad(s));
  padsEl.appendChild(btn);
  padEls.set(s.id, btn);
});

function flash(id) {
  const el = padEls.get(id);
  el.classList.add("hit");
  setTimeout(() => el.classList.remove("hit"), 110);
}

function triggerPad(sound) {
  ensureAudio();
  sound.play(ctx, master, ctx.currentTime);
  flash(sound.id);
}

window.addEventListener("keydown", (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  const sound = SOUNDS.find((s) => s.key === e.key.toLowerCase());
  if (sound) triggerPad(sound);
});

// ---- Sequencer grid ----
const gridEl = document.getElementById("grid");
const stepEls = SOUNDS.map(() => []);

SOUNDS.forEach((s, row) => {
  const rowEl = document.createElement("div");
  rowEl.className = "row";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = s.name;
  rowEl.appendChild(label);

  for (let i = 0; i < STEPS; i++) {
    const step = document.createElement("button");
    step.type = "button";
    step.className = "step" + (pattern[row][i] ? " on" : "");
    step.setAttribute("aria-label", `${s.name} step ${i + 1}`);
    step.setAttribute("aria-pressed", String(pattern[row][i]));
    step.addEventListener("click", () => {
      pattern[row][i] = !pattern[row][i];
      step.classList.toggle("on", pattern[row][i]);
      step.setAttribute("aria-pressed", String(pattern[row][i]));
    });
    rowEl.appendChild(step);
    stepEls[row].push(step);
  }
  gridEl.appendChild(rowEl);
});

// ---- Transport ----
const playBtn = document.getElementById("play");
const bpmInput = document.getElementById("bpm");
const bpmOut = document.getElementById("bpm-out");
const volInput = document.getElementById("vol");
const clearBtn = document.getElementById("clear");

let playing = false;
let timer = null;
let nextStep = 0;
let nextTime = 0;
const visualQueue = [];
let currentVisual = -1;

function scheduler() {
  while (nextTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
    SOUNDS.forEach((s, row) => {
      if (pattern[row][nextStep]) s.play(ctx, master, nextTime);
    });
    visualQueue.push({ step: nextStep, time: nextTime });
    const secondsPerStep = 60 / Number(bpmInput.value) / 4; // 16th notes
    nextTime += secondsPerStep;
    nextStep = (nextStep + 1) % STEPS;
  }
}

function paintPlayhead() {
  if (playing) {
    while (visualQueue.length && visualQueue[0].time <= ctx.currentTime) {
      const { step } = visualQueue.shift();
      setPlayhead(step);
    }
    requestAnimationFrame(paintPlayhead);
  }
}

function setPlayhead(step) {
  if (currentVisual >= 0) stepEls.forEach((row) => row[currentVisual].classList.remove("now"));
  currentVisual = step;
  if (step >= 0) stepEls.forEach((row) => row[step].classList.add("now"));
}

function start() {
  ensureAudio();
  playing = true;
  nextStep = 0;
  nextTime = ctx.currentTime + 0.05;
  timer = setInterval(scheduler, LOOKAHEAD_MS);
  playBtn.textContent = "■ Stop";
  playBtn.setAttribute("aria-pressed", "true");
  requestAnimationFrame(paintPlayhead);
}

function stop() {
  playing = false;
  clearInterval(timer);
  visualQueue.length = 0;
  setPlayhead(-1);
  playBtn.textContent = "▶ Play";
  playBtn.setAttribute("aria-pressed", "false");
}

playBtn.addEventListener("click", () => (playing ? stop() : start()));

bpmInput.addEventListener("input", () => (bpmOut.textContent = bpmInput.value));

volInput.addEventListener("input", () => {
  if (master) master.gain.value = Number(volInput.value) / 100;
});

clearBtn.addEventListener("click", () => {
  pattern.forEach((row, r) =>
    row.forEach((_, i) => {
      row[i] = false;
      stepEls[r][i].classList.remove("on");
      stepEls[r][i].setAttribute("aria-pressed", "false");
    }),
  );
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement?.tagName !== "BUTTON") {
    e.preventDefault();
    playing ? stop() : start();
  }
});
