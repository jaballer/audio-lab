// The sequencer's clock: a lookahead scheduler. No DOM.
//
//   const transport = createTransport({ audio, steps: 16, onStep });
//   transport.start();      // false if it was already playing
//   transport.stop();
//   transport.setBpm(120);  // returns the tempo actually set (clamped)
//   transport.poll();       // call every animation frame; true when the playhead moved
//
//   transport.playing, transport.bpm, transport.playheadStep, transport.playheadTime
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

export function createTransport({ audio, steps, onStep, bpm: initialBpm = 100 }) {
  let bpm = initialBpm;
  let playing = false;
  let timer = null;
  let nextStep = 0;
  let nextTime = 0;
  let playheadStep = -1;
  let playheadTime = 0;
  const visualQueue = []; // { step, time } for each scheduled step, until the playhead reaches it

  function schedule() {
    const now = audio.ctx.currentTime;
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
  };
}
