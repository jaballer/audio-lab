import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOOKAHEAD_MS, createTransport } from "./transport.js";

// An audio engine whose clock is whatever the test says it is.
function fakeAudio() {
  const ctx = { currentTime: 0 };
  return { ctx, ensure: vi.fn(() => ctx) };
}

function setup({ steps = 16, bpm = 120 } = {}) {
  const audio = fakeAudio();
  const played = []; // [step, time] as the scheduler reports them
  const transport = createTransport({ audio, steps, bpm, onStep: (step, time) => played.push([step, time]) });
  // Move the audio clock forward and let the scheduler wake up.
  const advance = (seconds) => {
    audio.ctx.currentTime += seconds;
    vi.advanceTimersByTime(LOOKAHEAD_MS);
  };
  // Move the clock forward in scheduler ticks, as it moves when nothing stalls.
  const run = (seconds) => {
    for (let t = 0; t < seconds; t += LOOKAHEAD_MS / 1000) advance(LOOKAHEAD_MS / 1000);
  };
  return { audio, transport, played, advance, run };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createTransport", () => {
  it("starts stopped, at the given tempo, with no playhead", () => {
    const { transport } = setup({ bpm: 90 });
    expect(transport.playing).toBe(false);
    expect(transport.bpm).toBe(90);
    expect(transport.playheadStep).toBe(-1);
  });

  it("start makes sure audio is running and reports whether it started", () => {
    const { audio, transport } = setup();
    expect(transport.start()).toBe(true);
    expect(audio.ensure).toHaveBeenCalled();
    expect(transport.playing).toBe(true);
    expect(transport.start()).toBe(false);
  });

  it("schedules steps ahead of the audio clock, one 16th note apart", () => {
    const { transport, played, advance } = setup({ bpm: 120 }); // a step is 0.125 s
    transport.start();
    advance(0);
    // First step after the short run-up, nothing else inside the 0.12 s window.
    expect(played.map(([step]) => step)).toEqual([0]);
    expect(played[0][1]).toBeCloseTo(0.05);

    advance(0.2); // clock at 0.2 s: schedules everything up to 0.32 s
    expect(played.map(([step]) => step)).toEqual([0, 1, 2]);
    expect(played[1][1]).toBeCloseTo(0.175);
    expect(played[2][1]).toBeCloseTo(0.3);
  });

  it("does not schedule a step twice when the timer fires again with no time passing", () => {
    const { transport, played, advance } = setup();
    transport.start();
    advance(0);
    advance(0);
    advance(0);
    expect(played).toHaveLength(1);
  });

  it("skips steps missed during a stall instead of playing them all at once", () => {
    const { transport, played, advance } = setup({ bpm: 120 }); // steps fall at 0.05 + n * 0.125 s
    transport.start();
    advance(0);
    played.length = 0;

    advance(1); // the timer was blocked for a second: steps 1 to 7 are long past
    // Only the step that is still ahead of the clock plays, on the original grid.
    expect(played).toHaveLength(1);
    expect(played[0][0]).toBe(8);
    expect(played[0][1]).toBeCloseTo(1.05);
  });

  it("moves the playhead across the steps skipped in a stall", () => {
    const { transport, advance, audio } = setup({ bpm: 120 });
    transport.start();
    advance(0);
    advance(1); // steps 1 to 7 are skipped; step 8 falls at 1.05 s, still ahead of the clock
    transport.poll();
    // The playhead is on the last step that has gone by, not stuck on step 0:
    // a live hit is quantized against it.
    expect(transport.playheadStep).toBe(7);
    expect(transport.playheadTime).toBeCloseTo(0.925);

    audio.ctx.currentTime = 1.06;
    transport.poll();
    expect(transport.playheadStep).toBe(8);
  });

  it("keeps the step order after a stall", () => {
    const { transport, played, advance } = setup({ steps: 4, bpm: 120 });
    transport.start();
    advance(0);
    advance(1);
    advance(0.25);
    // Step n always falls at 0.05 + n * 0.125 s, whatever was skipped on the way.
    for (const [step, time] of played) {
      expect(step).toBe(Math.round((time - 0.05) / 0.125) % 4);
    }
  });

  it("wraps from the last step back to the first", () => {
    const { transport, played, run } = setup({ steps: 4, bpm: 120 });
    transport.start();
    run(1);
    expect(played.slice(0, 6).map(([step]) => step)).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it("uses the tempo in force when each step is scheduled", () => {
    const { transport, played, advance, run } = setup({ bpm: 120 });
    transport.start();
    advance(0);
    transport.setBpm(60); // a step is now 0.25 s
    run(0.5);
    const gaps = played.slice(1).map(([, time], i) => time - played[i][1]);
    expect(gaps[0]).toBeCloseTo(0.125); // step 0 was scheduled at 120 BPM, so step 1 follows after 0.125 s
    expect(gaps[1]).toBeCloseTo(0.25);
  });

  it("setBpm clamps and returns the tempo it set", () => {
    const { transport } = setup();
    expect(transport.setBpm(1000)).toBe(240);
    expect(transport.setBpm(1)).toBe(40);
    expect(transport.setBpm(100.04)).toBe(100);
    expect(transport.bpm).toBe(100);
  });

  it("stop ends the scheduler, clears the queue and resets the playhead", () => {
    const { transport, played, advance, run } = setup();
    transport.start();
    run(0.3);
    transport.poll();
    expect(transport.playheadStep).toBeGreaterThanOrEqual(0);

    transport.stop();
    const count = played.length;
    advance(5);
    expect(played).toHaveLength(count);
    expect(transport.playing).toBe(false);
    expect(transport.playheadStep).toBe(-1);
    expect(transport.poll()).toBe(false);
  });

  it("restarts from the first step", () => {
    const { transport, played, advance } = setup({ bpm: 120 });
    transport.start();
    advance(0.5);
    transport.stop();
    played.length = 0;
    transport.start();
    advance(0);
    expect(played[0][0]).toBe(0);
  });
});

describe("playhead queue", () => {
  // requestAnimationFrame stops in a hidden tab while the scheduler keeps running,
  // so nothing calls poll() for as long as the tab stays in the background.
  it("stays small when poll is never called", () => {
    const { transport, run } = setup({ bpm: 120 });
    transport.start();
    run(60); // a minute, 480 steps
    // The step the playhead will land on, plus those still ahead of the clock.
    expect(transport.pendingSteps).toBeLessThanOrEqual(3);
  });

  it("still lands the playhead on the latest step that has arrived", () => {
    const { transport, run, audio } = setup({ bpm: 120 });
    transport.start();
    run(60);
    expect(transport.poll()).toBe(true);
    const latest = Math.floor((audio.ctx.currentTime - 0.05) / 0.125); // steps fall at 0.05 + n * 0.125 s
    expect(transport.playheadStep).toBe(latest % 16);
    expect(transport.playheadTime).toBeCloseTo(0.05 + latest * 0.125);
  });

  it("keeps the steps that are still ahead of the clock", () => {
    const { transport, advance, audio } = setup({ bpm: 120 });
    transport.start();
    advance(0.2); // steps 0, 1, 2 scheduled at 0.05, 0.175, 0.3
    advance(0.025); // clock 0.225: step 1 has arrived, step 2 is still ahead
    expect(transport.pendingSteps).toBe(2); // step 0 is behind step 1, so only it is dropped
    transport.poll();
    expect(transport.playheadStep).toBe(1);

    audio.ctx.currentTime = 0.31;
    expect(transport.poll()).toBe(true);
    expect(transport.playheadStep).toBe(2);
  });
});

describe("poll", () => {
  it("moves the playhead only to steps whose time has arrived", () => {
    const { transport, advance, audio } = setup({ bpm: 120 });
    transport.start();
    advance(0.2); // steps 0, 1, 2 scheduled at 0.05, 0.175, 0.3
    expect(transport.poll()).toBe(true); // clock is 0.2: steps 0 and 1 have arrived
    expect(transport.playheadStep).toBe(1);
    expect(transport.playheadTime).toBeCloseTo(0.175);

    expect(transport.poll()).toBe(false); // nothing new yet
    audio.ctx.currentTime = 0.31;
    expect(transport.poll()).toBe(true);
    expect(transport.playheadStep).toBe(2);
  });

  it("jumps straight to the latest step if several have arrived", () => {
    const { transport, advance, audio } = setup({ bpm: 120 });
    transport.start();
    advance(0.2);
    audio.ctx.currentTime = 10; // a long stall
    transport.poll();
    expect(transport.playheadStep).toBeGreaterThanOrEqual(2);
  });
});

// Live recording at a slow tempo: the pad is heard live and written into the next
// step, and that step may not have been scheduled yet. Without markHeard the
// scheduler would then play the new note a second time, a moment after the live one.
describe("markHeard", () => {
  function setupRecording({ bpm }) {
    const audio = fakeAudio();
    const pattern = new Set(); // "row:step" for each note in the pattern
    const sounded = []; // [row, step, time] for each sound the sequencer plays
    const transport = createTransport({
      audio,
      steps: 16,
      bpm,
      onStep(step, time, heard) {
        for (const row of [0, 1]) {
          if (pattern.has(`${row}:${step}`) && !heard.has(row)) sounded.push([row, step, time]);
        }
      },
    });
    const run = (seconds) => {
      for (let t = 0; t < seconds; t += LOOKAHEAD_MS / 1000) {
        audio.ctx.currentTime += LOOKAHEAD_MS / 1000;
        vi.advanceTimersByTime(LOOKAHEAD_MS);
      }
    };
    return { audio, pattern, sounded, transport, run };
  }

  const soundedAt = (sounded, row, step) => sounded.filter(([r, s]) => r === row && s === step);

  it("does not play a note again that was just heard live, on a step not yet scheduled", () => {
    const { transport, pattern, sounded, run } = setupRecording({ bpm: 40 }); // a step is 0.375 s
    transport.start();
    run(0.2); // step 0 is scheduled; step 1 (at 0.425 s) is still outside the lookahead
    pattern.add("0:1"); // a hit in the second half of step 0 is recorded into step 1
    transport.markHeard(0, 1);

    run(0.3);
    expect(soundedAt(sounded, 0, 1)).toHaveLength(0); // it was heard live already

    run(6); // one trip round the 16 steps: the recorded note now plays, as it should
    const plays = soundedAt(sounded, 0, 1);
    expect(plays).toHaveLength(1);
    expect(plays[0][2]).toBeCloseTo(0.425 + 16 * 0.375);
  });

  it("changes nothing when the step was already scheduled", () => {
    const { transport, pattern, sounded, run } = setupRecording({ bpm: 120 }); // a step is 0.125 s
    transport.start();
    run(0.2); // steps 0, 1 and 2 are scheduled
    pattern.add("0:2");
    transport.markHeard(0, 2); // too late to double: step 2 has already been passed over

    run(2.2);
    const plays = soundedAt(sounded, 0, 2);
    expect(plays).toHaveLength(1);
    expect(plays[0][2]).toBeCloseTo(0.05 + 2 * 0.125 + 16 * 0.125);
  });

  it("only silences the pad that was heard", () => {
    const { transport, pattern, sounded, run } = setupRecording({ bpm: 40 });
    transport.start();
    run(0.2);
    pattern.add("0:1");
    pattern.add("1:1");
    transport.markHeard(0, 1);

    run(0.3);
    expect(soundedAt(sounded, 0, 1)).toHaveLength(0);
    expect(soundedAt(sounded, 1, 1)).toHaveLength(1);
  });

  it("forgets what it was told when the transport stops", () => {
    const { transport, pattern, sounded, run } = setupRecording({ bpm: 40 });
    transport.start();
    transport.markHeard(0, 0);
    transport.stop();
    transport.start();
    pattern.add("0:0");

    run(0.2);
    expect(soundedAt(sounded, 0, 0)).toHaveLength(1);
  });

  it("forgets it when a stall skips past the step", () => {
    const { transport, pattern, sounded, audio, run } = setupRecording({ bpm: 40 });
    transport.start();
    run(0.2);
    pattern.add("0:1");
    transport.markHeard(0, 1);

    audio.ctx.currentTime += 12; // two whole trips round the steps go by in a stall
    vi.advanceTimersByTime(LOOKAHEAD_MS);
    run(0.2);
    // Step 1 comes round again, and this is a fresh pass: the note plays.
    const plays = soundedAt(sounded, 0, 1);
    expect(plays).toHaveLength(1);
    expect(plays[0][2]).toBeCloseTo(0.425 + 12);
  });
});
