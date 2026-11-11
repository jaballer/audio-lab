// The sampler's LCD: five text lines (one value each: sequence, pad, tempo, bar, step), a short-lived message, then a
// timeline along the bottom (a step ruler over a progress bar).
// `formatLcd` builds the text from the sequencer's state with no DOM, so it can
// be tested; `createLcd` writes it into the page's elements.
//
//   state = { playing, recording, sequence, sequenceCount, selected, soundName, bpm, playheadStep, playheadPosition, steps, bars, page, stepsOn }
//     steps:     how many steps one bar has (the STEP line counts all of them: steps times bars)
//     bars:      how many bars the sequence has
//     page:      the 0-based bar the step keys show (the progress bar marks it)
//     playheadStep / stepsOn:  of the bar the step keys show; playheadPosition is the step in the whole sequence
//     sequence:  the current sequence, 0-based
//     sequenceCount:  how many sequences there are; when given the line reads "SEQ 02/04", and without it "SEQ 02"
//     selected:  the selected pad, 0-based
//     stepsOn:  the selected pad's steps, as booleans

import { setText } from "../../shared/dom-updates.js";
import { pad2 } from "./format.js";

const MESSAGE_MS = 1600;

// What the display says while the machine starts up; it is blank when off. The progress bar fills over the boot (CSS).
export const BOOT_LINES = ["PAD 16", "DIGITAL SAMPLER", "SELF TEST  OK"];

export function formatLcd({
  playing,
  recording,
  sequence = 0,
  sequenceCount,
  selected,
  soundName,
  bpm,
  playheadStep,
  playheadPosition = playheadStep,
  steps,
  bars = 1,
  stepsOn,
}) {
  const located = playheadPosition >= 0 && playing;
  // The step in the whole sequence, as the step keys are numbered (the keys of the second bar are 17 to 32), out of all of
  // them: the bar line says which bar it is in.
  const stepLabel = located ? pad2(playheadPosition + 1) : "--";
  const barLabel = located ? pad2(Math.floor(playheadPosition / steps) + 1) : "--";
  const sequenceLabel = sequenceCount ? `${pad2(sequence + 1)}/${pad2(sequenceCount)}` : pad2(sequence + 1);
  return {
    // One value to a line, so that a line has one job and one rate of change: the tempo changes when it is turned, the
    // bar and the step with every beat. A song's position and repeats can have lines of their own the same way.
    lines: [
      `SEQ ${sequenceLabel}  ${playing ? "PLAYING" : "STOPPED"}${recording ? "  REC" : ""}`,
      `PAD ${pad2(selected + 1)}  ${soundName}`,
      `BPM ${bpm.toFixed(1)}`,
      `BAR ${barLabel}/${pad2(bars)}`,
      `STEP ${stepLabel}/${steps * bars}`,
    ],
    ruler: stepsOn.map((on, i) => ({ on, now: playing && i === playheadStep })),
  };
}

// The progress bar at the very bottom of the display, under the step ruler: how far the playhead is through the whole sequence (all its bars,
// where the ruler shows only the bar the step keys show), how many bars it has, and which of them is showing.
//
//   lcdProgress({ playing, playheadPosition, steps, bars, page })   // { bars, shown, fraction }
//
// `fraction` (0 to 1) is the share of the sequence played up to and including the step the playhead is on, so it reaches 1
// on the last step and starts the next loop at one step's worth; it is 0 while stopped. `shown` is the 0-based bar the
// step keys are showing.
export function lcdProgress({ playing, playheadPosition = -1, steps, bars = 1, page = 0 }) {
  const total = steps * bars;
  const located = playing && playheadPosition >= 0 && total > 0;
  return {
    bars,
    shown: Math.max(0, Math.min(page, bars - 1)),
    fraction: located ? Math.min(1, (playheadPosition + 1) / total) : 0,
  };
}

// `elements` is { lines: [el, el, el, el, el], message, ruler, progress }, and `steps` is how many cells the ruler has.
// `progress` (optional) is the element the progress bar is drawn in: it is given its shape as CSS custom properties.
// The progress bar's values as the CSS custom properties that draw it (strings) and whether there is more than one bar. A
// fraction to four decimals is a hundredth of a per cent of the bar: finer than a pixel on any screen.
const PROGRESS_DECIMALS = 4;
export function progressVars({ bars, shown, fraction }) {
  return {
    "--progress": String(Number(fraction.toFixed(PROGRESS_DECIMALS))),
    "--bars": String(bars),
    "--shown": String(shown),
    multi: bars > 1, // with one bar the line under the progress would be all of it
  };
}

// Written only when it changed: the display is drawn on every step while playing.
function drawProgress(element, result) {
  const { multi, ...properties } = progressVars(result);
  for (const [name, value] of Object.entries(properties)) {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  }
  element.classList.toggle("multi", multi);
}

// `screen` (optional) is the element that takes the power phase as `data-power` ("off", "booting", "on", "shutdown"),
// which the CSS draws: a dark glass when off, the text and bar coming up when booting.
export function createLcd({ lines, message, ruler, progress = null, screen = null, steps }) {
  const cells = [];
  for (let i = 0; i < steps; i++) {
    const cell = document.createElement("span");
    ruler.appendChild(cell);
    cells.push(cell);
  }

  let messageTimer = null;
  let phase = screen?.getAttribute("data-power") ?? "on"; // without a `screen` the display just shows what it is given
  let lastState = null;

  function draw(state) {
    const text = formatLcd(state);
    text.lines.forEach((line, i) => setText(lines[i], line));
    cells.forEach((cell, i) => {
      cell.classList.toggle("on", text.ruler[i].on);
      cell.classList.toggle("now", text.ruler[i].now);
    });
    if (progress) drawProgress(progress, lcdProgress(state));
  }

  function clear() {
    clearTimeout(messageTimer); // a message from before must not show under the boot lines
    message.textContent = "";
    lines.forEach((line) => setText(line, ""));
    cells.forEach((cell) => cell.classList.remove("on", "now"));
    if (progress) drawProgress(progress, lcdProgress({ playing: false, steps, bars: 1 }));
  }

  return {
    // The state is kept while the display is not showing it, so it is right the moment it comes on.
    render(state) {
      lastState = state;
      if (phase === "on" || phase === "shutdown") draw(state);
    },

    // Called when the machine's power phase changes (power-sequence.js). Shutdown keeps the text, which the CSS fades.
    setPower(next) {
      phase = next;
      screen?.setAttribute("data-power", next);
      if (next === "off") clear();
      else if (next === "booting") {
        clear();
        BOOT_LINES.forEach((text, i) => setText(lines[i], text));
      } else if (next === "on" && lastState) draw(lastState);
    },

    // A short message under the five lines, cleared after a moment.
    showMessage(text) {
      message.textContent = text;
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => (message.textContent = ""), MESSAGE_MS);
    },
  };
}
