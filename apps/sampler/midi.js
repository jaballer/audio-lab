// Web MIDI support.
//
// - Novation Launchpad (original layout): the bottom-left 4x4 block plays the
//   16 pads, the top two rows are the 16 step keys, and the round buttons along
//   the top run the transport. The pads are lit to mirror what is on screen.
// - Any other controller: notes 36-51 play pads 1-16 (velocity-sensitive).

import { createMidiAccess } from "../../shared/midi-access.js";
import { parseMidi } from "../../shared/midi-messages.js";

// Launchpad LED colour = velocity of a Note On: 16 * green + red + 12 (green/red 0-3).
const color = (green, red) => 16 * green + red + 12;
const OFF = color(0, 0);
const RED_LOW = color(0, 1);
const RED = color(0, 3);
const GREEN_LOW = color(1, 0);
const GREEN_MED = color(2, 0);
const GREEN = color(3, 0);
const AMBER_LOW = color(1, 1);
const AMBER = color(3, 3);

const isLaunchpad = (name = "") => /launchpad/i.test(name);

export function createMidi(api) {
  let output = null; // the Launchpad's output port, when one is connected
  const lastSent = new Map();
  const flashing = new Set();

  // Round buttons along the top edge (controllers 104-111, left to right).
  const TOP = [
    { cc: 104, run: () => api.start(), color: (s) => (s.playing ? GREEN : GREEN_LOW) },
    { cc: 105, run: () => api.stop(), color: () => AMBER_LOW },
    { cc: 106, run: () => api.toggleRec(), color: (s) => (s.recording ? RED : RED_LOW) },
    { cc: 107, run: () => api.clearPad(), color: () => AMBER_LOW },
    { cc: 108, run: () => api.clearAll(), color: () => AMBER_LOW },
    { cc: 109, run: () => api.tapTempo(), color: () => GREEN_LOW },
    { cc: 110, run: () => api.nudgeTempo(-1), color: () => AMBER_LOW },
    { cc: 111, run: () => api.nudgeTempo(1), color: () => AMBER_LOW },
  ];

  function led(status, data1, value) {
    if (!output) return;
    const key = `${status}:${data1}`;
    if (lastSent.get(key) === value) return; // only send changes
    lastSent.set(key, value);
    output.send([status, data1, value]);
  }

  function refresh() {
    if (!output) return;
    const s = api.getState();

    // Pads: bottom-left 4x4 block, pad 1 in the bottom-left corner.
    for (let idx = 0; idx < api.padCount; idx++) {
      const note = (7 - (idx >> 2)) * 16 + (idx & 3);
      const isSelected = idx === s.selected;
      let c = isSelected ? GREEN_MED : RED_LOW;
      if (flashing.has(idx)) c = isSelected ? AMBER : RED;
      led(0x90, note, c);
    }

    // Step keys: top two rows, steps 1-8 then 9-16.
    for (let i = 0; i < api.steps; i++) {
      const note = (i >> 3) * 16 + (i & 7);
      const on = s.stepsOn[i];
      const now = s.playing && i === s.playheadStep;
      led(0x90, note, on && now ? AMBER : now ? GREEN : on ? RED : OFF);
    }

    TOP.forEach((t) => led(0xb0, t.cc, t.color(s)));
  }

  function handle(input, data) {
    const msg = parseMidi(data);

    if (isLaunchpad(input.name)) {
      if (msg.type === "noteOn") {
        const row = msg.note >> 4;
        const col = msg.note & 15;
        if (row >= 4 && row <= 7 && col <= 3) api.triggerPad((7 - row) * 4 + col, msg.velocity / 127);
        else if (row <= 1 && col <= 7) api.toggleStep(row * 8 + col);
      } else if (msg.type === "cc" && msg.value > 0) {
        TOP.find((t) => t.cc === msg.controller)?.run();
      }
      return;
    }

    if (msg.type === "noteOn" && msg.note >= 36 && msg.note < 36 + api.padCount) {
      api.triggerPad(msg.note - 36, msg.velocity / 127);
    }
  }

  // Device scanning and permission live in shared/midi-access.js; here we only
  // pick out the Launchpad's output port so its LEDs can mirror the app.
  const { connect, autoConnect } = createMidiAccess({
    onMessage: handle,
    onStatus: api.onStatus,
    onChange(access) {
      const lp = [...access.outputs.values()].find((o) => isLaunchpad(o.name) && o.state !== "disconnected") ?? null;
      if (lp !== output) {
        output = lp;
        lastSent.clear();
        if (output) output.send([0xb0, 0, 0]); // reset all LEDs
      }
      refresh();
    },
  });

  function padHit(idx) {
    if (!output) return;
    flashing.add(idx);
    refresh();
    setTimeout(() => {
      flashing.delete(idx);
      refresh();
    }, 120);
  }

  // Turn the Launchpad's lights off when leaving the page.
  window.addEventListener("pagehide", () => {
    try {
      output?.send([0xb0, 0, 0]);
    } catch {
      /* ignore */
    }
  });

  return { connect, autoConnect, refresh, padHit };
}
