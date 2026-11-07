// MIDI monitor page: shows every message a connected device sends, so you can
// see what a controller really transmits (which notes its pads send, whether
// it sends pressure or clock, which channel) before writing a device profile.
//
// This file only wires the pieces together: MIDI in, the log, and the view.

import "../../shared/base.css";
import "./monitor.css";
import { createMidiAccess, wireMidiButton } from "../../shared/midi-access.js";
import { KINDS, describeMessage, formatLine } from "./describe.js";
import { createLog } from "./log.js";
import { createMonitorView } from "./view.js";

const $ = (id) => document.getElementById(id);

const log = createLog();
const view = createMonitorView({ list: $("log"), notes: $("notes-body") });

let paused = false;
const hidden = new Set(); // kinds the filters have switched off

const isVisible = (entry) => !hidden.has(entry.kind);

// ---------- MIDI ----------
function handleMidi(input, data) {
  if (paused) return;
  // performance.now() is the page's own clock: only the gaps between messages
  // matter here, so it does not need to line up with the MIDI event timestamp.
  const entry = { time: performance.now(), source: input.name, ...describeMessage(data) };
  log.add(entry);
  if (isVisible(entry)) view.append(entry);
  if (entry.hit) view.showNotes(log.notesHit());
}

wireMidiButton(
  $("midi-btn"),
  createMidiAccess({
    onMessage: handleMidi,
    onStatus: (text) => ($("midi-status").textContent = text),
  }),
);

// ---------- Controls ----------
const filters = $("filters");
for (const kind of KINDS) {
  const label = document.createElement("label");
  label.className = "filter";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = true;
  box.addEventListener("change", () => {
    if (box.checked) hidden.delete(kind);
    else hidden.add(kind);
    view.reset(log.entries().filter(isVisible));
  });
  label.append(box, ` ${kind}`);
  filters.append(label);
}

const pauseBtn = $("pause-btn");
pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "Resume" : "Pause";
  pauseBtn.setAttribute("aria-pressed", String(paused));
});

$("clear-btn").addEventListener("click", () => {
  log.clear();
  view.reset([]);
  view.showNotes([]);
});

const copyBtn = $("copy-btn");
copyBtn.addEventListener("click", async () => {
  const text = log.entries().filter(isVisible).map(formatLine).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = "Copied";
  } catch {
    // Clipboard access can be blocked (insecure context, denied permission).
    copyBtn.textContent = "Copy failed";
  }
  setTimeout(() => (copyBtn.textContent = "Copy log"), 1500);
});
