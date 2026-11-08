// The sampler's state and the things a user can do to it. No DOM.
//
// The page, the computer keyboard and a MIDI controller all want the same
// actions (hit a pad, toggle a step, start, record...), and each action has the
// same consequences (a new LCD message, a save, a redraw). Keeping them here,
// behind one set of methods, means no input has to remember those follow-ups.
//
//   const sampler = createSampler({
//     audio, sounds, steps,
//     song,                // a parseSong() result to start from, or null for the starter beat
//     onChange,            // something on screen is out of date: read getState() and redraw
//     onMessage,           // (text) a short note for the LCD
//     onPadHit,            // (index) a pad just sounded live: flash it
//     onSongChange,        // the pattern, tempo or volume changed: worth saving
//   });
//
//   sampler.triggerPad(3, 0.8)   // velocity 0-1, default 1
//   sampler.selectPad(3)
//   sampler.toggleStep(5)
//   sampler.start(); sampler.stop(); sampler.toggleRec()
//   sampler.clearPad(); sampler.clearAll()
//   sampler.setBpm(120); sampler.nudgeTempo(-1); sampler.tapTempo()
//   sampler.setVolume(80)        // 0-100, the slider's scale
//   sampler.poll()               // call every animation frame; true when the playhead moved
//   sampler.getState()           // { selected, recording, playing, bpm, volume, playheadStep, stepsOn }
//   sampler.getSong()            // { bpm, volume, pattern }: what song.js saves
//
// Nothing here calls `onChange` while the sampler is being built, so the caller
// can create it before the views that its callbacks refer to.

import { playSound } from "../../shared/sounds.js";
import { pad2 } from "./format.js";
import { createPattern } from "../../shared/pattern.js";
import { createScheduler } from "../../shared/scheduler.js";
import { createTapTempo, nearestStep } from "../../shared/tempo.js";
import { STARTER_BEAT } from "./starter-beat.js";

export const DEFAULT_VOLUME = 80; // 0-100; the same as the slider's markup
const VOLUME_SCALE = 100;

const noop = () => {};

export function createSampler({
  audio,
  sounds,
  steps,
  song = null,
  now = () => performance.now(),
  onChange = noop,
  onMessage = noop,
  onPadHit = noop,
  onSongChange = noop,
}) {
  let selected = 0;
  let recording = false;
  let volume = song ? song.volume : DEFAULT_VOLUME;

  const pattern = createPattern(sounds.length, steps, song ? song.pattern : STARTER_BEAT, {
    onChange: onSongChange,
  });

  // The sequencer runs on the audio clock; the context only exists once audio has been unlocked.
  const clock = { prepare: () => audio.ensure(), now: () => audio.ctx.currentTime };
  const scheduler = createScheduler({
    clock,
    steps,
    bpm: song?.bpm,
    onStep(step, time, heard) {
      const { ctx, master } = audio;
      sounds.forEach((sound, row) => {
        if (pattern.isOn(row, step) && !heard.has(row)) sound.play(ctx, master, time);
      });
    },
  });

  const taps = createTapTempo();

  // ---------- Pads ----------
  function selectPad(index) {
    selected = index;
    onChange();
  }

  // velocity is 0-1.
  function triggerPad(index, velocity = 1) {
    playSound(audio, sounds[index], velocity);
    onPadHit(index);
    if (recording && scheduler.playing) recordHit(index);
    selectPad(index);
  }

  // Live recording: quantize the hit to the nearest 16th step.
  function recordHit(index) {
    const step = nearestStep({
      now: audio.ctx.currentTime,
      playheadTime: scheduler.playheadTime,
      playheadStep: scheduler.playheadStep,
      bpm: scheduler.bpm,
      steps,
    });
    if (step < 0) return;
    pattern.set(index, step, true);
    scheduler.markHeard(index, step); // it was just played live: don't sound it again at a slow tempo
  }

  // ---------- Steps ----------
  function toggleStep(step) {
    pattern.toggle(selected, step);
    onChange();
  }

  function clearPad() {
    pattern.clearRow(selected);
    onMessage(`PAD ${pad2(selected + 1)} CLEARED`);
    onChange();
  }

  function clearAll() {
    pattern.clearAll();
    onMessage("ALL PADS CLEARED");
    onChange();
  }

  // ---------- Play and stop ----------
  function start() {
    if (!scheduler.start()) return; // already playing
    onChange();
  }

  function stop() {
    scheduler.stop();
    onChange();
  }

  function toggleRec() {
    recording = !recording;
    onMessage(recording ? (scheduler.playing ? "REC ON - HIT PADS" : "REC ARMED - PRESS PLAY") : "REC OFF");
    onChange();
  }

  // ---------- Tempo and volume ----------
  function setBpm(value) {
    scheduler.setBpm(value);
    onChange();
    onSongChange();
  }

  function tapTempo() {
    const bpm = taps.tap(now());
    if (bpm === null) {
      onMessage("TAP AGAIN...");
    } else {
      setBpm(bpm);
      onMessage("TAP TEMPO");
    }
  }

  function setVolume(value) {
    volume = value;
    audio.setVolume(volume / VOLUME_SCALE);
    onMessage(`VOLUME ${volume}`);
    onChange();
    onSongChange();
  }

  return {
    selectPad,
    triggerPad,
    toggleStep,
    clearPad,
    clearAll,
    start,
    stop,
    toggleRec,
    setBpm,
    nudgeTempo: (delta) => setBpm(scheduler.bpm + delta),
    tapTempo,
    setVolume,
    poll: () => scheduler.poll(),

    getState: () => ({
      selected,
      recording,
      playing: scheduler.playing,
      bpm: scheduler.bpm,
      volume,
      playheadStep: scheduler.playheadStep,
      stepsOn: pattern.row(selected),
    }),

    getSong: () => ({ bpm: scheduler.bpm, volume, pattern: pattern.snapshot() }),
  };
}
