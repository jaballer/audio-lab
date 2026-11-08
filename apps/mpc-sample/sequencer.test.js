import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEDULER_TICK_MS } from "../../shared/scheduler.js";
import { CLOCKS_PER_BEAT, FIRST_TICK_DELAY_MS, createClockMaster } from "./clock-master.js";
import { mpcSample } from "./devices.js";
import { GATE_RATIO, NOTE_VELOCITY, PAD_COUNT, createSequencer, padOf, rowFor, stepCount } from "./sequencer.js";

const ON = 0x90;
const OFF = 0x80;

function setup({ steps = 16, bpm = 120 } = {}) {
  const clock = { time: 0, now: () => clock.time };
  const sent = []; // { bytes, time } as the output was given them; time is undefined for "now"
  const cleared = vi.fn();
  const sequencer = createSequencer({
    clock,
    send: (bytes, time) => sent.push({ bytes, time }),
    clear: cleared,
    messages: mpcSample.messages,
    steps,
    bpm,
  });
  const advance = (seconds) => {
    clock.time += seconds;
    vi.advanceTimersByTime(SCHEDULER_TICK_MS);
  };
  const run = (seconds) => {
    for (let t = 0; t < seconds; t += SCHEDULER_TICK_MS / 1000) advance(SCHEDULER_TICK_MS / 1000);
  };
  const notes = (status) => sent.filter((m) => m.bytes[0] === status);
  return { clock, sequencer, sent, cleared, advance, run, notes };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("stepCount", () => {
  it("counts 16th notes: a beat is the signature's note value", () => {
    expect(stepCount({ bars: 1, numerator: 4, denominator: 4 })).toBe(16);
    expect(stepCount({ bars: 4, numerator: 4, denominator: 4 })).toBe(64);
    expect(stepCount({ bars: 1, numerator: 3, denominator: 4 })).toBe(12);
    expect(stepCount({ bars: 1, numerator: 7, denominator: 8 })).toBe(14);
    expect(stepCount({ bars: 2, numerator: 4, denominator: 2 })).toBe(64);
    expect(stepCount({ bars: 1, numerator: 5, denominator: 16 })).toBe(5);
  });
});

describe("rows and pads", () => {
  it("has a row for every pad of every bank", () => {
    expect(PAD_COUNT).toBe(128);
    expect(rowFor(0, 0)).toBe(0);
    expect(rowFor(1, 2)).toBe(18);
    expect(padOf(18)).toEqual({ index: 2, bank: 1 });
    expect(padOf(127)).toEqual({ index: 15, bank: 7 });
  });
});

describe("createSequencer", () => {
  it("sends a note on and a note off for each step that is on, at the step's time", () => {
    const { sequencer, notes, advance } = setup({ bpm: 120 }); // a step is 125 ms
    sequencer.toggle(rowFor(0, 0), 0);
    sequencer.toggle(rowFor(0, 2), 1);
    sequencer.start(0.05);
    advance(0);
    advance(0.2);
    expect(notes(ON).map((m) => m.bytes)).toEqual([
      [ON, 36, NOTE_VELOCITY],
      [ON, 38, NOTE_VELOCITY],
    ]);
    expect(notes(ON)[0].time).toBeCloseTo(50);
    expect(notes(ON)[1].time).toBeCloseTo(175);
    expect(notes(OFF)[0].time).toBeCloseTo(50 + 125 * GATE_RATIO);
    expect(notes(OFF)[1].bytes).toEqual([OFF, 38, 0]);
  });

  it("plays the pads of other banks on their own notes", () => {
    const { sequencer, notes, advance } = setup();
    sequencer.toggle(rowFor(1, 0), 0); // bank B, pad 1: note 52
    sequencer.start(0.05);
    advance(0);
    expect(notes(ON).map((m) => m.bytes[1])).toEqual([52]);
  });

  it("sends nothing for steps that are off", () => {
    const { sequencer, sent, run } = setup();
    sequencer.start();
    run(1);
    expect(sent).toEqual([]);
  });

  it("loops the pattern", () => {
    const { sequencer, notes, run } = setup({ steps: 4, bpm: 120 });
    sequencer.toggle(0, 0);
    sequencer.start(0.05);
    run(1.2); // the loop is 500 ms
    const times = notes(ON).map((m) => m.time);
    expect(times.length).toBeGreaterThanOrEqual(2);
    expect(times[1] - times[0]).toBeCloseTo(500);
  });

  it("keeps every step when the loop is made shorter, and gives them back when it is longer again", () => {
    const { sequencer } = setup({ steps: 32 });
    sequencer.toggle(0, 3);
    sequencer.toggle(0, 20);
    sequencer.setSteps(16);
    expect(sequencer.steps).toBe(16);
    sequencer.setSteps(64);
    expect(sequencer.steps).toBe(64);
    expect(sequencer.isOn(0, 3)).toBe(true);
    expect(sequencer.isOn(0, 20)).toBe(true);
    sequencer.toggle(0, 50); // the longer loop is editable too
    expect(sequencer.isOn(0, 50)).toBe(true);
  });

  it("plays only the steps inside a shorter loop", () => {
    const { sequencer, notes, run } = setup({ steps: 8, bpm: 120 });
    sequencer.toggle(0, 1);
    sequencer.toggle(0, 6);
    sequencer.setSteps(4);
    sequencer.start(0.05);
    run(2);
    const gaps = notes(ON)
      .map((m, i, all) => (i ? m.time - all[i - 1].time : null))
      .slice(1);
    expect(notes(ON).length).toBeGreaterThan(2);
    for (const gap of gaps) expect(gap).toBeCloseTo(500); // step 1 of a 4-step loop; step 6 never sounds
  });

  it("releases every pad that sounded, and drops what was queued, when it stops", () => {
    const { sequencer, sent, cleared, advance } = setup();
    sequencer.toggle(rowFor(0, 0), 0);
    sequencer.toggle(rowFor(0, 5), 0);
    sequencer.start(0.05);
    advance(0);
    sent.length = 0;
    sequencer.stop();
    expect(cleared).toHaveBeenCalled();
    const released = sent.filter((m) => m.time === undefined).map((m) => m.bytes); // now, not queued
    expect(released).toEqual([
      [OFF, 36, 0],
      [OFF, 41, 0],
    ]);
    expect(sequencer.playing).toBe(false);
  });

  // Firefox and Chrome have no MIDIOutput.clear(): what was queued ahead still arrives after Stop.
  it("releases again after the last queued note, for a browser that cannot drop what is queued", () => {
    const { sequencer, sent, advance } = setup({ bpm: 120 });
    sequencer.toggle(0, 0);
    sequencer.start(0.05);
    advance(0);
    const lastQueued = Math.max(...sent.map((m) => m.time ?? 0));
    sent.length = 0;
    sequencer.stop();
    const later = sent.filter((m) => m.time !== undefined);
    expect(later.map((m) => m.bytes)).toEqual([[OFF, 36, 0]]);
    expect(later[0].time).toBeGreaterThanOrEqual(lastQueued);
  });

  it("sends no more after it stops", () => {
    const { sequencer, sent, run } = setup();
    sequencer.toggle(0, 0);
    sequencer.start(0.05);
    run(0.3);
    sequencer.stop();
    sent.length = 0;
    run(2);
    expect(sent).toEqual([]);
  });

  it("runs at the tempo it is given, clamped to the device's range", () => {
    const { sequencer } = setup();
    expect(sequencer.setBpm(250)).toBe(250);
    expect(sequencer.setBpm(10)).toBe(30);
    expect(sequencer.setBpm(999)).toBe(300);
  });

  describe("the device's echo", () => {
    it("knows the notes it sent when they come back, and only those", () => {
      const { sequencer, advance } = setup();
      sequencer.toggle(0, 0);
      sequencer.start(0.05);
      advance(0);
      expect(sequencer.isEcho(37, 55)).toBe(false); // another pad
      expect(sequencer.isEcho(36, 55)).toBe(true); // the note, a few ms after it was due
      expect(sequencer.isEcho(36, 56)).toBe(false); // each note comes back once
    });

    it("still knows the echoes of notes queued before it stopped", () => {
      const { sequencer, advance } = setup();
      sequencer.toggle(0, 0);
      sequencer.start(0.05);
      advance(0);
      sequencer.stop();
      expect(sequencer.isEcho(36, 55)).toBe(true);
    });
  });
});

// The page sends the device a clock and the notes at once: a step has to fall on the sixth tick after
// the one before it, or the notes drift against the device's own sequence.
describe("one beat grid with the MIDI clock", () => {
  it("puts each step on the tick the device counts it by", () => {
    const { clock, sequencer, notes, run } = setup({ bpm: 100 });
    const ticks = [];
    const master = createClockMaster({
      send: (bytes, time) => bytes[0] === 0xf8 && ticks.push(time),
      startMessage: mpcSample.messages.play,
    });
    sequencer.toggle(0, 0);
    sequencer.toggle(0, 3);
    sequencer.toggle(0, 9);

    const at = 0.05 * 1000; // where Start goes, as the page chooses it
    master.start(100, at);
    sequencer.start((at + FIRST_TICK_DELAY_MS) / 1000);
    // Keep the clock master's ticks coming as the page's timer does.
    for (let t = 0; t < 2; t += 0.025) {
      run(0.025);
      master.tick(clock.time * 1000);
    }

    const onTimes = notes(ON).map((m) => m.time);
    expect(onTimes.slice(0, 3)).toHaveLength(3);
    // Steps 0, 3 and 9 sit on ticks 0, 18 and 54: six ticks a step.
    const ticksPerStep = CLOCKS_PER_BEAT / 4;
    expect(onTimes[0]).toBeCloseTo(ticks[0], 6);
    expect(onTimes[1]).toBeCloseTo(ticks[3 * ticksPerStep], 6);
    expect(onTimes[2]).toBeCloseTo(ticks[9 * ticksPerStep], 6);
  });
});

describe("following a clock the device sends", () => {
  const TICKS_PER_STEP = CLOCKS_PER_BEAT / 4; // a step is a 16th note

  it("plays step 0 on the first tick and then one step every six ticks", () => {
    const { sequencer, notes } = setup({ steps: 4 });
    sequencer.toggle(rowFor(0, 0), 0);
    sequencer.toggle(rowFor(0, 1), 2);
    sequencer.follow();
    for (let i = 0; i < TICKS_PER_STEP * 4; i++) {
      sequencer.tick(i, 120);
      if (i === 0) expect(notes(ON).map((m) => m.bytes[1])).toEqual([36]);
    }
    expect(notes(ON).map((m) => m.bytes[1])).toEqual([36, 37]);
  });

  it("loops, and ends each note a gate's share of a step after it began", () => {
    const { sequencer, notes } = setup({ steps: 2 });
    sequencer.toggle(rowFor(0, 0), 0);
    sequencer.follow();
    for (let i = 0; i < TICKS_PER_STEP * 4; i++) sequencer.tick(i, 120);
    expect(notes(ON)).toHaveLength(2); // step 0 comes round again after two steps
    expect(notes(OFF)[0].time - notes(ON)[0].time).toBeCloseTo(125 * GATE_RATIO);
  });

  it("is playing while it follows, with the playhead on the step, and not after stop", () => {
    const { sequencer } = setup({ steps: 4 });
    expect(sequencer.following).toBe(false);
    sequencer.follow();
    expect(sequencer.playing).toBe(true);
    for (let i = 0; i <= TICKS_PER_STEP; i++) sequencer.tick(i, 120);
    expect(sequencer.poll()).toBe(true);
    expect(sequencer.playheadStep).toBe(1);
    expect(sequencer.poll()).toBe(false); // nothing new since
    sequencer.stop();
    expect(sequencer.playing).toBe(false);
    expect(sequencer.following).toBe(false);
  });

  it("releases the pads that sounded when it stops", () => {
    const { sequencer, notes } = setup({ steps: 4 });
    sequencer.toggle(rowFor(0, 0), 0);
    sequencer.follow();
    sequencer.tick(0, 120);
    const before = notes(OFF).length;
    sequencer.stop();
    expect(notes(OFF).length).toBeGreaterThan(before);
  });

  it("ignores ticks when it is not following", () => {
    const { sequencer, sent } = setup({ steps: 4 });
    sequencer.toggle(rowFor(0, 0), 0);
    sequencer.tick(0, 120);
    expect(sent).toEqual([]);
  });
});

describe("continuing from where the device was", () => {
  const TICKS_PER_STEP = CLOCKS_PER_BEAT / 4;
  const runTicks = (sequencer, count) => {
    for (let i = 0; i < count; i++) sequencer.tick(i, 120);
  };

  it("resumes on the step after the one it stopped on", () => {
    const { sequencer } = setup({ steps: 8 });
    sequencer.follow();
    runTicks(sequencer, TICKS_PER_STEP * 3 + 1); // steps 0 to 3 have played, and 3 is under way
    sequencer.stop();
    sequencer.follow("continue");
    sequencer.tick(0, 120);
    expect(sequencer.poll()).toBe(true);
    expect(sequencer.playheadStep).toBe(4);
  });

  it("starts at step 0 again on a fresh start", () => {
    const { sequencer } = setup({ steps: 8 });
    sequencer.follow();
    runTicks(sequencer, TICKS_PER_STEP * 3);
    sequencer.stop();
    sequencer.follow();
    sequencer.tick(0, 120);
    expect(sequencer.playheadStep).toBe(0);
  });

  it("moves to the position the device reports, in sixteenth notes", () => {
    const { sequencer } = setup({ steps: 8 });
    sequencer.follow("continue");
    sequencer.seek(5);
    sequencer.tick(0, 120);
    expect(sequencer.playheadStep).toBe(5);
  });

  it("wraps a position that is past the end of a shorter loop", () => {
    const { sequencer } = setup({ steps: 8 });
    sequencer.follow();
    sequencer.seek(19);
    sequencer.tick(0, 120);
    expect(sequencer.playheadStep).toBe(3);
  });
});
