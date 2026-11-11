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
//     sequenceCount,       // how many sequences a start with no saved song has (1); a saved song brings its own
//     maxSequences,        // the most there can be (default: no limit)
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
//   sampler.queueSequence(2)     // 0-based; while playing, the one that takes over where this pass ends (pressed again, or the one showing: taken back);
//                                // stopped, it shows it at once
//   sampler.togglePlayAll()      // Play All: while it plays, each pass is followed by the next of the song (every sequence once, in order, or the arrangement
//                                // with its repeats), and the last by the first
//   sampler.addEntry(at)         // the sequence showing, once, as an entry of the song at that place (default: the end); its place, or -1
//   sampler.removeEntry(index)   // the entry goes (the last cannot); the one to be on after it, or -1
//   sampler.moveEntry(index, 1)  // an entry one place later (-1: earlier); where it is now
//   sampler.setEntryRepeats(index, 3)   // how many times the entry goes round, 1 to 16; what it is now
//   sampler.addSequence()        // an empty one at the end, shown; the same for copySequence(), which copies the one showing
//   sampler.removeSequence()     // the one showing goes, and the one after it takes its place (the last one cannot go)
//   sampler.sequenceHasSteps()   // does the one showing have any steps, in any bar? (to ask before removing it)
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
//   sampler.getState()           // { selected, recording, playing, bpm, swing, volume, sequence, sequenceCount, canAddSequence, canRemoveSequence, queuedSequence, playAll, heard, bars, page, playheadStep, stepsOn, stepVelocities, canUndo, canRedo, padSettings }
//                                // stepsOn and playheadStep are of the bar being shown (playheadStep is -1 when the playhead is in another bar). For a moment
//                                // after a sequence takes over (queued, or the next of Play All) what sounds is still the one that gave way: `heard` is
//                                // { sequence, bars, page, stepsOn, playheadStep } of what sounds, for the display (playheadPosition is in its numbering);
//                                // the rest, with sequence, bars and page, is the one showing, for the keys and for editing
//   sampler.getSong()            // { bpm, swing, volume, current, sequences: [{ bars, pattern, velocities }], padSettings, arrangement? }: what song.js saves
//
// Nothing here calls `onChange` while the sampler is being built, so the caller
// can create it before the views that its callbacks refer to.

import { withVelocity } from "../../shared/sounds.js";
import { pad2 } from "./format.js";
import {
  MAX_ENTRIES,
  afterSequenceAdded,
  afterSequenceRemoved,
  cleanArrangement,
  insertEntry,
  moveEntry as moveArrangementEntry,
  nextPass,
  positionOf,
  removeEntry as removeArrangementEntry,
  resolveArrangement,
  setRepeats,
  wherePassWas,
} from "./arrangement.js";
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
  maxSequences = Infinity,
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
  const makeSlot = ({ bars = 1, pattern: initial = {}, velocities } = {}) => ({
    bars: Math.min(maxBars, bars),
    history: createHistory(), // undo and redo are per sequence
    pattern: createPattern(kit.length, steps * maxBars, initial, { onChange: onSongChange, velocities }),
  });
  const slots = Array.from({ length: Math.max(1, song ? song.sequences.length : sequenceCount) }, (_, i) => {
    const saved = song?.sequences[i];
    return makeSlot({
      bars: saved?.bars,
      pattern: saved ? saved.pattern : i === 0 && !song ? STARTER_BEAT : {},
      velocities: saved?.velocities,
    });
  });
  // The order the sequences play in, with repeats, once a person has edited it (arrangement.js); null until then, which is every
  // sequence once, in order. Play All goes by it (`songAt`, below), and it is kept, saved and followed through adding, copying and
  // removing sequences, so that the order is always about the sequences there are. Nothing edits it yet, and Export does not read it.
  let arrangement = cleanArrangement(song?.arrangement, slots.length);
  let pattern = slots[current].pattern;
  let history = slots[current].history;
  let clipboard = null; // a bar of one pad's steps and velocities, from copySteps; kept across sequences
  let lastMergedAt = -Infinity; // when the last velocity change was made, for MERGE_MS
  let lastMergedPad = -1; // and on which pad: a change to another pad is another undo, however soon it comes
  let bars = slots[current].bars;
  const totalSteps = () => bars * steps;
  const lastPage = () => bars - 1;

  // A sequence can take over where the pass ends: one queued (queueSequence), or the next of Play All. The scheduler hands the first
  // step of the next pass to the audio clock before the last steps of this one have sounded (by the lookahead and a step: about a
  // quarter of a second at 100 BPM), so the switch is made in state that much early, and three things need to know which pass a
  // step belongs to: the hits already scheduled (`pass` on each: only those of the pass that has begun are built again from the
  // sequence now showing), the playhead, whose step numbers are the old sequence's until it reaches `passStart` (the display
  // follows that sequence till then: `heard`), and a live hit, which goes to the old one (`outgoing`).
  let queued = -1; // the sequence that takes over at the end of the pass, or -1
  // Play All: with nothing queued, the song goes on at the end of the pass: the next time round its entry, or the next entry
  // (arrangement.js: with no arrangement, the next sequence, and the first after the last). Where it goes is worked out at the pass
  // end, from the sequence then showing and `songAt`, so a sequence added, removed or switched to meanwhile cannot leave it pointing
  // at one that is not there. A mode of this visit: not saved with the beat.
  let playAll = false;
  // Where the pass that has just begun is in the song ({ entry, rep }, arrangement.js), or null when it is not known: Play was just
  // pressed, a person has picked a sequence, or the sequence is not in the song. The chain then takes the sequence showing for the
  // first time round the first entry that names it.
  let songAt = null;
  // The pass end the song last went on at (`time` on the audio clock), where it was before it did (`from`), and whether the entry went
  // round again there (`repeat`: nothing took over). The scheduler tells a pass end a second time when it goes back over it to build
  // the steps again (the sounds changed, a sequence was made shorter), and an entry that goes round again takes nothing over, so
  // nothing else would tell the second time from a new pass end: the song goes on once for a pass end, and a second telling works it
  // out again from where it was. A pass end that turns out not to be one (withdrawPassEnd) takes back a time round that was counted.
  const NO_WRAP = { time: -Infinity, from: null, repeat: false };
  let wrapped = NO_WRAP;
  // A person picked a sequence, or Play or Play All was pressed: where the song was means nothing now.
  function forgetSongPosition() {
    songAt = null;
    wrapped = NO_WRAP;
  }
  // The loop carries on past the pass end the scheduler had reached (a sequence made longer): it was not one, so nothing can take over
  // there, and a time round of an entry that the song went on to at it was not one either.
  function withdrawPassEnd() {
    // Only while its first step is still to sound: after that the time round has begun, and it is the pass after it that is longer.
    if (wrapped.repeat && lastWrap > clock.now()) {
      songAt = wrapped.from;
      wrapped = NO_WRAP;
    }
    lastWrap = -Infinity;
  }
  let switching = false; // inside the call that tells the scheduler the length of the sequence just picked (showSequence)
  let passId = 0; // counts the switches made at the end of a pass
  let passStart = -Infinity; // on the audio clock, where the pass the last switch began falls
  // Where the pass that has just ended in the scheduler ended, on the audio clock: its first step has been or is about to be
  // handed over, but has not sounded until this time. A sequence queued before then still takes over there (queueSequence): a
  // person who presses just ahead of the downbeat is on time. Not set once a sequence has taken over there.
  let lastWrap = -Infinity;
  // What the sequence that gave way at the last switch was (its pattern, its undo history, how many steps it had), for a live
  // hit in the moment before the playhead reaches the new pass: that hit is a step of the pass that is still sounding.
  let outgoing = null;
  // The pattern of the sequence the chain picked at the last pass end, when it picked it by itself (Play All, nothing asked for), or
  // null. Turning Play All off before that pass end sounds takes the pick back, as long as it is still what is showing.
  let chained = null;

  // The sequencer runs on the audio clock; the context only exists once audio has been unlocked.
  const scheduledHits = []; // { time, gridTime, step, rows, bus, chokes, pass } for each step handed to the scheduler, until its light is shown
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
      scheduledHits.push({ time, gridTime, step, rows, bus, chokes, pass: passId });
      if (scheduledHits.length > MAX_SCHEDULED_HITS) scheduledHits.shift();
    },
    // The loop has come round, and the first step of the next pass is the next one to be built: if a sequence is queued,
    // this is where it takes over, with the length it has.
    onWrap(time) {
      // A person has just picked this sequence (and the loop of its length ends where the scheduler is, by the position carrying
      // over): it plays, and the chain goes on from it at the next pass end, not now.
      if (switching) {
        lastWrap = time;
        return;
      }
      // A queued sequence goes first (a person asked for it), and the chain goes on from it.
      const asked = queued >= 0;
      let next = asked ? queued : current;
      if (!asked && playAll) {
        const from = wrapped.time === time ? wrapped.from : songAt;
        // Where that pass was, worked out now, so that what is remembered of it can follow an edit (a position not known is the first
        // entry that names the sequence in the list as it is, and an edit changes the list).
        const here = wherePassWas(arrangement, slots.length, from, current);
        const pass = nextPass(arrangement, slots.length, here, current);
        wrapped = { time, from: here, repeat: pass.sequence === current };
        songAt = { entry: pass.entry, rep: pass.rep };
        next = pass.sequence;
      }
      // Nothing to take over (one sequence, no chain, or an entry that goes round again): the pass end stays one that a sequence
      // queued just ahead of it can take over at, and no pick of the chain's is left to take back (chainAtOpenPassEnd).
      if (next === current) {
        chained = null;
        lastWrap = time;
      } else takeOver(next, time, { automatic: !asked });
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
    // Between a switch and the new pass sounding, the playhead is on the last steps of the sequence that gave way, so the steps
    // are counted in its length. The one nearest the first step of the next pass is the downbeat of the one that took over.
    const before = playheadInOldPass();
    const step = nearestStep({
      now: clock.now(),
      playheadTime: scheduler.playheadTime,
      playheadStep: scheduler.playheadStep,
      bpm: scheduler.bpm,
      swing: scheduler.swing,
      playheadDelay: scheduler.playheadDelay,
      steps: before ? outgoing.steps : totalSteps(),
    });
    if (step < 0) return;
    const into = before && step !== 0 ? outgoing : { pattern, history };
    // a hit played again over a step replaces its velocity
    editOn(into, () => into.pattern.set(index, step, true, Math.round(velocity * FULL_VELOCITY)));
    if (into !== outgoing) scheduler.markHeard(index, step); // it was just played live: don't sound it again at a slow tempo
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

  // Between a sequence taking over and the moment its first step sounds, the playhead is still on the last steps of the sequence
  // before, which are not steps of the one showing.
  const playheadInOldPass = () => scheduler.playheadStep >= 0 && scheduler.playheadTime < passStart;

  // The step keys show one bar; the playhead is only on them while it is in that bar.
  function playheadOnPage(step, onPage = page) {
    const local = step - onPage * steps;
    return local >= 0 && local < steps ? local : -1;
  }

  // Every change a person makes to the pattern goes through here, so that it can be undone: the state from
  // before is kept when the change did something. `merge` is for a change made in a stream (dragging a
  // velocity), where the first one is kept and the ones right after it are part of the same undo. `fresh` starts a new
  // undo even if the last change was a moment ago (a press on another bar), and what is merged after it joins that one.
  const edit = (change, options) => editOn({ pattern, history }, change, options);

  // `target` is the pattern and the undo history of the sequence the change is to: the one showing, or the one that has just
  // given way (a live hit in the moment between a switch and the new pass).
  function editOn(target, change, { merge = false, fresh = false } = {}) {
    const before = target.pattern.state();
    change();
    if (JSON.stringify(target.pattern.state()) === JSON.stringify(before)) return;
    const at = now();
    const continues = merge && !fresh && selected === lastMergedPad && at - lastMergedAt <= MERGE_MS;
    lastMergedAt = merge ? at : -Infinity;
    lastMergedPad = selected;
    if (!continues) target.history.push(before);
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
    if (!shorter) withdrawPassEnd(); // the loop carries on past the pass end the scheduler had reached: it is not one
    bars = next;
    slots[current].bars = bars;
    page = Math.min(page, lastPage());
    onMessage(`${bars} ${bars === 1 ? "BAR" : "BARS"}`);
    // Made shorter, the loop may end exactly where the scheduler is, which is a pass end: a queued sequence (or the next of Play
    // All) takes over there, from inside this call, and a queued one says so (after the message above, which was of the sequence that has gone). So everything
    // that is of this sequence is settled before it, and nothing after it is.
    scheduler.setSteps(totalSteps());
    // A step queued from a bar that is gone must not sound: build the queued ones again. (Made longer,
    // what is queued is still right.)
    if (shorter) rescheduleQueuedHits();
    onChange();
    onSongChange();
  }

  // What showing the sequence in slot `next` (which exists) changes here, apart from the scheduler.
  function adoptSequence(next) {
    queued = -1;
    current = next;
    pattern = slots[current].pattern;
    history = slots[current].history;
    lastMergedAt = -Infinity;
    bars = slots[current].bars;
    page = 0;
  }

  // Show the sequence in slot `next` now. If it is playing, the playhead carries on into it. It drops a sequence that was
  // waiting for the end of the pass: a person who picks one now, or adds or removes one (which moves the numbers), is not
  // leaving a plan behind.
  function showSequence(next) {
    if (slots[next].bars > bars) lastWrap = -Infinity; // as for setBars: a longer one carries on past the pass end
    adoptSequence(next);
    forgetSongPosition(); // a person picked it (or made or removed one): the song goes on from where this sequence first is
    // The position carries over into the length of the sequence picked, which can end the loop where the scheduler is: that is no
    // pass end for the chain to go on from (onWrap).
    switching = true;
    try {
      scheduler.setSteps(totalSteps());
    } finally {
      switching = false;
    }
    scheduler.forgetHeard(); // a live hit still waiting for its step was recorded into the old sequence
    rescheduleQueuedHits();
  }

  const clampSequence = (value) => Math.min(slots.length - 1, Math.max(0, Math.round(value)));

  function setSequence(value) {
    const next = clampSequence(value);
    if (next === current) {
      cancelQueue(); // the one asked for is the one showing: there is nothing to wait for
      return;
    }
    showSequence(next);
    onMessage(`SEQ ${pad2(current + 1)}`);
    onChange();
    onSongChange();
  }

  function togglePlayAll() {
    playAll = !playAll;
    forgetSongPosition();
    onMessage(playAll ? "PLAY ALL ON" : "PLAY ALL OFF");
    chainAtOpenPassEnd();
    onChange();
  }

  // Turned on or off in the moment after the scheduler has reached a pass end and before the display has: the mode is for that end,
  // not the next. On, the song's next pass begins there: its sequence takes over (the same takeover the chain makes, so as quiet), or
  // nothing does when the entry goes round again; off, the sequence the chain picked for it is taken back, to the one that gave way,
  // unless a person has picked another since.
  function chainAtOpenPassEnd() {
    // (An open pass end has nothing queued: a sequence queued in that moment takes over at once.)
    if (!scheduler.playing || !passEndOpen()) return;
    if (playAll) {
      const here = wherePassWas(arrangement, slots.length, songAt, current);
      const pass = nextPass(arrangement, slots.length, here, current);
      wrapped = { time: lastWrap, from: here, repeat: pass.sequence === current };
      songAt = { entry: pass.entry, rep: pass.rep };
      // An entry that goes round again has no sequence to take over: the first step built is already the right one.
      if (pass.sequence !== current) takeOverLate(pass.sequence, { automatic: true });
      return;
    }
    if (chained !== pattern) return;
    const back = slots.findIndex((slot) => slot.pattern === outgoing.pattern);
    if (back !== -1) takeOverLate(back, { automatic: true });
  }

  // ---------- The song's entries ----------
  // What the strip edits: the arrangement, through these four, which is the one place it changes apart from following the sequences.
  // They work on the entries as they play (a song nobody edited has every sequence once, and the first edit makes that explicit), and a
  // song that is playing goes on from its entry: where it is, and what is remembered of the last pass end, move with it. What it
  // plays next is worked out at the next pass end, so an edit is heard from there. No undo, as for the sequences' own list.
  const entryCount = () => resolveArrangement(arrangement, slots.length).length;
  const entryRepeats = (index) => resolveArrangement(arrangement, slots.length)[index]?.repeats ?? -1;

  function followEdit({ arrangement: next, entryAfter }) {
    // A pass that is playing and has not been told yet (the first after Play, or after a pick) is on the first entry that names its
    // sequence, in the list as it is now: said before the list changes, so that the edit moves it and does not choose it again.
    if (!songAt && playAll && scheduler.playing) songAt = positionOf(arrangement, slots.length, current);
    arrangement = next;
    const follow = (at) => {
      if (!at) return at;
      const entry = entryAfter(at.entry);
      return entry < 0 ? null : { entry, rep: at.rep };
    };
    songAt = follow(songAt);
    wrapped = wrapped.from ? { ...wrapped, from: follow(wrapped.from) } : wrapped;
  }

  // An edit made in the moment after the scheduler has reached a pass end and before its first step has sounded counts at that pass end,
  // as a press on a sequence key does (takeOverLate): what the song picked for it is worked out again from where the song was before
  // it, in the list as it is now. What the pass end gave was either a sequence taking over (the one that gave way is `outgoing`) or
  // the entry going round again, and a different answer takes back the steps built for the first and builds them again. A pass end
  // that was asked for (a queued sequence) is not the song's to change, and one that has sounded is heard from the next.
  function reconsiderPassEnd() {
    if (!playAll || !scheduler.playing || !passEndOpen() || wrapped.time !== lastWrap) return;
    const ended = wrapped.repeat ? current : slots.findIndex((slot) => slot.pattern === outgoing?.pattern);
    if (ended < 0) return;
    const pass = nextPass(arrangement, slots.length, wrapped.from, ended);
    songAt = { entry: pass.entry, rep: pass.rep };
    // Still the entry going round again with nothing taken over, only if it was and is: when this takes over, even back to the sequence that
    // ended, the pass has been restarted, so the pass end is a real one and no longer one that can be withdrawn.
    wrapped = { ...wrapped, repeat: wrapped.repeat && pass.sequence === ended };
    if (pass.sequence !== current) takeOverLate(pass.sequence, { automatic: true });
  }

  function addEntry(at = entryCount()) {
    const edit = insertEntry(arrangement, slots.length, at, current);
    if (!edit) {
      onMessage(`${MAX_ENTRIES} ENTRIES MAX`);
      return -1;
    }
    const place = Math.min(entryCount(), Math.max(0, at));
    followEdit(edit);
    reconsiderPassEnd();
    onMessage(`ENTRY ${pad2(place + 1)} ADDED`);
    onChange();
    onSongChange();
    return place;
  }

  function removeEntry(index) {
    const edit = removeArrangementEntry(arrangement, slots.length, index);
    if (!edit) {
      if (entryCount() === 1) onMessage("CANNOT REMOVE LAST ENTRY");
      return -1;
    }
    followEdit(edit);
    reconsiderPassEnd();
    onMessage(`ENTRY ${pad2(index + 1)} REMOVED`);
    onChange();
    onSongChange();
    return Math.min(index, entryCount() - 1);
  }

  function moveEntry(index, delta) {
    const to = Math.min(entryCount() - 1, Math.max(0, index + delta));
    const edit = moveArrangementEntry(arrangement, slots.length, index, to);
    if (!edit) return index; // already at that end of the song
    followEdit(edit);
    reconsiderPassEnd();
    onMessage(`ENTRY ${pad2(index + 1)} MOVED TO ${pad2(to + 1)}`);
    onChange();
    onSongChange();
    return to;
  }

  function setEntryRepeats(index, repeats) {
    const edit = setRepeats(arrangement, slots.length, index, repeats);
    if (!edit) return entryRepeats(index);
    followEdit(edit);
    const now = entryRepeats(index);
    // Made to go round fewer times than it has: this is its last time round (a position past the end would be taken for a stale one).
    const last = (at) => (at && at.entry === index ? { ...at, rep: Math.min(at.rep, now - 1) } : at);
    songAt = last(songAt);
    wrapped = wrapped.from ? { ...wrapped, from: last(wrapped.from) } : wrapped;
    reconsiderPassEnd();
    onMessage(`ENTRY ${pad2(index + 1)} REPEATS ${now}`);
    onChange();
    onSongChange();
    return now;
  }

  // Take back the sequence that was waiting for the end of the pass, saying so.
  function cancelQueue() {
    if (queued < 0) return;
    queued = -1;
    onMessage("NEXT CANCELLED");
    onChange();
  }

  // The sequence in slot `next` takes over at `time`, where the pass that is ending is followed by the first step of the one
  // that is coming, which has the length of the sequence now.
  //
  // `automatic` is the chain's own (Play All, with nothing asked for): it says nothing and saves nothing, which a pass at a time
  // would be an announcement for a screen reader and a write that tells another tab it is out of date, and it leaves the pass end
  // open for a sequence that is asked for just ahead of it (takeOverLate), since nobody asked for this one. `keepOutgoing` is for
  // taking over again at a pass end that was already taken over: what is still sounding is the sequence that gave way first.
  function takeOver(next, time, { automatic = false, keepOutgoing = false } = {}) {
    passId++;
    passStart = time;
    lastWrap = automatic ? time : -Infinity;
    if (!keepOutgoing) outgoing = { pattern, history, steps: totalSteps(), sequence: current, bars, page };
    adoptSequence(next);
    // Asked for, not the chain's pick (which has worked out where it is): the song goes on from the first entry that names it.
    if (!automatic) songAt = positionOf(arrangement, slots.length, next);
    chained = automatic ? pattern : null;
    scheduler.startPass(totalSteps());
    if (!automatic) onMessage(`SEQ ${pad2(current + 1)}`);
    onChange();
    if (!automatic) onSongChange();
  }

  // Queued after the pass ended in the scheduler, but before its next step has sounded: the steps already handed to the audio
  // clock for that pass are of the sequence that is giving way, so take them back, build them again from the one taking over, and
  // have it take over where the grid has the pass end. What is already queued of the pass before stays.
  function takeOverLate(next, { automatic = false } = {}) {
    const first = scheduledHits.findIndex((hit) => hit.gridTime >= lastWrap);
    if (first !== -1) for (const hit of scheduledHits.splice(first)) cancelHit(hit);
    scheduler.rewindTo(0, lastWrap);
    takeOver(next, lastWrap, { automatic, keepOutgoing: passStart === lastWrap });
  }

  // The pass end that the scheduler has reached and whose first step has not sounded: a press or a toggle in this moment is for it.
  // Not if the steps before it were taken back since (a rewind): they are still to be built, and the wrap is still to come.
  const passEndOpen = () => lastWrap > clock.now() && scheduler.nextTime >= lastWrap;

  // Next Seq, as on an MPC: while a beat plays, the sequence asked for takes over where the pass ends and the one showing plays
  // out until then. Picking the one that is waiting, or the one showing, takes the plan back; picking another changes it.
  // Stopped, there is no pass to wait for and it is shown at once.
  function queueSequence(value) {
    const next = clampSequence(value);
    if (!scheduler.playing) {
      setSequence(next);
      return;
    }
    if (next === queued || next === current) {
      cancelQueue();
      return;
    }
    if (passEndOpen()) {
      takeOverLate(next);
      return;
    }
    queued = next;
    onMessage(`NEXT SEQ ${pad2(next + 1)}`);
    onChange();
  }

  // The one place a sequence is made or goes, so that whatever depends on how many there are (a song that chains them, later)
  // has one place to follow. A new one is always at the end and is shown, and what was queued for the playhead is built again
  // from it, as when another sequence is picked.
  const atMost = () => slots.length >= maxSequences;
  const full = () => {
    onMessage(`${maxSequences} SEQUENCES MAX`);
    return true;
  };

  function addSequence() {
    if (atMost() && full()) return;
    slots.push(makeSlot());
    arrangement = afterSequenceAdded(arrangement, slots.length - 1);
    showSequence(slots.length - 1);
    onMessage(`SEQ ${pad2(current + 1)} ADDED`);
    onChange();
    onSongChange();
  }

  function copySequence() {
    if (atMost() && full()) return;
    const from = current;
    slots.push(makeSlot({ bars, pattern: pattern.snapshot(), velocities: pattern.velocitySnapshot() }));
    arrangement = afterSequenceAdded(arrangement, slots.length - 1);
    showSequence(slots.length - 1);
    onMessage(`SEQ ${pad2(from + 1)} COPIED TO ${pad2(current + 1)}`);
    onChange();
    onSongChange();
  }

  // Not undoable (undo is of the steps of one sequence), so the page asks first when there is anything in it (sequenceHasSteps).
  function removeSequence() {
    if (slots.length === 1) {
      onMessage("CANNOT REMOVE LAST SEQUENCE");
      return;
    }
    const removed = current;
    slots.splice(removed, 1);
    arrangement = afterSequenceRemoved(arrangement, removed);
    showSequence(Math.min(removed, slots.length - 1));
    onMessage(`SEQ ${pad2(removed + 1)} REMOVED`);
    onChange();
    onSongChange();
  }

  // Any step on any pad, in any bar: a sequence made shorter keeps the steps of the bars it dropped.
  const sequenceHasSteps = () => Object.keys(pattern.snapshot()).length > 0;

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
  // the ones that have not started and have the scheduler build them again from the new one. Not the ones of a pass before
  // a queued switch (the last steps of the sequence that was playing): they are what was meant to sound, and the new pass
  // is not made of them.
  function rescheduleQueuedHits() {
    if (!scheduler.playing) return;
    const now = clock.now();
    const first = scheduledHits.findIndex((hit) => hit.pass === passId && hit.time > now);
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
    cancelQueue();
    passStart = -Infinity;
    lastWrap = -Infinity;
    forgetSongPosition(); // from the top, with the sequence showing
    scheduler.start();
    onChange();
  }

  // The first press stops the sequence and lets what is sounding ring out; a press when it is already stopped
  // cuts off everything still sounding (a long tail, a sample), as a panic button does on hardware.
  function stop() {
    const wasPlaying = scheduler.playing;
    scheduler.stop();
    cancelQueuedHits();
    cancelQueue();
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
    queueSequence,
    togglePlayAll,
    addSequence,
    copySequence,
    removeSequence,
    addEntry,
    removeEntry,
    moveEntry,
    setEntryRepeats,
    sequenceHasSteps,
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

    getState: () => {
      const stepsOn = pattern.row(selected).slice(page * steps, (page + 1) * steps);
      const playheadStep = playheadOnPage(scheduler.playheadStep);
      return {
        selected,
        recording,
        playing: scheduler.playing,
        bpm: scheduler.bpm,
        swing: scheduler.swing,
        volume,
        sequence: current,
        sequenceCount: slots.length,
        canAddSequence: !atMost(),
        canRemoveSequence: slots.length > 1,
        queuedSequence: queued,
        playAll,
        // The song's entries as they play (a copy), whether a person has edited them, and where the song is while Play All plays it, which
        // leads what is heard by the lookahead as the sequence keys do: the entry and the time round it, or null (not playing it, or the
        // sequence playing is in no entry).
        arrangement: resolveArrangement(arrangement, slots.length).map((entry) => ({ ...entry })),
        arrangementEdited: arrangement !== null,
        canAddEntry: entryCount() < MAX_ENTRIES,
        canRemoveEntry: entryCount() > 1,
        songPass:
          playAll && scheduler.playing
            ? songAt
              ? { ...songAt }
              : positionOf(arrangement, slots.length, current)
            : null,
        // What sounds, for the display: until the new pass sounds, a sequence that has taken over is not yet the one heard, and the
        // playhead is on the last steps of the one that gave way, in its numbering and its length, in the bar that was showing.
        // `sequence`, `bars`, `page`, `stepsOn` and `playheadStep` below are the one showing, for the keys and for editing.
        heard: playheadInOldPass()
          ? {
              sequence: Math.min(outgoing.sequence, slots.length - 1),
              bars: outgoing.bars,
              page: outgoing.page,
              stepsOn: outgoing.pattern.row(selected).slice(outgoing.page * steps, (outgoing.page + 1) * steps),
              playheadStep: playheadOnPage(scheduler.playheadStep, outgoing.page),
            }
          : { sequence: current, bars, page, stepsOn, playheadStep },
        bars,
        page,
        playheadStep,
        // The step number in the whole sequence, for the LCD (in the numbering of the sequence that sounds: `heard.sequence`).
        playheadPosition: scheduler.playheadStep,
        stepsOn,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        // The velocities of the steps shown, 1-127 (a step that is off reads as full).
        stepVelocities: Array.from({ length: steps }, (_, i) => pattern.velocity(selected, page * steps + i)),
        padSettings: kit.settings(selected), // the selected pad's settings (pad-settings.js)
      };
    },

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
      // A copy, and left out while there is none (a song nobody edited is saved as it always was).
      ...(arrangement ? { arrangement: arrangement.map((entry) => ({ ...entry })) } : {}),
    }),
  };
}
