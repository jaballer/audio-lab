// The step sequencer that plays the MPC Sample's own sounds: it sends the device a note for each step
// that is on. No DOM, nothing at import time.
//
// The pattern has a row for every pad the device has (8 banks of 16), so any bank can be edited. It keeps
// every step it has been given, so a sequence made shorter for a moment gets its steps back when it is
// made longer again; only the first `steps` of them play. The
// scheduler (shared/scheduler.js) runs on the clock it is given and reports each step with the time
// to play it at; that time is in the same domain as Web MIDI timestamps, so the note goes out with it.
//
//   const sequencer = createSequencer({
//     clock,        // { now(): seconds }, in the domain of the timestamps `send` takes (ms / 1000)
//     send,         // (bytes, timeMs) => void; no time means now
//     clear,        // optional: drops what is queued ahead on the output
//     messages,     // the device profile's padOn(index, bank, velocity) and padOff(index, bank)
//     steps, bpm,
//   });
//   sequencer.start(at);            // `at` in seconds: where step 0 goes, to line up with a clock sent alongside
//   sequencer.toggle(row, step);    // row is bank * 16 + pad
//   sequencer.setSteps(32);         // the loop's length changed
//   sequencer.poll();               // every animation frame; true when the playhead moved
//   sequencer.stop();
//
// The device is clock slave to the page when the page starts it (apps/mpc-sample/clock-master.js), so
// the page sends ticks on the beat grid that starts at the same moment as step 0: a step is a 16th note,
// six ticks.

import { BANK_COUNT, PADS_PER_BANK, noteForPad } from "../../shared/mpc-sample.js";
import { createPattern } from "../../shared/pattern.js";
import { createScheduler } from "../../shared/scheduler.js";
import { stepSeconds } from "../../shared/tempo.js";
import { MAX_BPM, MIN_BPM } from "./clock-master.js";
import { createEchoGuard } from "./echo-guard.js";

export const PAD_COUNT = BANK_COUNT * PADS_PER_BANK; // a row of the pattern per pad of every bank
export const NOTE_VELOCITY = 100; // every step is as hard as this until a step can have its own
// How much of a step a note lasts. The device's samples may be one-shots that ignore the release; if they
// are gated, a note that ends a little before the next one lets a repeat sound again. Not judged by ear.
export const GATE_RATIO = 0.8;
const MS = 1000;
const SIXTEENTHS_PER_WHOLE = 16;

export const rowFor = (bank, index) => bank * PADS_PER_BANK + index;
export const padOf = (row) => ({ index: row % PADS_PER_BANK, bank: Math.floor(row / PADS_PER_BANK) });

// Steps in the sequence: a step is a 16th note, and a beat is the note value of the time signature.
export const stepCount = ({ bars, numerator, denominator }) => bars * numerator * (SIXTEENTHS_PER_WHOLE / denominator);

export function createSequencer({ clock, send, clear, messages, steps: initialSteps, bpm = 120 }) {
  let steps = initialSteps; // the loop's length
  let pattern = createPattern(PAD_COUNT, steps); // as long as the longest loop so far
  const sounded = new Set(); // rows whose note was sent since the start, so Stop can release each
  let queuedUntil = 0; // the latest time (ms) anything was queued for, so Stop can release after it
  const guard = createEchoGuard();

  function onStep(step, time) {
    const length = stepSeconds(scheduler.bpm);
    for (let row = 0; row < PAD_COUNT; row++) {
      if (!pattern.isOn(row, step)) continue;
      const { index, bank } = padOf(row);
      const at = time * MS;
      send(messages.padOn(index, bank, NOTE_VELOCITY), at);
      const off = at + length * GATE_RATIO * MS;
      send(messages.padOff(index, bank), off);
      queuedUntil = Math.max(queuedUntil, off);
      guard.expect(noteForPad(index, bank), at, clock.now() * MS);
      sounded.add(row);
    }
  }

  const scheduler = createScheduler({ clock, steps, onStep, bpm, bpmRange: { min: MIN_BPM, max: MAX_BPM } });

  return {
    start: (at) => scheduler.start(at),

    // Notes still queued ahead are dropped, and each pad that sounded is released now, so a gated
    // sample cannot hang on after Stop. Not every browser can drop what is queued (Firefox has no
    // MIDIOutput.clear), so a second release follows the last queued note: the notes that still
    // arrive are cut short and cannot be left held. The guard keeps what it waits for, for the same
    // reason: their echoes are still coming.
    stop() {
      scheduler.stop();
      clear?.();
      const after = Math.max(queuedUntil, clock.now() * MS);
      for (const row of sounded) {
        const { index, bank } = padOf(row);
        const release = messages.padOff(index, bank);
        send(release);
        send(release, after);
      }
      sounded.clear();
    },

    setSteps(count) {
      if (count === steps) return;
      // Only a longer loop than any so far needs a bigger pattern; a shorter one is a view of it.
      if (count > pattern.steps) pattern = createPattern(PAD_COUNT, count, pattern.snapshot());
      steps = count;
      scheduler.setSteps(count);
    },

    setBpm: (value) => scheduler.setBpm(value),
    poll: () => scheduler.poll(),
    isOn: (row, step) => pattern.isOn(row, step),
    toggle: (row, step) => pattern.toggle(row, step),
    clearRow: (row) => pattern.clearRow(row),
    clearAll: () => pattern.clearAll(),

    // Is this hit the device's echo of a note sent from here? `note` and `now` (ms) as the hit arrived.
    isEcho: (note, now) => guard.isEcho(note, now),

    get steps() {
      return steps;
    },
    get playing() {
      return scheduler.playing;
    },
    get bpm() {
      return scheduler.bpm;
    },
    get playheadStep() {
      return scheduler.playheadStep;
    },
  };
}
