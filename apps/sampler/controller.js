// The sampler's state and the things a user can do to it. No DOM.
//
// The page, the computer keyboard and a MIDI controller all want the same
// actions (hit a pad, toggle a step, start, record...), and each action has the
// same consequences (a new LCD message, a save, a redraw). Keeping them here,
// behind one set of methods, means no input has to remember those follow-ups.
//
//   const sampler = createSampler({
//     audio,
//     kit,                 // the sounds on the pads (kit.js)
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
//   sampler.setPadSetting("gain", -6)       // the selected pad's gain (dB), pitch (semitones), envelope, choke or colour, saved with the song
//   sampler.setStepVelocity(5, 90)   // 1-127, for a step that is on; the sequence plays it at that level
//   sampler.setStepVelocity(5, 90, { activate: true })   // the same, and turns the step on first if it is off: one undo
//   sampler.setSequence(1)       // 0-based; each sequence has its own steps and bars
//   sampler.setBars(2); sampler.setPage(1)   // how long the sequence is; which bar the step keys show
//   sampler.start()              // from the first step, even if it is already playing
//   sampler.stop()               // stops the sequence; pressed again while stopped, it cuts off all sound (tails too)
//   sampler.toggleRec()
//   sampler.clearPad(); sampler.clearAll()
//   sampler.copySteps(); sampler.pasteSteps()   // the steps and velocities of the bar showing for the selected pad,
//                                               // over the bar showing for the selected pad (another bar, pad or sequence)
//   sampler.kitChanged("sound" | "setting")  // the kit changed: a new sound rebuilds the queued steps, a setting is saved
//   sampler.undo(); sampler.redo()           // changes to the steps of the sequence showing
//   sampler.setBpm(120); sampler.nudgeTempo(-1); sampler.tapTempo()
//   sampler.setSwing(58)         // 50 (straight) to 75: the second step of each pair sounds later (tempo.js)
//   sampler.setVolume(80)        // 0-100, the slider's scale
//   sampler.poll()               // call every animation frame; true when the playhead moved (it also lights the pads on that step)
//   sampler.getState()           // { selected, recording, playing, bpm, swing, volume, sequence, sequenceCount, bars, page, playheadStep, stepsOn, stepVelocities, canUndo, canRedo, padSettings }
//                                // stepsOn and playheadStep are of the bar being shown (playheadStep is -1 when the playhead is in another bar)
//   sampler.getSong()            // { bpm, swing, volume, current, sequences: [{ bars, pattern, velocities }], padSettings }: what song.js saves
//
// Nothing here calls `onChange` while the sampler is being built, so the caller
// can create it before the views that its callbacks refer to.

import { withVelocity } from "../../shared/sounds.js";
import { pad2 } from "./format.js";
import { createVoices } from "./voices.js";
import { createHistory } from "../../shared/history.js";
import { SETTINGS, formatSetting } from "./pad-settings.js";
import { FULL_VELOCITY, createPattern, firstDifference } from "../../shared/pattern.js";
import { createScheduler } from "../../shared/scheduler.js";
import { SWING_DEFAULT, createTapTempo, nearestStep } from "../../shared/tempo.js";
import { STARTER_BEAT } from "./starter-beat.js";

export const DEFAULT_VOLUME = 80; // 0-100; the same as the slider's markup
export const VOLUME_SCALE = 100; // the volume slider's scale: 0-100 is a master gain of 0-1
const MERGE_MS = 600; // velocity changes this close together are one gesture, and one undo
const MAX_SCHEDULED_HITS = 64; // a page that stops polling (a hidden tab) must not grow the list for ever

const noop = () => {};

export function createSampler({
  audio,
  kit,
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
      history: createHistory(), // undo and redo are per sequence
      pattern: createPattern(kit.length, steps * maxBars, initial, {
        onChange: onSongChange,
        velocities: saved?.velocities,
      }),
    };
  });
  let pattern = slots[current].pattern;
  let history = slots[current].history;
  let clipboard = null; // a bar of one pad's steps and velocities, from copySteps; kept across sequences
  let lastMergedAt = -Infinity; // when the last velocity change was made, for MERGE_MS
  let lastMergedPad = -1; // and on which pad: a change to another pad is another undo, however soon it comes
  let bars = slots[current].bars;
  const totalSteps = () => bars * steps;
  const lastPage = () => bars - 1;

  // The sequencer runs on the audio clock; the context only exists once audio has been unlocked.
  const scheduledHits = []; // { time, gridTime, step, rows, bus, chokes } for each step handed to the scheduler, until its light is shown
  // A pad plays one voice at a time: a hit cuts off what the pad was still playing (voices.js).
  const voices = createVoices(kit.length, {
    groupOf: (pad) => kit.settings(pad).choke,
    releaseOf: (pad) => kit.envelope(pad)?.release ?? 0,
  });
  const clock = { prepare: () => audio.ensure(), now: () => audio.ctx.currentTime };
  const scheduler = createScheduler({
    clock,
    steps: totalSteps(),
    bpm: song?.bpm,
    swing: song?.swing,
    onStep(step, time, heard, gridTime) {
      const { ctx, master } = audio;
      const rows = [];
      const chokes = []; // the voices these hits cut off, so cancelling the step can give them back
      // The step's hits go through a gain of their own, so that if playback is restarted or
      // stopped before the step is reached, its sounds can be cut off (see cancelQueuedHits).
      const bus = ctx.createGain();
      bus.connect(master);
      // With the power off nothing is built: the hits would be muted, but their tails would still be sounding when
      // the power came on (a 10 second sample, every step) and be heard all at once. The beat goes on silently.
      for (let row = 0; row < kit.length && audio.powered; row++) {
        if (pattern.isOn(row, step) && !heard.has(row)) {
          const voice = voices.start(ctx, row, bus, time);
          kit.voice(row).play(ctx, withVelocity(ctx, voice.out, pattern.velocity(row, step) / FULL_VELOCITY), time);
          chokes.push(...voice.chokes);
          rows.push(row);
        }
      }
      // Remember what was scheduled, so the lights show what is heard even if the pattern is
      // edited in the lookahead before the playhead reaches this step.
      scheduledHits.push({ time, gridTime, step, rows, bus, chokes });
      if (scheduledHits.length > MAX_SCHEDULED_HITS) scheduledHits.shift();
    },
  });

  const taps = createTapTempo();

  // ---------- Pads ----------
  function selectPad(index) {
    selected = index;
    onChange();
  }

  // One hit now, through a voice of the pad's own (so it cuts off the pad's last hit). Dropped while the power is off:
  // it would be muted, but a long tail would still be playing at power on.
  function playLive(index, velocity) {
    if (!audio.powered) return;
    const ctx = audio.ensure();
    const { out } = voices.start(ctx, index, audio.master, ctx.currentTime);
    kit.voice(index).play(ctx, withVelocity(ctx, out, velocity), ctx.currentTime);
  }

  // velocity is 0-1.
  function triggerPad(index, velocity = 1) {
    playLive(index, velocity);
    onPadHit(index);
    // A hit that was not heard (the power is off: playLive dropped it) is not written into the pattern either.
    if (recording && scheduler.playing && audio.powered) recordHit(index, velocity);
    selectPad(index);
  }

  // Live recording: quantize the hit to the nearest 16th step.
  function recordHit(index, velocity) {
    const step = nearestStep({
      now: clock.now(),
      playheadTime: scheduler.playheadTime,
      playheadStep: scheduler.playheadStep,
      bpm: scheduler.bpm,
      swing: scheduler.swing,
      steps: totalSteps(),
    });
    if (step < 0) return;
    // a hit played again over a step replaces its velocity
    edit(() => pattern.set(index, step, true, Math.round(velocity * FULL_VELOCITY)));
    scheduler.markHeard(index, step); // it was just played live: don't sound it again at a slow tempo
  }

  // ---------- Steps ----------
  // The sound is scheduled ahead of time, so the pads light from here, when the playhead reaches the
  // steps, to line up with what is heard. They light for the hits that were scheduled, not for what
  // the pattern says now. Only the light: the selected pad stays.
  function lightReachedSteps() {
    // Like the scheduler's own playhead, show only the newest step reached: after a stall (a hidden
    // tab stops the frames, not the scheduler) the ones before it are over and must not all flash.
    let reached = null;
    while (scheduledHits.length && scheduledHits[0].time <= scheduler.playheadTime) reached = scheduledHits.shift();
    // Only when it is the very step the playhead is on: after a stall the scheduler moves the playhead
    // across steps it chose not to sound, and those have no record (the last one found would be old).
    if (reached && reached.time === scheduler.playheadTime) for (const row of reached.rows) onPadPlayed(row);
  }

  // The step keys show one bar; the playhead is only on them while it is in that bar.
  function playheadOnPage(step) {
    const local = step - page * steps;
    return local >= 0 && local < steps ? local : -1;
  }

  // Every change a person makes to the pattern goes through here, so that it can be undone: the state from
  // before is kept when the change did something. `merge` is for a change made in a stream (dragging a
  // velocity), where the first one is kept and the ones right after it are part of the same undo. `fresh` starts a new
  // undo even if the last change was a moment ago (a press on another bar), and what is merged after it joins that one.
  function edit(change, { merge = false, fresh = false } = {}) {
    const before = pattern.state();
    change();
    if (JSON.stringify(pattern.state()) === JSON.stringify(before)) return;
    const at = now();
    const continues = merge && !fresh && selected === lastMergedPad && at - lastMergedAt <= MERGE_MS;
    lastMergedAt = merge ? at : -Infinity;
    lastMergedPad = selected;
    if (!continues) history.push(before);
  }

  function toggleStep(step) {
    edit(() => pattern.toggle(selected, page * steps + step));
    onChange();
  }

  // The one place a pad's setting (gain, pitch, envelope, choke group, colour) changes: for the selected pad, saved with the song. The kit
  // clamps the value and tells the views.
  function setPadSetting(name, value) {
    kit.setSetting(selected, name, value);
    onMessage(
      `PAD ${pad2(selected + 1)} ${SETTINGS[name].label.toUpperCase()} ${formatSetting(name, kit.settings(selected)[name])}`,
    );
    onSongChange();
    onChange();
  }

  // The one place a step's velocity (1-127) is set from outside the pattern. Nothing happens for a step that is off,
  // unless `activate` is given (a press on its velocity bar): then it is turned on and given the velocity as one change,
  // so one undo takes both back.
  function setStepVelocity(step, value, { activate = false } = {}) {
    const index = page * steps + step;
    const wasOn = pattern.isOn(selected, index);
    if (!wasOn && !activate) return;
    edit(
      () => {
        if (!wasOn) pattern.toggle(selected, index);
        pattern.setVelocity(selected, index, value);
      },
      { merge: true, fresh: !wasOn },
    );
    onMessage(`VEL ${pattern.velocity(selected, index)}`);
    onChange();
  }

  function setPage(value) {
    const next = Math.min(lastPage(), Math.max(0, value));
    if (next === page) return;
    page = next;
    lastMergedAt = -Infinity; // a change on another bar is another undo
    onChange();
  }

  function setBars(value) {
    const next = Math.min(maxBars, Math.max(1, Math.round(value)));
    if (next === bars) return;
    const shorter = next < bars;
    bars = next;
    slots[current].bars = bars;
    scheduler.setSteps(totalSteps());
    // A step queued from a bar that is gone must not sound: build the queued ones again. (Made longer,
    // what is queued is still right.)
    if (shorter) rescheduleQueuedHits();
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
    history = slots[current].history;
    lastMergedAt = -Infinity;
    bars = slots[current].bars;
    page = 0;
    scheduler.setSteps(totalSteps());
    scheduler.forgetHeard(); // a live hit still waiting for its step was recorded into the old sequence
    rescheduleQueuedHits();
    onMessage(`SEQ ${pad2(current + 1)}`);
    onChange();
    onSongChange();
  }

  function clearPad() {
    edit(() => pattern.clearRow(selected));
    onMessage(`PAD ${pad2(selected + 1)} STEPS CLEARED`);
    onChange();
  }

  // Copy the steps and velocities of the bar being shown for the selected pad, and paste them over the bar
  // being shown for the selected pad, which may be another bar, pad or sequence (the same pad's next bar is
  // how a bar is repeated).
  function copySteps() {
    clipboard = pattern.rowState(selected, page * steps, steps);
    onMessage(`PAD ${pad2(selected + 1)} BAR ${page + 1} COPIED`);
  }

  function pasteSteps() {
    if (!clipboard) {
      onMessage("NO STEPS COPIED");
      return;
    }
    edit(() => pattern.replaceRow(selected, clipboard, page * steps));
    onMessage(`PASTED TO PAD ${pad2(selected + 1)} BAR ${page + 1}`);
    onChange();
  }

  // Go back to the pattern as it was before the last change to this sequence, or forward again.
  function travel(state, message) {
    if (!state) {
      onMessage(`NOTHING TO ${message}`);
      return;
    }
    const before = pattern.state();
    pattern.restore(state);
    lastMergedAt = -Infinity;
    // The history is of the whole sequence, so what it changes may be on a pad or a bar that is not showing. Go to
    // the first thing that changed, so an undo is never a change to something out of sight.
    const changed = firstDifference(before, pattern.state());
    if (changed) {
      selected = changed.row;
      page = Math.min(lastPage(), Math.floor(changed.step / steps));
    }
    onMessage(message);
    onChange();
  }
  const undo = () => travel(history.undo(pattern.state()), "UNDO");
  const redo = () => travel(history.redo(pattern.state()), "REDO");

  function clearAll() {
    edit(() => pattern.clearAll());
    onMessage("ALL STEPS CLEARED");
    onChange();
  }

  // The steps already handed to the audio clock were built from the sequence just replaced. Silence
  // the ones that have not started and have the scheduler build them again from the new one.
  function rescheduleQueuedHits() {
    if (!scheduler.playing) return;
    const now = clock.now();
    const first = scheduledHits.findIndex((hit) => hit.time > now);
    if (first === -1) return;
    const { step, gridTime } = scheduledHits[first];
    for (const hit of scheduledHits.splice(first)) cancelHit(hit);
    scheduler.rewindTo(step, gridTime); // where the step is on the grid, not when it sounded: swing may have moved since
  }

  // The kit changed: `what` is "sound" (a sample was loaded, restored or removed) or "setting" (a pad's gain, pitch,
  // envelope, choke group or colour). The steps already handed to the audio clock were built with the sounds the kit had, so for a sound
  // the ones that have not started are built again from the new ones. A setting does not rebuild them: the next
  // step built picks it up, at most the lookahead (about 120 ms) later, and rebuilding for every tick of a slider
  // made steps late. It is saved, though, for a setting changed from elsewhere (a sample's pitch cleared).
  function kitChanged(what) {
    if (what === "sound") rescheduleQueuedHits();
    else onSongChange();
  }

  // ---------- Play and stop ----------
  // Hits are handed to the audio clock up to the lookahead (about 120 ms) early, and the scheduler
  // cannot take them back. Silence the ones that have not started yet, so a restart or Stop does
  // not let the old run sound after the new one has begun (or after Stop). Sounds already
  // playing are left to ring out.
  // A step that has not started is cut off, and what it was going to cut off (the pad's earlier voices) carries on.
  function cancelHit(hit) {
    hit.bus.disconnect();
    voices.undo(hit.chokes);
  }

  function cancelQueuedHits() {
    if (scheduledHits.length) {
      const now = clock.now();
      for (const hit of scheduledHits) if (hit.time > now) cancelHit(hit);
    }
    scheduledHits.length = 0;
  }

  // Play always begins at the first step, as the button does on hardware: pressed while the
  // sequence is running, it starts again from the top.
  function start() {
    scheduler.stop();
    cancelQueuedHits();
    scheduler.start();
    onChange();
  }

  // The first press stops the sequence and lets what is sounding ring out; a press when it is already stopped
  // cuts off everything still sounding (a long tail, a sample), as a panic button does on hardware.
  function stop() {
    const wasPlaying = scheduler.playing;
    scheduler.stop();
    cancelQueuedHits();
    // Nothing to cut off before the audio exists (a fresh page), so nothing is said.
    if (!wasPlaying && audio.killSound()) onMessage("ALL SOUND OFF");
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

  function setSwing(value) {
    const swing = scheduler.setSwing(value);
    onMessage(swing === SWING_DEFAULT ? "SWING OFF" : `SWING ${swing}%`);
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
    setStepVelocity,
    setPadSetting,
    setPage,
    setBars,
    setSequence,
    clearPad,
    clearAll,
    kitChanged,
    copySteps,
    pasteSteps,
    undo,
    redo,
    start,
    stop,
    toggleRec,
    setBpm,
    setSwing,
    nudgeTempo: (delta) => setBpm(scheduler.bpm + delta),
    tapTempo,
    setVolume,
    poll() {
      const moved = scheduler.poll();
      if (moved && scheduler.playing) lightReachedSteps();
      return moved;
    },

    getState: () => ({
      selected,
      recording,
      playing: scheduler.playing,
      bpm: scheduler.bpm,
      swing: scheduler.swing,
      volume,
      sequence: current,
      sequenceCount,
      bars,
      page,
      playheadStep: playheadOnPage(scheduler.playheadStep),
      // The step number in the whole sequence, for the LCD.
      playheadPosition: scheduler.playheadStep,
      stepsOn: pattern.row(selected).slice(page * steps, (page + 1) * steps),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      // The velocities of the steps shown, 1-127 (a step that is off reads as full).
      stepVelocities: Array.from({ length: steps }, (_, i) => pattern.velocity(selected, page * steps + i)),
      padSettings: kit.settings(selected), // the selected pad's settings (pad-settings.js)
    }),

    getSong: () => ({
      bpm: scheduler.bpm,
      swing: scheduler.swing,
      volume,
      current,
      padSettings: kit.settingsSnapshot(),
      sequences: slots.map((slot) => ({
        bars: slot.bars,
        pattern: slot.pattern.snapshot(),
        velocities: slot.pattern.velocitySnapshot(),
      })),
    }),
  };
}
