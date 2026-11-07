// The sequencer's clock: a lookahead scheduler. No DOM.
//
//   const transport = createTransport({ audio, steps: 16, onStep });
//   transport.start();      // false if it was already playing
//   transport.stop();
//   transport.setBpm(120);  // returns the tempo actually set (clamped)
//   transport.poll();       // call every animation frame; true when the playhead moved
//
//   transport.playing, transport.bpm, transport.playheadStep, transport.playheadTime
//   transport.pendingSteps  // how many scheduled steps the playhead has yet to catch up with
//   transport.markHeard(row, step)  // see below
//
// Timers drift and stall, the audio clock does not. So a timer wakes every
// LOOKAHEAD_MS and schedules every step that falls within the next
// SCHEDULE_AHEAD_S of audio time: `onStep(step, time)` is told when (in
// AudioContext time) to play that step's sounds. The visible playhead follows
// separately: each scheduled step is queued, and `poll()` moves the playhead
// to the latest step whose time has actually arrived.
//
// `onStep(step, time, heard)` also gets `heard`, a Set of the rows (pads) that
// must stay silent on this pass because they were just heard live: see
// markHeard().

import { clampBpm, stepSeconds } from "./tempo.js";

export const LOOKAHEAD_MS = 25; // how often the scheduler wakes up
export const SCHEDULE_AHEAD_S = 0.12; // how far ahead of the audio clock it schedules
const START_DELAY_S = 0.05; // a short run-up so the first step is not already late
// How late a step may be and still play: a little over one scheduler tick. At the
// fastest tempo a step is longer than this, so at most one step is ever this late.
const MAX_LATE_S = 0.03;

export function createTransport({ audio, steps, onStep, bpm: initialBpm = 100 }) {
  let bpm = initialBpm;
  let playing = false;
  let timer = null;
  let nextStep = 0;
  let nextTime = 0;
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
    const now = audio.ctx.currentTime;
    dropSupersededSteps(now);
    skipMissedSteps(now);
    while (nextTime < now + SCHEDULE_AHEAD_S) {
      onStep(nextStep, nextTime, nextStep === heardStep ? new Set(heardRows) : NOBODY);
      if (nextStep === heardStep) forgetHeard();
      visualQueue.push({ step: nextStep, time: nextTime });
      nextTime += stepSeconds(bpm);
      nextStep = (nextStep + 1) % steps;
    }
  }

  function start() {
    if (playing) return false;
    const ctx = audio.ensure();
    playing = true;
    forgetHeard();
    nextStep = 0;
    nextTime = ctx.currentTime + START_DELAY_S;
    playheadStep = -1;
    timer = setInterval(schedule, LOOKAHEAD_MS);
    return true;
  }

  function stop() {
    playing = false;
    clearInterval(timer);
    visualQueue.length = 0;
    forgetHeard();
    playheadStep = -1;
  }

  function poll() {
    const now = audio.ctx.currentTime;
    let moved = false;
    while (visualQueue.length && visualQueue[0].time <= now) {
      const { step, time } = visualQueue.shift();
      playheadStep = step;
      playheadTime = time;
      moved = true;
    }
    return moved;
  }

  function setBpm(value) {
    bpm = clampBpm(value);
    return bpm;
  }

  return {
    start,
    stop,
    poll,
    setBpm,
    get playing() {
      return playing;
    },
    get bpm() {
      return bpm;
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
  };
}
