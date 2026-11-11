// The sequencer's clock: a lookahead scheduler. No DOM. Shared by every page that runs a step
// sequencer; the sampler's runs on the audio clock.
//
//   const scheduler = createScheduler({ clock, steps: 16, onStep });   // also bpm, bpmRange: { min, max }, onWrap
//   scheduler.start();      // false if it was already playing; start(at) puts the first step at time `at`
//   scheduler.stop();
//   scheduler.setSteps(32); // change the loop length, while playing too
//   scheduler.startPass(8); // from onWrap: the pass that is beginning is 8 steps long, whatever the last one was
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
// `onWrap(time)` is called when the loop comes round: as soon as the last step of a pass has been scheduled, with the time the
// first step of the next one falls (on the grid, before swing). That step is scheduled up to a step later (at a slow tempo well
// after), so what the page does here is for a pass that has not begun. It is where a pass can be a different length from the
// one before: `startPass(steps)` begins the pass that is coming at its first step with that many, which `setSteps` cannot do
// (it carries on into the new length from where the old one ended, for a person changing the length of a loop that is playing).
// The steps already queued for the playhead are left as they were. A stall that skips past the end of a pass calls it for each
// one it crosses, in order, so a page that picks the length at every wrap ends on the same grid as one that was not stalled,
// and lands in the last pass where the grid is. A page that stops the scheduler from here is not scheduled for again. A loop made shorter with
// `setSteps` so that it ends exactly where the scheduler is has come round too, and `onWrap` is called from inside that call.
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
  onWrap,
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
  let freshPass = false; // startPass has begun a pass whose first step has not been scheduled yet: setSteps changes that pass, it does not carry on from it
  let playheadStep = -1;
  let playheadTime = 0;
  let playheadDelay = 0; // how much later than its place on the grid the playhead's step sounded, with the swing it was queued with
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
    let missed = Math.ceil((now - MAX_LATE_S - nextTime) / length);
    if (missed <= 0) return;
    // Late is when a step SOUNDS, which swing puts after its place on the grid: the last one counted may still be on time
    // (a step built again by rewindTo, for one). Only that one can be: the one before it sounds before the grid place of
    // the next, which is already late.
    const soundsAt = (k) => nextTime + k * length + swingDelay((nextStep + k) % steps, bpm, swing);
    if (soundsAt(missed - 1) >= now - MAX_LATE_S) missed--;
    if (missed <= 0) return;
    forgetHeard(); // its step is skipped; a later pass over it is a new one
    // Go over the skipped steps a pass at a time, as scheduling them one by one would: each pass end crossed is told to onWrap,
    // which may make the next pass another length, and what is done by then stays done if it throws (as it does for a step
    // that is scheduled).
    let lastStep = -1;
    let lastTime = 0;
    let lastDelay = 0;
    while (missed > 0) {
      freshPass = false;
      const run = Math.min(missed, steps - nextStep);
      lastStep = nextStep + run - 1;
      lastDelay = swingDelay(lastStep, bpm, swing);
      lastTime = nextTime + (run - 1) * length + lastDelay;
      nextTime += run * length;
      nextStep += run;
      missed -= run;
      if (nextStep >= steps) {
        nextStep = 0;
        onWrap?.(nextTime);
        if (!playing) return;
      }
    }
    visualQueue.push({ step: lastStep, time: lastTime, delay: lastDelay });
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
    while (playing && nextTime < now + SCHEDULE_AHEAD_S) {
      // `nextTime` is the step's place on the grid, which swing does not move: only when the step sounds (and when the
      // playhead reaches it) is later, so tempo changes and stalls are still worked out on the even grid.
      const time = nextTime + swingDelay(nextStep, bpm, swing);
      // `nextTime` goes along as a fourth argument: a page that builds its steps again (rewindTo) hands it back, and it
      // cannot be worked out from `time` afterwards, as the swing may have changed since.
      onStep(nextStep, time, nextStep === heardStep ? new Set(heardRows) : NOBODY, nextTime);
      if (nextStep === heardStep) forgetHeard();
      visualQueue.push({ step: nextStep, time, delay: time - nextTime });
      nextTime += stepSeconds(bpm);
      nextStep = (nextStep + 1) % steps;
      scheduledAny = true;
      freshPass = false;
      if (nextStep === 0) onWrap?.(nextTime);
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
    freshPass = false;
    nextTime = at ?? clock.now() + START_DELAY_S;
    playheadStep = -1;
    playheadDelay = 0;
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
    playheadDelay = 0;
  }

  function poll() {
    // Stopped means nothing to move to, and a clock that needs prepare() (the audio context) may not
    // be ready to read yet.
    if (!playing) return false;
    const now = clock.now();
    let moved = false;
    while (visualQueue.length && visualQueue[0].time <= now) {
      const { step, time, delay } = visualQueue.shift();
      playheadStep = step;
      playheadTime = time;
      playheadDelay = delay;
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
    const wrappedJustNow = scheduledAny && nextStep === 0 && !freshPass;
    const oldSteps = steps;
    const landed = nextStep;
    steps = value;
    nextStep = value > oldSteps && wrappedJustNow ? oldSteps : nextStep % steps;
    if (playheadStep >= steps) playheadStep %= steps;
    for (const queued of visualQueue) queued.step %= steps;
    if (heardStep >= steps) forgetHeard();
    // A loop made shorter that ends exactly where the scheduler is has come round, as if its last step had just been scheduled:
    // the page is told, for a pass that is not begun, as it is at any other wrap. (Where it already was at the start of a pass,
    // it was told then.)
    if (scheduledAny && landed !== 0 && nextStep === 0) onWrap?.(nextTime);
  }

  // The pass that is beginning is `value` steps long, from its first step: for onWrap. Nothing already queued is touched, so
  // the steps of the pass that ended keep the numbers they were scheduled with.
  function startPass(value) {
    if (!Number.isInteger(value) || value < 1) return;
    steps = value;
    nextStep = 0;
    freshPass = true;
  }

  // Take back the steps scheduled from `step` (at `time`) on, and schedule them again from there: the
  // page replaced what they were built from (a different sequence), after the scheduler had already
  // handed the next step or two to the audio clock. The caller silences the old ones itself.
  // `time` is the step's place on the grid (the fourth argument `onStep` was given), not when it sounded.
  function rewindTo(step, time) {
    nextStep = step % steps;
    nextTime = time;
    freshPass = false;
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
    startPass,
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
    // What swing did to the step the playhead is on, as it was when the step was queued: the swing may have moved since.
    get playheadDelay() {
      return playheadDelay;
    },
    get playheadTime() {
      return playheadTime;
    },
    get pendingSteps() {
      return visualQueue.length;
    },
    // Where the next step to be scheduled falls on the grid (before swing): a page that builds steps again can tell whether the
    // scheduler has got past a pass end it knows of, or been taken back before it.
    get nextTime() {
      return nextTime;
    },
    markHeard,
    forgetHeard,
  };
}
