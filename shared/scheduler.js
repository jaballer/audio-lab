// The sequencer's clock: a lookahead scheduler. No DOM. Shared by every page that runs a step
// sequencer; the sampler's runs on the audio clock.
//
//   const scheduler = createScheduler({ clock, steps: 16, onStep });   // also bpm, bpmRange: { min, max }
//   scheduler.start();      // false if it was already playing; start(at) puts the first step at time `at`
//   scheduler.stop();
//   scheduler.setSteps(32); // change the loop length, while playing too
//   scheduler.setBpm(120);  // returns the tempo actually set (clamped to bpmRange, 40-240 by default)
//   scheduler.setSwing(58); // 50 (straight) to 75: the odd steps sound later (tempo.js); `swing` in the options starts it there
//   scheduler.poll();       // call every animation frame; true when the playhead moved
//
//   scheduler.playing, scheduler.bpm, scheduler.playheadStep, scheduler.playheadTime
//   scheduler.pendingSteps  // how many scheduled steps the playhead has yet to catch up with
//   scheduler.markHeard(row, step)  // see below
//
// `clock` is what time means here: `{ now(), prepare?() }`. `now()` is the current time in
// seconds, in whatever domain the steps are played in: the sampler gives it the AudioContext's
// `currentTime`; a page that sends MIDI would give it `performance.now() / 1000`, the domain of
// Web MIDI timestamps. `prepare()` runs once on start, for a clock that must be woken first
// (the audio engine creates its context only after a user gesture).
//
// Timers drift and stall, the audio clock does not. So a timer wakes every
// SCHEDULER_TICK_MS and schedules every step that falls within the next
// SCHEDULE_AHEAD_S of clock time: `onStep(step, time)` is told when (in the
// clock's time) to play that step's sounds. The visible playhead follows
// separately: each scheduled step is queued, and `poll()` moves the playhead
// to the latest step whose time has actually arrived.
//
// `onStep(step, time, heard)` also gets `heard`, a Set of the rows (pads) that
// must stay silent on this pass because they were just heard live: see
// markHeard(). It is part of the scheduler, not the sampler, because it is tied to which
// step is next and to the steps skipped after a stall, and any page that records live pad hits
// needs it.

import { SWING_DEFAULT, clampBpm, clampSwing, stepSeconds, swingDelay } from "./tempo.js";

// How often the scheduler wakes (not how far ahead it schedules: SCHEDULE_AHEAD_S).
export const SCHEDULER_TICK_MS = 25;
export const SCHEDULE_AHEAD_S = 0.12; // how far ahead of the clock it schedules
const START_DELAY_S = 0.05; // a short run-up so the first step is not already late
// How late a step may be and still play: a little over one scheduler tick. At the
// fastest tempo a step is longer than this, so at most one step is ever this late.
const MAX_LATE_S = 0.03;

export function createScheduler({
  clock,
  steps: initialSteps,
  onStep,
  bpm: initialBpm = 100,
  bpmRange,
  swing: initialSwing = SWING_DEFAULT,
}) {
  let steps = initialSteps;
  let bpm = initialBpm;
  let swing = clampSwing(initialSwing);
  let playing = false;
  let timer = null;
  let nextStep = 0;
  let nextTime = 0;
  let scheduledAny = false; // has this run scheduled a step yet? (nextStep === 0 can mean "not yet" or "just wrapped")
  let playheadStep = -1;
  let playheadTime = 0;
  const visualQueue = []; // { step, time } for each scheduled step, until the playhead reaches it
  // Live hits that were recorded into the step about to be scheduled: the sound was
  // already heard, so that step's scheduling pass must not play it again.
  let heardStep = -1;
  const heardRows = new Set();
  const NOBODY = new Set(); // what onStep gets when nothing was heard live

  // After a stall (a GC pause, a slow device) the steps that fell due meanwhile
  // are in the past, and Web Audio plays a sound scheduled in the past at once:
  // they would all land together as a burst. Skip them and carry on from the
  // next step on the original grid, so the beat stays in place and only the
  // missed hits are lost. A step that is only a little late still plays: a hit
  // a few milliseconds late is better than a missing one.
  //
  // The playhead still has to move across the skipped steps: it is where a live
  // hit is quantized from, and it would otherwise sit on its pre-stall step until
  // the next scheduled one arrives. So the last skipped step is queued for
  // poll(), which only needs the newest step that has gone by.
  function skipMissedSteps(now) {
    const length = stepSeconds(bpm);
    const missed = Math.ceil((now - MAX_LATE_S - nextTime) / length);
    if (missed <= 0) return;
    const last = missed - 1;
    forgetHeard(); // its step is skipped; a later pass over it is a new one
    visualQueue.push({ step: (nextStep + last) % steps, time: nextTime + last * length });
    nextTime += missed * length;
    nextStep = (nextStep + missed) % steps;
  }

  // poll() only uses the newest step that has arrived, but it runs from
  // requestAnimationFrame, which browsers pause in a hidden tab while this
  // scheduler keeps going (a tab playing audio is not throttled). Without this the
  // queue would grow by a step every step until the tab came back. An arrived step
  // that a newer arrived step has replaced can never be the answer, so drop it.
  function dropSupersededSteps(now) {
    let superseded = 0;
    while (superseded + 1 < visualQueue.length && visualQueue[superseded + 1].time <= now) superseded++;
    if (superseded > 0) visualQueue.splice(0, superseded);
  }

  // A pad hit while recording sounds at once and is also written into the step
  // nearest to it, which can be the next one. If that step has not been scheduled
  // yet (at slow tempos it is further off than the lookahead), the scheduler would
  // play the new note a moment after the live hit: a flam. So tell it which row
  // was just heard. A step that is already scheduled needs nothing: the recorded
  // note first plays on the next trip round, as it should.
  function markHeard(row, step) {
    if (!playing || step !== nextStep) return;
    if (heardStep !== step) forgetHeard();
    heardStep = step;
    heardRows.add(row);
  }

  function forgetHeard() {
    heardStep = -1;
    heardRows.clear();
  }

  function schedule() {
    const now = clock.now();
    dropSupersededSteps(now);
    skipMissedSteps(now);
    while (nextTime < now + SCHEDULE_AHEAD_S) {
      // `nextTime` is the step's place on the grid, which swing does not move: only when the step sounds (and when the
      // playhead reaches it) is later, so tempo changes and stalls are still worked out on the even grid.
      const time = nextTime + swingDelay(nextStep, bpm, swing);
      onStep(nextStep, time, nextStep === heardStep ? new Set(heardRows) : NOBODY);
      if (nextStep === heardStep) forgetHeard();
      visualQueue.push({ step: nextStep, time });
      nextTime += stepSeconds(bpm);
      nextStep = (nextStep + 1) % steps;
      scheduledAny = true;
    }
  }

  // `at` lets a page put step 0 on a moment it has already chosen, such as the first tick of a MIDI
  // clock it sends alongside, so the two grids start together. Without it step 0 follows a short run-up.
  function start(at) {
    if (playing) return false;
    clock.prepare?.();
    playing = true;
    forgetHeard();
    nextStep = 0;
    scheduledAny = false;
    nextTime = at ?? clock.now() + START_DELAY_S;
    playheadStep = -1;
    timer = setInterval(schedule, SCHEDULER_TICK_MS);
    return true;
  }

  function stop() {
    playing = false;
    clearInterval(timer);
    visualQueue.length = 0;
    forgetHeard();
    scheduledAny = false;
    playheadStep = -1;
  }

  function poll() {
    // Stopped means nothing to move to, and a clock that needs prepare() (the audio context) may not
    // be ready to read yet.
    if (!playing) return false;
    const now = clock.now();
    let moved = false;
    while (visualQueue.length && visualQueue[0].time <= now) {
      const { step, time } = visualQueue.shift();
      playheadStep = step;
      playheadTime = time;
      moved = true;
    }
    return moved;
  }

  // The loop got longer or shorter. A step that no longer exists cannot be next, so the count
  // wraps; the steps already queued for the playhead wrap the same way, and so does the step
  // the playhead is on now (until the next step arrives it would name a step that is gone).
  //
  // The lookahead may already have scheduled the last step of the old loop and wrapped to 0. Made
  // longer, the loop carries on past that step (into the new bars) instead of going back to the
  // start, so the result does not depend on the moment of the click.
  function setSteps(value) {
    const wrappedJustNow = scheduledAny && nextStep === 0;
    const oldSteps = steps;
    steps = value;
    nextStep = value > oldSteps && wrappedJustNow ? oldSteps : nextStep % steps;
    if (playheadStep >= steps) playheadStep %= steps;
    for (const queued of visualQueue) queued.step %= steps;
    if (heardStep >= steps) forgetHeard();
  }

  // Take back the steps scheduled from `step` (at `time`) on, and schedule them again from there: the
  // page replaced what they were built from (a different sequence), after the scheduler had already
  // handed the next step or two to the audio clock. The caller silences the old ones itself.
  function rewindTo(step, time) {
    nextStep = step % steps;
    // `time` is when the step sounded, which swing put later than its place on the grid.
    nextTime = time - swingDelay(step, bpm, swing);
    for (let i = visualQueue.length - 1; i >= 0; i--) if (visualQueue[i].time >= time) visualQueue.splice(i, 1);
    forgetHeard();
  }

  function setBpm(value) {
    bpm = clampBpm(value, bpmRange);
    return bpm;
  }

  function setSwing(value) {
    swing = clampSwing(value);
    return swing;
  }

  return {
    start,
    stop,
    poll,
    setBpm,
    setSwing,
    setSteps,
    rewindTo,
    get playing() {
      return playing;
    },
    get bpm() {
      return bpm;
    },
    get swing() {
      return swing;
    },
    get playheadStep() {
      return playheadStep;
    },
    get playheadTime() {
      return playheadTime;
    },
    get pendingSteps() {
      return visualQueue.length;
    },
    markHeard,
    forgetHeard,
  };
}
