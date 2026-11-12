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

  describe("swing", () => {
    // 120 BPM: a step is 0.125 s on the grid.
    const stepTimes = (played, count) => Object.fromEntries(played.slice(0, count));

    it("plays every step on the grid when it is straight", () => {
      const { scheduler, played, run } = setup({ bpm: 120 });
      scheduler.start(0);
      run(0.5);
      const times = stepTimes(played, 4);
      expect(times[1] - times[0]).toBeCloseTo(0.125);
      expect(times[2] - times[1]).toBeCloseTo(0.125);
    });

    it("plays the second step of each pair later, and the next pair where it was", () => {
      const { scheduler, played, run } = setup({ bpm: 120 });
      scheduler.setSwing(66);
      scheduler.start(0);
      run(0.5);
      const times = stepTimes(played, 5);
      expect(times[1] - times[0]).toBeCloseTo(0.165); // a bigger first half
      expect(times[2] - times[1]).toBeCloseTo(0.085); // and a smaller second
      expect(times[2]).toBeCloseTo(0.25); // the pair as a whole is two steps long, as before
      expect(times[4]).toBeCloseTo(0.5);
    });

    it("can be set to begin with, and read back as set", () => {
      const clock = fakeClock();
      const scheduler = createScheduler({ clock, steps: 16, bpm: 120, swing: 60, onStep: () => {} });
      expect(scheduler.swing).toBe(60);
      expect(scheduler.setSwing(200)).toBe(75);
      expect(scheduler.swing).toBe(75);
    });

    it("moves the playhead with the step, not before it", () => {
      const { clock, scheduler, run } = setup({ bpm: 120 });
      scheduler.setSwing(66);
      scheduler.start(0);
      run(0.1);
      clock.time = 0.15; // past the grid place of step 1 (0.125), before it sounds (0.165)
      scheduler.poll();
      expect(scheduler.playheadStep).toBe(0);
      clock.time = 0.17;
      scheduler.poll();
      expect(scheduler.playheadStep).toBe(1);
    });

    // A scheduler that also records the grid time each step was given, as the sampler's controller does.
    function withGrid(swing) {
      const clock = fakeClock();
      const steps = []; // { step, time, grid }
      const scheduler = createScheduler({
        clock,
        steps: 16,
        bpm: 120,
        swing,
        onStep: (step, time, _heard, grid) => steps.push({ step, time, grid }),
      });
      const run = (seconds) => {
        for (let t = 0; t < seconds; t += SCHEDULER_TICK_MS / 1000) {
          clock.time += SCHEDULER_TICK_MS / 1000;
          vi.advanceTimersByTime(SCHEDULER_TICK_MS);
        }
      };
      return { clock, scheduler, steps, run };
    }

    it("gives each step its place on the grid, which swing does not move", () => {
      const { scheduler, steps, run } = withGrid(66);
      scheduler.start(0);
      run(0.5);
      expect(steps.slice(0, 5).map(({ grid }) => grid)).toEqual([0, 0.125, 0.25, 0.375, 0.5]);
      expect(steps[1].time).toBeCloseTo(0.165); // sounded later than its place
    });

    it("builds a step again at its place on the grid", () => {
      const { scheduler, steps, run } = withGrid(66);
      scheduler.start(0);
      run(0.3); // steps up to 3 are handed out, and the clock is before them
      const { grid } = steps.find(({ step }) => step === 3);
      steps.length = 0;
      scheduler.rewindTo(3, grid);
      run(0.4);
      expect(steps[0].step).toBe(3);
      expect(steps[0].time).toBeCloseTo(0.375 + 0.04); // delayed once, not twice
      expect(steps[1].step).toBe(4);
      expect(steps[1].time).toBeCloseTo(0.5, 2); // and the next pair is on the grid
    });

    it("plays a step built again whose grid place is late but whose swung sound is not yet", () => {
      const { clock, scheduler, steps, run } = withGrid(75);
      scheduler.start(0);
      run(0.3);
      const { grid } = steps.find(({ step }) => step === 3); // on the grid at 0.375, sounding at 0.4375
      steps.length = 0;
      clock.time = 0.43; // 0.055 s after the grid place, more than a step may be late; 0.0075 s before it sounds
      scheduler.rewindTo(3, grid);
      vi.advanceTimersByTime(SCHEDULER_TICK_MS);
      expect(steps[0].step).toBe(3);
      expect(steps[0].time).toBeCloseTo(0.4375);
    });

    it("still skips a step that has gone by once it has sounded as well", () => {
      const { clock, scheduler, steps, run } = withGrid(75);
      scheduler.start(0);
      run(0.3);
      const { grid } = steps.find(({ step }) => step === 3);
      steps.length = 0;
      clock.time = 0.5; // 0.0625 s after it should have sounded
      scheduler.rewindTo(3, grid);
      vi.advanceTimersByTime(SCHEDULER_TICK_MS);
      expect(steps.find(({ step }) => step === 3)).toBeUndefined();
      expect(steps[0].step).toBe(4);
    });

    it("says how late the playhead's step was set to sound, with the swing it had when it was queued", () => {
      const { clock, scheduler, run } = setup({ bpm: 120 });
      scheduler.setSwing(75);
      scheduler.start(0);
      run(0.15);
      scheduler.setSwing(50); // moved after the steps were queued
      clock.time = 0.2; // step 1 sounds at 0.1875
      scheduler.poll();
      expect(scheduler.playheadStep).toBe(1);
      expect(scheduler.playheadDelay).toBeCloseTo(0.0625);
      clock.time = 0.26;
      scheduler.poll();
      expect(scheduler.playheadStep).toBe(2);
      expect(scheduler.playheadDelay).toBe(0);
    });

    it("keeps the loop where it was when the swing changed between a step being scheduled and built again", () => {
      for (const [before, after] of [
        [75, 50],
        [50, 75],
      ]) {
        const { scheduler, steps, run } = withGrid(before);
        scheduler.start(0);
        run(0.3);
        const { grid } = steps.find(({ step }) => step === 3);
        scheduler.setSwing(after);
        steps.length = 0;
        scheduler.rewindTo(3, grid);
        run(0.4);
        const four = steps.find(({ step }) => step === 4);
        expect(four.grid).toBeCloseTo(0.5); // the grid is where it was, whatever the swing did
        expect(four.time).toBeCloseTo(0.5); // an even step sounds on the grid
      }
    });
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
    clock.time += 5;
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

describe("passes", () => {
  // A scheduler that reports each step and each wrap, in the order they happen.
  function withWraps({ steps = 4, bpm = 120, swing, onWrap = () => {} } = {}) {
    const clock = fakeClock();
    const log = [];
    const scheduler = createScheduler({
      clock,
      steps,
      bpm,
      ...(swing === undefined ? {} : { swing }),
      onStep: (step, time) => log.push(`step ${step} @${time.toFixed(3)}`),
      onWrap: (time) => {
        log.push(`wrap @${time.toFixed(3)}`);
        onWrap(time, scheduler);
      },
    });
    const advance = (seconds) => {
      clock.time += seconds;
      vi.advanceTimersByTime(SCHEDULER_TICK_MS);
    };
    const run = (seconds) => {
      for (let t = 0; t < seconds; t += SCHEDULER_TICK_MS / 1000) advance(SCHEDULER_TICK_MS / 1000);
    };
    return { clock, scheduler, log, advance, run };
  }

  it("calls onWrap each time the loop comes round, before the first step of the new pass, with the time that step falls", () => {
    const { scheduler, log, run } = withWraps({ steps: 4, bpm: 120 }); // steps fall at 0.05 + n * 0.125 s
    scheduler.start();
    run(0.9);
    expect(log.slice(0, 7)).toEqual([
      "step 0 @0.050",
      "step 1 @0.175",
      "step 2 @0.300",
      "step 3 @0.425",
      "wrap @0.550",
      "step 0 @0.550",
      "step 1 @0.675",
    ]);
  });

  it("does not call onWrap before a loop has come round, or once it is stopped", () => {
    const { scheduler, log, run } = withWraps({ steps: 4, bpm: 120 });
    scheduler.start();
    run(0.3); // steps 0 to 2
    expect(log.some((entry) => entry.startsWith("wrap"))).toBe(false);
    scheduler.stop();
    log.length = 0;
    run(2);
    expect(log).toEqual([]);
  });

  it("starts a pass of another length from its first step: shorter", () => {
    const { scheduler, log, run } = withWraps({ steps: 4, onWrap: (_time, s) => s.startPass(2) });
    scheduler.start();
    run(1.2);
    const steps = log.filter((entry) => entry.startsWith("step")).map((entry) => Number(entry.split(" ")[1]));
    expect(steps.slice(0, 10)).toEqual([0, 1, 2, 3, 0, 1, 0, 1, 0, 1]);
  });

  it("starts a pass of another length from its first step: longer, and not carried on from where the old one ended", () => {
    let first = true;
    const { scheduler, log, run } = withWraps({
      steps: 2,
      onWrap: (_time, s) => {
        if (first) s.startPass(4);
        first = false;
      },
    });
    scheduler.start();
    run(1.4);
    const steps = log.filter((entry) => entry.startsWith("step")).map((entry) => Number(entry.split(" ")[1]));
    expect(steps.slice(0, 10)).toEqual([0, 1, 0, 1, 2, 3, 0, 1, 2, 3]); // the first pass of 4 starts at 0, where setSteps would have gone on to 2
  });

  it("leaves the steps already queued for the playhead as they were when a pass of another length begins", () => {
    const { scheduler, run, clock } = withWraps({ steps: 4, bpm: 120, onWrap: (_time, s) => s.startPass(2) });
    scheduler.start();
    run(0.5); // steps 0 to 3 are scheduled, and the wrap at 0.55 is about to come
    clock.time = 0.43;
    scheduler.poll();
    expect(scheduler.playheadStep).toBe(3); // not wrapped into 2 steps, as setSteps would
  });

  it("calls onWrap once for a stall that skips past the end of a pass, and lands in the pass that began there", () => {
    let first = true;
    const { scheduler, log, advance } = withWraps({
      steps: 4,
      bpm: 120,
      onWrap: (_time, s) => {
        if (first) s.startPass(8);
        first = false;
      },
    });
    scheduler.start();
    advance(0); // step 0 at 0.05
    log.length = 0;
    advance(1); // the timer was blocked for a second: steps 1 to 7 are long past, the pass of 4 ended at 0.55 s
    expect(log.filter((entry) => entry.startsWith("wrap"))).toEqual(["wrap @0.550"]);
    // The grid has the pass of 8 beginning at 0.55 s, so the step that falls at 1.05 s is its step 4.
    expect(log.filter((entry) => entry.startsWith("step"))).toEqual(["step 4 @1.050"]);
  });

  // What a policy that changes the length at every wrap, as a chain of sequences would, does the same in a stall as it does when
  // the steps are scheduled one by one: each pass end the stall crossed is told, in order, and the next pass is the length the
  // last one chose.
  it("calls onWrap for each pass end a stall crosses, so a length chosen at each of them lands the grid where uninterrupted play does", () => {
    const lengths = () => {
      const next = [8, 2, 4, 8];
      return (_time, s) => {
        if (next.length) s.startPass(next.shift());
      };
    };
    const steady = withWraps({ steps: 4, bpm: 120, onWrap: lengths() });
    steady.scheduler.start();
    steady.run(2.6);
    const stalled = withWraps({ steps: 4, bpm: 120, onWrap: lengths() });
    stalled.scheduler.start();
    stalled.advance(0.1);
    stalled.advance(1.9); // the timer was held up for two seconds, across three pass ends
    stalled.run(0.6);
    const wraps = (log) => log.filter((entry) => entry.startsWith("wrap"));
    expect(wraps(stalled.log)).toEqual(wraps(steady.log));
    expect(wraps(steady.log).slice(0, 4)).toEqual(["wrap @0.550", "wrap @1.550", "wrap @1.800", "wrap @2.300"]);
    const stepsFrom = (log, time) =>
      log.filter((entry) => entry.startsWith("step") && Number(entry.split("@")[1]) >= time);
    expect(stepsFrom(stalled.log, 2.0)).toEqual(stepsFrom(steady.log, 2.0));
    expect(stepsFrom(stalled.log, 2.0)[0]).toBe("step 2 @2.050");
  });

  // 120 BPM, 4 steps: they fall at 0.05, 0.175, 0.3, 0.425, and the pass ends at 0.55; after the first tick the next step is 1,
  // at 0.175, and a step is late enough to be skipped once it is 0.03 s behind the clock.
  it("calls onWrap, and begins the next pass, when a stall ends exactly where the pass does", () => {
    const { scheduler, log, advance } = withWraps({ steps: 4, bpm: 120, onWrap: (_time, s) => s.startPass(2) });
    scheduler.start();
    advance(0);
    log.length = 0;
    advance(0.5); // steps 1, 2 and 3 are past: the pass is over at 0.55 s, and the next begins
    expect(log).toEqual(["wrap @0.550", "step 0 @0.550"]);
  });

  it("calls no onWrap for a stall that ends a step before the pass does, and then does where the pass ends", () => {
    const { scheduler, log, advance } = withWraps({ steps: 4, bpm: 120 });
    scheduler.start();
    advance(0);
    log.length = 0;
    advance(0.4); // steps 1 and 2 are past
    expect(log).toEqual(["step 3 @0.425", "wrap @0.550"]);
  });

  it("puts the playhead after a stall at where the last step it skipped sounded, swing and all", () => {
    let first = true;
    const { scheduler, advance, clock } = withWraps({
      steps: 4,
      bpm: 120,
      swing: 66, // the odd steps sound 0.04 s late
      onWrap: (_time, s) => {
        if (first) s.startPass(8);
        first = false;
      },
    });
    scheduler.start();
    advance(0);
    advance(1);
    clock.time = 1.0;
    scheduler.poll();
    expect(scheduler.playheadStep).toBe(3); // step 7 of the grid is the pass of 8's step 3, an odd one
    expect(scheduler.playheadTime).toBeCloseTo(0.05 + 7 * 0.125 + 0.04);
    expect(scheduler.playheadDelay).toBeCloseTo(0.04); // what a live hit is quantized against: how late that step sounds
  });

  it("numbers the playhead after a stall by the pass that began in it, whichever length that is", () => {
    const { scheduler, log, advance, clock } = withWraps({ steps: 4, bpm: 120, onWrap: (_time, s) => s.startPass(2) });
    scheduler.start();
    advance(0);
    log.length = 0;
    advance(1);
    clock.time = 1.0;
    scheduler.poll();
    expect(scheduler.playheadStep).toBe(1); // steps 4 to 7 of the grid are 0, 1, 0, 1 of passes of 2: not 7 % 4
    expect(log.filter((entry) => entry.startsWith("step"))).toEqual(["step 0 @1.050"]);
  });

  it("puts the playhead after a stall on a step of the pass that began in it, as long as that pass is", () => {
    let first = true;
    const { scheduler, advance, clock } = withWraps({
      steps: 4,
      bpm: 120,
      onWrap: (_time, s) => {
        if (first) s.startPass(16);
        first = false;
      },
    });
    scheduler.start();
    advance(0);
    advance(1);
    clock.time = 1.0;
    scheduler.poll();
    expect(scheduler.playheadStep).toBe(3); // step 7 of the old grid is step 3 of the pass of 16 that began at 0.55 s
  });

  it("does not go on scheduling when onWrap stops it, and leaves nothing for a restart to find", () => {
    const { scheduler, log, run, advance } = withWraps({ steps: 4, bpm: 120, onWrap: (_time, s) => s.stop() });
    scheduler.start();
    run(1);
    expect(log).toEqual(["step 0 @0.050", "step 1 @0.175", "step 2 @0.300", "step 3 @0.425", "wrap @0.550"]);
    // The same in a late tick, which has to work out where the pass ends first.
    const late = withWraps({ steps: 4, bpm: 120, onWrap: (_time, s) => s.stop() });
    late.scheduler.start();
    late.advance(0);
    late.log.length = 0;
    late.advance(1);
    expect(late.log).toEqual(["wrap @0.550"]);
    expect(late.scheduler.pendingSteps).toBe(0);
    expect(late.scheduler.playing).toBe(false);
    advance(0);
  });

  it("carries on from the wrap when onWrap throws, in a tick that was late as in one that was not", () => {
    const throwOnce = () => {
      let thrown = false;
      return (_time, s) => {
        s.startPass(8);
        if (!thrown) {
          thrown = true;
          throw new Error("a view failed");
        }
      };
    };
    const { scheduler, log, advance } = withWraps({ steps: 4, bpm: 120, onWrap: throwOnce() });
    scheduler.start();
    advance(0);
    log.length = 0;
    expect(() => advance(1)).toThrow("a view failed");
    advance(0); // the next tick: the clock is where it was
    // The pass of 8 began at 0.55 s, so what falls at 1.05 s is its step 4 (not a step the failed tick had half worked out).
    expect(log.filter((entry) => entry.startsWith("step"))).toEqual(["step 4 @1.050"]);
    expect(scheduler.playing).toBe(true);
  });

  it("ignores a pass length that is not a whole number of steps, at least one", () => {
    const { scheduler, log, run } = withWraps({
      steps: 4,
      onWrap: (_time, s) => {
        for (const bad of [0, -1, NaN, 2.5, Infinity]) s.startPass(bad);
      },
    });
    scheduler.start();
    run(1.5);
    const steps = log.filter((entry) => entry.startsWith("step")).map((entry) => entry.split(" ")[1]);
    expect(steps.slice(0, 10)).toEqual(["0", "1", "2", "3", "0", "1", "2", "3", "0", "1"]);
  });

  // At 40 BPM a step is 0.375 s and the lookahead 0.12 s, so the first step of the pass that comes is not scheduled until well after
  // onWrap: for that long, a person changing the length of the loop is changing the pass that has not begun.
  it("begins the new pass at its first step when the loop is made longer before that step is scheduled", () => {
    const { scheduler, log, run } = withWraps({ steps: 4, bpm: 40, onWrap: (_time, s) => s.startPass(2) });
    scheduler.start();
    run(1.1); // steps 0 to 3 are scheduled; the wrap is at 1.55 s
    expect(log[log.length - 1]).toBe("wrap @1.550");
    scheduler.setSteps(8);
    run(0.6);
    expect(log.filter((entry) => entry.startsWith("step"))[4]).toBe("step 0 @1.550"); // not step 2, carried on from where a pass of 2 ended
  });

  // A pass begun by startPass is fresh only until its first step is scheduled: a wrap after it is a wrap like any other.
  it("carries on into a longer loop from a wrap that came after a pass began by startPass", () => {
    let wraps = 0;
    const { scheduler, log, run } = withWraps({
      steps: 4,
      bpm: 40,
      onWrap: (_time, s) => {
        if (wraps++ === 0) s.startPass(4);
      },
    });
    scheduler.start();
    run(2.8); // the first wrap is at 1.55 s, the second at 3.05 s: the last step of the pass is scheduled at about 2.6 s
    expect(log[log.length - 1]).toBe("wrap @3.050");
    scheduler.setSteps(8);
    run(0.3);
    expect(log.filter((entry) => entry.startsWith("step")).at(-1)).toBe("step 4 @3.050");
  });

  it("carries on into a longer loop when a stall crossed a pass begun by startPass and then a plain one, ending where it ends", () => {
    let wraps = 0;
    const { scheduler, log, advance, run } = withWraps({
      steps: 4,
      bpm: 40,
      onWrap: (_time, s) => {
        if (wraps++ === 0) s.startPass(4);
      },
    });
    scheduler.start();
    advance(0);
    advance(2.8); // two pass ends at 1.55 s and 3.05 s: the stall ends exactly at the second, and its first step is not scheduled yet
    expect(log[log.length - 1]).toBe("wrap @3.050");
    scheduler.setSteps(8);
    run(0.3);
    expect(log.filter((entry) => entry.startsWith("step")).at(-1)).toBe("step 4 @3.050");
  });

  // 120 BPM, 8 steps: they fall at 0.05, 0.175, 0.3, 0.425, 0.55... After the tick at 0.325 step 3 is scheduled and the next is 4.
  describe("a loop made shorter", () => {
    const atStepFour = (options = {}) => {
      const w = withWraps({ steps: 8, bpm: 120, ...options });
      w.scheduler.start();
      w.run(0.325); // the tick at 0.325 schedules step 3, at 0.425 s
      expect(w.log[w.log.length - 1]).toBe("step 3 @0.425");
      return w;
    };

    it("that ends where the scheduler is has come round: onWrap is told, with where the next step falls", () => {
      const { scheduler, log, run } = atStepFour();
      scheduler.setSteps(4); // step 4 of 8 is step 0 of 4
      expect(log[log.length - 1]).toBe("wrap @0.550");
      run(0.6); // the pass of 4 that begins at 0.55 s ends at 1.05 s
      expect(log.filter((entry) => entry.startsWith("wrap"))).toEqual(["wrap @0.550", "wrap @1.050"]);
      expect(log[log.indexOf("wrap @0.550") + 1]).toBe("step 0 @0.550");
    });

    it("lets onWrap begin the pass that comes at another length", () => {
      const { scheduler, log, run } = atStepFour({ onWrap: (_time, s) => s.startPass(2) });
      scheduler.setSteps(4);
      run(0.5);
      const steps = log.filter((entry) => entry.startsWith("step")).map((entry) => Number(entry.split(" ")[1]));
      expect(steps.slice(-4)).toEqual([0, 1, 0, 1]);
    });

    it("that ends somewhere else in the loop has not come round", () => {
      const { scheduler, log } = atStepFour();
      scheduler.setSteps(3); // step 4 of 8 is step 1 of 3
      expect(log.some((entry) => entry.startsWith("wrap"))).toBe(false);
    });

    it("tells onWrap once, not again, when the loop had already come round", () => {
      const { scheduler, log, run } = withWraps({ steps: 4, bpm: 40 });
      scheduler.start();
      run(1.1); // the last step of the pass is scheduled and the loop has come round, with the first step of the next not yet
      expect(log.filter((entry) => entry.startsWith("wrap"))).toHaveLength(1);
      scheduler.setSteps(2);
      expect(log.filter((entry) => entry.startsWith("wrap"))).toHaveLength(1);
    });

    it("says nothing once it is stopped, wherever the loop had got to", () => {
      const { scheduler, log } = atStepFour();
      scheduler.stop();
      scheduler.setSteps(4); // the step that would have been next is where a loop of 4 ends
      expect(log.some((entry) => entry.startsWith("wrap"))).toBe(false);
    });

    it("says nothing before there is a loop to come round", () => {
      const { scheduler, log } = withWraps({ steps: 8, bpm: 120 });
      scheduler.setSteps(4);
      scheduler.start();
      scheduler.setSteps(2);
      expect(log.some((entry) => entry.startsWith("wrap"))).toBe(false);
    });
  });

  it("says where the next step to schedule falls on the grid, which a page that builds steps again can compare with a pass end", () => {
    const { scheduler, advance } = withWraps({ steps: 8, bpm: 120 });
    scheduler.start();
    advance(0); // step 0 is scheduled, at 0.05 s
    expect(scheduler.nextTime).toBeCloseTo(0.175);
    scheduler.rewindTo(0, 0.05);
    expect(scheduler.nextTime).toBeCloseTo(0.05);
  });

  it("is untouched by a stall that does not cross a wrap", () => {
    const { scheduler, log, advance } = withWraps({ steps: 16, bpm: 120 });
    scheduler.start();
    advance(0);
    log.length = 0;
    advance(0.6);
    expect(log.some((entry) => entry.startsWith("wrap"))).toBe(false);
  });
});

describe("the end of a run", () => {
  // 4 steps at 120 BPM: a step is 0.125 s, the steps fall at 0.05, 0.175, 0.3 and 0.425 s, and the pass ends at 0.55 s. The scheduler
  // reaches that end (and calls onWrap) as soon as it has scheduled the last step, at the tick when the clock passes 0.305 s.
  function withEnd({ steps = 4, bpm = 120, swing, onWrap = () => {} } = {}) {
    const clock = fakeClock();
    const log = [];
    const ends = []; // the clock when the scheduler said the run was over, and whether it was playing then
    const scheduler = createScheduler({
      clock,
      steps,
      bpm,
      ...(swing === undefined ? {} : { swing }),
      onStep: (step, time) => log.push(`step ${step} @${time.toFixed(3)}`),
      onWrap: (time) => {
        log.push(`wrap @${time.toFixed(3)}`);
        onWrap(time, scheduler);
      },
      onEnd: () => {
        log.push("end");
        ends.push({ at: clock.time, playing: scheduler.playing });
      },
    });
    const advance = (seconds) => {
      clock.time += seconds;
      vi.advanceTimersByTime(SCHEDULER_TICK_MS);
    };
    const run = (seconds) => {
      for (let t = 0; t < seconds - 1e-9; t += SCHEDULER_TICK_MS / 1000) advance(SCHEDULER_TICK_MS / 1000);
    };
    const stepsLogged = () => log.filter((entry) => entry.startsWith("step"));
    return { clock, scheduler, log, ends, advance, run, stepsLogged };
  }
  const endsAtFirstWrap = (time, scheduler) => scheduler.endAt(time);
  // Ends the first time it is told of a pass end, and goes on after that.
  const endsOnce = () => {
    let told = 0;
    return (time, scheduler) => {
      if (told++ === 0) scheduler.endAt(time);
    };
  };

  it("schedules no step from the pass end on, and has not stopped until the clock gets there", () => {
    const { scheduler, log, run, stepsLogged, ends, clock } = withEnd({ onWrap: endsAtFirstWrap });
    scheduler.start();
    run(0.5); // 0.5 s: the last step has been scheduled (it sounds at 0.425 s) and the pass end (0.55 s) is ahead
    expect(stepsLogged()).toEqual(["step 0 @0.050", "step 1 @0.175", "step 2 @0.300", "step 3 @0.425"]);
    expect(log).toContain("wrap @0.550");
    expect(scheduler.playing).toBe(true);
    expect(ends).toEqual([]);
    expect(clock.time).toBeCloseTo(0.5);
    run(0.025); // 0.525 s: still ahead of it
    expect(scheduler.playing).toBe(true);
    expect(ends).toEqual([]);
  });

  it("stops itself when the clock reaches the pass end, and says so, once, after it has stopped", () => {
    const { scheduler, run, ends, stepsLogged } = withEnd({ onWrap: endsAtFirstWrap });
    scheduler.start();
    run(2);
    expect(ends).toHaveLength(1);
    expect(ends[0].playing).toBe(false); // the page reads "stopped" from inside onEnd
    expect(ends[0].at).toBeGreaterThanOrEqual(0.55);
    expect(ends[0].at).toBeLessThan(0.55 + SCHEDULER_TICK_MS / 1000 + 1e-9); // at the first tick after it
    expect(scheduler.playing).toBe(false);
    expect(stepsLogged()).toHaveLength(4); // nothing was scheduled after the end, and the timer is not left running
    expect(vi.getTimerCount()).toBe(0);
  });

  it("moves the playhead to the last step before it ends, and not after", () => {
    const { scheduler, run } = withEnd({ onWrap: endsAtFirstWrap });
    scheduler.start();
    run(0.45);
    expect(scheduler.poll()).toBe(true);
    expect(scheduler.playheadStep).toBe(3);
    run(2);
    expect(scheduler.poll()).toBe(false);
    expect(scheduler.playheadStep).toBe(-1);
  });

  it("still schedules the last step of a pass swung late: it sounds before the end", () => {
    const { scheduler, run, stepsLogged, log } = withEnd({ swing: 75, onWrap: endsAtFirstWrap });
    scheduler.start();
    run(1);
    expect(stepsLogged()).toHaveLength(4);
    const last = Number(stepsLogged()[3].split("@")[1]);
    expect(last).toBeGreaterThan(0.425); // swung late
    expect(last).toBeLessThan(0.55);
    expect(log).toContain("end");
  });

  it("says when it ends, as a time, and nothing once it has stopped or been taken back", () => {
    const { scheduler, run } = withEnd({ onWrap: endsAtFirstWrap });
    expect(scheduler.endsAt).toBeNull();
    scheduler.start();
    run(0.4);
    expect(scheduler.endsAt).toBeCloseTo(0.55);
    scheduler.endAt(null);
    expect(scheduler.endsAt).toBeNull();
    scheduler.endAt(0.55);
    run(1);
    expect(scheduler.endsAt).toBeNull(); // over
  });

  it("goes on, from where it is, when the end is taken back before the clock gets there", () => {
    const { scheduler, run, log, ends } = withEnd({ onWrap: endsAtFirstWrap });
    scheduler.start();
    run(0.4);
    scheduler.endAt(null);
    run(0.5);
    expect(ends).toEqual([]);
    expect(scheduler.playing).toBe(true);
    // the next pass begins on the pass end, as it does when nothing ended it
    expect(log).toContain("step 0 @0.550");
    expect(log).toContain("step 1 @0.675");
  });

  it("is taken back by a rewind: the scheduler goes back over the pass end and tells it again", () => {
    const { scheduler, run, log, ends } = withEnd({ onWrap: endsOnce() });
    scheduler.start();
    run(0.35); // the end is set, and the last step is built
    scheduler.rewindTo(3, 0.425); // the page builds the last step again
    expect(scheduler.endsAt).toBeNull();
    run(0.9);
    expect(ends).toEqual([]); // told of the pass end a second time and not ended there: the run goes on
    expect(log.filter((entry) => entry.startsWith("wrap @0.550"))).toHaveLength(2);
    expect(log).toContain("step 0 @0.550");
  });

  it("is ended again when the page ends it again at the pass end told a second time", () => {
    const { scheduler, run, ends, stepsLogged } = withEnd({ onWrap: endsAtFirstWrap });
    scheduler.start();
    run(0.35);
    scheduler.rewindTo(3, 0.425);
    run(1);
    expect(ends).toHaveLength(1);
    expect(stepsLogged().map((entry) => entry.split(" @")[0])).toEqual([
      "step 0",
      "step 1",
      "step 2",
      "step 3",
      "step 3",
    ]);
  });

  it("is taken back by a loop made longer, which carries on past the pass end it had reached", () => {
    const { scheduler, run, log, ends } = withEnd({ onWrap: endsOnce() });
    scheduler.start();
    run(0.35);
    scheduler.setSteps(8); // not a pass end after all: the loop goes on into the new length
    run(0.8);
    expect(ends).toEqual([]);
    expect(log).toContain("step 4 @0.550");
    expect(scheduler.playing).toBe(true);
  });

  it("is kept by a loop made shorter after the pass end, which has nothing more to say about it", () => {
    const { scheduler, run, ends } = withEnd({ steps: 8, onWrap: endsAtFirstWrap });
    scheduler.start();
    run(1.1); // the pass of 8 steps has been scheduled in full (to 1.05 s)
    scheduler.setSteps(4);
    run(1);
    expect(ends).toHaveLength(1);
  });

  it("is taken back by a new pass, which the run goes on into", () => {
    const { scheduler, run, ends, log } = withEnd({ onWrap: endsOnce() });
    scheduler.start();
    run(0.35);
    scheduler.startPass(2);
    run(0.5);
    expect(ends).toEqual([]);
    expect(log).toContain("step 0 @0.550");
    expect(log).toContain("step 1 @0.675");
    expect(log).toContain("wrap @0.800");
  });

  it("is over at once for a stall that crosses it, with nothing scheduled after it", () => {
    const { scheduler, advance, ends, stepsLogged, log } = withEnd({ onWrap: endsAtFirstWrap });
    scheduler.start();
    advance(0.01); // step 0 is scheduled
    advance(5); // the timer was held up for five seconds: the first pass ended at 0.55 s while nothing was scheduled
    expect(ends).toHaveLength(1);
    expect(scheduler.playing).toBe(false);
    expect(log.filter((entry) => entry.startsWith("wrap"))).toEqual(["wrap @0.550"]); // not told of passes beyond it
    expect(stepsLogged()).toHaveLength(1);
  });

  it("is over at the next tick for a stall after it was set, and the pass ends beyond it are not told", () => {
    const { scheduler, run, advance, ends, stepsLogged, log } = withEnd({ onWrap: endsAtFirstWrap });
    scheduler.start();
    run(0.35);
    advance(5);
    expect(ends).toHaveLength(1);
    expect(stepsLogged()).toHaveLength(4);
    expect(log.filter((entry) => entry.startsWith("wrap"))).toEqual(["wrap @0.550"]); // the stall's steps were not walked over
  });

  it("is not an end when the scheduler is stopped before the clock gets there", () => {
    const { scheduler, run, ends } = withEnd({ onWrap: endsAtFirstWrap });
    scheduler.start();
    run(0.4);
    scheduler.stop();
    run(1);
    expect(ends).toEqual([]);
  });

  it("is not carried into the next run: start and stop take it back", () => {
    const { scheduler, run, ends, stepsLogged, clock } = withEnd({ onWrap: endsOnce() });
    scheduler.start();
    run(0.4);
    scheduler.stop(); // the end was at 0.55 s, which the clock is still short of
    expect(scheduler.endsAt).toBeNull();
    clock.time = 10; // a later run, after the time the old end was at
    scheduler.start();
    run(1);
    expect(ends).toEqual([]);
    expect(stepsLogged().length).toBeGreaterThan(8);
  });

  it("can be started again once it has ended, and the end does not come back", () => {
    const { scheduler, run, ends, clock } = withEnd({ onWrap: endsOnce() });
    scheduler.start();
    run(1);
    expect(ends).toHaveLength(1);
    clock.time = 5;
    expect(scheduler.start()).toBe(true);
    run(2);
    expect(ends).toHaveLength(1);
    expect(scheduler.playing).toBe(true);
  });

  it("ends a run that was told its end from outside a wrap, at that time, and works without an onEnd", () => {
    const { clock, scheduler, played, run } = setup({ steps: 16, bpm: 120 });
    scheduler.start();
    run(0.1);
    scheduler.endAt(0.3);
    run(1);
    expect(scheduler.playing).toBe(false);
    expect(played.map(([step]) => step)).toEqual([0, 1]); // the steps at 0.05 s and 0.175 s; the one at 0.3 s is the end's
    expect(clock.time).toBeGreaterThan(0.3);
  });

  it("ignores an end that is not a time", () => {
    for (const notATime of [Number.NaN, Number.POSITIVE_INFINITY, "0.3", {}]) {
      const { scheduler, run } = withEnd();
      scheduler.start();
      scheduler.endAt(notATime);
      expect(scheduler.endsAt).toBeNull();
      run(1);
      expect(scheduler.playing).toBe(true);
    }
  });

  it("ignores an end told while it is stopped: there is no run to end, and the next one is not ended by it", () => {
    const { scheduler, run, ends, clock } = withEnd();
    scheduler.endAt(0.3);
    expect(scheduler.endsAt).toBeNull();
    scheduler.start();
    run(1);
    expect(scheduler.playing).toBe(true);
    expect(ends).toEqual([]);
    scheduler.stop();
    scheduler.endAt(clock.time + 0.2);
    expect(scheduler.endsAt).toBeNull();
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
