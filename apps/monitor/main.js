// MIDI monitor page: shows every message a connected device sends, so you can
// see what a controller really transmits (which notes its pads send, whether
// it sends pressure or clock, which channel) before writing a device profile.
//
// This file only wires the pieces together: MIDI in, the log, and the view.

import "../../shared/base.css";
import "./monitor.css";
import { createAppHeader } from "../../shared/app-header.js";
import { enableOffline } from "../../shared/offline.js";
import { createSiteFooter } from "../../shared/site-footer.js";
import { createSiteHeader } from "../../shared/site-header.js";
import { createMidiAccess, wireMidiButton } from "../../shared/midi-access.js";
import { KINDS, describeMessage, formatLine } from "./describe.js";
import { createLog } from "./log.js";
import { createMonitorView } from "./view.js";

const $ = (id) => document.getElementById(id);

const site = createSiteHeader($("site-header"), { current: "monitor" });
createSiteFooter($("site-footer"));
enableOffline($("update-notice"));
createAppHeader($("header"), {
  brand: { name: "MIDI ", accent: "MONITOR" },
  sub: "What your controller really sends",
  tools: site.midiTools,
});

const log = createLog();
const view = createMonitorView({ list: $("log"), notes: $("notes-body"), sourceHead: $("notes-source-head") });

let paused = false;
const hidden = new Set(); // kinds the filters have switched off

const isVisible = (entry) => !hidden.has(entry.kind);

// ---------- MIDI ----------
function handleMidi(input, data, timeStamp) {
  if (paused) return;
  // The time the system received the message, so the gaps shown stay true even
  // when a flood of messages makes this callback run late.
  const entry = { time: timeStamp, source: input.name, ...describeMessage(data) };
  log.add(entry);
  if (isVisible(entry)) view.append(entry);
  if (entry.hit) view.showNotes(log.notesHit());
}

wireMidiButton(
  site.midiButton,
  createMidiAccess({
    onMessage: handleMidi,
    onStatus: site.setMidiStatus,
    onLog: site.log,
    sysex: true, // the monitor shows SysEx, which the browser only delivers when asked for
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
