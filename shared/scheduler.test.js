import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEDULER_TICK_MS, createScheduler } from "./scheduler.js";

// A clock that is whatever the test says it is. `time` is where "now" is, in seconds.
function fakeClock(time = 0) {
  const clock = { time, now: () => clock.time, prepare: vi.fn() };
  return clock;
}

function setup({ steps = 16, bpm = 120 } = {}) {
  const clock = fakeClock();
  const played = []; // [step, time] as the scheduler reports them
  const scheduler = createScheduler({ clock, steps, bpm, onStep: (step, time) => played.push([step, time]) });
  // Move the clock forward and let the scheduler wake up.
  const advance = (seconds) => {
    clock.time += seconds;
    vi.advanceTimersByTime(SCHEDULER_TICK_MS);
  };
  // Move the clock forward in scheduler ticks, as it moves when nothing stalls.
  const run = (seconds) => {
    for (let t = 0; t < seconds; t += SCHEDULER_TICK_MS / 1000) advance(SCHEDULER_TICK_MS / 1000);
  };
  return { clock, scheduler, played, advance, run };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createScheduler", () => {
  it("starts stopped, at the given tempo, with no playhead", () => {
    const { scheduler } = setup({ bpm: 90 });
    expect(scheduler.playing).toBe(false);
    expect(scheduler.bpm).toBe(90);
    expect(scheduler.playheadStep).toBe(-1);
  });

  it("start prepares the clock and reports whether it started", () => {
    const { clock, scheduler } = setup();
    expect(scheduler.start()).toBe(true);
    expect(clock.prepare).toHaveBeenCalled();
    expect(scheduler.playing).toBe(true);
    expect(scheduler.start()).toBe(false);
  });

  it("prepares the clock before it reads the time", () => {
    // Like the audio engine's context, which does not exist until it is prepared.
    let ready = false;
    const clock = {
      prepare: () => (ready = true),
      now: () => {
        if (!ready) throw new Error("clock read before prepare");
        return 0;
      },
    };
    const scheduler = createScheduler({ clock, steps: 16, onStep: () => {} });
    expect(() => scheduler.start()).not.toThrow();
  });

  it("poll does not read the clock while stopped", () => {
    const clock = {
      now: () => {
        throw new Error("clock read while stopped");
      },
    };
    const scheduler = createScheduler({ clock, steps: 16, onStep: () => {} });
    expect(scheduler.poll()).toBe(false);
  });

  it("clamps the tempo to the range it was given", () => {
    const scheduler = createScheduler({
      clock: fakeClock(),
      steps: 16,
      onStep: () => {},
      bpmRange: { min: 30, max: 300 },
    });
    expect(scheduler.setBpm(250)).toBe(250);
    expect(scheduler.setBpm(10)).toBe(30);
    expect(scheduler.setBpm(999)).toBe(300);
  });

  it("puts step 0 on the time it is given", () => {
    const { scheduler, played, advance } = setup({ bpm: 120 });
    scheduler.start(0.06); // 60 ms from now, not the usual 50 ms run-up
    advance(0);
    expect(played).toHaveLength(1);
    expect(played[0][0]).toBe(0);
    expect(played[0][1]).toBeCloseTo(0.06);
  });

  it("wraps to the new length when the loop is made shorter, and keeps going when it is longer", () => {
    const { scheduler, played, advance, run } = setup({ steps: 16, bpm: 120 });
    scheduler.start();
    run(1.6); // past step 12
    scheduler.setSteps(4);
    played.length = 0;
    run(1);
    const steps = played.map(([step]) => step);
    expect(steps.every((step) => step < 4)).toBe(true);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBe((steps[i - 1] + 1) % 4);

    scheduler.setSteps(8);
    played.length = 0;
    advance(0);
    run(2);
    const longer = played.map(([step]) => step);
    expect(Math.max(...longer)).toBe(7);
  });

  it("carries on past the old end when made longer just after it wrapped, wherever the click lands", () => {
    // The lookahead schedules the last step and wraps to 0 a little before that step sounds.
    const { scheduler, played, run } = setup({ steps: 4, bpm: 120 });
    scheduler.start();
    while (!played.some(([step]) => step === 3)) run(0.01); // step 3 is scheduled: the next one wrapped to 0
    played.length = 0;
    scheduler.setSteps(8);
    run(1);
    expect(played.slice(0, 4).map(([step]) => step)).toEqual([4, 5, 6, 7]);
  });

  it("starts from step 0 when made longer before anything was scheduled", () => {
    const { scheduler, played, run } = setup({ steps: 4, bpm: 120 });
    scheduler.start();
    scheduler.setSteps(8);
    run(0.5);
    expect(played[0][0]).toBe(0);
  });

  it("schedules again from a step it is rewound to, and the playhead does not report the taken-back ones", () => {
    const { scheduler, played, run } = setup({ steps: 16, bpm: 120 });
    scheduler.start();
    while (!played.some(([step]) => step === 2)) run(0.01); // step 2 (at 0.3 s) is scheduled, not yet reached
    const [, time] = played.find(([step]) => step === 2);
    played.length = 0;
    scheduler.rewindTo(2, time);
    run(0.4);
    expect(played[0]).toEqual([2, time]); // handed out again, at the same moment
    expect(played.slice(0, 3).map(([step]) => step)).toEqual([2, 3, 4]);
  });

  it("wraps the steps already queued for the playhead into the new length", () => {
    const { scheduler, run } = setup({ steps: 16, bpm: 120 });
    scheduler.start();
    run(1.6); // steps up to about 12 are queued, and the playhead has not been polled
    scheduler.setSteps(4);
    scheduler.poll();
    expect(scheduler.playheadStep).toBeGreaterThanOrEqual(0);
    expect(scheduler.playheadStep).toBeLessThan(4);
  });

  it("forgets a live hit marked on a step the shorter loop no longer has, so it does not silence that step when the loop grows again", () => {
    const clock = fakeClock();
    const heards = [];
    const scheduler = createScheduler({
      clock,
      steps: 16,
      bpm: 120,
      onStep: (step, _time, heard) => heards.push([step, [...heard]]),
    });
    const run = (seconds) => {
      for (let t = 0; t < seconds; t += SCHEDULER_TICK_MS / 1000) {
        clock.time += SCHEDULER_TICK_MS / 1000;
        vi.advanceTimersByTime(SCHEDULER_TICK_MS);
      }
    };
    scheduler.start();
    while (!heards.some(([step]) => step === 12)) run(0.01);
    const next = heards.at(-1)[0] + 1; // the step the scheduler will hand out next: 13 or so
    scheduler.markHeard(5, next); // a live hit on pad 5 was written into it
    scheduler.setSteps(4); // the step is gone
    scheduler.setSteps(16); // and back again
    heards.length = 0;
    run(3);
    const second = heards.find(([step]) => step === next);
    expect(second).toBeDefined();
    expect(second[1]).toEqual([]); // nothing is held back on it
  });

  it("starts with an empty queue after Stop and Start, so the playhead does not jump to an old step", () => {
    const { scheduler, played, run, clock } = setup({ steps: 16, bpm: 120 });
    scheduler.start();
    run(1);
    scheduler.stop();
    expect(scheduler.pendingSteps).toBe(0);
    clock.t += 5;
    scheduler.start();
    expect(scheduler.pendingSteps).toBe(0);
    expect(scheduler.poll()).toBe(false);
    expect(scheduler.playheadStep).toBe(-1);
    played.length = 0;
    run(0.2);
    expect(played[0][0]).toBe(0); // and it begins again at the first step
  });

  it("moves the playhead into the new length at once when the loop is made shorter", () => {
    const { scheduler, run } = setup({ steps: 16, bpm: 120 });
    scheduler.start();
    run(1.6);
    scheduler.poll();
    expect(scheduler.playheadStep).toBeGreaterThanOrEqual(4);
    scheduler.setSteps(4);
    expect(scheduler.playheadStep).toBeLessThan(4);
  });

  it("reports step times in the clock's own domain, and needs no prepare", () => {
    // A clock that starts far from zero, as performance.now() / 1000 does, with no prepare().
    const clock = { time: 5000, now: () => clock.time };
    const played = [];
    const scheduler = createScheduler({
      clock,
      steps: 16,
      bpm: 120,
      onStep: (step, time) => played.push([step, time]),
    });
    scheduler.start();
    vi.advanceTimersByTime(SCHEDULER_TICK_MS); // the first step, after the short run-up
    clock.time += 0.2;
    vi.advanceTimersByTime(SCHEDULER_TICK_MS);
    expect(played.map(([step]) => step)).toEqual([0, 1, 2]);
    expect(played[0][1]).toBeCloseTo(5000.05);
    expect(played[1][1]).toBeCloseTo(5000.175);
  });

  it("schedules steps ahead of the clock, one 16th note apart", () => {
    const { scheduler, played, advance } = setup({ bpm: 120 }); // a step is 0.125 s
    scheduler.start();
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
    const { scheduler, played, advance } = setup();
    scheduler.start();
    advance(0);
    advance(0);
    advance(0);
    expect(played).toHaveLength(1);
  });

  it("skips steps missed during a stall instead of playing them all at once", () => {
    const { scheduler, played, advance } = setup({ bpm: 120 }); // steps fall at 0.05 + n * 0.125 s
    scheduler.start();
    advance(0);
    played.length = 0;

    advance(1); // the timer was blocked for a second: steps 1 to 7 are long past
    // Only the step that is still ahead of the clock plays, on the original grid.
    expect(played).toHaveLength(1);
    expect(played[0][0]).toBe(8);
    expect(played[0][1]).toBeCloseTo(1.05);
  });

  it("moves the playhead across the steps skipped in a stall", () => {
    const { scheduler, advance, clock } = setup({ bpm: 120 });
    scheduler.start();
    advance(0);
    advance(1); // steps 1 to 7 are skipped; step 8 falls at 1.05 s, still ahead of the clock
    scheduler.poll();
    // The playhead is on the last step that has gone by, not stuck on step 0:
    // a live hit is quantized against it.
    expect(scheduler.playheadStep).toBe(7);
    expect(scheduler.playheadTime).toBeCloseTo(0.925);

    clock.time = 1.06;
    scheduler.poll();
    expect(scheduler.playheadStep).toBe(8);
  });

  it("keeps the step order after a stall", () => {
    const { scheduler, played, advance } = setup({ steps: 4, bpm: 120 });
    scheduler.start();
    advance(0);
    advance(1);
    advance(0.25);
    // Step n always falls at 0.05 + n * 0.125 s, whatever was skipped on the way.
    for (const [step, time] of played) {
      expect(step).toBe(Math.round((time - 0.05) / 0.125) % 4);
    }
  });

  it("wraps from the last step back to the first", () => {
    const { scheduler, played, run } = setup({ steps: 4, bpm: 120 });
    scheduler.start();
    run(1);
    expect(played.slice(0, 6).map(([step]) => step)).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it("uses the tempo in force when each step is scheduled", () => {
    const { scheduler, played, advance, run } = setup({ bpm: 120 });
    scheduler.start();
    advance(0);
    scheduler.setBpm(60); // a step is now 0.25 s
    run(0.5);
    const gaps = played.slice(1).map(([, time], i) => time - played[i][1]);
    expect(gaps[0]).toBeCloseTo(0.125); // step 0 was scheduled at 120 BPM, so step 1 follows after 0.125 s
    expect(gaps[1]).toBeCloseTo(0.25);
  });

  it("setBpm clamps and returns the tempo it set", () => {
    const { scheduler } = setup();
    expect(scheduler.setBpm(1000)).toBe(240);
    expect(scheduler.setBpm(1)).toBe(40);
    expect(scheduler.setBpm(100.04)).toBe(100);
    expect(scheduler.bpm).toBe(100);
  });

  it("stop ends the scheduler, clears the queue and resets the playhead", () => {
    const { scheduler, played, advance, run } = setup();
    scheduler.start();
    run(0.3);
    scheduler.poll();
    expect(scheduler.playheadStep).toBeGreaterThanOrEqual(0);

    scheduler.stop();
    const count = played.length;
    advance(5);
    expect(played).toHaveLength(count);
    expect(scheduler.playing).toBe(false);
    expect(scheduler.playheadStep).toBe(-1);
    expect(scheduler.poll()).toBe(false);
  });

  it("restarts from the first step", () => {
    const { scheduler, played, advance } = setup({ bpm: 120 });
    scheduler.start();
    advance(0.5);
    scheduler.stop();
    played.length = 0;
    scheduler.start();
    advance(0);
    expect(played[0][0]).toBe(0);
  });
});

describe("playhead queue", () => {
  // requestAnimationFrame stops in a hidden tab while the scheduler keeps running,
  // so nothing calls poll() for as long as the tab stays in the background.
  it("stays small when poll is never called", () => {
    const { scheduler, run } = setup({ bpm: 120 });
    scheduler.start();
    run(60); // a minute, 480 steps
    // The step the playhead will land on, plus those still ahead of the clock.
    expect(scheduler.pendingSteps).toBeLessThanOrEqual(3);
  });

  it("still lands the playhead on the latest step that has arrived", () => {
    const { scheduler, run, clock } = setup({ bpm: 120 });
    scheduler.start();
    run(60);
    expect(scheduler.poll()).toBe(true);
    const latest = Math.floor((clock.time - 0.05) / 0.125); // steps fall at 0.05 + n * 0.125 s
    expect(scheduler.playheadStep).toBe(latest % 16);
    expect(scheduler.playheadTime).toBeCloseTo(0.05 + latest * 0.125);
  });

  it("keeps the steps that are still ahead of the clock", () => {
    const { scheduler, advance, clock } = setup({ bpm: 120 });
    scheduler.start();
    advance(0.2); // steps 0, 1, 2 scheduled at 0.05, 0.175, 0.3
    advance(0.025); // clock 0.225: step 1 has arrived, step 2 is still ahead
    expect(scheduler.pendingSteps).toBe(2); // step 0 is behind step 1, so only it is dropped
    scheduler.poll();
    expect(scheduler.playheadStep).toBe(1);

    clock.time = 0.31;
    expect(scheduler.poll()).toBe(true);
    expect(scheduler.playheadStep).toBe(2);
  });
});

describe("poll", () => {
  it("moves the playhead only to steps whose time has arrived", () => {
    const { scheduler, advance, clock } = setup({ bpm: 120 });
    scheduler.start();
    advance(0.2); // steps 0, 1, 2 scheduled at 0.05, 0.175, 0.3
    expect(scheduler.poll()).toBe(true); // clock is 0.2: steps 0 and 1 have arrived
    expect(scheduler.playheadStep).toBe(1);
    expect(scheduler.playheadTime).toBeCloseTo(0.175);

    expect(scheduler.poll()).toBe(false); // nothing new yet
    clock.time = 0.31;
    expect(scheduler.poll()).toBe(true);
    expect(scheduler.playheadStep).toBe(2);
  });

  it("jumps straight to the latest step if several have arrived", () => {
    const { scheduler, advance, clock } = setup({ bpm: 120 });
    scheduler.start();
    advance(0.2);
    clock.time = 10; // a long stall
    scheduler.poll();
    expect(scheduler.playheadStep).toBeGreaterThanOrEqual(2);
  });
});

// Live recording at a slow tempo: the pad is heard live and written into the next
// step, and that step may not have been scheduled yet. Without markHeard the
// scheduler would then play the new note a second time, a moment after the live one.
describe("markHeard", () => {
  function setupRecording({ bpm }) {
    const clock = fakeClock();
    const pattern = new Set(); // "row:step" for each note in the pattern
    const sounded = []; // [row, step, time] for each sound the sequencer plays
    const scheduler = createScheduler({
      clock,
      steps: 16,
      bpm,
      onStep(step, time, heard) {
        for (const row of [0, 1]) {
          if (pattern.has(`${row}:${step}`) && !heard.has(row)) sounded.push([row, step, time]);
        }
      },
    });
    const run = (seconds) => {
      for (let t = 0; t < seconds; t += SCHEDULER_TICK_MS / 1000) {
        clock.time += SCHEDULER_TICK_MS / 1000;
        vi.advanceTimersByTime(SCHEDULER_TICK_MS);
      }
    };
    return { clock, pattern, sounded, scheduler, run };
  }

  const soundedAt = (sounded, row, step) => sounded.filter(([r, s]) => r === row && s === step);

  it("does not play a note again that was just heard live, on a step not yet scheduled", () => {
    const { scheduler, pattern, sounded, run } = setupRecording({ bpm: 40 }); // a step is 0.375 s
    scheduler.start();
    run(0.2); // step 0 is scheduled; step 1 (at 0.425 s) is still outside the lookahead
    pattern.add("0:1"); // a hit in the second half of step 0 is recorded into step 1
    scheduler.markHeard(0, 1);

    run(0.3);
    expect(soundedAt(sounded, 0, 1)).toHaveLength(0); // it was heard live already

    run(6); // one trip round the 16 steps: the recorded note now plays, as it should
    const plays = soundedAt(sounded, 0, 1);
    expect(plays).toHaveLength(1);
    expect(plays[0][2]).toBeCloseTo(0.425 + 16 * 0.375);
  });

  it("forgets a live hit that was waiting for its step, when asked (the pattern was replaced)", () => {
    const { scheduler, pattern, sounded, run } = setupRecording({ bpm: 40 });
    scheduler.start();
    run(0.2);
    pattern.add("0:1");
    scheduler.markHeard(0, 1);
    scheduler.forgetHeard();

    run(0.3);
    expect(soundedAt(sounded, 0, 1)).toHaveLength(1); // not suppressed: it was never heard in this pattern
  });

  it("changes nothing when the step was already scheduled", () => {
    const { scheduler, pattern, sounded, run } = setupRecording({ bpm: 120 }); // a step is 0.125 s
    scheduler.start();
    run(0.2); // steps 0, 1 and 2 are scheduled
    pattern.add("0:2");
    scheduler.markHeard(0, 2); // too late to double: step 2 has already been passed over

    run(2.2);
    const plays = soundedAt(sounded, 0, 2);
    expect(plays).toHaveLength(1);
    expect(plays[0][2]).toBeCloseTo(0.05 + 2 * 0.125 + 16 * 0.125);
  });

  it("only silences the pad that was heard", () => {
    const { scheduler, pattern, sounded, run } = setupRecording({ bpm: 40 });
    scheduler.start();
    run(0.2);
    pattern.add("0:1");
    pattern.add("1:1");
    scheduler.markHeard(0, 1);

    run(0.3);
    expect(soundedAt(sounded, 0, 1)).toHaveLength(0);
    expect(soundedAt(sounded, 1, 1)).toHaveLength(1);
  });

  it("forgets what it was told when the scheduler stops", () => {
    const { scheduler, pattern, sounded, run } = setupRecording({ bpm: 40 });
    scheduler.start();
    scheduler.markHeard(0, 0);
    scheduler.stop();
    scheduler.start();
    pattern.add("0:0");

    run(0.2);
    expect(soundedAt(sounded, 0, 0)).toHaveLength(1);
  });

  it("forgets it when a stall skips past the step", () => {
    const { scheduler, pattern, sounded, clock, run } = setupRecording({ bpm: 40 });
    scheduler.start();
    run(0.2);
    pattern.add("0:1");
    scheduler.markHeard(0, 1);

    clock.time += 12; // two whole trips round the steps go by in a stall
    vi.advanceTimersByTime(SCHEDULER_TICK_MS);
    run(0.2);
    // Step 1 comes round again, and this is a fresh pass: the note plays.
    const plays = soundedAt(sounded, 0, 1);
    expect(plays).toHaveLength(1);
    expect(plays[0][2]).toBeCloseTo(0.425 + 12);
  });
});
