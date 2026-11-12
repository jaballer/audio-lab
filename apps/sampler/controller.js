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
//     sequenceCount,       // how many sequences a start with no saved beat has (1); a saved beat brings its own
//     maxSequences,        // the most there can be (default: no limit)
//     beat,                // a parseBeat() result to start from, or null for the starter beat
//     onChange,            // something on screen is out of date: read getState() and redraw
//     onMessage,           // (text) a short note for the LCD
//     onPadHit,            // (index) a pad just sounded live: flash it
//     onPadPlayed,         // (index) the sequence just reached a pad that is on: light it (a pad does not move for this)
//     onBeatChange,        // the pattern, tempo or volume changed: worth saving
//   });
//
//   sampler.triggerPad(3, 0.8)   // velocity 0-1, default 1
//   sampler.selectPad(3)
//   sampler.toggleStep(5)        // a step of the bar being shown (see setPage)
//   sampler.setPadSetting("gain", -6)       // the selected pad's gain (dB), pitch (semitones), envelope, choke or colour, saved with the beat
//   sampler.setStepVelocity(5, 90)   // 1-127, for a step that is on; the sequence plays it at that level
//   sampler.setStepVelocity(5, 90, { activate: true })   // the same, and turns the step on first if it is off: one undo
//   sampler.setSequence(1)       // 0-based; each sequence has its own steps and bars
//   sampler.queueSequence(2)     // 0-based; while playing, the one that takes over where this pass ends (pressed again, or the one showing: taken back);
//                                // stopped, it shows it at once
//   sampler.toggleSong()         // Song mode: Play begins at the entry selected, each pass is followed by the next of the song (every sequence once, in order, or
//                                // the arrangement with its repeats), and the song ends after its last pass (or, with Loop on, the last is followed by the first);
//                                // the editor stays where it is, and a sequence key only shows
//   sampler.toggleLoop()         // Loop on or off: whether the song goes round again at its end instead of stopping (off to begin with, saved with the beat)
//   sampler.selectEntry(2)       // the entry of the song that is selected (0-based): where Song mode begins, and what the tools act on
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
//   sampler.getState()           // { selected, recording, playing, bpm, swing, volume, sequence, sequenceCount, canAddSequence, canRemoveSequence, queuedSequence, songMode, loopSong, heard, bars, page, playheadStep, stepsOn, stepVelocities, canUndo, canRedo, padSettings }
//                                // stepsOn and playheadStep are of the bar being shown (playheadStep is -1 when the playhead is in another bar). For a moment
//                                // after a sequence takes over (queued, or the next of the song) what sounds is still the one that gave way: `heard` is
//                                // { sequence, bars, page, stepsOn, playheadStep, song } of what sounds, for the display (playheadPosition is in its numbering;
//                                // `song` is where the song is in Song mode, or null: { entry, entries, sequence, rep, repeats, next }, `entry` and `rep` -1 when not known,
//                                // `next` -1 when the song ends after this pass);
//                                // the rest, with sequence, bars and page, is the one showing, for the keys and for editing
//   sampler.getBeat()            // { bpm, swing, volume, current, sequences: [{ bars, pattern, velocities }], padSettings, arrangement?, loopSong? }: what beat.js saves
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
  isLastPass,
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
  beat = null,
  now = () => performance.now(),
  onChange = noop,
  onMessage = noop,
  onPadHit = noop,
  onPadPlayed = noop,
  onBeatChange = noop,
}) {
  let selected = 0;
  let recording = false;
  let volume = beat ? beat.volume : DEFAULT_VOLUME;
  let page = 0;
  let current = beat?.current ?? 0;

  // Each sequence has its own steps and length; tempo and volume are shared. With no saved beat the
  // first sequence is the starter beat and the rest are empty. A pattern has room for every bar, so
  // shortening a sequence keeps what was in the bars it drops.
  const makeSlot = ({ bars = 1, pattern: initial = {}, velocities } = {}) => ({
    bars: Math.min(maxBars, bars),
    history: createHistory(), // undo and redo are per sequence
    pattern: createPattern(kit.length, steps * maxBars, initial, { onChange: onBeatChange, velocities }),
  });
  const slots = Array.from({ length: Math.max(1, beat ? beat.sequences.length : sequenceCount) }, (_, i) => {
    const saved = beat?.sequences[i];
    return makeSlot({
      bars: saved?.bars,
      pattern: saved ? saved.pattern : i === 0 && !beat ? STARTER_BEAT : {},
      velocities: saved?.velocities,
    });
  });
  // The order the sequences play in, with repeats, once a person has edited it (arrangement.js); null until then, which is every
  // sequence once, in order. Song mode goes by it (`songAt`, below), and it is kept, saved and followed through adding, copying and
  // removing sequences, so that the order is always about the sequences there are. The Song panel edits it, and Export reads it.
  let arrangement = cleanArrangement(beat?.arrangement, slots.length);
  // Does the song go round again at its end instead of stopping? Off until a person turns it on, and saved with the beat. It is only about
  // Song mode: a beat that is not in Song mode is a loop of the sequence showing, whatever this says.
  let loopSong = beat?.loopSong === true;
  // The entry of the song that is selected (the strip shows it, and the tools act on it): where Song mode begins when Play is pressed.
  // Kept in range when it is read, since the song can have fewer entries than it had.
  let selectedEntry = 0;
  let pattern = slots[current].pattern;
  let history = slots[current].history;
  let clipboard = null; // a bar of one pad's steps and velocities, from copySteps; kept across sequences
  let lastMergedAt = -Infinity; // when the last velocity change was made, for MERGE_MS
  let lastMergedPad = -1; // and on which pad: a change to another pad is another undo, however soon it comes
  let bars = slots[current].bars;
  const lastPage = () => bars - 1;
  // What plays and what shows are two things. `current` is the sequence the step keys, the step editor and the sequence keys are
  // about, with its `pattern`, `history`, `bars` and `page`; `playing` is the slot of the sequence the scheduler builds steps from, and what the
  // display says sounds. They are the same sequence for now: every pick, switch and takeover sets both (adoptSequence), so a person
  // sees and edits what plays. Reads that are about sound (the steps built, the length of the pass, the sequence the song or a queue
  // goes on from, a live hit recorded) use `playing`; reads that are about the editor use `current`.
  // `playing` is the slot itself and not its number, which is not stable: removing a sequence moves the ones after it down, and the slot
  // of the one that goes is still what was playing until the next one is adopted. Where a number is wanted it is `playingIndex()`.
  let playing = slots[current];
  const playingIndex = () => slots.indexOf(playing);
  const playingSteps = () => playing.bars * steps;

  // A sequence can take over where the pass ends: one queued (queueSequence), or the next of the song. The scheduler hands the first
  // step of the next pass to the audio clock before the last steps of this one have sounded (by the lookahead and a step: about a
  // quarter of a second at 100 BPM), so the switch is made in state that much early, and three things need to know which pass a
  // step belongs to: the hits already scheduled (`pass` on each: only those of the pass that has begun are built again from the
  // sequence now showing), the playhead, whose step numbers are the old sequence's until it reaches `passStart` (the display
  // follows that sequence till then: `heard`), and a live hit, which goes to the old one (`outgoing`).
  let queued = -1; // the sequence that takes over at the end of the pass, or -1
  // Song mode: with nothing queued, the song goes on at the end of the pass: the next time round its entry, or the next entry
  // (arrangement.js: with no arrangement, the next sequence, and the first after the last). Where it goes is worked out at the pass
  // end, from the sequence then showing and `songAt`, so a sequence added, removed or switched to meanwhile cannot leave it pointing
  // at one that is not there. A mode of this visit: not saved with the beat.
  let songMode = false;
  // Where the pass that has just begun is in the song ({ entry, rep }, arrangement.js), or null when it is not known: Play was just
  // pressed, a person has picked a sequence, or the sequence is not in the song. The chain then takes the sequence showing for the
  // first time round the first entry that names it.
  let songAt = null;
  // The pass end the song last went on at (`time` on the audio clock), where it was before it did (`from`), and whether the entry went
  // round again there (`repeat`: nothing took over). The scheduler tells a pass end a second time when it goes back over it to build
  // the steps again (the sounds changed, a sequence was made shorter), and an entry that goes round again takes nothing over, so
  // nothing else would tell the second time from a new pass end: the song goes on once for a pass end, and a second telling works it
  // out again from where it was. A pass end that turns out not to be one (withdrawPassEnd) takes back a time round that was counted.
  // `end` is for the pass end that is the song's end (the last pass, with Loop off): nothing takes over, and the run stops there.
  const NO_WRAP = { time: -Infinity, from: null, repeat: false, end: false };
  // The same pass end comes back from the scheduler with a time that differs by a rounding (it counts the grid a step at a time, and
  // after a stall with a multiplication), so two times are one pass end when they are this close: two pass ends are at least a step
  // apart, 62 ms at the fastest tempo.
  const SAME_PASS_END_S = 0.01;
  const isSamePassEnd = (a, b) => Math.abs(a - b) < SAME_PASS_END_S;
  let wrapped = NO_WRAP;
  // The song ends after the pass at `here` (a place, or null when it is not known): the last pass of the last entry, with Loop off. A pass
  // that is in no entry is not one the song ends after: the chain takes the first entry from it, as it always did.
  const endsAt = (here) => !loopSong && isLastPass(arrangement, slots.length, here);
  // A person picked a sequence in Pattern mode, or Play or the Song key was pressed: where the song was means nothing now.
  function forgetSongPosition() {
    songAt = null;
    wrapped = NO_WRAP;
  }
  // The loop carries on past the pass end the scheduler had reached (a sequence made longer): it was not one, so nothing can take over
  // there, and a time round of an entry that the song went on to at it was not one either.
  function withdrawPassEnd() {
    // Only while its first step is still to sound: after that the time round has begun, and it is the pass after it that is longer. (The
    // song's end needs nothing here: the scheduler takes it back itself when a loop made longer carries on past the pass end (`setSteps`),
    // and the song's place was not moved on at it.)
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
  // The pattern of the sequence the chain picked at the last pass end, when it picked it by itself (Song mode, nothing asked for), or
  // null. Turning Song mode off before that pass end sounds takes the pick back, as long as it is still what is showing.
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
    steps: playingSteps(),
    bpm: beat?.bpm,
    swing: beat?.swing,
    onStep(step, time, heard, gridTime) {
      const { ctx, master } = audio;
      const { pattern: playingPattern } = playing;
      const rows = [];
      const chokes = []; // the voices these hits cut off, so cancelling the step can give them back
      // The step's hits go through a gain of their own, so that if playback is restarted or
      // stopped before the step is reached, its sounds can be cut off (see cancelQueuedHits).
      const bus = ctx.createGain();
      bus.connect(master);
      // With the power off nothing is built: the hits would be muted, but their tails would still be sounding when
      // the power came on (a 10 second sample, every step) and be heard all at once. The beat goes on silently.
      for (let row = 0; row < kit.length && audio.powered; row++) {
        if (playingPattern.isOn(row, step) && !heard.has(row)) {
          const voice = voices.start(ctx, row, bus, time);
          kit
            .voice(row)
            .play(ctx, withVelocity(ctx, voice.out, playingPattern.velocity(row, step) / FULL_VELOCITY), time);
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
    // The clock has reached the end of the song's last pass: the scheduler has stopped itself.
    onEnd: songEnded,
    onWrap(time) {
      // A person has just picked this sequence (and the loop of its length ends where the scheduler is, by the position carrying
      // over): it plays, and the chain goes on from it at the next pass end, not now.
      if (switching) {
        lastWrap = time;
        return;
      }
      // A queued sequence goes first (a person asked for it), and the chain goes on from it.
      const asked = queued >= 0;
      const was = playingIndex(); // the sequence whose pass has ended
      let next = asked ? queued : was;
      if (!asked && songMode) {
        const from = isSamePassEnd(wrapped.time, time) ? wrapped.from : songAt;
        // Where that pass was, worked out now, so that what is remembered of it can follow an edit (a position not known is the first
        // entry that names the sequence in the list as it is, and an edit changes the list).
        const here = wherePassWas(arrangement, slots.length, from, was);
        // The last pass of the song, with Loop off: the run ends where this pass does. Nothing takes over, and the song stays at this pass,
        // which sounds until the end (the scheduler goes on playing, so that its last step is not cut off, and stops at `time`).
        if (endsAt(here)) {
          wrapped = { time, from: here, repeat: false, end: true };
          songAt = here;
          chained = null;
          lastWrap = time;
          scheduler.endAt(time);
          return;
        }
        const pass = nextPass(arrangement, slots.length, here, was);
        wrapped = { time, from: here, repeat: pass.sequence === was, end: false };
        songAt = { entry: pass.entry, rep: pass.rep };
        next = pass.sequence;
      }
      // Nothing to take over (one sequence, no chain, or an entry that goes round again): the pass end stays one that a sequence
      // queued just ahead of it can take over at, and no pick of the chain's is left to take back (chainAtOpenPassEnd).
      if (next === was) {
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
      steps: before ? outgoing.steps : playingSteps(),
    });
    if (step < 0) return;
    const into = before && step !== 0 ? outgoing : { pattern: playing.pattern, history: playing.history };
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

  // Where the song is, for the display's song screen (lcd.js), in Song mode, or null: what sounds, which is not what `songAt` says
  // while the scheduler is ahead of the sound (the pass end it has reached has not sounded until `wrapped.time`: `from` is the pass
  // that still does). Stopped it is where Play would begin, the entry selected. A place not known (Song mode joined in mid-pass, or the
  // sequence that sounds is in no entry) is the first entry that names the sequence, as the chain takes it, or -1 for none.
  // `heardSequence` is the sequence that sounds; what follows it is worked out as the chain will at the pass end.
  // `gone` says the slot of the sequence that sounds has been removed (it plays out its pass): its place is not known, and what follows is
  // what the chain takes after it, the first entry (`nextPass` with no sequence it knows). `built` is the sequence the scheduler has already
  // built to follow the one that sounds, while it still does (a sequence has taken over in state, whatever asked for it): that is the one
  // that is next, which the arrangement alone does not say when a person queued it, or Song mode was turned on after it was.
  function heardSong(heardSequence, gone, built = -1) {
    if (!songMode) return null;
    const entries = resolveArrangement(arrangement, slots.length);
    const known = (place) => (place && entries[place.entry] ? place : null);
    let at;
    let sequence = heardSequence;
    if (scheduler.playing) {
      const ahead = wrapped.time > clock.now();
      at = gone
        ? null
        : (known(ahead ? wrapped.from : songAt) ?? known(positionOf(arrangement, slots.length, heardSequence)));
    } else {
      at = { entry: Math.min(selectedEntry, entries.length - 1), rep: 0 };
      sequence = entries[at.entry].sequence;
    }
    // Nothing comes next after the last pass of a song that ends there (-1), whatever the scheduler has or has not built.
    const next = endsAt(at)
      ? -1
      : scheduler.playing && built >= 0
        ? built
        : nextPass(arrangement, slots.length, at, gone && scheduler.playing ? -1 : sequence).sequence;
    return {
      entry: at ? at.entry : -1,
      entries: entries.length,
      sequence,
      rep: at ? at.rep : -1,
      repeats: at ? entries[at.entry].repeats : 0,
      next,
    };
  }

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

  // The one place a pad's setting (gain, pitch, envelope, choke group, colour) changes: for the selected pad, saved with the beat. The kit
  // clamps the value and tells the views.
  function setPadSetting(name, value) {
    kit.setSetting(selected, name, value);
    onMessage(
      `PAD ${pad2(selected + 1)} ${SETTINGS[name].label.toUpperCase()} ${formatSetting(name, kit.settings(selected)[name])}`,
    );
    onBeatChange();
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
    // What plays is only changed when it is what is showing: the length of the pass is the playing sequence's.
    const alters = slots[current] === playing;
    if (!shorter && alters) withdrawPassEnd(); // the loop carries on past the pass end the scheduler had reached: it is not one
    bars = next;
    slots[current].bars = bars;
    page = Math.min(page, lastPage());
    onMessage(`${bars} ${bars === 1 ? "BAR" : "BARS"}`);
    // Made shorter, the loop may end exactly where the scheduler is, which is a pass end: a queued sequence (or the next of the
    // song) takes over there, from inside this call, and a queued one says so (after the message above, which was of the sequence that has gone). So everything
    // that is of this sequence is settled before it, and nothing after it is.
    if (alters) scheduler.setSteps(playingSteps());
    // A step queued from a bar that is gone must not sound: build the queued ones again. (Made longer,
    // what is queued is still right.)
    if (shorter && alters) rescheduleQueuedHits();
    onChange();
    onBeatChange();
  }

  // What showing the sequence in slot `next` (which exists) changes here: the editor, and not what plays.
  function showOnly(next) {
    queued = -1;
    current = next;
    pattern = slots[current].pattern;
    history = slots[current].history;
    lastMergedAt = -Infinity;
    bars = slots[current].bars;
    page = 0;
  }

  // Showing and playing the sequence in slot `next` (which exists), apart from the scheduler: what Pattern mode does with every pick
  // and takeover, so that a person sees and edits what plays.
  function adoptSequence(next) {
    showOnly(next);
    playing = slots[next];
  }

  // Not playing, what is said to sound is what is showing (and the length the scheduler will begin with is its length).
  function mirrorPlaying() {
    playing = slots[current];
    scheduler.setSteps(playingSteps());
  }

  // Show the sequence in slot `next` now. If it is playing, the playhead carries on into it. It drops a sequence that was
  // waiting for the end of the pass: a person who picks one now, or adds or removes one (which moves the numbers), is not
  // leaving a plan behind.
  function showSequence(next) {
    // In Song mode a pick is the editor's alone: what plays, and where the song is, go on as they were.
    if (songMode) {
      showOnly(next);
      if (!scheduler.playing) mirrorPlaying();
      return;
    }
    if (slots[next].bars > playing.bars) lastWrap = -Infinity; // as for setBars: a longer one carries on past the pass end
    adoptSequence(next);
    forgetSongPosition(); // a person picked it (or made or removed one): the song goes on from where this sequence first is
    // The position carries over into the length of the sequence picked, which can end the loop where the scheduler is: that is no
    // pass end for the chain to go on from (onWrap).
    switching = true;
    try {
      scheduler.setSteps(playingSteps());
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
    // In Song mode the first line of the display says which sequence plays, so this one says that it is only showing.
    onMessage(songMode ? `SHOWING SEQ ${pad2(current + 1)}` : `SEQ ${pad2(current + 1)}`);
    onChange();
    onBeatChange();
  }

  function toggleSong() {
    songMode = !songMode;
    forgetSongPosition();
    // The keys only show in Song mode, so a sequence that was waiting to play next has nothing to wait for.
    if (songMode) queued = -1;
    onMessage(songMode ? "SONG ON" : "SONG OFF");
    // Nothing but Song mode ends a run: turned off just ahead of the song's end, the sequence that was playing goes on as a loop.
    if (!songMode) scheduler.endAt(null);
    chainAtOpenPassEnd();
    const showing = current;
    if (!songMode && scheduler.playing) followPlaying();
    onChange();
    if (current !== showing) onBeatChange(); // the sequence showing is saved with the beat
  }

  // Song mode turned off while the beat plays: it goes on as a loop of the sequence that was playing, and the editor moves to it, so that
  // in Pattern mode what is seen and heard are the same again. If that sequence has been removed there is nothing to move to, and what
  // is showing plays from here.
  function followPlaying() {
    const at = playingIndex();
    if (at === -1) showSequence(current);
    else if (slots[at] !== slots[current]) showOnly(at);
  }

  // Turned on or off in the moment after the scheduler has reached a pass end and before the display has: the mode is for that end,
  // not the next. On, the song's next pass begins there: its sequence takes over (the same takeover the chain makes, so as quiet), or
  // nothing does when the entry goes round again; off, the sequence the chain picked for it is taken back, to the one that gave way,
  // unless a person has picked another since.
  function chainAtOpenPassEnd() {
    // (An open pass end has nothing queued: a sequence queued in that moment takes over at once.)
    if (!scheduler.playing || !passEndOpen()) return;
    if (songMode) {
      const was = playingIndex();
      const here = wherePassWas(arrangement, slots.length, songAt, was);
      if (endsAt(here)) {
        endSongLate(was, here);
        return;
      }
      const pass = nextPass(arrangement, slots.length, here, was);
      wrapped = { time: lastWrap, from: here, repeat: pass.sequence === was, end: false };
      songAt = { entry: pass.entry, rep: pass.rep };
      // An entry that goes round again has no sequence to take over: the first step built is already the right one.
      if (pass.sequence !== was) takeOverLate(pass.sequence, { automatic: true });
      return;
    }
    if (chained !== playing.pattern) return;
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

  // Where the song is, and what is remembered of its last pass end, go with an entry that has moved: `entryAfter(index)` says where the
  // entry that was at `index` is now (-1 when it is gone).
  function followPosition(entryAfter) {
    const follow = (at) => {
      if (!at) return at;
      const entry = entryAfter(at.entry);
      return entry < 0 ? null : { entry, rep: at.rep };
    };
    songAt = follow(songAt);
    wrapped = wrapped.from ? { ...wrapped, from: follow(wrapped.from) } : wrapped;
  }

  // A pass that is playing and has not been told yet (the first after Play, or after a pick) is on the first entry that names its
  // sequence, in the list as it is now: said before the list changes, so that a change moves it and does not choose it again.
  function resolvePosition() {
    if (!songAt && songMode && scheduler.playing) songAt = positionOf(arrangement, slots.length, playingIndex());
  }

  function followEdit({ arrangement: next, entryAfter }) {
    resolvePosition();
    arrangement = next;
    followPosition(entryAfter);
  }

  function selectEntry(index) {
    selectedEntry = Math.min(entryCount() - 1, Math.max(0, Math.round(index)));
    onChange();
  }

  // An edit made in the moment after the scheduler has reached a pass end and before its first step has sounded counts at that pass end,
  // as a press on a sequence key does (takeOverLate): what the song picked for it is worked out again from where the song was before
  // it, in the list as it is now. What the pass end gave was either a sequence taking over (the one that gave way is `outgoing`) or
  // the entry going round again, and a different answer takes back the steps built for the first and builds them again. A pass end
  // that was asked for (a queued sequence) is not the song's to change, and one that has sounded is heard from the next.
  function reconsiderPassEnd() {
    if (!songMode || !scheduler.playing || !passEndOpen() || wrapped.time !== lastWrap) return;
    const ended =
      wrapped.repeat || wrapped.end ? playingIndex() : slots.findIndex((slot) => slot.pattern === outgoing?.pattern);
    // A takeover whose sequence that gave way has been removed is left as it is. Where the pass end was the song's end, or the entry went
    // round again, the sequence that plays may have been removed (-1): the pass end is decided again from where nothing is known of the song.
    if (ended < 0 && !(wrapped.repeat || wrapped.end)) return;
    // Where the pass that ended is in the list as it is now (an entry that was removed leaves its place unknown, and then it is the first
    // entry that names the sequence), as onWrap and chainAtOpenPassEnd resolve it before they ask whether it is the end.
    const here = wherePassWas(arrangement, slots.length, wrapped.from, ended);
    // It is, or has become, the song's end (Loop turned off, the last entry taken away or given fewer times round, another moved last).
    if (endsAt(here)) {
      if (!wrapped.end) endSongLate(ended, here);
      else wrapped = { ...wrapped, from: here };
      return;
    }
    const pass = nextPass(arrangement, slots.length, here, ended);
    const wasEnd = wrapped.end;
    songAt = { entry: pass.entry, rep: pass.rep };
    // Still the entry going round again with nothing taken over, only if it was and is: when this takes over, even back to the sequence that
    // ended, the pass has been restarted, so the pass end is a real one and no longer one that can be withdrawn. A pass end that was the
    // song's end and is not any more (Loop turned on, an entry added) goes on from the sequence that ended, so that is a time round too.
    wrapped = { ...wrapped, repeat: (wrapped.repeat || wasEnd) && pass.sequence === ended, end: false };
    if (pass.sequence !== playingIndex()) takeOverLate(pass.sequence, { automatic: true });
    else if (wasEnd) scheduler.endAt(null); // nothing to take over: the sequence that ended goes round again, from where the scheduler is
  }

  // The pass end that the scheduler has reached turns out to be the song's end, in the moment before it sounds (see reconsiderPassEnd,
  // and Song mode turned on): what was built from it on is taken back, a pass end that had been taken over is taken back to the sequence that
  // gave way, and the run ends there, as it would have if it had been the end all along.
  function endSongLate(ended, here) {
    songAt = here;
    wrapped = { time: lastWrap, from: here, repeat: false, end: true };
    if (ended !== playingIndex()) takeOverLate(ended, { automatic: true });
    else takeBackBuilt();
    chained = null; // the song did not pick it: there is nothing to take back if Song mode is turned off
    scheduler.endAt(lastWrap);
  }

  // The song has ended: the clock has reached the end of its last pass, and the scheduler has stopped itself, as a stop does (what sounds
  // rings on). Every step was handed over before it, so there is nothing to cut off, and the display is told as it is of a stop.
  function songEnded() {
    if (songMode && playing !== slots[current]) mirrorPlaying(); // the display says the sequence showing again
    onMessage("END OF SONG");
    onChange();
  }

  function toggleLoop() {
    loopSong = !loopSong;
    onMessage(loopSong ? "LOOP ON" : "LOOP OFF");
    // Turned on or off in the moment before a pass end that is, or is not, the song's end has sounded, it is for that pass end.
    reconsiderPassEnd();
    onChange();
    onBeatChange();
  }

  function addEntry(at = entryCount()) {
    const edit = insertEntry(arrangement, slots.length, at, current);
    if (!edit) {
      onMessage(`${MAX_ENTRIES} ENTRIES MAX`);
      return -1;
    }
    const place = Math.min(entryCount(), Math.max(0, at));
    followEdit(edit);
    selectedEntry = place;
    reconsiderPassEnd();
    onMessage(`ENTRY ${pad2(place + 1)} ADDED`);
    onChange();
    onBeatChange();
    return place;
  }

  function removeEntry(index) {
    const edit = removeArrangementEntry(arrangement, slots.length, index);
    if (!edit) {
      if (entryCount() === 1) onMessage("CANNOT REMOVE LAST ENTRY");
      return -1;
    }
    followEdit(edit);
    selectedEntry = Math.min(index, entryCount() - 1);
    reconsiderPassEnd();
    onMessage(`ENTRY ${pad2(index + 1)} REMOVED`);
    onChange();
    onBeatChange();
    return selectedEntry;
  }

  function moveEntry(index, delta) {
    const to = Math.min(entryCount() - 1, Math.max(0, index + delta));
    const edit = moveArrangementEntry(arrangement, slots.length, index, to);
    if (!edit) return index; // already at that end of the song
    followEdit(edit);
    selectedEntry = to;
    reconsiderPassEnd();
    onMessage(`ENTRY ${pad2(index + 1)} MOVED TO ${pad2(to + 1)}`);
    onChange();
    onBeatChange();
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
    onBeatChange();
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
  // `automatic` is the chain's own (Song mode, with nothing asked for): it says nothing and saves nothing, which a pass at a time
  // would be an announcement for a screen reader and a write that tells another tab it is out of date, and it leaves the pass end
  // open for a sequence that is asked for just ahead of it (takeOverLate), since nobody asked for this one. `keepOutgoing` is for
  // taking over again at a pass end that was already taken over: what is still sounding is the sequence that gave way first.
  function takeOver(next, time, { automatic = false, keepOutgoing = false } = {}) {
    passId++;
    passStart = time;
    lastWrap = automatic ? time : -Infinity;
    if (!keepOutgoing) {
      const { pattern: gone, history: goneHistory, bars: goneBars } = playing;
      outgoing = {
        slot: playing, // to find it again by its number as it is now: removing a sequence moves the ones after it down
        pattern: gone,
        history: goneHistory,
        steps: playingSteps(),
        sequence: playingIndex(),
        bars: goneBars,
        // The bar the display was in for it: the one the step keys showed if they showed it, else the last (the playhead is near the end of a pass).
        page: slots[current] === playing ? page : goneBars - 1,
      };
    }
    // The song, in Song mode, moves what plays and leaves the editor where it is.
    if (songMode) playing = slots[next];
    else adoptSequence(next);
    // Asked for, not the chain's pick (which has worked out where it is): the song goes on from the first entry that names it.
    if (!automatic) songAt = positionOf(arrangement, slots.length, next);
    chained = automatic ? playing.pattern : null;
    scheduler.startPass(playingSteps());
    if (!automatic) onMessage(`SEQ ${pad2(next + 1)}`); // the one that began to play
    onChange();
    if (!automatic) onBeatChange();
  }

  // Queued after the pass ended in the scheduler, but before its next step has sounded: the steps already handed to the audio
  // clock for that pass are of the sequence that is giving way, so take them back, build them again from the one taking over, and
  // have it take over where the grid has the pass end. What is already queued of the pass before stays.
  function takeOverLate(next, { automatic = false } = {}) {
    takeBackBuilt();
    takeOver(next, lastWrap, { automatic, keepOutgoing: passStart === lastWrap });
  }

  // What was built from the open pass end on is taken back, and the scheduler is where it was at the pass end.
  function takeBackBuilt() {
    const first = scheduledHits.findIndex((hit) => hit.gridTime >= lastWrap);
    if (first !== -1) for (const hit of scheduledHits.splice(first)) cancelHit(hit);
    scheduler.rewindTo(0, lastWrap);
  }

  // The pass end that the scheduler has reached and whose first step has not sounded: a press or a toggle in this moment is for it.
  // Not if the steps before it were taken back since (a rewind): they are still to be built, and the wrap is still to come.
  const passEndOpen = () => lastWrap > clock.now() && scheduler.nextTime >= lastWrap;

  // Next Seq, as on an MPC: while a beat plays, the sequence asked for takes over where the pass ends and the one showing plays
  // out until then. Picking the one that is waiting, or the one showing, takes the plan back; picking another changes it.
  // Stopped, there is no pass to wait for and it is shown at once.
  function queueSequence(value) {
    const next = clampSequence(value);
    if (songMode || !scheduler.playing) {
      setSequence(next);
      return;
    }
    if (next === queued || next === playingIndex()) {
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
    reconsiderPassEnd(); // the new sequence is in the song after the last: a pass end that was the song's end is not
    onMessage(`SEQ ${pad2(current + 1)} ADDED`);
    onChange();
    onBeatChange();
  }

  function copySequence() {
    if (atMost() && full()) return;
    const from = current;
    slots.push(makeSlot({ bars, pattern: pattern.snapshot(), velocities: pattern.velocitySnapshot() }));
    arrangement = afterSequenceAdded(arrangement, slots.length - 1);
    showSequence(slots.length - 1);
    reconsiderPassEnd();
    onMessage(`SEQ ${pad2(from + 1)} COPIED TO ${pad2(current + 1)}`);
    onChange();
    onBeatChange();
  }

  // Not undoable (undo is of the steps of one sequence), so the page asks first when there is anything in it (sequenceHasSteps).
  function removeSequence() {
    if (slots.length === 1) {
      onMessage("CANNOT REMOVE LAST SEQUENCE");
      return;
    }
    const removed = current;
    // The entries that name the sequence go and the ones after them move down, and where the song is, and the entry selected, go with
    // theirs. In Pattern mode picking the sequence that is shown next forgets where the song was, as it always did.
    const before = resolveArrangement(arrangement, slots.length);
    resolvePosition();
    slots.splice(removed, 1);
    arrangement = afterSequenceRemoved(arrangement, removed);
    const gone = before.map(({ sequence }) => sequence === removed);
    const entryAfter = (index) => (gone[index] ? -1 : index - gone.slice(0, index).filter(Boolean).length);
    if (songMode) followPosition(entryAfter);
    const selection = entryAfter(selectedEntry);
    selectedEntry = Math.min(selection < 0 ? selectedEntry : selection, entryCount() - 1);
    showSequence(Math.min(removed, slots.length - 1));
    reconsiderPassEnd(); // a sequence that went may have been the one the song was to go on to, or the one that plays
    onMessage(`SEQ ${pad2(removed + 1)} REMOVED`);
    onChange();
    onBeatChange();
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
    else onBeatChange();
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
  // sequence is running, it starts again from the top. With the sequence showing, or in Song mode with the entry selected.
  function start() {
    scheduler.stop();
    cancelQueuedHits();
    cancelQueue();
    passStart = -Infinity;
    lastWrap = -Infinity;
    forgetSongPosition();
    if (songMode) beginSong();
    scheduler.start();
    onChange();
  }

  // Song mode begins at the first time round the entry that is selected: its sequence plays, in its length, and the editor stays where it is.
  function beginSong() {
    const entries = resolveArrangement(arrangement, slots.length);
    const entry = Math.min(selectedEntry, entries.length - 1);
    playing = slots[entries[entry].sequence];
    scheduler.setSteps(playingSteps());
    songAt = { entry, rep: 0 };
  }

  // The first press stops the sequence and lets what is sounding ring out; a press when it is already stopped
  // cuts off everything still sounding (a long tail, a sample), as a panic button does on hardware.
  function stop() {
    const wasPlaying = scheduler.playing;
    scheduler.stop();
    cancelQueuedHits();
    cancelQueue();
    if (songMode && playing !== slots[current]) mirrorPlaying(); // stopped, the display says the sequence showing again
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
    onBeatChange();
  }

  function setSwing(value) {
    const swing = scheduler.setSwing(value);
    onMessage(swing === SWING_DEFAULT ? "SWING OFF" : `SWING ${swing}%`);
    onChange();
    onBeatChange();
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
    onBeatChange();
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
    toggleSong,
    toggleLoop,
    addSequence,
    copySequence,
    removeSequence,
    selectEntry,
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
      // The step keys have a cursor only while they show the sequence that plays: in Song mode the editor can be on another.
      const showsPlaying = slots[current] === playing;
      const playheadStep = showsPlaying ? playheadOnPage(scheduler.playheadStep) : -1;
      // The bar the display is in for what plays: the one the step keys show, or the bar the playhead is in when they show another sequence.
      const heardPage = showsPlaying
        ? page
        : Math.min(playing.bars - 1, Math.floor(Math.max(0, scheduler.playheadStep) / steps));
      // The sequence that gave way, by its number now (a lower one removed since moves it down); if it was removed itself, the number it had,
      // kept in range.
      const outgoingAt = outgoing ? slots.indexOf(outgoing.slot) : -1;
      const heardOut =
        outgoingAt === -1 && outgoing ? Math.max(0, Math.min(outgoing.sequence, slots.length - 1)) : outgoingAt;
      return {
        selected,
        recording,
        playing: scheduler.playing,
        bpm: scheduler.bpm,
        swing: scheduler.swing,
        volume,
        sequence: current,
        // The sequence the scheduler plays from (what the song has gone on to, in Song mode): the one showing in Pattern mode. It goes
        // ahead of what is heard by the lookahead; `heard.sequence` is what sounds.
        playingSequence: playingIndex() === -1 ? current : playingIndex(),
        sequenceCount: slots.length,
        canAddSequence: !atMost(),
        canRemoveSequence: slots.length > 1,
        queuedSequence: queued,
        songMode,
        loopSong,
        selectedEntry: Math.min(selectedEntry, entryCount() - 1),
        // The song's entries as they play (a copy), whether a person has edited them, and where the song is while Song mode plays it, which
        // leads what is heard by the lookahead as the sequence keys do: the entry and the time round it, or null (not playing it, or the
        // sequence playing is in no entry).
        arrangement: resolveArrangement(arrangement, slots.length).map((entry) => ({ ...entry })),
        arrangementEdited: arrangement !== null,
        canAddEntry: entryCount() < MAX_ENTRIES,
        canRemoveEntry: entryCount() > 1,
        songPass:
          songMode && scheduler.playing
            ? songAt
              ? { ...songAt }
              : positionOf(arrangement, slots.length, playingIndex())
            : null,
        // What sounds, for the display: until the new pass sounds, a sequence that has taken over is not yet the one heard, and the
        // playhead is on the last steps of the one that gave way, in its numbering and its length, in the bar that was showing.
        // `sequence`, `bars`, `page`, `stepsOn` and `playheadStep` below are the one showing, for the keys and for editing (`heard` is
        // the one playing: the same sequence for now). `song` is where the song is, for the song screen (heardSong).
        heard: playheadInOldPass()
          ? {
              sequence: heardOut,
              bars: outgoing.bars,
              page: outgoing.page,
              stepsOn: outgoing.pattern.row(selected).slice(outgoing.page * steps, (outgoing.page + 1) * steps),
              playheadStep: playheadOnPage(scheduler.playheadStep, outgoing.page),
              song: heardSong(heardOut, outgoingAt === -1, playingIndex()),
            }
          : {
              // (A sequence that was removed while it played goes on to the end of its pass: the display says the one showing.)
              sequence: playingIndex() === -1 ? current : playingIndex(),
              bars: playing.bars,
              page: heardPage,
              stepsOn: playing.pattern.row(selected).slice(heardPage * steps, (heardPage + 1) * steps),
              playheadStep: playheadOnPage(scheduler.playheadStep, heardPage),
              song: heardSong(playingIndex() === -1 ? current : playingIndex(), playingIndex() === -1),
            },
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

    getBeat: () => ({
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
      // A copy, and left out while there is none (a beat nobody edited is saved as it always was).
      ...(arrangement ? { arrangement: arrangement.map((entry) => ({ ...entry })) } : {}),
      ...(loopSong ? { loopSong: true } : {}),
    }),
  };
}
