// The sampler's state and the things a user can do to it. No DOM.
//
// The page, the computer keyboard and a MIDI controller all want the same
// actions (hit a pad, toggle a step, start, record...), and each action has the
// same consequences (a new LCD message, a save, a redraw). Keeping them here,
// behind one set of methods, means no input has to remember those follow-ups.
//
//   const sampler = createSampler({
//     audio, sounds,
//     steps,               // steps in one bar (the pattern is up to maxBars of them)
//     maxBars,
//     sequenceCount,       // how many sequences there are to choose from
//     song,                // a parseSong() result to start from, or null for the starter beat
//     onChange,            // something on screen is out of date: read getState() and redraw
//     onMessage,           // (text) a short note for the LCD
//     onPadHit,            // (index) a pad just sounded live: flash it
//     onPadPlayed,         // (index) the sequence just reached a pad that is on: light it (a pad does not move for this)
//     onSongChange,        // the pattern, tempo or volume changed: worth saving
//   });
//
//   sampler.triggerPad(3, 0.8)   // velocity 0-1, default 1
//   sampler.selectPad(3)
//   sampler.toggleStep(5)        // a step of the bar being shown (see setPage)
//   sampler.setSequence(1)       // 0-based; each sequence has its own steps and bars
//   sampler.setBars(2); sampler.setPage(1)   // how long the sequence is; which bar the step keys show
//   sampler.start()              // from the first step, even if it is already playing
//   sampler.stop(); sampler.toggleRec()
//   sampler.clearPad(); sampler.clearAll()
//   sampler.setBpm(120); sampler.nudgeTempo(-1); sampler.tapTempo()
//   sampler.setVolume(80)        // 0-100, the slider's scale
//   sampler.poll()               // call every animation frame; true when the playhead moved (it also lights the pads on that step)
//   sampler.getState()           // { selected, recording, playing, bpm, volume, sequence, sequenceCount, bars, page, playheadStep, stepsOn }
//                                // stepsOn and playheadStep are of the bar being shown (playheadStep is -1 when the playhead is in another bar)
//   sampler.getSong()            // { bpm, volume, current, sequences: [{ bars, pattern }] }: what song.js saves
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
  maxBars = 1,
  sequenceCount = 1,
  song = null,
  now = () => performance.now(),
  onChange = noop,
  onMessage = noop,
  onPadHit = noop,
  onPadPlayed = noop,
  onSongChange = noop,
}) {
  let selected = 0;
  let recording = false;
  let volume = song ? song.volume : DEFAULT_VOLUME;
  let page = 0;
  let current = song?.current ?? 0;

  // Each sequence has its own steps and length; tempo and volume are shared. With no saved song the
  // first sequence is the starter beat and the rest are empty. A pattern has room for every bar, so
  // shortening a sequence keeps what was in the bars it drops.
  const slots = Array.from({ length: sequenceCount }, (_, i) => {
    const saved = song?.sequences[i];
    const initial = saved ? saved.pattern : i === 0 && !song ? STARTER_BEAT : {};
    return {
      bars: Math.min(maxBars, saved?.bars ?? 1),
      pattern: createPattern(sounds.length, steps * maxBars, initial, { onChange: onSongChange }),
    };
  });
  let pattern = slots[current].pattern;
  let bars = slots[current].bars;
  const totalSteps = () => bars * steps;
  const lastPage = () => bars - 1;

  // The sequencer runs on the audio clock; the context only exists once audio has been unlocked.
  const clock = { prepare: () => audio.ensure(), now: () => audio.ctx.currentTime };
  const scheduler = createScheduler({
    clock,
    steps: totalSteps(),
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
      now: clock.now(),
      playheadTime: scheduler.playheadTime,
      playheadStep: scheduler.playheadStep,
      bpm: scheduler.bpm,
      steps: totalSteps(),
    });
    if (step < 0) return;
    pattern.set(index, step, true);
    scheduler.markHeard(index, step); // it was just played live: don't sound it again at a slow tempo
  }

  // ---------- Steps ----------
  // The sound is scheduled ahead of time, so the pads flash from here, when the playhead
  // reaches the step, to line up with what is heard. Only the light: the selected pad stays.
  function flashStep(step) {
    sounds.forEach((_sound, row) => {
      if (pattern.isOn(row, step)) onPadPlayed(row);
    });
  }

  // The step keys show one bar; the playhead is only on them while it is in that bar.
  function playheadOnPage(step) {
    const local = step - page * steps;
    return local >= 0 && local < steps ? local : -1;
  }

  function toggleStep(step) {
    pattern.toggle(selected, page * steps + step);
    onChange();
  }

  function setPage(value) {
    const next = Math.min(lastPage(), Math.max(0, value));
    if (next === page) return;
    page = next;
    onChange();
  }

  function setBars(value) {
    const next = Math.min(maxBars, Math.max(1, Math.round(value)));
    if (next === bars) return;
    bars = next;
    slots[current].bars = bars;
    scheduler.setSteps(totalSteps());
    page = Math.min(page, lastPage());
    onMessage(`${bars} ${bars === 1 ? "BAR" : "BARS"}`);
    onChange();
    onSongChange();
  }

  // Switch to another sequence. If it is playing, the playhead carries on into the new one.
  function setSequence(value) {
    const next = Math.min(sequenceCount - 1, Math.max(0, Math.round(value)));
    if (next === current) return;
    current = next;
    pattern = slots[current].pattern;
    bars = slots[current].bars;
    page = 0;
    scheduler.setSteps(totalSteps());
    onMessage(`SEQ ${pad2(current + 1)}`);
    onChange();
    onSongChange();
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
  // Play always begins at the first step, as the button does on hardware: pressed while the
  // sequence is running, it starts again from the top.
  function start() {
    scheduler.stop();
    scheduler.start();
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
    setPage,
    setBars,
    setSequence,
    clearPad,
    clearAll,
    start,
    stop,
    toggleRec,
    setBpm,
    nudgeTempo: (delta) => setBpm(scheduler.bpm + delta),
    tapTempo,
    setVolume,
    poll() {
      const moved = scheduler.poll();
      if (moved && scheduler.playing) flashStep(scheduler.playheadStep);
      return moved;
    },

    getState: () => ({
      selected,
      recording,
      playing: scheduler.playing,
      bpm: scheduler.bpm,
      volume,
      sequence: current,
      sequenceCount,
      bars,
      page,
      playheadStep: playheadOnPage(scheduler.playheadStep),
      // The step number in the whole sequence, for the LCD.
      playheadPosition: scheduler.playheadStep,
      stepsOn: pattern.row(selected).slice(page * steps, (page + 1) * steps),
    }),

    getSong: () => ({
      bpm: scheduler.bpm,
      volume,
      current,
      sequences: slots.map((slot) => ({ bars: slot.bars, pattern: slot.pattern.snapshot() })),
    }),
  };
}
