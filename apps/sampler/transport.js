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
//
// Timers drift and stall, the audio clock does not. So a timer wakes every
// LOOKAHEAD_MS and schedules every step that falls within the next
// SCHEDULE_AHEAD_S of audio time: `onStep(step, time)` is told when (in
// AudioContext time) to play that step's sounds. The visible playhead follows
// separately: each scheduled step is queued, and `poll()` moves the playhead
// to the latest step whose time has actually arrived.

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

  function schedule() {
    const now = audio.ctx.currentTime;
    dropSupersededSteps(now);
    skipMissedSteps(now);
    while (nextTime < now + SCHEDULE_AHEAD_S) {
      onStep(nextStep, nextTime);
      visualQueue.push({ step: nextStep, time: nextTime });
      nextTime += stepSeconds(bpm);
      nextStep = (nextStep + 1) % steps;
    }
  }

  function start() {
    if (playing) return false;
    const ctx = audio.ensure();
    playing = true;
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
  };
}
