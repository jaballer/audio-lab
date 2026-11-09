// Web MIDI support. What each controller's notes and buttons mean, and how to
// light it, lives in a device profile (devices.js); this file connects the
// profiles to the app:
//
// - input: the profile for the port a message came from turns it into events
//   (pad, step, control) that are handed to the app.
// - output: when a connected output port belongs to a profile that has lights
//   (the Launchpad), its LEDs are kept in step with what is on screen.

import { createMidiRouter } from "../../shared/midi-devices.js";
import { createMidiAccess } from "../../shared/midi-access.js";
import { PROFILES } from "./devices.js";

const LIT_PROFILES = PROFILES.filter((profile) => profile.lights);
const MAX_VELOCITY = 127;
const FLASH_MS = 120;

export function createMidi(api) {
  let output = null; // the output port of a controller with lights, when one is connected
  let outputProfile = null;
  const lastSent = new Map();
  const flashing = new Set();
  const flashTimers = new Map(); // pad -> its pending timeout

  const controls = {
    start: () => api.start(),
    stop: () => api.stop(),
    record: () => api.toggleRec(),
    clearPad: () => api.clearPad(),
    clearAll: () => api.clearAll(),
    tap: () => api.tapTempo(),
    tempoDown: () => api.nudgeTempo(-1),
    tempoUp: () => api.nudgeTempo(1),
  };

  // What to do for each event a profile can produce. Profiles don't know how
  // many pads or steps the app has, so out-of-range ones are dropped here.
  const handlers = {
    pad(event) {
      if (event.index < api.padCount) api.triggerPad(event.index, event.velocity / MAX_VELOCITY);
    },
    step(event) {
      if (event.index < api.steps) api.toggleStep(event.index);
    },
    control(event) {
      controls[event.name]();
    },
  };

  function led(status, data1, value) {
    if (!output) return;
    const key = `${status}:${data1}`;
    if (lastSent.get(key) === value) return; // only send changes
    lastSent.set(key, value);
    output.send([status, data1, value]);
  }

  function refresh() {
    if (!output) return;
    const lights = outputProfile.lights({ ...api.getState(), padCount: api.padCount, steps: api.steps, flashing });
    for (const [status, data1, value] of lights) led(status, data1, value);
  }

  const profileForOutput = (port) =>
    port.state === "disconnected" ? undefined : LIT_PROFILES.find((profile) => profile.match(port.name));

  // Device scanning and permission live in shared/midi-access.js; here we only
  // pick out the output port whose LEDs should mirror the app.
  const { connect, autoConnect } = createMidiAccess({
    onMessage: createMidiRouter(PROFILES, handlers),
    onStatus: api.onStatus,
    onLog: api.onLog,
    onChange(access) {
      const port = [...access.outputs.values()].find((p) => profileForOutput(p)) ?? null;
      if (port !== output) {
        output = port;
        outputProfile = port ? profileForOutput(port) : null;
        lastSent.clear();
        if (output && outputProfile.reset) output.send(outputProfile.reset); // all LEDs off
      }
      refresh();
    },
  });

  function padHit(idx) {
    if (!output) return;
    flashing.add(idx);
    refresh();
    // A pad hit again while lit starts its time over: otherwise the first hit's timer would
    // switch it off partway through the second (dense sequenced patterns flickered).
    clearTimeout(flashTimers.get(idx));
    flashTimers.set(
      idx,
      setTimeout(() => {
        flashing.delete(idx);
        flashTimers.delete(idx);
        refresh();
      }, FLASH_MS),
    );
  }

  // Turn the controller's lights off when leaving the page.
  window.addEventListener("pagehide", () => {
    try {
      if (outputProfile?.reset) output.send(outputProfile.reset);
    } catch {
      /* ignore */
    }
  });

  return { connect, autoConnect, refresh, padHit };
}
