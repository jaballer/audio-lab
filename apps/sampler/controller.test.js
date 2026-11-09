import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VOLUME, createSampler } from "./controller.js";
import { SCHEDULER_TICK_MS } from "../../shared/scheduler.js";
import { STARTER_BEAT } from "./starter-beat.js";

const STEPS = 16;
const PADS = 4;

// An audio engine whose clock is whatever the test says it is, and whose gain
// nodes just remember what they were given.
function fakeAudio() {
  const master = { id: "master" };
  const ctx = {
    currentTime: 0,
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })),
  };
  return { ctx, master, powered: true, ensure: vi.fn(() => ctx), setVolume: vi.fn() };
}

const SEQUENCES = 4;
// A saved song with one sequence of the given pattern and length, the rest empty.
const savedSong = ({ bpm = 100, volume = 50, bars = 1, pattern = {}, velocities = {}, current = 0 } = {}) => ({
  bpm,
  volume,
  current,
  sequences: Array.from({ length: SEQUENCES }, (_, i) =>
    i === 0 ? { bars, pattern, velocities } : { bars: 1, pattern: {}, velocities: {} },
  ),
});

function setup({ song = null, bpm } = {}) {
  const audio = fakeAudio();
  const sounds = Array.from({ length: PADS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, play: vi.fn() }));
  const calls = { change: vi.fn(), message: vi.fn(), padHit: vi.fn(), padPlayed: vi.fn(), songChange: vi.fn() };
  let clock = 0;
  const sampler = createSampler({
    audio,
    sounds,
    steps: STEPS,
    maxBars: 4,
    sequenceCount: SEQUENCES,
    song: song ?? (bpm ? savedSong({ bpm }) : null),
    now: () => clock,
    onChange: calls.change,
    onMessage: calls.message,
    onPadHit: calls.padHit,
    onPadPlayed: calls.padPlayed,
    onSongChange: calls.songChange,
  });
  // Move the audio clock forward and let the scheduler wake up.
  const advance = (seconds) => {
    audio.ctx.currentTime += seconds;
    vi.advanceTimersByTime(SCHEDULER_TICK_MS);
  };
  const tapAt = (ms) => {
    clock = ms;
    sampler.tapTempo();
  };
  const setClock = (ms) => (clock = ms);
  return { audio, sounds, sampler, advance, tapAt, setClock, ...calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("starting state", () => {
  it("starts from the starter beat, the default volume and nothing selected but pad 1", () => {
    const { sampler } = setup();
    expect(sampler.getSong()).toMatchObject({ bpm: 100, volume: DEFAULT_VOLUME, current: 0 });
    expect(sampler.getSong().sequences[0].pattern).toEqual(STARTER_BEAT);
    expect(sampler.getSong().sequences[1].pattern).toEqual({}); // only the first has the starter beat
    expect(sampler.getState()).toMatchObject({ selected: 0, recording: false, playing: false, playheadStep: -1 });
  });

  it("starts from saved velocities, and plays them", () => {
    const song = savedSong({ bpm: 120, pattern: { 0: [0] }, velocities: { 0: { 0: 50 } } });
    const { sampler, sounds, advance } = setup({ song });
    expect(sampler.getSong()).toEqual(song);
    expect(sampler.getState().stepVelocities[0]).toBe(50);
    sampler.start();
    advance(0);
    expect(sounds[0].play.mock.calls[0][1].gain.value).toBeCloseTo(50 / 127);
  });

  it("keeps each sequence's velocities apart", () => {
    const song = {
      ...savedSong({ pattern: { 0: [0] }, velocities: { 0: { 0: 50 } } }),
    };
    song.sequences[1] = { bars: 1, pattern: { 0: [0] }, velocities: {} };
    const { sampler } = setup({ song });
    sampler.setSequence(1);
    expect(sampler.getState().stepVelocities[0]).toBe(127);
    sampler.setSequence(0);
    expect(sampler.getState().stepVelocities[0]).toBe(50);
  });

  it("starts from a saved song", () => {
    const song = savedSong({ bpm: 133.5, volume: 35, bars: 2, pattern: { 1: [2, 6, 20] }, current: 2 });
    const { sampler } = setup({ song });
    expect(sampler.getSong()).toEqual(song);
  });

  it("does not report a change while it is being built", () => {
    const { change, songChange, message } = setup();
    expect(change).not.toHaveBeenCalled();
    expect(songChange).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
  });
});

describe("triggerPad", () => {
  it("plays the pad on the master output at the current time, flashes and selects it", () => {
    const { audio, sounds, sampler, padHit, change } = setup();
    audio.ctx.currentTime = 1.5;
    sampler.triggerPad(2);
    expect(sounds[2].play).toHaveBeenCalledWith(audio.ctx, audio.master, 1.5);
    expect(audio.ctx.createGain).not.toHaveBeenCalled();
    expect(padHit).toHaveBeenCalledWith(2);
    expect(sampler.getState().selected).toBe(2);
    expect(change).toHaveBeenCalled();
  });

  it("plays a quieter hit through its own gain stage", () => {
    const { audio, sounds, sampler } = setup();
    sampler.triggerPad(1, 0.5);
    const gain = audio.ctx.createGain.mock.results[0].value;
    expect(gain.gain.value).toBe(0.5);
    expect(gain.connect).toHaveBeenCalledWith(audio.master);
    expect(sounds[1].play.mock.calls[0][1]).toBe(gain);
  });

  it("never lets a hit go fully silent", () => {
    const { audio, sampler } = setup();
    sampler.triggerPad(0, 0);
    expect(audio.ctx.createGain.mock.results[0].value.gain.value).toBe(0.05);
  });
});

describe("undo and redo", () => {
  const withBeat = (extra = {}) => setup({ song: savedSong({ pattern: { 0: [0, 4] }, ...extra }) });

  it("starts with nothing to undo or redo", () => {
    const { sampler, message } = setup();
    expect(sampler.getState()).toMatchObject({ canUndo: false, canRedo: false });
    sampler.undo();
    expect(message).toHaveBeenLastCalledWith("NOTHING TO UNDO");
    sampler.redo();
    expect(message).toHaveBeenLastCalledWith("NOTHING TO REDO");
  });

  it("undoes a toggled step and redoes it, and saves each time", () => {
    const { sampler, songChange, message } = withBeat();
    sampler.toggleStep(1);
    expect(sampler.getState()).toMatchObject({ canUndo: true, canRedo: false });
    songChange.mockClear();
    sampler.undo();
    expect(sampler.getState().stepsOn[1]).toBe(false);
    expect(sampler.getState()).toMatchObject({ canUndo: false, canRedo: true });
    expect(songChange).toHaveBeenCalled();
    expect(message).toHaveBeenLastCalledWith("UNDO");
    sampler.redo();
    expect(sampler.getState().stepsOn[1]).toBe(true);
    expect(message).toHaveBeenLastCalledWith("REDO");
  });

  it("undoes clearing a pad, clearing everything and a velocity", () => {
    const { sampler, setClock } = withBeat({ velocities: { 0: { 4: 50 } } });
    sampler.clearPad();
    sampler.undo();
    expect(sampler.getState().stepsOn[4]).toBe(true);
    expect(sampler.getState().stepVelocities[4]).toBe(50);
    sampler.clearAll();
    sampler.undo();
    expect(sampler.getSong().sequences[0].pattern).toEqual({ 0: [0, 4] });
    setClock(10_000);
    sampler.setStepVelocity(4, 90);
    sampler.undo();
    expect(sampler.getState().stepVelocities[4]).toBe(50);
  });

  it("does not keep a change that did nothing", () => {
    const { sampler } = withBeat();
    sampler.setStepVelocity(2, 50); // off
    sampler.selectPad(3);
    sampler.clearPad(); // already empty
    expect(sampler.getState().canUndo).toBe(false);
  });

  it("makes velocity changes made close together one undo, and later ones another", () => {
    const { sampler, setClock } = withBeat();
    setClock(1000);
    sampler.setStepVelocity(0, 100);
    setClock(1200);
    sampler.setStepVelocity(0, 80);
    sampler.setStepVelocity(4, 60);
    setClock(5000);
    sampler.setStepVelocity(0, 30);
    sampler.undo();
    expect(sampler.getState().stepVelocities[0]).toBe(80);
    sampler.undo();
    expect(sampler.getState().stepVelocities.slice(0, 5)).toEqual([127, 127, 127, 127, 127]);
    expect(sampler.getState().canUndo).toBe(false);
  });

  it("does not merge velocity changes made on different pads, however close together", () => {
    const { sampler, setClock } = setup({ song: savedSong({ pattern: { 0: [0], 1: [0] } }) });
    setClock(1000);
    sampler.selectPad(0);
    sampler.setStepVelocity(0, 40);
    setClock(1100);
    sampler.selectPad(1);
    sampler.setStepVelocity(0, 60);
    sampler.undo();
    expect(sampler.getState().stepVelocities[0]).toBe(127); // pad 1 back to full
    sampler.selectPad(0);
    expect(sampler.getState().stepVelocities[0]).toBe(40); // pad 0's change is still there
    sampler.undo();
    expect(sampler.getState().stepVelocities[0]).toBe(127);
  });

  it("does not merge velocity changes made on different bars, however close together", () => {
    const { sampler, setClock } = setup({ song: savedSong({ bars: 2, pattern: { 0: [0, 16] } }) });
    setClock(1000);
    sampler.setStepVelocity(0, 40);
    setClock(1100);
    sampler.setPage(1);
    sampler.setStepVelocity(0, 60);
    sampler.undo();
    expect(sampler.getState().stepVelocities[0]).toBe(127); // bar 2 back to full
    sampler.setPage(0);
    expect(sampler.getState().stepVelocities[0]).toBe(40); // bar 1's change is still there
  });

  it("ends the redo line when something new is done after an undo", () => {
    const { sampler } = withBeat();
    sampler.toggleStep(1);
    sampler.undo();
    sampler.toggleStep(2);
    expect(sampler.getState().canRedo).toBe(false);
  });

  it("keeps each sequence's undo apart", () => {
    const { sampler } = withBeat();
    sampler.toggleStep(1);
    sampler.setSequence(1);
    expect(sampler.getState().canUndo).toBe(false);
    sampler.setSequence(0);
    expect(sampler.getState().canUndo).toBe(true);
  });

  it("undoes a recorded hit", () => {
    const { sampler, advance } = setup({ bpm: 120 });
    sampler.start();
    advance(0.2);
    sampler.poll();
    sampler.toggleRec();
    sampler.triggerPad(3);
    expect(sampler.getState().canUndo).toBe(true);
    sampler.undo();
    expect(sampler.getSong().sequences[0].pattern[3]).toBeUndefined();
  });
});

describe("copy and paste", () => {
  it("says there is nothing to paste before something is copied", () => {
    const { sampler, message } = setup();
    sampler.pastePad();
    expect(message).toHaveBeenLastCalledWith("NO STEPS COPIED");
    expect(sampler.getState().canUndo).toBe(false);
  });

  it("copies the selected pad's steps and velocities over another pad, and it can be undone", () => {
    const { sampler, message } = setup({
      song: savedSong({ pattern: { 0: [0, 4], 2: [9] }, velocities: { 0: { 4: 50 } } }),
    });
    sampler.selectPad(0);
    sampler.copyPad();
    expect(message).toHaveBeenLastCalledWith("PAD 01 STEPS COPIED");
    sampler.selectPad(2);
    sampler.pastePad();
    expect(message).toHaveBeenLastCalledWith("STEPS PASTED TO PAD 03");
    expect(sampler.getSong().sequences[0]).toMatchObject({
      pattern: { 0: [0, 4], 2: [0, 4] },
      velocities: { 0: { 4: 50 }, 2: { 4: 50 } },
    });
    sampler.undo();
    expect(sampler.getSong().sequences[0].pattern[2]).toEqual([9]);
  });

  it("copies across bars and into another sequence", () => {
    const { sampler } = setup({ song: savedSong({ bars: 2, pattern: { 1: [3, 20] } }) });
    sampler.selectPad(1);
    sampler.copyPad();
    sampler.setSequence(1);
    sampler.setBars(2);
    sampler.pastePad();
    expect(sampler.getSong().sequences[1].pattern).toEqual({ 1: [3, 20] });
  });

  it("pastes a copy that is not changed by what happens to the pad afterwards", () => {
    const { sampler } = setup({ song: savedSong({ pattern: { 0: [1] } }) });
    sampler.copyPad();
    sampler.clearPad();
    sampler.selectPad(1);
    sampler.pastePad();
    expect(sampler.getSong().sequences[0].pattern).toEqual({ 1: [1] });
  });
});

describe("recording", () => {
  // At 120 BPM a step is 0.125 s. After start() and 0.2 s the scheduler has
  // queued steps 0, 1 and 2 (at 0.05, 0.175 and 0.3 s); polling at 0.2 s puts
  // the playhead on step 1.
  function playing() {
    const s = setup({ bpm: 120 });
    s.sampler.start();
    s.advance(0.2);
    s.sampler.poll();
    return s;
  }

  it("lights the pads that are on when the playhead reaches a step, without selecting them", () => {
    const { sampler, padHit, padPlayed, advance } = setup({ song: savedSong({ bpm: 120, pattern: { 2: [1] } }) });
    sampler.start();
    advance(0.2); // as below, the playhead is then on step 1
    expect(padPlayed).not.toHaveBeenCalled(); // scheduled, but the playhead has not been polled yet
    sampler.poll();
    expect(padPlayed).toHaveBeenCalledWith(2);
    expect(padHit).not.toHaveBeenCalled(); // not a live hit: those are the ones that push a pad down
    expect(sampler.getState().selected).toBe(0);
  });

  it("cuts off the hits queued but not yet started when Play restarts, and leaves the sounding ones", () => {
    const { sounds, sampler, advance } = setup({ song: savedSong({ bpm: 120, pattern: { 0: [0, 1, 2] } }) });
    sampler.start();
    for (let i = 0; i < 5; i++) advance(0.05); // steps at 0.05 and 0.175 have started; the one at 0.3 is queued (one big jump would look like a stall and skip steps)
    const buses = sounds[0].play.mock.calls.map((call) => call[1]);
    expect(buses).toHaveLength(3);
    sampler.start();
    expect(buses[0].disconnect).not.toHaveBeenCalled(); // already sounding: left to ring out
    expect(buses[1].disconnect).not.toHaveBeenCalled();
    expect(buses[2].disconnect).toHaveBeenCalledTimes(1);
  });

  it("cuts off the hits queued but not yet started when Stop is pressed", () => {
    const { sounds, sampler, advance } = setup({ song: savedSong({ bpm: 120, pattern: { 0: [0, 1, 2] } }) });
    sampler.start();
    for (let i = 0; i < 5; i++) advance(0.05);
    const buses = sounds[0].play.mock.calls.map((call) => call[1]);
    sampler.stop();
    expect(buses[1].disconnect).not.toHaveBeenCalled();
    expect(buses[2].disconnect).toHaveBeenCalledTimes(1);
  });

  it("flashes nothing for a step the scheduler skipped after a stall", () => {
    const { sampler, padPlayed, advance } = setup({
      song: savedSong({ bpm: 120, pattern: { 0: Array.from({ length: 16 }, (_, i) => i) } }),
    });
    sampler.start();
    advance(0.05); // step 0 is scheduled
    advance(1.99); // a stall: the due steps are skipped, not sounded, and the next step is still ahead
    sampler.poll();
    expect(padPlayed).not.toHaveBeenCalled(); // the playhead is on a step that never sounded
  });

  it("lights only the newest step reached, not every step that went by since the last frame", () => {
    const { sampler, padPlayed, advance } = setup({ song: savedSong({ bpm: 120, pattern: { 1: [0], 2: [1] } }) });
    sampler.start();
    for (let i = 0; i < 4; i++) advance(0.05); // steps 0 (0.05) and 1 (0.175) are both reached before one poll
    sampler.poll();
    expect(padPlayed.mock.calls.map(([row]) => row)).toEqual([2]);
  });

  it("lights the pads that were scheduled, even if the pattern changed before the playhead got there", () => {
    const { sampler, sounds, padPlayed, advance } = setup({ song: savedSong({ bpm: 120, pattern: { 2: [1] } }) });
    sampler.start();
    advance(0.2); // step 1 is scheduled, and its sound is on its way
    expect(sounds[2].play).toHaveBeenCalledTimes(1);
    sampler.selectPad(2);
    sampler.toggleStep(1); // too late to unsound it, so it must still light
    sampler.poll();
    expect(padPlayed).toHaveBeenCalledWith(2);
  });

  it("writes a live hit into the step the playhead is on", () => {
    const { sampler, songChange } = playing();
    sampler.toggleRec();
    sampler.triggerPad(3);
    sampler.selectPad(3);
    expect(sampler.getState().stepsOn[1]).toBe(true);
    expect(songChange).toHaveBeenCalled();
  });

  it("writes a hit in the second half of a step into the next one", () => {
    const { audio, sampler } = playing();
    sampler.toggleRec();
    audio.ctx.currentTime = 0.175 + 0.07; // 70 ms into a 125 ms step
    sampler.triggerPad(3);
    expect(sampler.getState().stepsOn[2]).toBe(true);
    expect(sampler.getState().stepsOn[1]).toBe(false);
  });

  it("records the velocity of a live hit, and a hit played again over the step replaces it", () => {
    const { sampler, sounds, advance } = playing();
    sampler.toggleRec();
    sampler.triggerPad(3, 0.5);
    expect(sampler.getState().stepVelocities[1]).toBe(64); // 0.5 of 127, rounded
    expect(sampler.getSong().sequences[0].velocities).toEqual({ 3: { 1: 64 } });
    sampler.triggerPad(3, 1);
    expect(sampler.getState().stepVelocities[1]).toBe(127);
    expect(sampler.getSong().sequences[0].velocities).toEqual({});
    expect(sounds[3].play).toHaveBeenCalledTimes(2); // each hit sounded once, live
    advance(0);
  });

  it("records nothing unless it is armed", () => {
    const { sampler, songChange } = playing();
    sampler.triggerPad(3);
    expect(sampler.getState().stepsOn.some(Boolean)).toBe(false);
    expect(songChange).not.toHaveBeenCalled();
  });

  it("records nothing while stopped, even when armed", () => {
    const { sampler } = setup({ bpm: 120 });
    sampler.toggleRec();
    sampler.triggerPad(3);
    expect(sampler.getState().stepsOn.some(Boolean)).toBe(false);
  });

  it("records nothing before the playhead has reached a step", () => {
    const { audio, sampler } = setup({ bpm: 120 });
    sampler.start();
    sampler.toggleRec();
    audio.ctx.currentTime = 0.02; // started, but poll() has not seen a step yet
    sampler.triggerPad(3);
    expect(sampler.getState().stepsOn.some(Boolean)).toBe(false);
  });

  it("says what recording is doing", () => {
    const { sampler, message, advance } = setup();
    sampler.toggleRec();
    expect(message).toHaveBeenLastCalledWith("REC ARMED - PRESS PLAY");
    sampler.toggleRec();
    expect(message).toHaveBeenLastCalledWith("REC OFF");
    sampler.start();
    advance(0);
    sampler.toggleRec();
    expect(message).toHaveBeenLastCalledWith("REC ON - HIT PADS");
    expect(sampler.getState().recording).toBe(true);
  });
});

describe("sequences", () => {
  it("starts on the saved one, and says how many there are", () => {
    const { sampler } = setup({ song: savedSong({ current: 2 }) });
    expect(sampler.getState()).toMatchObject({ sequence: 2, sequenceCount: SEQUENCES });
  });

  it("switches to another, names it and asks for a save", () => {
    const { sampler, message, songChange } = setup();
    sampler.setSequence(1);
    expect(sampler.getState().sequence).toBe(1);
    expect(message).toHaveBeenLastCalledWith("SEQ 02");
    expect(songChange).toHaveBeenCalledTimes(1);
    sampler.setSequence(1);
    expect(songChange).toHaveBeenCalledTimes(1); // no change, no save
  });

  it("stays within the sequences there are", () => {
    const { sampler } = setup();
    sampler.setSequence(99);
    expect(sampler.getState().sequence).toBe(SEQUENCES - 1);
    sampler.setSequence(-3);
    expect(sampler.getState().sequence).toBe(0);
  });

  it("gives each its own steps and length", () => {
    const { sampler } = setup();
    sampler.selectPad(2);
    sampler.setSequence(1);
    expect(sampler.getState()).toMatchObject({ bars: 1, stepsOn: new Array(STEPS).fill(false) });
    sampler.toggleStep(3);
    sampler.setBars(3);
    sampler.setSequence(0);
    expect(sampler.getState().bars).toBe(1);
    expect(sampler.getState().stepsOn[3]).toBe(false);
    sampler.setSequence(1);
    expect(sampler.getState().bars).toBe(3);
    expect(sampler.getState().stepsOn[3]).toBe(true);
  });

  it("clears only the sequence it is on", () => {
    const { sampler } = setup();
    sampler.setSequence(1);
    sampler.selectPad(2);
    sampler.toggleStep(3);
    sampler.setSequence(0);
    sampler.clearAll();
    expect(sampler.getSong().sequences[0].pattern).toEqual({});
    expect(sampler.getSong().sequences[1].pattern).toEqual({ 2: [3] });
  });

  it("replaces the steps already queued with the new sequence's when it is switched while playing", () => {
    const base = savedSong({ bpm: 120, pattern: { 0: [0, 1, 2] } });
    const song = {
      ...base,
      sequences: [base.sequences[0], { bars: 1, pattern: { 1: [2] } }, ...base.sequences.slice(2)],
    };
    const { sounds, sampler, padPlayed, advance } = setup({ song });
    sampler.start();
    for (let i = 0; i < 5; i++) advance(0.05); // steps 0 and 1 have started; step 2 (0.3 s) is queued from sequence 1
    const queued = sounds[0].play.mock.calls[2][1];
    sampler.setSequence(1);
    expect(queued.disconnect).toHaveBeenCalledTimes(1); // the old sequence's hit on step 2 will not sound
    expect(sounds[1].play).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) advance(0.05);
    expect(sounds[0].play).toHaveBeenCalledTimes(3); // nothing more from the old sequence
    expect(sounds[1].play).toHaveBeenCalledTimes(1); // the new sequence's step 2, at the same moment
    expect(sounds[1].play.mock.calls[0][2]).toBeCloseTo(0.3);
    sampler.poll();
    expect(padPlayed).not.toHaveBeenCalledWith(0); // the old hit on step 2 does not light either
  });

  it("goes back to the first bar of the new sequence", () => {
    const { sampler } = setup({ song: savedSong({ bars: 3 }) });
    sampler.setPage(2);
    sampler.setSequence(1);
    expect(sampler.getState().page).toBe(0);
  });

  it("plays the steps of the sequence it switched to", () => {
    const { sounds, sampler, advance } = setup({
      song: {
        ...savedSong({ bpm: 120 }),
        sequences: [savedSong().sequences[0], { bars: 1, pattern: { 3: [0] } }].concat(savedSong().sequences.slice(2)),
      },
    });
    sampler.setSequence(1);
    sampler.start();
    advance(0);
    expect(sounds[3].play).toHaveBeenCalled();
    expect(sounds[0].play).not.toHaveBeenCalled(); // the first sequence is empty here
  });
});

describe("steps and clearing", () => {
  it("toggles a step of the selected pad and asks for a save", () => {
    const { sampler, songChange, change } = setup();
    sampler.selectPad(3);
    change.mockClear();
    sampler.toggleStep(5);
    expect(sampler.getState().stepsOn[5]).toBe(true);
    expect(songChange).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("starts at one bar and keeps a saved length", () => {
    expect(setup().sampler.getState()).toMatchObject({ bars: 1, page: 0 });
    expect(setup({ song: savedSong({ bars: 3 }) }).sampler.getState().bars).toBe(3);
  });

  it("lengthens the sequence, names it and asks for a save", () => {
    const { sampler, message, songChange } = setup();
    sampler.setBars(2);
    expect(sampler.getState().bars).toBe(2);
    expect(message).toHaveBeenLastCalledWith("2 BARS");
    expect(songChange).toHaveBeenCalledTimes(1);
    sampler.setBars(2);
    expect(songChange).toHaveBeenCalledTimes(1); // no change, no save
  });

  it("drops a queued step from a bar that was removed when the sequence is shortened while playing", () => {
    const { sounds, sampler, advance } = setup({ song: savedSong({ bpm: 120, bars: 2, pattern: { 0: [18] } }) });
    sampler.start();
    let guard = 0;
    while (!sounds[0].play.mock.calls.length && guard++ < 200) advance(0.05); // step 18 is queued, not started
    expect(sounds[0].play).toHaveBeenCalledTimes(1);
    const queued = sounds[0].play.mock.calls[0][1];
    sampler.setBars(1);
    expect(queued.disconnect).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i++) advance(0.05);
    expect(sounds[0].play).toHaveBeenCalledTimes(1); // the one-bar loop has nothing on step 2 (18 wrapped)
  });

  it("keeps bars within 1 and the maximum", () => {
    const { sampler } = setup();
    sampler.setBars(99);
    expect(sampler.getState().bars).toBe(4);
    sampler.setBars(0);
    expect(sampler.getState().bars).toBe(1);
  });

  it("edits the bar being shown, and the other bars keep their steps", () => {
    const { sampler } = setup();
    sampler.setBars(2);
    sampler.setPage(1);
    sampler.selectPad(3);
    sampler.toggleStep(5);
    expect(sampler.getSong().sequences[0].pattern[3]).toEqual([21]);
    expect(sampler.getState().stepsOn[5]).toBe(true);
    sampler.setPage(0);
    expect(sampler.getState().stepsOn[5]).toBe(false);
  });

  it("does not move past the first or last bar, and follows the sequence when it gets shorter", () => {
    const { sampler } = setup();
    sampler.setBars(3);
    sampler.setPage(9);
    expect(sampler.getState().page).toBe(2);
    sampler.setPage(-1);
    expect(sampler.getState().page).toBe(0);
    sampler.setPage(2);
    sampler.setBars(2);
    expect(sampler.getState().page).toBe(1);
  });

  it("keeps the steps of a bar that was dropped, for when it comes back", () => {
    const { sampler } = setup({ song: savedSong({ bars: 2, pattern: { 0: [20] } }) });
    sampler.setBars(1);
    expect(sampler.getSong().sequences[0].pattern[0]).toEqual([20]);
  });

  it("clears the selected pad and names it", () => {
    const { sampler, message } = setup();
    expect(sampler.getState().stepsOn.some(Boolean)).toBe(true); // the starter kick
    sampler.clearPad();
    expect(sampler.getState().stepsOn.some(Boolean)).toBe(false);
    expect(message).toHaveBeenLastCalledWith("PAD 01 STEPS CLEARED");
  });

  it("clears every pad", () => {
    const { sampler, message } = setup();
    sampler.clearAll();
    expect(sampler.getSong().sequences[0].pattern).toEqual({});
    expect(message).toHaveBeenLastCalledWith("ALL STEPS CLEARED");
  });
});

describe("transport", () => {
  it("start and stop report a change, and a second start (a restart) reports one too", () => {
    const { sampler, change } = setup();
    sampler.start();
    expect(sampler.getState().playing).toBe(true);
    expect(change).toHaveBeenCalledTimes(1);
    sampler.start();
    expect(change).toHaveBeenCalledTimes(2);
    sampler.stop();
    expect(sampler.getState().playing).toBe(false);
    expect(change).toHaveBeenCalledTimes(3);
  });

  it("plays the pads that are on at each step, at the time the scheduler gives", () => {
    const { audio, sounds, sampler, advance } = setup({ song: savedSong({ bpm: 120, pattern: STARTER_BEAT }) });
    sampler.start();
    advance(0);
    // The starter beat: kick on step 0, closed hat (pad 2) on step 0, snare not yet.
    const bus = sounds[0].play.mock.calls[0][1]; // each step plays through a gain of its own, into the master
    expect(sounds[0].play).toHaveBeenCalledWith(audio.ctx, bus, expect.closeTo(0.05));
    expect(bus.connect).toHaveBeenCalledWith(audio.master);
    expect(sounds[2].play).toHaveBeenCalledTimes(1);
    expect(sounds[1].play).not.toHaveBeenCalled();
  });

  it("plays a step with a lower velocity through a gain stage of its own, in front of the step's gain", () => {
    const { audio, sounds, sampler, advance } = setup({ song: savedSong({ bpm: 120, pattern: { 0: [0], 1: [0] } }) });
    sampler.selectPad(0);
    sampler.setStepVelocity(0, 64);
    sampler.start();
    advance(0);
    const quiet = sounds[0].play.mock.calls[0][1];
    expect(quiet.gain.value).toBeCloseTo(64 / 127);
    const bus = quiet.connect.mock.calls[0][0]; // the stage feeds the step's own gain, which feeds the master
    expect(bus.connect).toHaveBeenCalledWith(audio.master);
    expect(sounds[1].play.mock.calls[0][1]).toBe(bus); // a step left at full velocity plays straight into it
  });

  it("changes a step's velocity only for a step that is on, and tells the views and the LCD", () => {
    const { sampler, change, songChange, message } = setup({ song: savedSong({ pattern: { 0: [2] } }) });
    sampler.selectPad(0);
    change.mockClear();
    songChange.mockClear();
    sampler.setStepVelocity(2, 50);
    expect(songChange).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenLastCalledWith("VEL 50");
    expect(sampler.getState().stepVelocities[2]).toBe(50);
    sampler.setStepVelocity(3, 50); // off: nothing to change
    expect(songChange).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("sets the velocity of a step on the bar being shown, for the selected pad", () => {
    const { sampler } = setup({ song: savedSong({ bars: 2, pattern: { 1: [5, 21] } }) });
    sampler.selectPad(1);
    sampler.setPage(1);
    sampler.setStepVelocity(5, 30); // step 21 of the sequence
    expect(sampler.getSong().sequences[0].velocities).toEqual({ 1: { 21: 30 } });
    expect(sampler.getState().stepVelocities[5]).toBe(30);
    sampler.setPage(0);
    expect(sampler.getState().stepVelocities[5]).toBe(127);
  });

  it("starts again from the first step when Play is pressed while playing", () => {
    const { audio, sounds, sampler, advance } = setup({ song: savedSong({ bpm: 120, pattern: { 0: [0] } }) });
    sampler.start();
    advance(0.5); // a few steps in: the playhead has moved on from step 0
    sampler.poll();
    expect(sampler.getState().playheadStep).toBeGreaterThan(0);
    sounds[0].play.mockClear();
    sampler.start();
    expect(sampler.getState().playheadStep).toBe(-1); // nothing played yet in the new run
    advance(0);
    expect(sounds[0].play).toHaveBeenCalledTimes(1); // step 0 sounds again, a short run-up after now
    expect(sounds[0].play.mock.calls[0][2]).toBeGreaterThan(audio.ctx.currentTime);
    expect(sampler.getState().playing).toBe(true);
  });

  it("does not sound a pad again at the step it was just played live and recorded into", () => {
    // At 40 BPM a step is 0.375 s, much longer than the lookahead, so the next
    // step has not been scheduled when a hit lands in the second half of this one.
    const { audio, sounds, sampler, advance } = setup({ bpm: 40 });
    sampler.start();
    advance(0);
    advance(0.05);
    sampler.poll(); // playhead on step 0
    sampler.toggleRec();
    audio.ctx.currentTime = 0.05 + 0.25; // late in step 0: belongs to step 1
    sampler.triggerPad(3);
    expect(sounds[3].play).toHaveBeenCalledTimes(1);
    advance(0.1); // the scheduler now reaches step 1
    expect(sounds[3].play).toHaveBeenCalledTimes(1);
  });
});

describe("tempo", () => {
  it("clamps the tempo and reports a change and a save", () => {
    const { sampler, change, songChange } = setup();
    sampler.setBpm(1000);
    expect(sampler.getState().bpm).toBe(240);
    expect(change).toHaveBeenCalledTimes(1);
    expect(songChange).toHaveBeenCalledTimes(1);
  });

  it("nudges the tempo from where it is", () => {
    const { sampler } = setup({ bpm: 120 });
    sampler.nudgeTempo(-1);
    expect(sampler.getState().bpm).toBe(119);
  });

  it("asks for another tap, then follows the taps", () => {
    const { sampler, message, tapAt } = setup();
    tapAt(1000);
    expect(message).toHaveBeenLastCalledWith("TAP AGAIN...");
    expect(sampler.getState().bpm).toBe(100);
    tapAt(1500); // half a second apart: 120 BPM
    expect(message).toHaveBeenLastCalledWith("TAP TEMPO");
    expect(sampler.getState().bpm).toBe(120);
  });
});

describe("volume", () => {
  it("sets the master level on the 0-1 scale, says so and asks for a save", () => {
    const { audio, sampler, message, songChange } = setup();
    sampler.setVolume(40);
    expect(audio.setVolume).toHaveBeenCalledWith(0.4);
    expect(message).toHaveBeenLastCalledWith("VOLUME 40");
    expect(sampler.getState().volume).toBe(40);
    expect(songChange).toHaveBeenCalledTimes(1);
  });
});
