import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VOLUME, createSampler } from "./controller.js";
import { createKit } from "./kit.js";
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
    createGain: vi.fn(() => ({
      gain: { value: 1, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
  };
  return { ctx, master, powered: true, ensure: vi.fn(() => ctx), setVolume: vi.fn(), killSound: vi.fn(() => true) };
}

// What a step plays through: its own gain, the last node before the master. A hit's sound goes through a voice of
// its pad (voices.js) and perhaps a velocity stage first, and each node says where it sends its sound.
function busOf(node) {
  let current = node;
  for (;;) {
    const next = current.connect.mock.calls[0]?.[0];
    if (!next || next.id === "master") return current;
    current = next;
  }
}

const SEQUENCES = 4;
// A saved song with one sequence of the given pattern and length, the rest empty.
const savedSong = ({
  bpm = 100,
  swing = 50,
  volume = 50,
  bars = 1,
  pattern = {},
  velocities = {},
  current = 0,
  padSettings = {},
} = {}) => ({
  bpm,
  swing,
  volume,
  current,
  padSettings,
  sequences: Array.from({ length: SEQUENCES }, (_, i) =>
    i === 0 ? { bars, pattern, velocities } : { bars: 1, pattern: {}, velocities: {} },
  ),
});

function setup({ song = null, bpm, ownCount = false, maxSequences } = {}) {
  const audio = fakeAudio();
  const sounds = Array.from({ length: PADS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, play: vi.fn() }));
  const calls = { change: vi.fn(), message: vi.fn(), padHit: vi.fn(), padPlayed: vi.fn(), songChange: vi.fn() };
  let clock = 0;
  const sampler = createSampler({
    audio,
    kit: createKit(sounds),
    steps: STEPS,
    maxBars: 4,
    ...(maxSequences === undefined ? {} : { maxSequences }),
    ...(ownCount ? {} : { sequenceCount: SEQUENCES }), // `ownCount`: say nothing, as the page does with no saved song
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
    const voice = sounds[2].play.mock.calls[0][1]; // the pad's voice, which goes to the master
    expect(sounds[2].play).toHaveBeenCalledWith(audio.ctx, voice, 1.5);
    expect(voice.connect).toHaveBeenCalledWith(audio.master);
    expect(audio.ctx.createGain).toHaveBeenCalledTimes(1);
    expect(padHit).toHaveBeenCalledWith(2);
    expect(sampler.getState().selected).toBe(2);
    expect(change).toHaveBeenCalled();
  });

  it("plays a quieter hit through its own gain stage", () => {
    const { audio, sounds, sampler } = setup();
    sampler.triggerPad(1, 0.5);
    const [voice, gain] = audio.ctx.createGain.mock.results.map((result) => result.value); // the voice, then the stage
    expect(gain.gain.value).toBe(0.5);
    expect(gain.connect).toHaveBeenCalledWith(voice);
    expect(voice.connect).toHaveBeenCalledWith(audio.master);
    expect(sounds[1].play.mock.calls[0][1]).toBe(gain);
  });

  it("never lets a hit go fully silent", () => {
    const { audio, sampler } = setup();
    sampler.triggerPad(0, 0);
    expect(audio.ctx.createGain.mock.results[1].value.gain.value).toBe(0.05); // the stage, after the pad's voice
  });
});

describe("pad settings", () => {
  it("sets gain or pitch on the selected pad, says so, saves, and redraws", () => {
    const { sampler, message, songChange, change } = setup();
    sampler.selectPad(2);
    songChange.mockClear();
    change.mockClear();
    sampler.setPadSetting("gain", -6);
    expect(message).toHaveBeenLastCalledWith("PAD 03 GAIN -6 dB");
    expect(songChange).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledTimes(1);
    sampler.setPadSetting("pitch", 3);
    expect(message).toHaveBeenLastCalledWith("PAD 03 PITCH +3 st");
    expect(sampler.getState().padSettings).toEqual({
      gain: -6,
      pitch: 3,
      choke: 0,
      color: 0,
      attack: 0,
      decay: 0,
      sustain: 100,
      release: 0,
    });
    sampler.selectPad(0);
    expect(sampler.getState().padSettings).toEqual({
      gain: 0,
      pitch: 0,
      choke: 0,
      color: 0,
      attack: 0,
      decay: 0,
      sustain: 100,
      release: 0,
    });
  });

  it("says the value it kept, which is the clamped one", () => {
    const { sampler, message } = setup();
    sampler.setPadSetting("gain", 50);
    expect(message).toHaveBeenLastCalledWith("PAD 01 GAIN +6 dB");
  });

  it("is saved with the song, only for the pads that are not at the defaults", () => {
    const { sampler } = setup();
    expect(sampler.getSong().padSettings).toEqual({});
    sampler.selectPad(1);
    sampler.setPadSetting("pitch", -5);
    expect(sampler.getSong().padSettings).toEqual({
      1: { gain: 0, pitch: -5, choke: 0, color: 0, attack: 0, decay: 0, sustain: 100, release: 0 },
    });
  });

  it("changes a live hit and the sequence, from the next hit", () => {
    const sounds = Array.from({ length: PADS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, play: vi.fn() }));
    const audio = fakeAudio();
    const kit = createKit(sounds);
    const sampler = createSampler({
      audio,
      kit,
      steps: STEPS,
      song: savedSong({ bpm: 120, pattern: { 1: [0, 1, 2, 3] } }),
    });
    sampler.selectPad(1);
    sampler.setPadSetting("pitch", 12);
    sampler.triggerPad(1);
    expect(sounds[1].play.mock.calls[0][3]).toEqual({ rate: 2 }); // a live hit
    sampler.start();
    audio.ctx.currentTime += 0.2;
    vi.advanceTimersByTime(SCHEDULER_TICK_MS);
    expect(sounds[1].play.mock.calls.length).toBeGreaterThan(1);
    expect(sounds[1].play.mock.calls.slice(1).every((call) => call[3]?.rate === 2)).toBe(true); // and the steps
  });

  it("is heard from the next step built: steps already queued keep what they were built with", () => {
    const sounds = Array.from({ length: PADS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, play: vi.fn() }));
    const audio = fakeAudio();
    const sampler = createSampler({
      audio,
      kit: createKit(sounds),
      steps: STEPS,
      song: savedSong({ bpm: 120, pattern: { 0: [0, 1, 2, 3, 4, 5, 6, 7] } }),
    });
    sampler.start();
    audio.ctx.currentTime += 0.2;
    vi.advanceTimersByTime(SCHEDULER_TICK_MS);
    const built = sounds[0].play.mock.calls.length;
    expect(built).toBeGreaterThan(1);
    sampler.setPadSetting("gain", -6); // while steps are queued
    audio.ctx.currentTime += 0.3;
    vi.advanceTimersByTime(SCHEDULER_TICK_MS);
    const calls = sounds[0].play.mock.calls;
    expect(calls.length).toBeGreaterThan(built);
    const isBus = (out) => out.gain.value === 1; // a step's own gain (the fake starts every gain at 1)
    expect(calls.slice(0, built).every((call) => isBus(call[1]))).toBe(true); // built before: untouched
    expect(calls.slice(built).every((call) => call[1].gain.value < 1)).toBe(true); // built after: through the stage
  });

  it("puts the gain stage under the step's own gain, so stopping silences it with the step", () => {
    const sounds = Array.from({ length: PADS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, play: vi.fn() }));
    const audio = fakeAudio();
    const sampler = createSampler({
      audio,
      kit: createKit(sounds),
      steps: STEPS,
      song: savedSong({ bpm: 120, pattern: { 0: [0, 1, 2, 3, 4, 5, 6, 7] } }),
    });
    sampler.setPadSetting("gain", -6);
    sampler.start();
    audio.ctx.currentTime += 0.2;
    vi.advanceTimersByTime(SCHEDULER_TICK_MS);
    const last = sounds[0].play.mock.calls.at(-1)[1]; // the stage the last queued step plays through
    const bus = busOf(last); // ... which feeds, by way of the pad's voice, the step's own gain
    expect(bus.connect).toHaveBeenCalledWith(audio.master);
    sampler.stop();
    expect(bus.disconnect).toHaveBeenCalled(); // a step not yet started is cut off, stage and all
  });

  describe("kitChanged", () => {
    // Playing with steps queued ahead of the clock, and a way to see what a change did to them.
    function queuedSteps() {
      const sounds = Array.from({ length: PADS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, play: vi.fn() }));
      const audio = fakeAudio();
      const songChange = vi.fn();
      const kit = createKit(sounds);
      const sampler = createSampler({
        audio,
        kit,
        steps: STEPS,
        song: savedSong({ bpm: 120, pattern: { 0: [0, 1, 2, 3, 4, 5, 6, 7] } }),
        onSongChange: songChange,
      });
      sampler.start();
      audio.ctx.currentTime += 0.2;
      vi.advanceTimersByTime(SCHEDULER_TICK_MS);
      const buses = sounds[0].play.mock.calls.map((call) => busOf(call[1]));
      expect(buses.length).toBeGreaterThan(1);
      return { sounds, sampler, audio, kit, buses, songChange };
    }

    it("does not rebuild the steps already queued for a setting, so dragging a slider cannot make them late", () => {
      const { sounds, sampler, audio, buses, songChange } = queuedSteps();
      const built = sounds[0].play.mock.calls.length;
      songChange.mockClear();
      for (let tick = 0; tick < 5; tick++) sampler.kitChanged("setting"); // a slider drag: many changes
      expect(buses.some((bus) => bus.disconnect.mock.calls.length > 0)).toBe(false); // nothing silenced
      expect(sounds[0].play.mock.calls.length).toBe(built); // nothing built again
      audio.ctx.currentTime += 0.05;
      vi.advanceTimersByTime(SCHEDULER_TICK_MS);
      expect(sounds[0].play.mock.calls.length - built).toBeLessThanOrEqual(1); // the grid carried on as it was
    });

    it("saves for a setting, which can change without the sampler being asked (a cleared pitch)", () => {
      const { sampler, songChange } = queuedSteps();
      songChange.mockClear();
      sampler.kitChanged("setting");
      expect(songChange).toHaveBeenCalledTimes(1);
    });

    it("rebuilds the steps already queued for a new sound, and does not save for it", () => {
      const { sounds, sampler, buses, songChange } = queuedSteps();
      songChange.mockClear();
      sampler.kitChanged("sound");
      expect(buses.at(-1).disconnect).toHaveBeenCalled(); // the last step queued has not started: silenced
      expect(songChange).not.toHaveBeenCalled(); // a sound is kept by samples.js, not the song
      expect(sounds[0].play).toHaveBeenCalled();
    });
  });

  it("applies gain and pitch together: the gain stage and the playback rate", () => {
    const sounds = Array.from({ length: PADS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, play: vi.fn() }));
    const audio = fakeAudio();
    const sampler = createSampler({ audio, kit: createKit(sounds), steps: STEPS });
    sampler.setPadSetting("gain", -6);
    sampler.setPadSetting("pitch", 12);
    sampler.triggerPad(0);
    const [, stage, , options] = sounds[0].play.mock.calls[0];
    expect(stage.gain.value).toBeCloseTo(0.501, 3);
    expect(stage.connect.mock.calls[0][0].connect).toHaveBeenCalledWith(audio.master); // into the pad's voice
    expect(options).toEqual({ rate: 2 });
  });

  it("applies the gain to a live hit through a stage of its own, in front of the master", () => {
    const sounds = Array.from({ length: PADS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, play: vi.fn() }));
    const audio = fakeAudio();
    const sampler = createSampler({ audio, kit: createKit(sounds), steps: STEPS });
    sampler.setPadSetting("gain", -6);
    sampler.triggerPad(0);
    const stage = sounds[0].play.mock.calls[0][1];
    expect(stage.gain.value).toBeCloseTo(0.501, 3);
    expect(stage.connect.mock.calls[0][0].connect).toHaveBeenCalledWith(audio.master); // into the pad's voice
  });
});

describe("the kit", () => {
  it("builds the steps already queued again when the sounds change, so the next hit is the new sound", () => {
    const sounds = Array.from({ length: PADS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, play: vi.fn() }));
    const kit = createKit(sounds);
    const audio = fakeAudio();
    const sampler = createSampler({
      audio,
      kit,
      steps: STEPS,
      song: savedSong({ bpm: 120, pattern: { 0: [0, 1, 2, 3] } }),
    });
    sampler.start();
    audio.ctx.currentTime += 0.2;
    vi.advanceTimersByTime(SCHEDULER_TICK_MS);
    const queued = sounds[0].play.mock.calls.map((call) => busOf(call[1]));
    expect(queued.length).toBeGreaterThan(1);
    const swapped = { id: "loaded", name: "Loaded", play: vi.fn() };
    kit.set(0, swapped);
    sampler.kitChanged("sound");
    expect(queued.at(-1).disconnect).toHaveBeenCalled(); // the last step queued has not started: silenced
    audio.ctx.currentTime += 0.05;
    vi.advanceTimersByTime(SCHEDULER_TICK_MS);
    expect(swapped.play).toHaveBeenCalled(); // and built again with the new sound
  });

  it("plays a sound swapped onto a pad, live and in the sequence, from the next hit", () => {
    const sounds = Array.from({ length: PADS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, play: vi.fn() }));
    const kit = createKit(sounds);
    const audio = fakeAudio();
    const sampler = createSampler({
      audio,
      kit,
      steps: STEPS,
      song: savedSong({ bpm: 120, pattern: { 1: [0, 1] } }),
    });
    const swapped = { id: "loaded", name: "Loaded", play: vi.fn() };
    kit.set(1, swapped);
    sampler.triggerPad(1);
    expect(swapped.play).toHaveBeenCalledTimes(1);
    expect(sounds[1].play).not.toHaveBeenCalled();
    sampler.start();
    audio.ctx.currentTime += 0.2;
    vi.advanceTimersByTime(SCHEDULER_TICK_MS);
    expect(swapped.play.mock.calls.length).toBeGreaterThan(1);
    expect(sounds[1].play).not.toHaveBeenCalled();
    kit.reset(1);
    sampler.triggerPad(1);
    expect(sounds[1].play).toHaveBeenCalledTimes(1);
  });
});

describe("undo and redo show where they acted", () => {
  const twoBars = (extra = {}) => setup({ song: savedSong({ bars: 2, pattern: { 0: [1], 2: [20] }, ...extra }) });

  it("selects the pad and bar of the step it changed, so the change is never out of sight", () => {
    const { sampler } = twoBars();
    sampler.selectPad(2);
    sampler.setPage(1);
    sampler.toggleStep(4); // step 20 of the sequence, on pad 2: it was on, so it goes off
    sampler.selectPad(0); // somewhere else entirely
    sampler.setPage(0);
    sampler.undo();
    expect(sampler.getState().selected).toBe(2);
    expect(sampler.getState().page).toBe(1);
    expect(sampler.getState().stepsOn[4]).toBe(true); // and it is on the screen
  });

  it("does the same for redo", () => {
    const { sampler } = twoBars();
    sampler.selectPad(2);
    sampler.setPage(1);
    sampler.toggleStep(4);
    sampler.undo();
    sampler.selectPad(1);
    sampler.setPage(0);
    sampler.redo();
    expect(sampler.getState()).toMatchObject({ selected: 2, page: 1 });
    expect(sampler.getState().stepsOn[4]).toBe(false);
  });

  it("goes to a velocity change as well", () => {
    const { sampler, setClock } = twoBars();
    sampler.selectPad(0);
    setClock(10_000);
    sampler.setStepVelocity(1, 40);
    sampler.selectPad(3);
    sampler.undo();
    expect(sampler.getState().selected).toBe(0);
    expect(sampler.getState().stepVelocities[1]).toBe(127);
  });

  it("goes to the first thing that changed when several did", () => {
    const { sampler } = twoBars();
    sampler.selectPad(2);
    sampler.setPage(1);
    sampler.clearAll(); // pad 0 step 1 and pad 2 step 20 both go
    sampler.selectPad(3);
    sampler.undo();
    expect(sampler.getState()).toMatchObject({ selected: 0, page: 0 });
  });

  it("stays on the last bar there is when the change is beyond it", () => {
    const { sampler } = twoBars();
    sampler.selectPad(2);
    sampler.setPage(1);
    sampler.toggleStep(4);
    sampler.setBars(1); // the sequence is now one bar long, with step 20 out of reach
    sampler.undo();
    expect(sampler.getState().page).toBe(0);
  });

  it("leaves the selection alone when there is nothing to undo", () => {
    const { sampler } = twoBars();
    sampler.selectPad(3);
    sampler.undo();
    expect(sampler.getState().selected).toBe(3);
  });
});

describe("with the power off", () => {
  function powered(on) {
    const sounds = Array.from({ length: PADS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, play: vi.fn() }));
    const audio = fakeAudio();
    audio.powered = on;
    const sampler = createSampler({
      audio,
      kit: createKit(sounds),
      steps: STEPS,
      song: savedSong({ bpm: 120, pattern: { 0: [0, 1, 2, 3, 4, 5, 6, 7] } }),
    });
    return { sounds, audio, sampler };
  }
  const run = (audio, seconds) => {
    audio.ctx.currentTime += seconds;
    vi.advanceTimersByTime(SCHEDULER_TICK_MS);
  };

  it("builds no sound for the steps, so no tails pile up to be heard all at once at power on", () => {
    const { sounds, audio, sampler } = powered(false);
    sampler.start();
    run(audio, 0.4);
    expect(sounds[0].play).not.toHaveBeenCalled();
  });

  it("builds them again once the power is on, and the beat has been going all the time", () => {
    const { sounds, audio, sampler } = powered(false);
    sampler.start();
    run(audio, 0.4);
    audio.powered = true;
    run(audio, 0.4);
    sampler.poll();
    expect(sounds[0].play).toHaveBeenCalled();
    expect(sampler.getState().playheadStep).toBeGreaterThan(0); // it did not wait at the first step
  });

  it("can still be stopped and restarted with nothing queued to cut off", () => {
    const { audio, sampler } = powered(false);
    sampler.start();
    run(audio, 0.4);
    expect(() => {
      sampler.stop();
      sampler.start();
    }).not.toThrow();
  });

  it("does not write a hit that was not heard into the pattern", () => {
    const { audio, sampler } = powered(false);
    sampler.start();
    run(audio, 0.2);
    sampler.toggleRec();
    sampler.triggerPad(3);
    expect(sampler.getSong().sequences[0].pattern[3]).toBeUndefined();
  });

  it("writes a hit that was heard, as it always did", () => {
    const { audio, sampler } = powered(true);
    sampler.start();
    run(audio, 0.2);
    sampler.poll();
    sampler.toggleRec();
    sampler.triggerPad(3);
    expect(sampler.getSong().sequences[0].pattern[3]).toBeDefined();
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

  it("keeps a toggle made right after a velocity change as an undo of its own, and does not merge a later change into the earlier one", () => {
    const { sampler, setClock } = setup({ song: savedSong({ pattern: { 0: [0, 1] } }) });
    setClock(1000);
    sampler.setStepVelocity(0, 40);
    setClock(1100);
    sampler.toggleStep(1); // a toggle is never part of a drag
    setClock(1200);
    sampler.setStepVelocity(0, 60); // the toggle ended the stream, so this does not join the first change
    sampler.undo();
    expect(sampler.getState().stepVelocities[0]).toBe(40);
    sampler.undo();
    expect(sampler.getState().stepsOn[1]).toBe(true); // the toggle is undone on its own
    expect(sampler.getState().stepVelocities[0]).toBe(40);
    sampler.undo();
    expect(sampler.getState().stepVelocities[0]).toBe(127);
    expect(sampler.getState().canUndo).toBe(false);
  });

  it("makes a velocity change right after a toggle its own undo", () => {
    const { sampler, setClock } = setup({ song: savedSong({ pattern: { 0: [0] } }) });
    setClock(1000);
    sampler.toggleStep(1);
    setClock(1100);
    sampler.setStepVelocity(1, 30);
    sampler.undo();
    expect(sampler.getState().stepsOn[1]).toBe(true); // only the velocity went
    expect(sampler.getState().stepVelocities[1]).toBe(127);
    sampler.undo();
    expect(sampler.getState().stepsOn[1]).toBe(false);
  });

  it("does not let an undone velocity change swallow the next one into its undo", () => {
    const { sampler, setClock } = setup({ song: savedSong({ pattern: { 0: [0] } }) });
    setClock(1000);
    sampler.setStepVelocity(0, 40);
    sampler.undo();
    setClock(1100); // well inside the merge window of the change that was undone
    sampler.setStepVelocity(0, 60);
    expect(sampler.getState().canUndo).toBe(true);
    sampler.undo();
    expect(sampler.getState().stepVelocities[0]).toBe(127);
  });

  it("does the same after a redo", () => {
    const { sampler, setClock } = setup({ song: savedSong({ pattern: { 0: [0] } }) });
    setClock(1000);
    sampler.setStepVelocity(0, 40);
    sampler.undo();
    sampler.redo();
    setClock(1100);
    sampler.setStepVelocity(0, 60);
    sampler.undo();
    expect(sampler.getState().stepVelocities[0]).toBe(40); // only the last change is undone
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
    sampler.pasteSteps();
    expect(message).toHaveBeenLastCalledWith("NO STEPS COPIED");
    expect(sampler.getState().canUndo).toBe(false);
  });

  it("copies the bar showing for a pad and its velocities over another pad, and it can be undone", () => {
    const { sampler, message } = setup({
      song: savedSong({ pattern: { 0: [0, 4], 2: [9] }, velocities: { 0: { 4: 50 } } }),
    });
    sampler.selectPad(0);
    sampler.copySteps();
    expect(message).toHaveBeenLastCalledWith("PAD 01 BAR 1 COPIED");
    sampler.selectPad(2);
    sampler.pasteSteps();
    expect(message).toHaveBeenLastCalledWith("PASTED TO PAD 03 BAR 1");
    expect(sampler.getSong().sequences[0]).toMatchObject({
      pattern: { 0: [0, 4], 2: [0, 4] },
      velocities: { 0: { 4: 50 }, 2: { 4: 50 } },
    });
    sampler.undo();
    expect(sampler.getSong().sequences[0].pattern[2]).toEqual([9]);
  });

  it("repeats a bar on the same pad: copy it, go to the next bar, paste", () => {
    const { sampler, message } = setup({
      song: savedSong({ bars: 2, pattern: { 1: [3, 5] }, velocities: { 1: { 5: 40 } } }),
    });
    sampler.selectPad(1);
    sampler.copySteps();
    sampler.setPage(1);
    sampler.pasteSteps();
    expect(message).toHaveBeenLastCalledWith("PASTED TO PAD 02 BAR 2");
    expect(sampler.getSong().sequences[0]).toMatchObject({
      pattern: { 1: [3, 5, 19, 21] },
      velocities: { 1: { 5: 40, 21: 40 } },
    });
    sampler.undo();
    expect(sampler.getSong().sequences[0].pattern).toEqual({ 1: [3, 5] });
  });

  it("copies only the bar showing, and replaces only the bar it is pasted on", () => {
    const { sampler } = setup({ song: savedSong({ bars: 2, pattern: { 1: [3, 20], 2: [1, 17] } }) });
    sampler.selectPad(1);
    sampler.setPage(1);
    sampler.copySteps(); // bar 2 of pad 1: step 20, which is step 4 of the bar
    sampler.selectPad(2);
    sampler.setPage(0);
    sampler.pasteSteps(); // over bar 1 of pad 2
    expect(sampler.getSong().sequences[0].pattern).toEqual({ 1: [3, 20], 2: [4, 17] });
  });

  it("copies into another sequence", () => {
    const { sampler } = setup({ song: savedSong({ pattern: { 1: [3, 7] } }) });
    sampler.selectPad(1);
    sampler.copySteps();
    sampler.setSequence(1);
    sampler.pasteSteps();
    expect(sampler.getSong().sequences[1].pattern).toEqual({ 1: [3, 7] });
  });

  it("pastes a copy that is not changed by what happens to the pad afterwards", () => {
    const { sampler } = setup({ song: savedSong({ pattern: { 0: [1] } }) });
    sampler.copySteps();
    sampler.clearPad();
    sampler.selectPad(1);
    sampler.pasteSteps();
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
    const buses = sounds[0].play.mock.calls.map((call) => busOf(call[1]));
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
    const buses = sounds[0].play.mock.calls.map((call) => busOf(call[1]));
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

  it("starts with one sequence when there is no saved song, and cannot go to another", () => {
    const { sampler } = setup({ ownCount: true });
    expect(sampler.getState()).toMatchObject({ sequence: 0, sequenceCount: 1 });
    expect(sampler.getSong().sequences).toEqual([{ bars: 1, pattern: STARTER_BEAT, velocities: {} }]);
    sampler.setSequence(1);
    expect(sampler.getState().sequence).toBe(0);
  });

  it("has as many sequences as the saved song has, not the number the page was told to start with", () => {
    const song = savedSong({ pattern: { 0: [0] } });
    song.sequences = song.sequences.slice(0, 2);
    const { sampler } = setup({ song });
    expect(sampler.getState().sequenceCount).toBe(2);
    expect(sampler.getSong().sequences).toHaveLength(2);
    sampler.setSequence(99);
    expect(sampler.getState().sequence).toBe(1);
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
    const queued = busOf(sounds[0].play.mock.calls[2][1]);
    sampler.setSequence(1);
    expect(queued.disconnect).toHaveBeenCalledTimes(1); // the old sequence's hit on step 2 will not sound
    const started = sounds[0].play.mock.calls.slice(0, 2).map((call) => busOf(call[1]));
    for (const bus of started) expect(bus.disconnect).not.toHaveBeenCalled(); // those already sounding ring out
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

// A saved song of `count` sequences, the first of them with the given steps.
const songOf = (count, { first = {}, bpm = 120, ...rest } = {}) => {
  const base = savedSong({ bpm, pattern: first, ...rest });
  return { ...base, sequences: Array.from({ length: count }, (_, i) => base.sequences[i] ?? base.sequences[1]) };
};

describe("adding, copying and removing sequences", () => {
  describe("addSequence", () => {
    it("adds an empty sequence at the end and shows it, naming it and asking for a save", () => {
      const { sampler, message, songChange, change } = setup({
        song: songOf(3, { first: { 0: [0] } }),
        maxSequences: 6,
      });
      sampler.addSequence();
      expect(sampler.getState()).toMatchObject({ sequence: 3, sequenceCount: 4, bars: 1 });
      expect(sampler.getSong().sequences).toHaveLength(4);
      expect(sampler.getSong().sequences[3]).toEqual({ bars: 1, pattern: {}, velocities: {} });
      expect(sampler.getSong().sequences[0].pattern).toEqual({ 0: [0] }); // the others are as they were
      expect(message).toHaveBeenLastCalledWith("SEQ 04 ADDED");
      expect(songChange).toHaveBeenCalled();
      expect(change).toHaveBeenCalled();
    });

    it("starts a new sequence on its first bar with nothing to undo, whatever was showing", () => {
      const { sampler } = setup({ song: songOf(2, { first: { 0: [0] }, bars: 3 }), maxSequences: 6 });
      sampler.toggleStep(5);
      sampler.setPage(2);
      sampler.addSequence();
      expect(sampler.getState()).toMatchObject({ page: 0, canUndo: false, canRedo: false });
      sampler.setSequence(0);
      expect(sampler.getState().canUndo).toBe(true); // the first one kept its own
    });

    it("asks for a save when a step is turned on in the new sequence, as it does for any other", () => {
      const { sampler, songChange } = setup({ song: songOf(2), maxSequences: 6 });
      sampler.addSequence();
      songChange.mockClear();
      sampler.toggleStep(2);
      expect(songChange).toHaveBeenCalled();
    });

    it("says so, and changes nothing, when there are as many as there can be", () => {
      const { sampler, message, songChange } = setup({ song: songOf(3), maxSequences: 3 });
      sampler.addSequence();
      expect(message).toHaveBeenLastCalledWith("3 SEQUENCES MAX");
      expect(sampler.getState()).toMatchObject({ sequence: 0, sequenceCount: 3 });
      expect(songChange).not.toHaveBeenCalled();
    });
  });

  describe("copySequence", () => {
    const original = { 0: [0, 4], 2: [9] };

    it("adds a copy of the one showing (steps, velocities and length) at the end and shows it", () => {
      const song = songOf(2, { first: original, velocities: { 0: { 4: 50 } }, bars: 2 });
      const { sampler, message, songChange } = setup({ song, maxSequences: 6 });
      sampler.copySequence();
      expect(sampler.getState()).toMatchObject({ sequence: 2, sequenceCount: 3, bars: 2 });
      expect(sampler.getSong().sequences[2]).toEqual({ bars: 2, pattern: original, velocities: { 0: { 4: 50 } } });
      expect(message).toHaveBeenLastCalledWith("SEQ 01 COPIED TO 03");
      expect(songChange).toHaveBeenCalled();
    });

    it("copies the sequence that is showing, not the first", () => {
      const song = songOf(3, { first: original });
      song.sequences[1] = { bars: 1, pattern: { 3: [3] }, velocities: {} };
      const { sampler } = setup({ song, maxSequences: 6 });
      sampler.setSequence(1);
      sampler.copySequence();
      expect(sampler.getSong().sequences[3].pattern).toEqual({ 3: [3] });
    });

    it("makes a copy that is its own: editing one leaves the other alone", () => {
      const { sampler } = setup({ song: songOf(1, { first: original }), maxSequences: 6 });
      sampler.copySequence();
      sampler.selectPad(0);
      sampler.toggleStep(0); // turns step 0 of pad 1 off in the copy
      expect(sampler.getSong().sequences[1].pattern[0]).toEqual([4]);
      expect(sampler.getSong().sequences[0].pattern[0]).toEqual([0, 4]);
    });

    it("tells the page to redraw", () => {
      const { sampler, change } = setup({ song: songOf(1, { first: original }), maxSequences: 6 });
      change.mockClear();
      sampler.copySequence();
      expect(change).toHaveBeenCalled();
    });

    it("asks for a save when a step is turned on in the copy", () => {
      const { sampler, songChange } = setup({ song: songOf(1, { first: original }), maxSequences: 6 });
      sampler.copySequence();
      songChange.mockClear();
      sampler.toggleStep(2);
      expect(songChange).toHaveBeenCalled();
    });

    it("starts the copy with nothing to undo", () => {
      const { sampler } = setup({ song: songOf(1, { first: original }), maxSequences: 6 });
      sampler.toggleStep(3);
      sampler.copySequence();
      expect(sampler.getState().canUndo).toBe(false);
    });

    it("says so, and changes nothing, when there are as many as there can be", () => {
      const { sampler, message, songChange } = setup({ song: songOf(2, { first: original }), maxSequences: 2 });
      sampler.copySequence();
      expect(message).toHaveBeenLastCalledWith("2 SEQUENCES MAX");
      expect(sampler.getSong().sequences).toHaveLength(2);
      expect(songChange).not.toHaveBeenCalled();
    });
  });

  describe("removeSequence", () => {
    const four = () => {
      const song = songOf(4, { first: { 0: [0] } });
      song.sequences[1] = { bars: 1, pattern: { 1: [1] }, velocities: {} };
      song.sequences[2] = { bars: 1, pattern: { 2: [2] }, velocities: {} };
      song.sequences[3] = { bars: 1, pattern: { 3: [3] }, velocities: {} };
      return song;
    };
    const rows = (sampler) => sampler.getSong().sequences.map((sequence) => Number(Object.keys(sequence.pattern)[0]));

    it("removes the one showing, and the next one takes its place on the screen", () => {
      const { sampler, message, songChange } = setup({ song: four() });
      sampler.setSequence(1);
      songChange.mockClear();
      sampler.removeSequence();
      expect(rows(sampler)).toEqual([0, 2, 3]);
      expect(sampler.getState()).toMatchObject({ sequence: 1, sequenceCount: 3 });
      expect(sampler.getState().stepsOn[2]).toBe(false); // pad 1 is selected: what shows is the sequence that moved up
      expect(message).toHaveBeenLastCalledWith("SEQ 02 REMOVED");
      expect(songChange).toHaveBeenCalled();
    });

    it("shows the new last one when the last was removed", () => {
      const { sampler } = setup({ song: four() });
      sampler.setSequence(3);
      sampler.removeSequence();
      expect(rows(sampler)).toEqual([0, 1, 2]);
      expect(sampler.getState().sequence).toBe(2);
    });

    it("shows the new first one when the first was removed", () => {
      const { sampler } = setup({ song: four() });
      sampler.removeSequence();
      expect(rows(sampler)).toEqual([1, 2, 3]);
      expect(sampler.getState().sequence).toBe(0);
    });

    it("keeps the last sequence, and says so", () => {
      const { sampler, message, songChange } = setup({ song: songOf(1, { first: { 0: [0] } }) });
      sampler.removeSequence();
      expect(message).toHaveBeenLastCalledWith("CANNOT REMOVE LAST SEQUENCE");
      expect(sampler.getSong().sequences).toHaveLength(1);
      expect(sampler.getSong().sequences[0].pattern).toEqual({ 0: [0] });
      expect(songChange).not.toHaveBeenCalled();
    });

    it("leaves the other sequences their own undo", () => {
      const { sampler } = setup({ song: songOf(2, { first: { 0: [0] } }) });
      sampler.toggleStep(5); // an edit to the first
      sampler.setSequence(1);
      sampler.removeSequence();
      expect(sampler.getState()).toMatchObject({ sequence: 0, canUndo: true });
      sampler.undo();
      expect(sampler.getSong().sequences[0].pattern[0]).toEqual([0]);
    });

    it("can be undone for nothing: the removed sequence's own history goes with it", () => {
      const { sampler } = setup({ song: songOf(3, { first: { 0: [0] } }) });
      sampler.setSequence(1);
      sampler.toggleStep(2); // makes an undo for sequence 2, which is about to go
      sampler.removeSequence();
      expect(sampler.getState().canUndo).toBe(false); // the one that moved up has none of its own
    });

    it("goes back to the first bar of the sequence that is shown after it", () => {
      const song = songOf(3, { bars: 3 });
      song.sequences[1] = { bars: 3, pattern: {}, velocities: {} }; // the one that moves up is as long, so a bar can be left behind
      const { sampler } = setup({ song });
      sampler.setPage(2);
      expect(sampler.getState().page).toBe(2);
      sampler.removeSequence();
      expect(sampler.getState().page).toBe(0);
    });

    it("names the sequence that went, also when it was the last one", () => {
      const { sampler, message } = setup({ song: four() });
      sampler.setSequence(3);
      sampler.removeSequence();
      expect(message).toHaveBeenLastCalledWith("SEQ 04 REMOVED"); // not 03, which is what is showing now
    });

    it("tells the page to redraw", () => {
      const { sampler, change } = setup({ song: four() });
      change.mockClear();
      sampler.removeSequence();
      expect(change).toHaveBeenCalled();
    });

    it("carries on playing into the sequence that is shown after it, and not the removed one's steps", () => {
      const song = songOf(3, { first: { 0: [0, 1, 2, 3] } });
      song.sequences[1] = { bars: 1, pattern: { 1: [0, 1, 2, 3] }, velocities: {} };
      song.sequences[2] = { bars: 1, pattern: { 2: [0, 1, 2, 3] }, velocities: {} };
      const { sounds, sampler, advance } = setup({ song });
      sampler.setSequence(1);
      sampler.start();
      for (let i = 0; i < 5; i++) advance(0.05);
      const fromRemoved = sounds[1].play.mock.calls.length;
      sampler.removeSequence(); // shows what was sequence 3
      for (let i = 0; i < 8; i++) advance(0.05);
      expect(sounds[1].play).toHaveBeenCalledTimes(fromRemoved); // nothing more from the removed one
      expect(sounds[2].play).toHaveBeenCalled(); // the one that took its place
      expect(sampler.getState().playing).toBe(true);
    });
  });

  describe("while playing", () => {
    // A long sequence beside a short one, 120 BPM (a step is 0.125 s): the loop has to be as long as what is showing.
    const longBesideShort = () => {
      const song = songOf(3, { first: { 0: [0] }, bars: 4 });
      song.sequences[1] = { bars: 1, pattern: { 1: [0] }, velocities: {} }; // a step at the start of each pass of its 16 steps
      song.sequences[2] = { bars: 1, pattern: {}, velocities: {} };
      return song;
    };
    const playPast = (s, steps) => {
      for (let i = 0; i < steps * 2.5; i++) {
        s.advance(0.05);
        s.sampler.poll();
      }
    };

    it.each([
      ["removing the sequence showing", (sampler) => sampler.removeSequence()],
      ["switching to the short one", (sampler) => sampler.setSequence(1)],
      ["adding an empty one", (sampler) => sampler.addSequence()],
    ])("wraps the loop at the new sequence's length after %s", (_name, act) => {
      const s = setup({ song: longBesideShort(), maxSequences: 6 });
      s.sampler.start();
      playPast(s, 20); // past step 16 of the 4 bars
      expect(s.sampler.getState().playheadPosition).toBeGreaterThan(16);
      act(s.sampler);
      playPast(s, 3);
      expect(s.sampler.getState().playheadPosition).toBeLessThan(16); // a loop that kept the old length would still be counting to 64
      expect(s.sampler.getState().playheadStep).toBeLessThan(16);
    });

    it("keeps playing the short sequence's steps on every pass after the long one is removed", () => {
      const s = setup({ song: longBesideShort() });
      s.sampler.start();
      playPast(s, 20);
      s.sampler.removeSequence(); // shows the short one, with a step at the start of each pass
      const before = s.sounds[1].play.mock.calls.length;
      playPast(s, 48); // three passes of 16 steps
      expect(s.sounds[1].play.mock.calls.length - before).toBeGreaterThanOrEqual(2);
    });

    it("cuts off the steps already queued from the sequence that was removed, and leaves the sounding ones", () => {
      const base = savedSong({ bpm: 120, pattern: { 0: [0, 1, 2] } });
      const song = { ...base, sequences: [base.sequences[0], { bars: 1, pattern: { 1: [2] }, velocities: {} }] };
      const { sounds, sampler, advance } = setup({ song });
      sampler.start();
      for (let i = 0; i < 5; i++) advance(0.05); // steps 0 and 1 have started; step 2 (0.3 s) is queued
      const buses = sounds[0].play.mock.calls.map((call) => busOf(call[1]));
      expect(buses).toHaveLength(3);
      sampler.removeSequence();
      expect(buses[2].disconnect).toHaveBeenCalledTimes(1); // the queued one will not sound
      expect(buses[0].disconnect).not.toHaveBeenCalled(); // those already sounding ring out
      expect(buses[1].disconnect).not.toHaveBeenCalled();
      for (let i = 0; i < 3; i++) advance(0.05);
      expect(sounds[0].play).toHaveBeenCalledTimes(3); // nothing more from the removed one
      expect(sounds[1].play).toHaveBeenCalledTimes(1); // the one that moved up has its own step 2, at the same moment
    });

    it("does not let a live hit that was written into the removed sequence silence the same step of the next one", () => {
      // 40 BPM: a step is 0.375 s, and step 1 is not queued until 0.305 s. A hit at 0.28 s is written into step 1 of the
      // sequence showing and marked as heard, so that the scheduler does not sound it a second time. That sequence is then
      // gone, and the one that took its place has its own hit on pad 3, step 1, which must sound.
      const song = songOf(2);
      song.sequences[0] = { bars: 1, pattern: {}, velocities: {} };
      song.sequences[1] = { bars: 1, pattern: { 2: [1] }, velocities: {} };
      const { audio, sampler, sounds, advance } = setup({ song: { ...song, bpm: 40 } });
      sampler.start();
      advance(0.2);
      sampler.poll();
      sampler.toggleRec();
      audio.ctx.currentTime = 0.28;
      sampler.triggerPad(2);
      expect(sounds[2].play).toHaveBeenCalledTimes(1); // heard live
      sampler.removeSequence();
      advance(0.1);
      expect(sounds[2].play).toHaveBeenCalledTimes(2); // and the next sequence's own step 1 as well
    });
  });

  describe("sequenceHasSteps", () => {
    it("is false for an empty sequence and true once a step is on", () => {
      const { sampler } = setup({ song: songOf(2), maxSequences: 6 });
      expect(sampler.sequenceHasSteps()).toBe(false);
      sampler.toggleStep(3);
      expect(sampler.sequenceHasSteps()).toBe(true);
    });

    it("counts steps in a bar the sequence no longer shows", () => {
      const { sampler } = setup({ song: songOf(1, { first: { 0: [20] }, bars: 1 }) }); // step 20 is in bar 2 of a one-bar sequence
      expect(sampler.sequenceHasSteps()).toBe(true);
    });

    it("is about the sequence showing", () => {
      const { sampler } = setup({ song: songOf(2, { first: { 0: [0] } }) });
      expect(sampler.sequenceHasSteps()).toBe(true);
      sampler.setSequence(1);
      expect(sampler.sequenceHasSteps()).toBe(false);
    });
  });

  describe("getState", () => {
    it("says whether a sequence can be added and whether one can be removed", () => {
      const { sampler } = setup({ song: songOf(1), maxSequences: 2 });
      expect(sampler.getState()).toMatchObject({ canAddSequence: true, canRemoveSequence: false });
      sampler.addSequence();
      expect(sampler.getState()).toMatchObject({ canAddSequence: false, canRemoveSequence: true });
    });

    it("starts with one sequence when it is given none: a saved song with an empty list, or a count of 0", () => {
      const noneSaved = { ...savedSong(), sequences: [] };
      expect(setup({ song: noneSaved }).sampler.getState()).toMatchObject({ sequence: 0, sequenceCount: 1 });
      expect(setup({ ownCount: true, bpm: undefined }).sampler.getState().sequenceCount).toBe(1);
    });

    it("has no limit on adding when it is told none", () => {
      const { sampler } = setup({ song: songOf(2) });
      for (let i = 0; i < 20; i++) sampler.addSequence();
      expect(sampler.getState()).toMatchObject({ sequenceCount: 22, canAddSequence: true });
    });
  });
});

describe("the next sequence", () => {
  // 120 BPM: a step is 0.125 s and the first falls at 0.05 s, so a pass of 16 steps ends at 2.05 s, and one of 4 bars (64 steps) at 8.05 s.
  // Each sequence has a step 0 on a pad of its own (sequence 1 on pad 2, sequence 2 on pad 3), to tell which one is sounding.
  const twoSequences = ({ bars = 1, bpm = 120, nextBars = 1, nextSteps = [0] } = {}) => {
    const song = songOf(3, { bpm });
    song.sequences[0] = { bars, pattern: { 0: [0] }, velocities: {} };
    song.sequences[1] = { bars: nextBars, pattern: { 1: nextSteps }, velocities: {} };
    song.sequences[2] = { bars: 1, pattern: { 2: [0] }, velocities: {} };
    return song;
  };
  const run = (s, seconds) => {
    for (let t = 0; t < seconds; t += 0.05) {
      s.advance(0.05);
      s.sampler.poll();
    }
  };

  it("switches at once when nothing is playing: there is no pass to wait for", () => {
    const { sampler, message } = setup({ song: twoSequences() });
    sampler.queueSequence(1);
    expect(sampler.getState()).toMatchObject({ sequence: 1, queuedSequence: -1 });
    expect(message).toHaveBeenLastCalledWith("SEQ 02");
  });

  it("waits while playing, says which is next, and keeps the one showing", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.5);
    s.sampler.queueSequence(1);
    expect(s.sampler.getState()).toMatchObject({ sequence: 0, queuedSequence: 1 });
    expect(s.message).toHaveBeenLastCalledWith("NEXT SEQ 02");
  });

  it("switches where the pass ends, and the new one sounds from its first step at that moment", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.5);
    s.sampler.queueSequence(1);
    run(s, 1.2); // 1.7 s: the pass ends at 2.05 s
    expect(s.sampler.getState().sequence).toBe(0);
    run(s, 0.45); // 2.15 s: the next pass has been scheduled
    expect(s.sampler.getState()).toMatchObject({ sequence: 1, queuedSequence: -1 });
    expect(s.message).toHaveBeenLastCalledWith("SEQ 02");
    expect(s.sounds[1].play).toHaveBeenCalledTimes(1);
    expect(s.sounds[1].play.mock.calls[0][2]).toBeCloseTo(2.05); // the first step of the new pass, on the grid
    expect(s.sounds[0].play).toHaveBeenCalledTimes(1); // and nothing more from the old one
  });

  it("asks for a save when it switches", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    s.songChange.mockClear();
    run(s, 2);
    expect(s.songChange).toHaveBeenCalled();
    expect(s.sampler.getSong().current).toBe(1);
  });

  it("goes round again in the sequence that took over, pass after pass, from where it began", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    run(s, 6.2); // 6.5 s: the pass of 16 ended at 2.05 s, and the new one has come round twice (4.05 s, 6.05 s)
    expect(s.sounds[1].play.mock.calls.map((call) => call[2])).toEqual([
      expect.closeTo(2.05, 2),
      expect.closeTo(4.05, 2),
      expect.closeTo(6.05, 2),
    ]);
  });

  it("waits for the end of a pass of the length the sequence showing has", () => {
    const s = setup({ song: twoSequences({ bars: 4 }) });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    run(s, 3.5); // 3.8 s: a 1-bar pass would be over, a 4-bar one is not
    expect(s.sampler.getState().sequence).toBe(0);
    run(s, 4.6); // 8.4 s: the pass of 64 steps ended at 8.05 s
    expect(s.sampler.getState()).toMatchObject({ sequence: 1, bars: 1 });
    expect(s.sounds[1].play.mock.calls[0][2]).toBeCloseTo(8.05);
  });

  it("goes round in the length of the sequence that took over, when it is shorter", () => {
    const s = setup({ song: twoSequences({ bars: 4 }) });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    run(s, 10.1); // 10.4 s: the pass of 64 steps ended at 8.05 s, and the 16 of the next at 10.05 s
    expect(s.sounds[1].play.mock.calls.map((call) => call[2])).toEqual([
      expect.closeTo(8.05, 2),
      expect.closeTo(10.05, 2),
    ]);
  });

  it("goes round in the length of the sequence that took over, when it is longer", () => {
    // Its only step is in the second bar, which a loop of the old length would never reach.
    const s = setup({ song: twoSequences({ nextBars: 2, nextSteps: [16] }) });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    run(s, 8.1); // 8.4 s: it began at 2.05 s, its step 16 is at 4.05 s, and it comes round at 6.05 s and 8.05 s
    expect(s.sounds[1].play.mock.calls.map((call) => call[2])).toEqual([
      expect.closeTo(4.05, 2),
      expect.closeTo(8.05, 2),
    ]);
  });

  it("redraws when the switch is made, and not before", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    s.change.mockClear();
    run(s, 1.2);
    expect(s.change).not.toHaveBeenCalled();
    run(s, 0.6);
    expect(s.change).toHaveBeenCalled();
  });

  it("takes the queue back when the sequence showing is picked to switch to now", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    s.sampler.setSequence(0);
    expect(s.sampler.getState()).toMatchObject({ sequence: 0, queuedSequence: -1 });
    expect(s.message).toHaveBeenLastCalledWith("NEXT CANCELLED");
    run(s, 2.2);
    expect(s.sampler.getState().sequence).toBe(0);
  });

  // A press just ahead of the downbeat is on time. The scheduler has the pass ended (and hands its first step to the audio clock) up to
  // a lookahead and a step before that step sounds, so for 1.85 to 2.05 s here a queue has to take the steps back and build them again.
  describe("queued just ahead of the end of the pass", () => {
    const toWindow = (s, seconds = 1.85) => {
      s.sampler.start();
      run(s, 1.8);
      s.advance(seconds - 1.8);
    };

    it("takes over at that end when the first step of the next pass has not been handed to the audio clock yet", () => {
      const s = setup({ song: twoSequences() });
      toWindow(s); // 1.85 s: the pass has ended in the scheduler; its first step, at 2.05 s, is not scheduled before 1.93 s
      expect(s.sampler.getState()).toMatchObject({ sequence: 0, queuedSequence: -1 });
      s.sampler.queueSequence(1);
      // The sequence showing (for editing) is the new one; what sounds, until the downbeat, is the one giving way.
      expect(s.sampler.getState()).toMatchObject({
        sequence: 1,
        queuedSequence: -1,
        heard: { sequence: 0, bars: 1 },
      });
      expect(s.message).toHaveBeenLastCalledWith("SEQ 02");
      run(s, 0.3); // 2.15 s: the first step of the new pass has sounded
      expect(s.sampler.getState().playheadStep).toBe(0);
      run(s, 2.1); // 4.25 s
      expect(s.sounds[1].play.mock.calls.map((call) => call[2])).toEqual([
        expect.closeTo(2.05, 2),
        expect.closeTo(4.05, 2),
      ]);
      expect(s.sounds[0].play).toHaveBeenCalledTimes(1); // only the first step of the beat, at 0.05 s
    });

    it("takes back the first step already handed over, which was built from the sequence giving way, and builds it again", () => {
      const s = setup({ song: twoSequences() });
      toWindow(s, 1.95); // its first step, at 2.05 s, has been scheduled from the sequence that is giving way
      expect(s.sounds[0].play).toHaveBeenCalledTimes(2);
      const given = busOf(s.sounds[0].play.mock.calls.at(-1)[1]);
      s.sampler.queueSequence(1);
      expect(given.disconnect).toHaveBeenCalledTimes(1);
      run(s, 0.4);
      expect(s.sounds[1].play).toHaveBeenCalledTimes(1);
      expect(s.sounds[1].play.mock.calls[0][2]).toBeCloseTo(2.05); // on the grid, where the beat's own step 0 was
    });

    it("leaves the last steps of the pass that is ending to sound", () => {
      const song = twoSequences();
      song.sequences[0] = { bars: 1, pattern: { 0: [15] }, velocities: {} };
      const s = setup({ song });
      toWindow(s, 1.95); // step 15 sounds at 1.925 s: it is behind the clock now, and what was queued with it stays
      const last = busOf(s.sounds[0].play.mock.calls.at(-1)[1]);
      s.sampler.queueSequence(1);
      expect(last.disconnect).not.toHaveBeenCalled();
    });

    it("takes over at the end of a pass of several bars, with the length it has", () => {
      const s = setup({ song: twoSequences({ bars: 4 }) });
      s.sampler.start();
      run(s, 7.9); // the pass of 64 steps ends at 8.05 s
      s.sampler.queueSequence(1);
      expect(s.sampler.getState()).toMatchObject({ sequence: 1, bars: 1 });
      run(s, 2.5);
      expect(s.sounds[1].play.mock.calls.map((call) => call[2])).toEqual([
        expect.closeTo(8.05, 2),
        expect.closeTo(10.05, 2),
      ]);
    });

    it("waits for the pass after once the first step of the one that has begun has sounded", () => {
      const s = setup({ song: twoSequences() });
      s.sampler.start();
      run(s, 2.2); // the first step of the second pass sounded at 2.05 s
      s.sampler.queueSequence(1);
      expect(s.sampler.getState()).toMatchObject({ sequence: 0, queuedSequence: 1 });
      run(s, 2);
      expect(s.sounds[1].play.mock.calls.map((call) => call[2])).toEqual([expect.closeTo(4.05, 2)]);
    });

    it("waits for the end of the pass the queued sequence has just taken over when another is queued in that moment", () => {
      const s = setup({ song: twoSequences() });
      s.sampler.start();
      run(s, 0.3);
      s.sampler.queueSequence(1);
      run(s, 1.6); // 1.9 s: the second sequence has taken over, and its first step is still to sound
      s.sampler.queueSequence(2);
      expect(s.sampler.getState()).toMatchObject({ sequence: 1, queuedSequence: 2 });
      run(s, 2.4); // 4.3 s
      expect(s.sounds[1].play.mock.calls.map((call) => call[2])).toEqual([expect.closeTo(2.05, 2)]);
      expect(s.sounds[2].play.mock.calls.map((call) => call[2])).toEqual([expect.closeTo(4.05, 2)]);
    });

    it("makes a second press in that moment the one that follows, as it does once the first has taken over", () => {
      const s = setup({ song: twoSequences() });
      toWindow(s);
      s.sampler.queueSequence(1);
      s.sampler.queueSequence(2);
      expect(s.sampler.getState()).toMatchObject({ sequence: 1, queuedSequence: 2 });
      run(s, 2.4); // 4.25 s
      expect(s.sounds[1].play.mock.calls.map((call) => call[2])).toEqual([expect.closeTo(2.05, 2)]);
      expect(s.sounds[2].play.mock.calls.map((call) => call[2])).toEqual([expect.closeTo(4.05, 2)]);
    });

    it("waits for the end of the longer pass when the loop is made longer after the pass has ended in the scheduler", () => {
      const s = setup({ song: twoSequences() });
      toWindow(s); // 1.85 s: the pass of one bar has ended in the scheduler, and its first step has not sounded
      s.sampler.setBars(2); // the loop carries on into a second bar: 2.05 s is not where it ends any more
      s.sampler.queueSequence(1);
      expect(s.sampler.getState()).toMatchObject({ sequence: 0, queuedSequence: 1 });
      run(s, 2.6); // 4.45 s
      expect(s.sounds[1].play.mock.calls.map((call) => call[2])).toEqual([expect.closeTo(4.05, 2)]);
    });

    it("waits for the end of the longer pass when a longer sequence is picked to switch to now in that moment", () => {
      const s = setup({ song: twoSequences({ nextBars: 2 }), maxSequences: 6 });
      toWindow(s);
      s.sampler.setSequence(1); // two bars, carried on into
      s.sampler.queueSequence(2);
      expect(s.sampler.getState()).toMatchObject({ sequence: 1, queuedSequence: 2 });
      run(s, 2.6);
      expect(s.sounds[2].play.mock.calls.map((call) => call[2])).toEqual([expect.closeTo(4.05, 2)]);
    });

    it("still takes over at that end when a shorter sequence is picked to switch to now in that moment", () => {
      const s = setup({ song: twoSequences({ bars: 2 }), maxSequences: 6 });
      s.sampler.start();
      run(s, 3.8);
      s.advance(0.05); // 3.85 s: the pass of two bars has ended in the scheduler, and its first step sounds at 4.05 s
      s.sampler.setSequence(1); // one bar: the last steps of the pass are built again from it, so the scheduler is back before the pass end
      s.sampler.queueSequence(2); // so this one waits for the pass end that is about to come round again, and takes over there
      expect(s.sampler.getState()).toMatchObject({ sequence: 1, queuedSequence: 2 });
      run(s, 0.3); // 4.2 s
      expect(s.sampler.getState()).toMatchObject({ sequence: 2, queuedSequence: -1 });
      expect(s.sounds[2].play.mock.calls.map((call) => call[2])).toEqual([expect.closeTo(4.05, 2)]);
    });

    it("still takes over at that end when the loop is made shorter in that moment", () => {
      const s = setup({ song: twoSequences({ bars: 2 }) });
      s.sampler.start();
      run(s, 3.8); // the pass of two bars ends at 4.05 s
      s.sampler.setBars(1); // a pass that ends where it did
      s.sampler.queueSequence(1);
      expect(s.sampler.getState()).toMatchObject({ sequence: 0, queuedSequence: 1 }); // the steps built for the dropped bar are built again
      run(s, 0.5); // 4.3 s
      expect(s.sampler.getState()).toMatchObject({ sequence: 1, queuedSequence: -1 });
      expect(s.sounds[1].play.mock.calls.map((call) => call[2])).toEqual([expect.closeTo(4.05, 2)]);
    });

    // A sequence of two bars, made one bar at the moment the scheduler is at the end of the first: the loop has come round there.
    describe("when the loop is made shorter so that it ends where the scheduler is", () => {
      const atEndOfFirstBar = () => {
        const s = setup({ song: twoSequences({ bars: 2 }) });
        s.sampler.start();
        const tick = (count) => {
          for (let i = 0; i < count; i++) {
            s.advance(0.05);
            s.sampler.poll();
          }
        };
        tick(6);
        s.sampler.queueSequence(1);
        tick(31); // 1.85 s: step 15 is scheduled, and the next is 16, which is where a loop of one bar ends
        return s;
      };

      it("takes over there, in the pass that begins at 2.05 s", () => {
        const s = atEndOfFirstBar();
        s.sampler.setBars(1);
        expect(s.sampler.getState()).toMatchObject({ sequence: 1, queuedSequence: -1, bars: 1 });
        expect(s.sampler.getSong().sequences[0].bars).toBe(1);
        for (let i = 0; i < 12; i++) {
          s.advance(0.05);
          s.sampler.poll();
        }
        expect(s.sounds[1].play.mock.calls.map((call) => call[2])).toEqual([expect.closeTo(2.05, 2)]);
      });

      it("says the sequence that took over, and not the length it was shortened to", () => {
        const s = atEndOfFirstBar();
        s.sampler.setBars(1);
        expect(s.message).toHaveBeenLastCalledWith("SEQ 02");
        expect(s.message).toHaveBeenCalledWith("1 BAR");
      });

      it("redraws and asks for a save", () => {
        const s = atEndOfFirstBar();
        s.change.mockClear();
        s.songChange.mockClear();
        s.sampler.setBars(1);
        expect(s.change).toHaveBeenCalled();
        expect(s.songChange).toHaveBeenCalled();
      });

      it("is a pass end for a sequence queued afterwards too, when none was before", () => {
        const s = setup({ song: twoSequences({ bars: 2 }) });
        s.sampler.start();
        for (let i = 0; i < 37; i++) {
          s.advance(0.05);
          s.sampler.poll();
        }
        s.sampler.setBars(1); // the loop comes round here, with nothing queued
        s.sampler.queueSequence(1); // and a press before the downbeat takes over there
        for (let i = 0; i < 6; i++) {
          s.advance(0.05);
          s.sampler.poll();
        }
        expect(s.sampler.getState()).toMatchObject({ sequence: 1, queuedSequence: -1 });
        expect(s.sounds[1].play.mock.calls.map((call) => call[2])).toEqual([expect.closeTo(2.05, 2)]);
      });
    });

    it("waits for the wrap that is about to come again, when the steps before it have just been taken back in the same moment", () => {
      // A change of sounds takes the last step of the pass back to build it again, and a press just after it finds the scheduler
      // behind the pass end: there is no first step to take back, and rewinding to the pass end would skip the one that was.
      const song = twoSequences();
      song.sequences[0] = { bars: 1, pattern: { 0: [15] }, velocities: {} };
      const s = setup({ song });
      s.sampler.start();
      for (let i = 0; i < 76; i++) {
        s.advance(0.025);
        s.sampler.poll();
      }
      s.sampler.kitChanged("sound"); // 1.9 s: step 15, at 1.925 s, is built again
      s.sampler.queueSequence(1);
      expect(s.sampler.getState()).toMatchObject({ sequence: 0, queuedSequence: 1 }); // a plain queue: the wrap comes round again
      for (let i = 0; i < 12; i++) {
        s.advance(0.025);
        s.sampler.poll();
      }
      const step15 = s.sounds[0].play.mock.calls.filter((call) => Math.abs(call[2] - 1.925) < 0.01);
      expect(busOf(step15.at(-1)[1]).disconnect).not.toHaveBeenCalled(); // the step that was taken back sounds
      expect(s.sampler.getState().sequence).toBe(1);
      expect(s.sounds[1].play.mock.calls.map((call) => call[2])).toEqual([expect.closeTo(2.05, 2)]);
    });

    it("is for the end of the pass before a restart, and not for the one after", () => {
      const s = setup({ song: twoSequences() });
      toWindow(s);
      s.sampler.start();
      run(s, 0.1);
      s.sampler.queueSequence(1);
      expect(s.sampler.getState()).toMatchObject({ sequence: 0, queuedSequence: 1 }); // the restarted beat is a pass of its own
    });
  });

  it("takes the queue back when the queued sequence is pressed again, or the one showing is", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    s.sampler.queueSequence(1);
    expect(s.sampler.getState().queuedSequence).toBe(-1);
    expect(s.message).toHaveBeenLastCalledWith("NEXT CANCELLED");
    s.sampler.queueSequence(2);
    s.sampler.queueSequence(0);
    expect(s.sampler.getState().queuedSequence).toBe(-1);
    run(s, 2.2);
    expect(s.sampler.getState().sequence).toBe(0);
  });

  it("changes which one is next when another is pressed", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    s.sampler.queueSequence(2);
    expect(s.sampler.getState().queuedSequence).toBe(2);
    run(s, 2);
    expect(s.sampler.getState().sequence).toBe(2);
  });

  it.each([
    ["Stop", (sampler) => sampler.stop()],
    ["Play pressed again", (sampler) => sampler.start()],
    ["picking a sequence to switch to now", (sampler) => sampler.setSequence(2)],
    ["adding one", (sampler) => sampler.addSequence()],
    ["removing the one showing", (sampler) => sampler.removeSequence()],
  ])("drops the queue on %s", (_name, act) => {
    const s = setup({ song: twoSequences(), maxSequences: 6 });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    act(s.sampler);
    expect(s.sampler.getState().queuedSequence).toBe(-1);
  });

  it.each([
    ["Stop", (sampler) => sampler.stop()],
    ["Play pressed again", (sampler) => sampler.start()],
  ])("says the queue is taken back when %s drops it, since the display still says what plays next", (_name, act) => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    act(s.sampler);
    expect(s.message).toHaveBeenLastCalledWith("NEXT CANCELLED");
  });

  it("says nothing of a queue when Stop or Play is pressed and there was none", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.3);
    s.message.mockClear();
    s.sampler.start();
    s.sampler.stop();
    expect(s.message).not.toHaveBeenCalledWith("NEXT CANCELLED");
  });

  it("begins to show the playhead of a beat that is restarted in the moment after a switch, not after the pass it left", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    run(s, 1.6); // 1.9 s: switched, with the old pass's last steps still to sound
    expect(s.sampler.getState()).toMatchObject({ sequence: 1, heard: { sequence: 0 } });
    s.sampler.start();
    run(s, 0.1); // the first step of the new run sounded at about 1.95 s, before the pass that was left would have ended (2.05 s)
    expect(s.sampler.getState().playheadStep).toBe(0);
  });

  it("writes a live hit into the new sequence once its pass has begun", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.toggleRec();
    s.sampler.queueSequence(1);
    run(s, 2.1); // 2.4 s: the new pass began at 2.05 s
    expect(s.sampler.getState().playheadStep).toBeGreaterThanOrEqual(0);
    s.sampler.triggerPad(3);
    expect(s.sampler.getSong().sequences[1].pattern[3]).toBeDefined();
    expect(s.sampler.getSong().sequences[0].pattern[3]).toBeUndefined();
  });

  it("does not switch after Stop and Play when the queue was dropped", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    s.sampler.stop();
    s.sampler.start();
    run(s, 2.5);
    expect(s.sampler.getState().sequence).toBe(0);
  });

  it("shows no playhead for the last steps of the old pass once the switch has been made, a moment before they sound", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(1);
    run(s, 1.65); // 1.95 s: the pass ends at 2.05 s and its step 0 has just been scheduled; the playhead is on the old step 15
    expect(s.sampler.getState().sequence).toBe(1);
    // The display goes on with the pass that sounds, in its numbering and its length: step 16 of 16 of the sequence giving way, and
    // the keys are for the one showing.
    expect(s.sampler.getState()).toMatchObject({
      heard: { sequence: 0, bars: 1 },
      playheadPosition: 15,
      playheadStep: 15,
    });
    run(s, 0.15); // 2.1 s: the playhead is on the first step of the new pass
    expect(s.sampler.getState()).toMatchObject({
      heard: { sequence: 1, playheadStep: 0 },
      playheadStep: 0,
      playheadPosition: 0,
    });
  });

  // Between the switch and the first step of the new pass sounding, the playhead is on the last steps of the sequence that gave
  // way, so a hit is a step of that one, or the downbeat of the one that takes over if it is nearest that.
  describe("a live hit in the moment between a switch and the new pass", () => {
    const recordingThroughSwitch = () => {
      const s = setup({ song: twoSequences() });
      s.sampler.start();
      run(s, 0.3);
      s.sampler.toggleRec();
      s.sampler.queueSequence(1);
      run(s, 1.6); // 1.9 s: switched at 1.85 s; step 15 of the old pass sounded at 1.925 s, and the new pass begins at 2.05 s
      return s;
    };

    it("is written into the sequence that is giving way, at the step it is nearest, and sounds once", () => {
      const s = recordingThroughSwitch();
      run(s, 0.04); // 1.95 s: the playhead is on step 15
      expect(s.sampler.getState()).toMatchObject({ sequence: 1, heard: { sequence: 0 } });
      s.sampler.triggerPad(3);
      const song = s.sampler.getSong();
      expect(song.sequences[0].pattern[3]).toEqual([15]);
      expect(song.sequences[1].pattern[3]).toBeUndefined();
      expect(s.sounds[3].play).toHaveBeenCalledTimes(1);
    });

    it("is written into the sequence that takes over, at its first step, when that is the one it is nearest", () => {
      const s = recordingThroughSwitch();
      run(s, 0.1); // 2.0 s, 50 ms before the downbeat: the playhead is still on step 15 of the sequence that gave way
      expect(s.sampler.getState().playheadStep).toBe(15);
      s.sampler.triggerPad(3);
      const song = s.sampler.getSong();
      expect(song.sequences[1].pattern[3]).toEqual([0]);
      expect(song.sequences[0].pattern[3]).toBeUndefined();
      expect(s.sounds[3].play).toHaveBeenCalledTimes(1); // and it does not sound again on the downbeat
      run(s, 0.3);
      expect(s.sounds[3].play).toHaveBeenCalledTimes(1);
    });

    it("counts its step in the length of the sequence that gave way, which may not be the length of the one that took over", () => {
      const s = setup({ song: twoSequences({ bars: 2 }) }); // 32 steps, then a sequence of 16
      s.sampler.start();
      const tick = (count) => {
        for (let i = 0; i < count; i++) {
          s.advance(0.05);
          s.sampler.poll();
        }
      };
      tick(6);
      s.sampler.toggleRec();
      s.sampler.queueSequence(1);
      tick(72); // 3.9 s: switched at 3.85 s; the pass of 32 steps ends at 4.05 s, and the playhead is on its step 30 (31 is at 3.925 s)
      // What sounds is a sequence of two bars and its step 31 of 32; the one showing is a bar.
      expect(s.sampler.getState()).toMatchObject({
        sequence: 1,
        bars: 1,
        heard: { sequence: 0, bars: 2 },
        playheadPosition: 30,
      });
      s.sampler.triggerPad(3); // past halfway to step 31
      expect(s.sampler.getSong().sequences[0].pattern[3]).toEqual([31]);
      expect(s.sampler.getSong().sequences[1].pattern[3]).toBeUndefined();
    });

    it("can be undone in the sequence it was written into, and not in the one showing", () => {
      const s = recordingThroughSwitch();
      run(s, 0.04);
      s.sampler.triggerPad(3);
      expect(s.sampler.getState().canUndo).toBe(false); // the one showing has nothing to undo
      s.sampler.setSequence(0);
      expect(s.sampler.getState().canUndo).toBe(true);
      s.sampler.undo();
      expect(s.sampler.getSong().sequences[0].pattern[3]).toBeUndefined();
    });

    it("asks for a save", () => {
      const s = recordingThroughSwitch();
      run(s, 0.04);
      s.songChange.mockClear();
      s.sampler.triggerPad(3);
      expect(s.songChange).toHaveBeenCalled();
    });

    it("is written into the one showing once the new pass has begun, as before", () => {
      const s = recordingThroughSwitch();
      run(s, 0.3); // 2.2 s
      s.sampler.triggerPad(3);
      expect(s.sampler.getSong().sequences[1].pattern[3]).toBeDefined();
      expect(s.sampler.getSong().sequences[0].pattern[3]).toBeUndefined();
    });

    it("goes into the sequence that gave way when a sequence taking over late took it over", () => {
      const s = setup({ song: twoSequences() });
      s.sampler.start();
      run(s, 1.8);
      s.sampler.toggleRec();
      s.advance(0.05); // 1.85 s: the pass has ended in the scheduler
      s.sampler.queueSequence(1);
      s.advance(0.05);
      s.sampler.triggerPad(3);
      expect(s.sampler.getSong().sequences[0].pattern[3]).toEqual([15]);
    });
  });

  it.each([
    ["the sounds change", (sampler) => sampler.kitChanged("sound"), 1],
    ["another sequence is picked to switch to now", (sampler) => sampler.setSequence(2), 2],
  ])(
    "builds again only the steps of the pass that has begun when %s just after the switch, and leaves the old pass's",
    (_name, act, pad) => {
      // 240 BPM: a step is 0.0625 s and the pass ends at 1.05 s. At 0.95 s the switch has been made, the old step 15 (at 0.9875 s)
      // and the new step 0 (at 1.05 s) are both queued.
      const song = twoSequences({ bpm: 240 });
      song.sequences[0] = { bars: 1, pattern: { 0: [15] }, velocities: {} };
      const s = setup({ song });
      s.sampler.start();
      for (let t = 0; t < 0.6; t += 0.05) s.advance(0.05);
      s.sampler.queueSequence(1);
      for (let t = 0; t < 0.35; t += 0.05) s.advance(0.05); // 0.95 s
      expect(s.sampler.getState().sequence).toBe(1);
      const oldStep = busOf(s.sounds[0].play.mock.calls.at(-1)[1]);
      const newStep = busOf(s.sounds[1].play.mock.calls.at(-1)[1]);
      act(s.sampler);
      expect(newStep.disconnect).toHaveBeenCalledTimes(1); // built again
      expect(oldStep.disconnect).not.toHaveBeenCalled(); // the pass that was already underway keeps what it had
      s.advance(0.1);
      expect(s.sounds[pad].play.mock.calls.at(-1)[2]).toBeCloseTo(1.05); // and the new pass is still there, at the same time
    },
  );

  it("makes the switch once, in the pass where it lands, when a stall skips past the end of the pass", () => {
    const s = setup({ song: twoSequences() });
    s.sampler.start();
    s.advance(0.1);
    s.sampler.queueSequence(1);
    s.advance(3); // the timer was held up: the pass ended at 2.05 s while nothing was scheduled
    s.sampler.poll();
    expect(s.sampler.getState()).toMatchObject({ sequence: 1, queuedSequence: -1 });
    expect(s.message.mock.calls.filter(([text]) => text === "SEQ 02")).toHaveLength(1);
  });

  it("says which sequence is queued in the state", () => {
    const s = setup({ song: twoSequences() });
    expect(s.sampler.getState().queuedSequence).toBe(-1);
    s.sampler.start();
    run(s, 0.2);
    s.sampler.queueSequence(2);
    expect(s.sampler.getState().queuedSequence).toBe(2);
  });
});

describe("Play All", () => {
  // 120 BPM: a pass of one bar is 2 s, its first step at 0.05 s, so the passes begin at 0.05, 2.05, 4.05 s and so on. Sequence i has a
  // step 0 on pad i, to tell which one is sounding.
  const chain = (count = 3, { bars = [], bpm = 120 } = {}) => {
    const song = songOf(count, { bpm });
    for (let i = 0; i < count; i++) song.sequences[i] = { bars: bars[i] ?? 1, pattern: { [i]: [0] }, velocities: {} };
    return song;
  };
  const tick = (s, count) => {
    for (let i = 0; i < count; i++) {
      s.advance(0.05);
      s.sampler.poll();
    }
  };
  const run = (s, seconds) => tick(s, Math.round(seconds / 0.05));
  const timesOf = (s, pad) => s.sounds[pad].play.mock.calls.map((call) => call[2]);
  const closeTo = (...times) => times.map((time) => expect.closeTo(time, 2));

  it("is off to begin with, and a beat stays on the sequence it is on", () => {
    const s = setup({ song: chain(3) });
    expect(s.sampler.getState().playAll).toBe(false);
    s.sampler.start();
    run(s, 6.2);
    expect(s.sampler.getState().sequence).toBe(0);
    expect(timesOf(s, 1)).toEqual([]);
  });

  it("is turned on and off by togglePlayAll, which says so and redraws", () => {
    const s = setup({ song: chain(3) });
    s.sampler.togglePlayAll();
    expect(s.sampler.getState().playAll).toBe(true);
    expect(s.message).toHaveBeenLastCalledWith("PLAY ALL ON");
    expect(s.change).toHaveBeenCalled();
    s.sampler.togglePlayAll();
    expect(s.sampler.getState().playAll).toBe(false);
    expect(s.message).toHaveBeenLastCalledWith("PLAY ALL OFF");
  });

  it("plays the sequences in order, one pass each, and starts again from the first after the last", () => {
    const s = setup({ song: chain(3) });
    s.sampler.togglePlayAll();
    s.sampler.start();
    run(s, 7.2); // 7.2 s: the fourth pass began at 6.05 s, and the fifth begins at 8.05 s
    expect(timesOf(s, 0)).toEqual(closeTo(0.05, 6.05));
    expect(timesOf(s, 1)).toEqual(closeTo(2.05));
    expect(timesOf(s, 2)).toEqual(closeTo(4.05));
    expect(s.sampler.getState().sequence).toBe(0);
  });

  it("shows the sequence that plays, and goes on from pass to pass without a message or a save of its own", () => {
    const s = setup({ song: chain(3) });
    s.sampler.togglePlayAll();
    s.sampler.start();
    run(s, 1.5);
    expect(s.sampler.getState().sequence).toBe(0);
    s.message.mockClear();
    s.songChange.mockClear();
    s.change.mockClear();
    run(s, 0.6); // 2.1 s: the second pass has begun
    expect(s.sampler.getState().sequence).toBe(1);
    expect(s.change).toHaveBeenCalled();
    // Said and saved once a pass, it would be an announcement a pass for a screen reader and a write a pass that tells another
    // tab it is out of date: where a chain has got to is not what the beat is.
    expect(s.message).not.toHaveBeenCalled();
    expect(s.songChange).not.toHaveBeenCalled();
    expect(s.sampler.getSong().current).toBe(1); // and what is saved next, by an edit, is the sequence it is on
    run(s, 2);
    expect(s.sampler.getState().sequence).toBe(2);
    expect(s.message).not.toHaveBeenCalled();
  });

  it("says and saves the switch to a queued sequence, and not the chain's after it", () => {
    const s = setup({ song: chain(4) });
    s.sampler.togglePlayAll();
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(2);
    s.message.mockClear();
    s.songChange.mockClear();
    run(s, 2.0); // 2.3 s: the queued sequence has taken over
    expect(s.message).toHaveBeenLastCalledWith("SEQ 03");
    expect(s.songChange).toHaveBeenCalled();
    s.message.mockClear();
    s.songChange.mockClear();
    run(s, 2.0); // 4.3 s: the chain has gone to 4
    expect(s.sampler.getState().sequence).toBe(3);
    expect(s.message).not.toHaveBeenCalled();
    expect(s.songChange).not.toHaveBeenCalled();
  });

  it("begins with the sequence showing, then goes on in order", () => {
    const s = setup({ song: chain(3) });
    s.sampler.setSequence(1);
    s.sampler.togglePlayAll();
    s.sampler.start();
    run(s, 5.2); // the fourth pass begins at 6.05 s
    expect(timesOf(s, 1)).toEqual(closeTo(0.05));
    expect(timesOf(s, 2)).toEqual(closeTo(2.05));
    expect(timesOf(s, 0)).toEqual(closeTo(4.05));
  });

  it("goes round in the length of each sequence", () => {
    const s = setup({ song: chain(3, { bars: [2, 1, 1] }) });
    s.sampler.togglePlayAll();
    s.sampler.start();
    run(s, 8.2); // the first is two bars (4 s), then 2 s each: 4.05, 6.05, 8.05
    expect(timesOf(s, 1)).toEqual(closeTo(4.05));
    expect(timesOf(s, 2)).toEqual(closeTo(6.05));
    expect(timesOf(s, 0)).toEqual(closeTo(0.05, 8.05));
  });

  describe("turned on or off just ahead of the end of the pass", () => {
    it("takes effect at that end when turned on before the next pass's first step is handed to the audio clock", () => {
      const s = setup({ song: chain(3) });
      s.sampler.start();
      tick(s, 38); // 1.9 s: the pass has ended in the scheduler, which has built nothing of the next
      s.message.mockClear();
      s.songChange.mockClear();
      s.sampler.togglePlayAll();
      expect(s.sampler.getState()).toMatchObject({ playAll: true, sequence: 1 });
      expect(s.message.mock.calls.map(([text]) => text)).toEqual(["PLAY ALL ON"]); // and the switch is the chain's: quiet
      expect(s.songChange).not.toHaveBeenCalled();
      run(s, 0.5);
      expect(timesOf(s, 1)).toEqual(closeTo(2.05));
    });

    it("takes back the first step already built, and builds it again, when turned on after it was handed over", () => {
      const s = setup({ song: chain(3) });
      s.sampler.start();
      tick(s, 40); // 2.0 s: the first step of the next pass, at 2.05 s, was built from the sequence that gives way
      const built = busOf(s.sounds[0].play.mock.calls.at(-1)[1]);
      s.sampler.togglePlayAll();
      expect(built.disconnect).toHaveBeenCalledTimes(1);
      run(s, 0.5);
      expect(timesOf(s, 1)).toEqual(closeTo(2.05));
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 2.05)); // the one built again was never a second sound
    });

    it("waits for the end of the next pass when turned on after the first step of the pass that began has sounded", () => {
      const s = setup({ song: chain(3) });
      s.sampler.start();
      run(s, 2.2);
      s.sampler.togglePlayAll();
      expect(s.sampler.getState().sequence).toBe(0);
      run(s, 2.2); // 4.4 s
      expect(timesOf(s, 1)).toEqual(closeTo(4.05));
    });

    it("does nothing at that end with one sequence, or when a queued sequence has taken over there", () => {
      const one = setup({ song: chain(1) });
      one.sampler.start();
      tick(one, 40); // 2.0 s: the first step of the next pass is built
      const built = busOf(one.sounds[0].play.mock.calls.at(-1)[1]);
      one.sampler.togglePlayAll();
      expect(built.disconnect).not.toHaveBeenCalled(); // it is not taken back and built again for nothing
      const queued = setup({ song: chain(3) });
      queued.sampler.start();
      run(queued, 0.3);
      queued.sampler.queueSequence(2);
      tick(queued, 31); // 1.85 s: the queued sequence has taken over, and its pass end is closed to a press
      queued.sampler.togglePlayAll();
      expect(queued.sampler.getState().sequence).toBe(2);
    });

    it("takes back the chain's pick, so the sequence goes round again, when turned off after the pass end took it", () => {
      const s = setup({ song: chain(3) });
      s.sampler.togglePlayAll();
      s.sampler.start();
      tick(s, 38); // 1.9 s: the chain has picked the second sequence, and the display is still on the first
      expect(s.sampler.getState()).toMatchObject({ sequence: 1, heard: { sequence: 0 } });
      s.message.mockClear();
      s.songChange.mockClear();
      s.sampler.togglePlayAll();
      expect(s.sampler.getState()).toMatchObject({ playAll: false, sequence: 0 });
      expect(s.message.mock.calls.map(([text]) => text)).toEqual(["PLAY ALL OFF"]);
      expect(s.songChange).not.toHaveBeenCalled();
      run(s, 3.2); // 5.1 s: the first sequence went round again at 2.05 s and 4.05 s
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 2.05, 4.05));
      expect(timesOf(s, 1)).toEqual([]);
    });

    it("takes back the pick's first step, if it was built, when turned off", () => {
      const s = setup({ song: chain(3) });
      s.sampler.togglePlayAll();
      s.sampler.start();
      tick(s, 40); // 2.0 s
      const picked = busOf(s.sounds[1].play.mock.calls[0][1]);
      s.sampler.togglePlayAll();
      expect(picked.disconnect).toHaveBeenCalledTimes(1);
      run(s, 0.5);
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 2.05));
    });

    it("is left to the end of the next pass when turned off after the pass that began has sounded", () => {
      const s = setup({ song: chain(3) });
      s.sampler.togglePlayAll();
      s.sampler.start();
      run(s, 2.2);
      s.sampler.togglePlayAll();
      expect(s.sampler.getState().sequence).toBe(1);
      run(s, 2.2); // 4.4 s
      expect(s.sampler.getState().sequence).toBe(1);
    });

    it("does not undo a sequence a person has picked since the chain's pick: that one stands", () => {
      const s = setup({ song: chain(3), maxSequences: 6 });
      s.sampler.togglePlayAll();
      s.sampler.start();
      tick(s, 38); // the first sequence gave way to the second
      s.sampler.setSequence(2); // a person switches to the third now: the chain's pass end is not what it was
      s.sampler.togglePlayAll();
      expect(s.sampler.getState().sequence).toBe(2); // not sent back to the first
    });
  });

  it("takes effect at the end of the pass when turned on while it plays, and stops there when turned off", () => {
    const s = setup({ song: chain(3) });
    s.sampler.start();
    run(s, 0.5);
    s.sampler.togglePlayAll();
    expect(s.sampler.getState().sequence).toBe(0); // not at once
    run(s, 2); // 2.5 s
    expect(s.sampler.getState().sequence).toBe(1);
    s.sampler.togglePlayAll();
    run(s, 4); // 6.5 s: the passes at 4.05 and 6.05 s keep the sequence they were on
    expect(s.sampler.getState().sequence).toBe(1);
    expect(timesOf(s, 1)).toEqual(closeTo(2.05, 4.05, 6.05));
  });

  it("goes to a queued sequence first, and on from there", () => {
    const s = setup({ song: chain(4) });
    s.sampler.togglePlayAll();
    s.sampler.start();
    run(s, 0.3);
    s.sampler.queueSequence(2);
    run(s, 6.9); // 7.2 s: 0, then the queued 2, then 3, then 0 again at 6.05 s, and 1 would begin at 8.05 s
    expect(timesOf(s, 2)).toEqual(closeTo(2.05));
    expect(timesOf(s, 3)).toEqual(closeTo(4.05));
    expect(timesOf(s, 0)).toEqual(closeTo(0.05, 6.05));
    expect(timesOf(s, 1)).toEqual([]);
  });

  it("goes on from a sequence switched to now", () => {
    const s = setup({ song: chain(4) });
    s.sampler.togglePlayAll();
    s.sampler.start();
    run(s, 0.5);
    s.sampler.setSequence(2);
    run(s, 4.0); // 4.5 s: the pass that began at 0.05 s ends at 2.05 s
    expect(s.sampler.getState().sequence).toBe(0); // 2 -> 3 -> 0
    expect(timesOf(s, 3)).toEqual(closeTo(2.05));
    expect(timesOf(s, 0)).toEqual(closeTo(0.05, 4.05));
  });

  it("makes no switch with one sequence, says nothing and saves nothing, and goes on playing it", () => {
    const s = setup({ song: chain(1) });
    s.sampler.togglePlayAll();
    s.sampler.start();
    run(s, 0.3);
    s.message.mockClear();
    s.songChange.mockClear();
    run(s, 4.2);
    expect(timesOf(s, 0)).toEqual(closeTo(0.05, 2.05, 4.05));
    expect(s.message).not.toHaveBeenCalled();
    expect(s.songChange).not.toHaveBeenCalled();
  });

  it("goes on through the sequences there are when one is added or removed while it plays", () => {
    const s = setup({ song: chain(3), maxSequences: 6 });
    s.sampler.togglePlayAll();
    s.sampler.start();
    run(s, 2.5);
    expect(s.sampler.getState().sequence).toBe(1);
    s.sampler.removeSequence(); // the one showing goes, and the one after takes its place (index 1 of two)
    expect(s.sampler.getState()).toMatchObject({ sequence: 1, sequenceCount: 2 });
    run(s, 2); // 4.5 s: the pass ended at 4.05 s
    expect(s.sampler.getState().sequence).toBe(0);
  });

  it.each([
    ["added", (sampler) => sampler.addSequence()],
    ["copied", (sampler) => sampler.copySequence()],
  ])("stays on, and goes round the sequences there are, when one is %s while it plays", (_name, act) => {
    const s = setup({ song: chain(3), maxSequences: 6 });
    s.sampler.togglePlayAll();
    s.sampler.start();
    run(s, 0.5);
    act(s.sampler);
    expect(s.sampler.getState()).toMatchObject({ playAll: true, sequence: 3, sequenceCount: 4 });
    run(s, 2); // 2.5 s: the pass that ended at 2.05 s was followed by the first, after the last
    expect(s.sampler.getState().sequence).toBe(0);
    expect(timesOf(s, 0)).toEqual(closeTo(0.05, 2.05));
  });

  it("stays on through Stop, and Play begins again at the sequence showing", () => {
    const s = setup({ song: chain(3) });
    s.sampler.togglePlayAll();
    s.sampler.start();
    run(s, 2.5);
    s.sampler.stop();
    expect(s.sampler.getState()).toMatchObject({ playAll: true, playing: false, sequence: 1 });
    s.sampler.start();
    run(s, 2.7); // the restarted beat began at about 2.55 s with the one showing, and its second pass at about 4.6 s
    expect(s.sampler.getState().sequence).toBe(2);
    expect(timesOf(s, 1).at(-1)).toBeGreaterThan(2.5); // it began again with the one showing
  });

  it("stays in step through a stall that skips several pass ends", () => {
    const s = setup({ song: chain(3) });
    s.sampler.togglePlayAll();
    s.sampler.start();
    s.advance(0.1);
    s.advance(4.5); // the timer was held up: the passes ended at 2.05 s and 4.05 s
    s.sampler.poll();
    expect(s.sampler.getState().sequence).toBe(2); // one switch for a stall that crosses two pass ends would be on 1
    expect(s.sampler.getState().heard.sequence).toBe(2);
  });

  it("writes a live hit into the sequence that plays", () => {
    const s = setup({ song: chain(3) });
    s.sampler.togglePlayAll();
    s.sampler.toggleRec();
    s.sampler.start();
    run(s, 2.7); // the second pass began at 2.05 s
    s.sampler.triggerPad(3);
    expect(s.sampler.getSong().sequences[1].pattern[3]).toBeDefined();
    expect(s.sampler.getSong().sequences[0].pattern[3]).toBeUndefined();
  });

  // The chain's pick for the next pass is the scheduler's, up to a lookahead and a step before it sounds, and the display is still on the
  // pass that is ending: a press in that moment is for what comes after it, and replaces the pick, as it does where nothing was picked.
  describe("a press just ahead of the end of the pass", () => {
    it("takes over there in place of the chain's pick, before the pick's first step is handed to the audio clock", () => {
      const s = setup({ song: chain(4) });
      s.sampler.togglePlayAll();
      s.sampler.start();
      tick(s, 38); // 1.9 s: the chain has picked 2 at 1.85 s; its first step, at 2.05 s, is not built before 1.93 s
      expect(s.sampler.getState()).toMatchObject({ sequence: 1, heard: { sequence: 0 } });
      s.sampler.queueSequence(3);
      expect(s.sampler.getState()).toMatchObject({ sequence: 3, queuedSequence: -1 });
      expect(s.message).toHaveBeenLastCalledWith("SEQ 04");
      run(s, 2.4); // 4.3 s
      expect(timesOf(s, 3)).toEqual(closeTo(2.05));
      expect(timesOf(s, 1)).toEqual([]);
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 4.05)); // and the chain goes on from the one pressed
    });

    it("takes back the pick's first step if it was handed over, and builds it again from the one pressed", () => {
      const s = setup({ song: chain(4) });
      s.sampler.togglePlayAll();
      s.sampler.start();
      tick(s, 40); // 2.0 s: the pick's first step, at 2.05 s, was built at 1.95 s
      const picked = busOf(s.sounds[1].play.mock.calls[0][1]);
      s.sampler.queueSequence(3);
      expect(picked.disconnect).toHaveBeenCalledTimes(1);
      run(s, 0.5);
      expect(timesOf(s, 3)).toEqual(closeTo(2.05));
    });

    it("is saved and said, as any press is", () => {
      const s = setup({ song: chain(4) });
      s.sampler.togglePlayAll();
      s.sampler.start();
      tick(s, 38);
      s.songChange.mockClear();
      s.sampler.queueSequence(3);
      expect(s.songChange).toHaveBeenCalled();
      expect(s.sampler.getSong().current).toBe(3);
    });

    it("leaves a hit recorded in that moment to the sequence that is sounding, in the chain's pass or the pressed one's", () => {
      const s = setup({ song: chain(4) });
      s.sampler.togglePlayAll();
      s.sampler.toggleRec();
      s.sampler.start();
      tick(s, 38);
      s.sampler.queueSequence(3);
      tick(s, 1); // 1.95 s: the playhead is on step 15 of the first sequence
      s.sampler.triggerPad(2); // a pad that the sequences compared have no step on
      const song = s.sampler.getSong();
      expect(song.sequences[0].pattern[2]).toEqual([15]);
      expect(song.sequences[1].pattern[2]).toBeUndefined();
      expect(song.sequences[3].pattern[2]).toBeUndefined();
    });

    it("does not follow a press on the sequence the chain has picked: it plays there anyway", () => {
      const s = setup({ song: chain(4) });
      s.sampler.togglePlayAll();
      s.sampler.start();
      tick(s, 38);
      s.sampler.queueSequence(1);
      expect(s.sampler.getState()).toMatchObject({ sequence: 1, queuedSequence: -1 });
      run(s, 0.5);
      expect(timesOf(s, 1)).toEqual(closeTo(2.05));
    });
  });

  it("hands a hit recorded in the moment after a chain switch to the sequence that is still sounding", () => {
    const s = setup({ song: chain(3) });
    s.sampler.togglePlayAll();
    s.sampler.toggleRec();
    s.sampler.start();
    tick(s, 39); // 1.95 s: switched at 1.85 s, and the playhead is on step 15
    expect(s.sampler.getState()).toMatchObject({ sequence: 1, heard: { sequence: 0 } });
    s.sampler.triggerPad(3);
    expect(s.sampler.getSong().sequences[0].pattern[3]).toEqual([15]);
    expect(s.sampler.getSong().sequences[1].pattern[3]).toBeUndefined();
  });

  it("keeps the place of what sounds on the display inside the sequences there are, when one is removed in the moment after a switch", () => {
    const s = setup({ song: chain(3), maxSequences: 6 });
    s.sampler.togglePlayAll();
    s.sampler.start();
    tick(s, 118); // 5.9 s: the third sequence sounds until 6.05 s, and the chain has picked the first
    expect(s.sampler.getState()).toMatchObject({ sequence: 0, heard: { sequence: 2 }, sequenceCount: 3 });
    s.sampler.removeSequence();
    const state = s.sampler.getState();
    expect(state.sequenceCount).toBe(2);
    expect(state.heard.sequence).toBeLessThan(state.sequenceCount);
  });

  describe("what sounds, for the display, in the moment after a switch", () => {
    // The first sequence has steps 0 and 5 of pad 0, the second step 2 (and the pad selected is pad 0): the display's ruler is of the
    // one that sounds until the new pass does, as are its label and its playhead; the step keys are of the one showing.
    const steppy = (bars = [1, 1]) => {
      const song = songOf(2);
      song.sequences[0] = { bars: bars[0], pattern: { 0: [0, 5] }, velocities: {} };
      song.sequences[1] = { bars: bars[1], pattern: { 0: [2] }, velocities: {} };
      return song;
    };
    const lit = (row) => row.map((value, i) => (value ? i : -1)).filter((i) => i >= 0);

    it("gives the display's ruler the steps of the sequence that sounds, and the keys those of the one showing", () => {
      const s = setup({ song: steppy() });
      s.sampler.start();
      run(s, 0.3);
      s.sampler.queueSequence(1);
      run(s, 1.65); // 1.95 s: switched at 1.85 s, and the playhead is on step 15 of the first
      const state = s.sampler.getState();
      expect(lit(state.heard.stepsOn)).toEqual([0, 5]);
      expect(lit(state.stepsOn)).toEqual([2]);
      expect(state.heard).toMatchObject({ sequence: 0, bars: 1, page: 0, playheadStep: 15 });
      run(s, 0.15); // 2.1 s: the new pass sounds
      expect(lit(s.sampler.getState().heard.stepsOn)).toEqual([2]);
    });

    it("gives the bar of the sequence that sounds that the person was looking at, and the playhead in it", () => {
      const song = songOf(2);
      song.sequences[0] = { bars: 2, pattern: { 0: [16, 20] }, velocities: {} }; // the second bar's steps 0 and 4
      song.sequences[1] = { bars: 1, pattern: { 0: [2] }, velocities: {} };
      const s = setup({ song });
      s.sampler.start();
      s.sampler.setPage(1);
      run(s, 0.3);
      s.sampler.queueSequence(1);
      run(s, 3.6); // 3.9 s: switched at 3.85 s; the playhead is on step 30 of 32, the 15th of the second bar
      const heard = s.sampler.getState().heard;
      expect(heard).toMatchObject({ sequence: 0, bars: 2, page: 1, playheadStep: 14 });
      expect(lit(heard.stepsOn)).toEqual([0, 4]);
      expect(s.sampler.getState().page).toBe(0); // the keys are of the sequence showing, from its first bar
    });

    it("is the sequence showing, its bar and its playhead when nothing is taking over", () => {
      const stopped = setup({ song: steppy() });
      stopped.sampler.start();
      run(stopped, 0.3);
      stopped.sampler.queueSequence(1);
      run(stopped, 1.65); // 1.95 s: switched, with the old pass's last steps still to sound
      stopped.sampler.stop(); // and stopped there: the display is of the sequence showing, from then on
      expect(stopped.sampler.getState().heard).toMatchObject({ sequence: 1, playheadStep: -1 });

      const s = setup({ song: steppy() });
      s.sampler.start();
      run(s, 0.5);
      const state = s.sampler.getState();
      expect(state.heard).toEqual({
        sequence: state.sequence,
        bars: state.bars,
        page: state.page,
        stepsOn: state.stepsOn,
        playheadStep: state.playheadStep,
      });
    });
  });

  it("has nothing left sounding on the display when it is stopped in the moment after a chain switch", () => {
    const s = setup({ song: chain(3) });
    s.sampler.togglePlayAll();
    s.sampler.start();
    tick(s, 39); // 1.95 s: the chain has picked the second sequence, and the display is still on the first
    expect(s.sampler.getState()).toMatchObject({ sequence: 1, heard: { sequence: 0 } });
    s.sampler.stop();
    expect(s.sampler.getState()).toMatchObject({
      playing: false,
      sequence: 1,
      heard: { sequence: 1 },
      playheadStep: -1,
    });
    run(s, 0.5); // and it stays so: nothing is waiting to clear it
    expect(s.sampler.getState().heard.sequence).toBe(1);
  });

  it("shows what sounds on the display for the last steps of every pass, in that sequence's numbering", () => {
    const s = setup({ song: chain(3, { bars: [4, 1, 1] }) });
    s.sampler.togglePlayAll();
    s.sampler.start();
    tick(s, 78); // 3.9 s: the pass of 64 steps ends at 8.05 s
    expect(s.sampler.getState()).toMatchObject({ sequence: 0, heard: { sequence: 0, bars: 4 } });
    tick(s, 80); // 7.9 s: the chain has picked 2 (at about 7.85 s), and the playhead is on step 62 of the first
    expect(s.sampler.getState()).toMatchObject({
      sequence: 1,
      heard: { sequence: 0, bars: 4 },
      playheadPosition: 62,
    });
    tick(s, 6); // 8.2 s
    expect(s.sampler.getState()).toMatchObject({
      sequence: 1,
      heard: { sequence: 1, bars: 1 },
      playheadPosition: 1,
    });
  });

  describe("a sequence picked while it plays", () => {
    // 120 BPM, the first sequence four bars: at 1.9 s the scheduler's next step is 16, which is where a loop of one bar ends.
    const atStepSixteen = (extra = {}) => {
      const s = setup({ song: chain(3, { bars: [4, 1, 1] }), maxSequences: 6, ...extra });
      s.sampler.togglePlayAll();
      s.sampler.start();
      tick(s, 38);
      s.message.mockClear();
      return s;
    };
    const saidSequence = (s) => s.message.mock.calls.map(([text]) => text).filter((text) => text.startsWith("SEQ"));

    it("is the one showing, and what the chain does from it is at the pass end, not in the call", () => {
      const s = atStepSixteen();
      s.sampler.setSequence(1);
      expect(s.sampler.getState().sequence).toBe(1);
      expect(saidSequence(s)).toEqual(["SEQ 02"]);
      // The position carries over, as it always does: the picked sequence is on its last step, and the pass ends at 2.05 s.
      run(s, 0.4); // 2.3 s
      expect(s.sampler.getState().sequence).toBe(2);
      expect(timesOf(s, 2)).toEqual(closeTo(2.05));
      expect(saidSequence(s)).toEqual(["SEQ 02"]); // and the chain said nothing
    });

    it("stays added when a sequence is added then", () => {
      const s = atStepSixteen();
      s.sampler.addSequence();
      expect(s.sampler.getState()).toMatchObject({ sequence: 3, sequenceCount: 4 });
      expect(saidSequence(s)).toEqual(["SEQ 04 ADDED"]);
    });

    it("stays on the sequence that takes the place of one removed then", () => {
      const s = atStepSixteen();
      s.sampler.removeSequence();
      expect(s.sampler.getState()).toMatchObject({ sequence: 0, sequenceCount: 2 });
      expect(saidSequence(s)).toEqual(["SEQ 01 REMOVED"]);
    });

    it("still goes on to the next sequence when the loop is made shorter so that it ends where the scheduler is", () => {
      const s = atStepSixteen();
      s.sampler.setBars(1); // that is a pass end, where the chain goes on
      expect(s.sampler.getState().sequence).toBe(1);
    });
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
    const queued = busOf(sounds[0].play.mock.calls[0][1]);
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

describe("a pad plays one voice at a time", () => {
  const voiceOf = (sound, call) => sound.play.mock.calls[call][1]; // the node a hit plays into, at full velocity

  it("cuts off the pad's last hit when it is tapped again, from the moment of the new hit", () => {
    const { audio, sounds, sampler } = setup();
    audio.ctx.currentTime = 1;
    sampler.triggerPad(2);
    audio.ctx.currentTime = 1.4;
    sampler.triggerPad(2);
    expect(voiceOf(sounds[2], 0).gain.setTargetAtTime).toHaveBeenCalledWith(0, 1.4, expect.any(Number));
    expect(voiceOf(sounds[2], 1).gain.setTargetAtTime).not.toHaveBeenCalled();
  });

  it("leaves other pads playing", () => {
    const { sounds, sampler } = setup();
    sampler.triggerPad(0);
    sampler.triggerPad(1);
    expect(voiceOf(sounds[0], 0).gain.setTargetAtTime).not.toHaveBeenCalled();
  });

  it("cuts off the pad's last hit in the sequence when the next step on that pad starts", () => {
    const { sounds, sampler, advance } = setup({ song: savedSong({ bpm: 120, pattern: { 0: [0, 1] } }) });
    sampler.start();
    for (let i = 0; i < 4; i++) advance(0.05);
    expect(sounds[0].play).toHaveBeenCalledTimes(2);
    const [, , secondTime] = sounds[0].play.mock.calls[1];
    expect(voiceOf(sounds[0], 0).gain.setTargetAtTime).toHaveBeenCalledWith(0, secondTime, expect.any(Number));
  });

  it("cuts off a sequenced hit that is still sounding when the pad is tapped", () => {
    const { audio, sounds, sampler, advance } = setup({ song: savedSong({ bpm: 120, pattern: { 0: [0] } }) });
    sampler.start();
    for (let i = 0; i < 4; i++) advance(0.05);
    const stepVoice = voiceOf(sounds[0], 0);
    sampler.triggerPad(0);
    expect(stepVoice.gain.setTargetAtTime).toHaveBeenCalledWith(0, audio.ctx.currentTime, expect.any(Number));
  });

  it("lets the earlier hit carry on when the step that was going to cut it off is cancelled by Stop", () => {
    const { sounds, sampler, advance } = setup({ song: savedSong({ bpm: 120, pattern: { 0: [0, 3] } }) });
    sampler.start();
    for (let i = 0; i < 7; i++) advance(0.05); // step 0 has started; step 3 (at 0.425 s) is queued
    expect(sounds[0].play).toHaveBeenCalledTimes(2);
    const first = voiceOf(sounds[0], 0);
    expect(first.gain.setTargetAtTime).toHaveBeenCalledTimes(1); // it was going to be cut off by the queued step
    sampler.stop();
    expect(first.gain.cancelScheduledValues).toHaveBeenLastCalledWith(0); // and now it is not: the cut is taken back
    expect(first.gain.setTargetAtTime).toHaveBeenCalledTimes(1); // and not set again
  });

  it("keeps a pad cut off by a live tap when the queued step that also cut it is cancelled", () => {
    const { audio, sounds, sampler, advance } = setup({ song: savedSong({ bpm: 120, pattern: { 0: [0, 3] } }) });
    sampler.start();
    for (let i = 0; i < 7; i++) advance(0.05); // step 0 sounds; step 3 (at 0.425 s) is queued and will cut it
    const first = voiceOf(sounds[0], 0);
    audio.ctx.currentTime = 0.36;
    sampler.triggerPad(0); // a tap before that
    sampler.stop();
    // the queued step is gone, but the tap still cuts the long hit, from its own moment
    expect(first.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.36, expect.any(Number));
  });

  it("does the same when the queued step is rebuilt because the sequence was switched", () => {
    const base = savedSong({ bpm: 120, pattern: { 0: [0, 3] } });
    const song = { ...base, sequences: [base.sequences[0], { bars: 1, pattern: {} }, ...base.sequences.slice(2)] };
    const { sounds, sampler, advance } = setup({ song });
    sampler.start();
    for (let i = 0; i < 7; i++) advance(0.05);
    const first = voiceOf(sounds[0], 0);
    sampler.setSequence(1);
    expect(first.gain.cancelScheduledValues).toHaveBeenLastCalledWith(0);
    expect(first.gain.setTargetAtTime).toHaveBeenCalledTimes(1);
  });
});

describe("a pad's release", () => {
  // Pads that play loaded samples (they have setTrim), so the envelope applies.
  const samplePads = () =>
    Array.from({ length: PADS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, play: vi.fn(), setTrim() {} }));

  it("is how long a hit on the same pad takes to cut the last one off", () => {
    const sounds = samplePads();
    const audio = fakeAudio();
    const sampler = createSampler({ audio, kit: createKit(sounds), steps: STEPS });
    sampler.setPadSetting("release", 100); // 5 s
    audio.ctx.currentTime = 1;
    sampler.triggerPad(0);
    audio.ctx.currentTime = 2;
    sampler.triggerPad(0);
    const [, , , options] = sounds[0].play.mock.calls[0];
    expect(options.envelope.release).toBe(5);
    const firstVoice = audio.ctx.createGain.mock.results[0].value; // the first hit's voice
    expect(firstVoice.gain.setTargetAtTime).toHaveBeenCalledWith(0, 2, 5 / 7); // 5 s over seven time constants
  });

  it("is not used for a pad that plays a built-in sound: it keeps the short fade", () => {
    const { audio, sounds, sampler } = setup();
    sampler.setPadSetting("release", 100);
    audio.ctx.currentTime = 1;
    sampler.triggerPad(0);
    audio.ctx.currentTime = 2;
    sampler.triggerPad(0);
    expect(sounds[0].play.mock.calls[0]).toHaveLength(3); // no options: nothing for a built-in sound to do with them
    const firstVoice = audio.ctx.createGain.mock.results[0].value;
    expect(firstVoice.gain.setTargetAtTime).toHaveBeenCalledWith(0, 2, 0.004);
  });

  it("sets like the other settings: the LCD says the time", () => {
    const { sampler, message } = setup();
    sampler.setPadSetting("attack", 50);
    expect(message).toHaveBeenLastCalledWith("PAD 01 ATTACK 250 MS");
    sampler.setPadSetting("sustain", 40);
    expect(message).toHaveBeenLastCalledWith("PAD 01 SUSTAIN 40 %");
  });
});

describe("pad colours", () => {
  it("sets a pad's colour like the other settings: says so, saves it, and tells the views", () => {
    const { sampler, message, songChange, change } = setup();
    sampler.selectPad(1);
    songChange.mockClear();
    change.mockClear();
    sampler.setPadSetting("color", 3);
    expect(message).toHaveBeenLastCalledWith("PAD 02 COLOR BLUE");
    expect(sampler.getState().padSettings.color).toBe(3);
    expect(sampler.getSong().padSettings).toEqual({
      1: { gain: 0, pitch: 0, choke: 0, color: 3, attack: 0, decay: 0, sustain: 100, release: 0 },
    });
    expect(songChange).toHaveBeenCalled();
    expect(change).toHaveBeenCalled();
    sampler.setPadSetting("color", 0);
    expect(message).toHaveBeenLastCalledWith("PAD 02 COLOR NONE");
    expect(sampler.getSong().padSettings).toEqual({});
  });

  it("has no effect on how a pad plays: the same call, to the same kind of node, at the same time", () => {
    const plain = setup();
    plain.audio.ctx.currentTime = 1;
    plain.sampler.triggerPad(0, 0.5);
    const coloured = setup();
    coloured.sampler.setPadSetting("color", 3);
    coloured.audio.ctx.currentTime = 1;
    coloured.sampler.triggerPad(0, 0.5);
    const [, plainOut, plainTime, ...plainRest] = plain.sounds[0].play.mock.calls[0];
    const [, colouredOut, colouredTime, ...colouredRest] = coloured.sounds[0].play.mock.calls[0];
    expect(colouredTime).toBe(plainTime);
    expect(colouredRest).toEqual(plainRest);
    expect(colouredOut.gain.value).toBe(plainOut.gain.value);
    expect(coloured.audio.ctx.createGain).toHaveBeenCalledTimes(plain.audio.ctx.createGain.mock.calls.length);
  });
});

describe("choke groups", () => {
  const voiceOf = (sound, call) => sound.play.mock.calls[call][1];

  it("sets a pad's group like gain and pitch: says so, saves it, and tells the views", () => {
    const { sampler, message, songChange, change } = setup();
    sampler.selectPad(2);
    songChange.mockClear();
    change.mockClear();
    sampler.setPadSetting("choke", 3);
    expect(message).toHaveBeenLastCalledWith("PAD 03 CHOKE GROUP 3");
    expect(sampler.getState().padSettings.choke).toBe(3);
    expect(sampler.getSong().padSettings).toEqual({
      2: { gain: 0, pitch: 0, choke: 3, color: 0, attack: 0, decay: 0, sustain: 100, release: 0 },
    });
    expect(songChange).toHaveBeenCalled();
    expect(change).toHaveBeenCalled();
    sampler.setPadSetting("choke", 0);
    expect(message).toHaveBeenLastCalledWith("PAD 03 CHOKE OFF");
  });

  it("cuts a live hit on another pad in the same group, and leaves a pad in another group", () => {
    const { audio, sounds, sampler } = setup();
    for (const [pad, group] of [
      [0, 1],
      [1, 1],
      [2, 2],
    ]) {
      sampler.selectPad(pad);
      sampler.setPadSetting("choke", group);
    }
    audio.ctx.currentTime = 1;
    sampler.triggerPad(2); // group 2
    sampler.triggerPad(0); // group 1
    audio.ctx.currentTime = 1.5;
    sampler.triggerPad(1); // group 1: cuts pad 0
    expect(voiceOf(sounds[0], 0).gain.setTargetAtTime).toHaveBeenCalledWith(0, 1.5, expect.any(Number));
    expect(voiceOf(sounds[2], 0).gain.setTargetAtTime).not.toHaveBeenCalled();
  });

  it("cuts a sequenced hit of another pad in the group when this pad's step starts", () => {
    const { sounds, sampler, advance } = setup({ song: savedSong({ bpm: 120, pattern: { 0: [0], 1: [4] } }) });
    for (const pad of [0, 1]) {
      sampler.selectPad(pad);
      sampler.setPadSetting("choke", 1);
    }
    sampler.start();
    for (let i = 0; i < 10; i++) advance(0.05); // pad 1's step 4 is at 0.55 s, queued within the lookahead
    const [, , cutTime] = sounds[1].play.mock.calls[0];
    expect(voiceOf(sounds[0], 0).gain.setTargetAtTime).toHaveBeenCalledWith(0, cutTime, expect.any(Number));
  });

  it("lets another pad's voice carry on when the step that was going to cut it is cancelled by Stop", () => {
    const { sounds, sampler, advance } = setup({ song: savedSong({ bpm: 120, pattern: { 0: [0], 1: [3] } }) });
    for (const pad of [0, 1]) {
      sampler.selectPad(pad);
      sampler.setPadSetting("choke", 1);
    }
    sampler.start();
    for (let i = 0; i < 7; i++) advance(0.05); // pad 0's step 0 sounds; pad 1's step 3 (0.425 s) is queued, and will cut it
    const first = voiceOf(sounds[0], 0);
    expect(first.gain.setTargetAtTime).toHaveBeenCalledTimes(1);
    sampler.stop();
    expect(first.gain.cancelScheduledValues).toHaveBeenLastCalledWith(0);
    expect(first.gain.setTargetAtTime).toHaveBeenCalledTimes(1); // and not cut again
  });

  it("does not cut pads in no group", () => {
    const { sounds, sampler, audio } = setup();
    audio.ctx.currentTime = 1;
    sampler.triggerPad(0);
    sampler.triggerPad(1);
    expect(voiceOf(sounds[0], 0).gain.setTargetAtTime).not.toHaveBeenCalled();
  });
});

describe("Stop pressed again", () => {
  it("stops the sequence the first time, and leaves what is sounding to ring out", () => {
    const { audio, sampler, message } = setup();
    sampler.start();
    sampler.stop();
    expect(sampler.getState().playing).toBe(false);
    expect(audio.killSound).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalledWith("ALL SOUND OFF");
  });

  it("cuts off all sound when it is pressed while already stopped, and says so", () => {
    const { audio, sampler, message } = setup();
    sampler.start();
    sampler.stop();
    sampler.stop();
    expect(audio.killSound).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenLastCalledWith("ALL SOUND OFF");
    sampler.stop();
    expect(audio.killSound).toHaveBeenCalledTimes(2); // and every press after it
  });

  it("does so from a fresh page too, where Stop has nothing to stop but a pad may still be ringing", () => {
    const { audio, sampler } = setup();
    sampler.stop();
    expect(audio.killSound).toHaveBeenCalledTimes(1);
  });

  it("says nothing when there was no sound to cut off, as on a fresh page before the audio exists", () => {
    const { audio, sampler, message } = setup();
    audio.killSound.mockReturnValue(false);
    sampler.stop();
    expect(message).not.toHaveBeenCalledWith("ALL SOUND OFF");
  });

  it("is not triggered by Play, which restarts the sequence without a Stop", () => {
    const { audio, sampler } = setup();
    sampler.start();
    sampler.start();
    expect(audio.killSound).not.toHaveBeenCalled();
  });

  it("still reports a change, so the display follows", () => {
    const { sampler, change } = setup();
    change.mockClear();
    sampler.stop();
    expect(change).toHaveBeenCalledTimes(1);
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
    const bus = busOf(sounds[0].play.mock.calls[0][1]); // each step plays through a gain of its own, into the master
    expect(sounds[0].play).toHaveBeenCalledWith(audio.ctx, expect.anything(), expect.closeTo(0.05));
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
    const bus = busOf(quiet); // the stage feeds the pad's voice, which feeds the step's own gain, which feeds the master
    expect(bus.connect).toHaveBeenCalledWith(audio.master);
    expect(sounds[1].play.mock.calls[0][1].connect).toHaveBeenCalledWith(bus); // a step left at full velocity plays straight into its pad's voice
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

  it("turns a step on as it gives it a velocity when asked to, as one undo", () => {
    const { sampler } = setup({ song: savedSong({ pattern: { 0: [2] } }) });
    sampler.selectPad(0);
    sampler.setStepVelocity(3, 40, { activate: true });
    expect(sampler.getState().stepsOn[3]).toBe(true);
    expect(sampler.getState().stepVelocities[3]).toBe(40);
    sampler.setStepVelocity(3, 90, { activate: true }); // already on: just the velocity
    expect(sampler.getState().stepVelocities[3]).toBe(90);
    sampler.undo();
    expect(sampler.getState().stepsOn[3]).toBe(false); // the turning on and the velocity went together
    expect(sampler.getState().stepsOn[2]).toBe(true);
  });

  it("keeps each press that turns a step on as an undo of its own, and merges the drag after it", () => {
    const { sampler } = setup({ song: savedSong({ pattern: { 0: [0] } }) });
    sampler.selectPad(0);
    sampler.setStepVelocity(3, 40, { activate: true });
    sampler.setStepVelocity(3, 60); // the drag carries on over the same step: the same undo
    sampler.setStepVelocity(7, 50, { activate: true }); // a new press, right after: its own undo
    sampler.undo();
    expect(sampler.getState().stepsOn[7]).toBe(false);
    expect(sampler.getState().stepsOn[3]).toBe(true);
    expect(sampler.getState().stepVelocities[3]).toBe(60);
    sampler.undo();
    expect(sampler.getState().stepsOn[3]).toBe(false);
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

describe("swing", () => {
  it("starts straight, or where the saved song had it", () => {
    expect(setup().sampler.getState().swing).toBe(50);
    expect(setup({ song: savedSong({ swing: 60 }) }).sampler.getState().swing).toBe(60);
  });

  it("is kept inside its range, says so, and asks for a save", () => {
    const { sampler, message, change, songChange } = setup();
    sampler.setSwing(200);
    expect(sampler.getState().swing).toBe(75);
    expect(message).toHaveBeenLastCalledWith("SWING 75%");
    expect(change).toHaveBeenCalledTimes(1);
    expect(songChange).toHaveBeenCalledTimes(1);
    expect(sampler.getSong().swing).toBe(75);
  });

  it("says it is off when it is straight again", () => {
    const { sampler, message } = setup();
    sampler.setSwing(60);
    sampler.setSwing(50);
    expect(message).toHaveBeenLastCalledWith("SWING OFF");
  });

  it("plays the second step of each pair later", () => {
    const { sampler, sounds, advance } = setup({
      bpm: 120,
      song: savedSong({ bpm: 120, swing: 66, pattern: { 0: [0, 1] } }),
    });
    sampler.start();
    for (let i = 0; i < 20; i++) advance(0.025); // as the clock moves when nothing stalls
    const [first, second] = sounds[0].play.mock.calls.map((call) => call[2]);
    // A step is 0.125 s at 120 BPM; the second of the pair is 0.04 s after its place on the grid.
    expect(second - first).toBeCloseTo(0.165);
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

describe("the arrangement", () => {
  const entry = (sequence, repeats = 1) => ({ sequence, repeats });
  const withArrangement = (count, arrangement) => ({ ...songOf(count), arrangement });
  const arrangementOf = (sampler) => sampler.getSong().arrangement;

  it("is not in the song while there is none, and adding, copying and removing sequences do not make one", () => {
    const { sampler } = setup({ song: songOf(3), maxSequences: 6 });
    expect(sampler.getSong()).not.toHaveProperty("arrangement");
    sampler.addSequence();
    sampler.copySequence();
    expect(sampler.getSong()).not.toHaveProperty("arrangement");
    sampler.removeSequence();
    sampler.removeSequence();
    expect(sampler.getSong().sequences).toHaveLength(3);
    expect(sampler.getSong()).not.toHaveProperty("arrangement");
  });

  it("is kept as the song had it, in its order and with its repeats", () => {
    const arrangement = [entry(2, 3), entry(0), entry(2, 16)];
    const { sampler } = setup({ song: withArrangement(3, arrangement) });
    expect(arrangementOf(sampler)).toEqual(arrangement);
  });

  it("is handed back as a copy, so what the page does with it cannot change the sampler's", () => {
    const { sampler } = setup({ song: withArrangement(3, [entry(1, 2)]) });
    arrangementOf(sampler)[0].repeats = 9;
    arrangementOf(sampler).push(entry(0));
    expect(arrangementOf(sampler)).toEqual([entry(1, 2)]);
  });

  it("is not changed by what was in the song it was given: it is the sampler's own", () => {
    const given = withArrangement(3, [entry(1, 2)]);
    const { sampler } = setup({ song: given });
    given.arrangement[0].repeats = 9;
    expect(arrangementOf(sampler)).toEqual([entry(1, 2)]);
  });

  it("is cleaned on the way in: an entry for a sequence the song does not have is dropped", () => {
    const { sampler } = setup({ song: withArrangement(3, [entry(0), entry(3, 2), entry(2)]) });
    expect(arrangementOf(sampler)).toEqual([entry(0), entry(2)]);
  });

  it("is no arrangement when nothing in it names a sequence the song has", () => {
    const { sampler } = setup({ song: withArrangement(3, [entry(5), entry(7, 2)]) });
    expect(sampler.getSong()).not.toHaveProperty("arrangement");
  });

  describe("when a sequence is added or copied", () => {
    it("gets an entry for it at the end, with one repeat", () => {
      const { sampler } = setup({ song: withArrangement(3, [entry(2, 4), entry(0)]), maxSequences: 6 });
      sampler.addSequence();
      expect(arrangementOf(sampler)).toEqual([entry(2, 4), entry(0), entry(3)]);
    });

    it("gets an entry for the copy, and none for the sequence that was copied", () => {
      const { sampler } = setup({ song: withArrangement(3, [entry(2, 4), entry(0)]), maxSequences: 6 });
      sampler.setSequence(1);
      sampler.copySequence();
      expect(arrangementOf(sampler)).toEqual([entry(2, 4), entry(0), entry(3)]);
    });

    it("gets none when there are as many entries as there can be: the sequence is made, and is not in the song", () => {
      const full = Array.from({ length: 32 }, (_, i) => entry(i % 3));
      const { sampler } = setup({ song: withArrangement(3, full), maxSequences: 6 });
      sampler.addSequence();
      expect(sampler.getSong().sequences).toHaveLength(4);
      expect(arrangementOf(sampler)).toEqual(full);
    });

    it("gets none when the sequence is not made because there are as many as there can be", () => {
      const { sampler } = setup({ song: withArrangement(3, [entry(1)]), maxSequences: 3 });
      sampler.addSequence();
      sampler.copySequence();
      expect(arrangementOf(sampler)).toEqual([entry(1)]);
    });

    it("asks for a save, as adding or copying a sequence always does, for the entry as much as for the sequence", () => {
      const { sampler, songChange } = setup({ song: withArrangement(3, [entry(1)]), maxSequences: 6 });
      sampler.addSequence();
      expect(songChange).toHaveBeenCalledTimes(1);
      sampler.copySequence();
      expect(songChange).toHaveBeenCalledTimes(2);
    });
  });

  describe("when a sequence is removed", () => {
    it("loses the entries that named it, and the ones for the sequences after it move down", () => {
      const { sampler } = setup({
        song: withArrangement(4, [entry(0, 2), entry(1, 3), entry(0), entry(3, 4), entry(2)]),
        maxSequences: 6,
      });
      sampler.setSequence(1);
      sampler.removeSequence();
      expect(sampler.getSong().sequences).toHaveLength(3);
      expect(arrangementOf(sampler)).toEqual([entry(0, 2), entry(0), entry(2, 4), entry(1)]);
    });

    it("removes the sequence that is showing: the last one too, with nothing after it to move", () => {
      const { sampler } = setup({ song: withArrangement(3, [entry(2, 5), entry(0), entry(1)]), maxSequences: 6 });
      sampler.setSequence(2);
      sampler.removeSequence();
      expect(arrangementOf(sampler)).toEqual([entry(0), entry(1)]);
    });

    it("asks for a save, as removing a sequence always does", () => {
      const { sampler, songChange } = setup({ song: withArrangement(3, [entry(1), entry(2)]), maxSequences: 6 });
      sampler.removeSequence();
      expect(songChange).toHaveBeenCalledTimes(1);
    });

    it("is no arrangement when the sequence removed was all there was in it", () => {
      const { sampler } = setup({ song: withArrangement(3, [entry(1, 4), entry(1)]), maxSequences: 6 });
      sampler.setSequence(1);
      sampler.removeSequence();
      expect(sampler.getSong().sequences).toHaveLength(2);
      expect(sampler.getSong()).not.toHaveProperty("arrangement");
    });

    it("is left as it was when the last sequence cannot be removed", () => {
      const { sampler } = setup({ song: withArrangement(1, [entry(0, 3)]) });
      sampler.removeSequence();
      expect(arrangementOf(sampler)).toEqual([entry(0, 3)]);
    });

    it("follows a sequence added after one was removed: the new one has the number the removed one left free", () => {
      const { sampler } = setup({ song: withArrangement(3, [entry(0), entry(1), entry(2)]), maxSequences: 6 });
      sampler.setSequence(0);
      sampler.removeSequence(); // sequences 0 and 1 are what were 1 and 2
      sampler.addSequence();
      expect(arrangementOf(sampler)).toEqual([entry(0), entry(1), entry(2)]);
    });
  });
});

describe("Play All with an arrangement", () => {
  // 120 BPM: a pass of one bar is 2 s, its first step at 0.05 s, so the passes begin at 0.05, 2.05, 4.05 s and so on. Sequence i has a
  // step 0 on pad i, to tell which one is sounding, and `arrangement` is the order and the repeats the chain goes in.
  const entry = (sequence, repeats = 1) => ({ sequence, repeats });
  const songWith = (count, arrangement, { bars = [] } = {}) => {
    const base = songOf(count, { bpm: 120 });
    for (let i = 0; i < count; i++) base.sequences[i] = { bars: bars[i] ?? 1, pattern: { [i]: [0] }, velocities: {} };
    return arrangement ? { ...base, arrangement } : base;
  };
  const tick = (s, count) => {
    for (let i = 0; i < count; i++) {
      s.advance(0.05);
      s.sampler.poll();
    }
  };
  const run = (s, seconds) => tick(s, Math.round(seconds / 0.05));
  const timesOf = (s, pad) => s.sounds[pad].play.mock.calls.map((call) => call[2]);
  const closeTo = (...times) => times.map((time) => expect.closeTo(time, 2));
  const playAll = (s) => {
    s.sampler.togglePlayAll();
    s.sampler.start();
  };

  it("plays each entry as many times as it repeats before it goes on, round and round", () => {
    const s = setup({ song: songWith(3, [entry(0, 2), entry(1), entry(2, 3)]) });
    playAll(s);
    run(s, 15.2); // the passes begin every 2 s from 0.05 s: two of the first, one of the second, three of the third, then again
    expect(timesOf(s, 0)).toEqual(closeTo(0.05, 2.05, 12.05, 14.05));
    expect(timesOf(s, 1)).toEqual(closeTo(4.05));
    expect(timesOf(s, 2)).toEqual(closeTo(6.05, 8.05, 10.05));
  });

  it("goes in the order of the entries, not the order of the sequences", () => {
    const s = setup({ song: songWith(3, [entry(0), entry(2), entry(1)]) });
    playAll(s);
    run(s, 6.2);
    expect(timesOf(s, 0)).toEqual(closeTo(0.05, 6.05));
    expect(timesOf(s, 2)).toEqual(closeTo(2.05));
    expect(timesOf(s, 1)).toEqual(closeTo(4.05));
  });

  it("begins with the sequence showing, at the first entry that names it, and goes on from there", () => {
    const s = setup({ song: songWith(3, [entry(0), entry(1, 2), entry(2)]) });
    s.sampler.setSequence(1);
    playAll(s);
    run(s, 11.2);
    expect(timesOf(s, 1)).toEqual(closeTo(0.05, 2.05, 8.05, 10.05));
    expect(timesOf(s, 2)).toEqual(closeTo(4.05));
    expect(timesOf(s, 0)).toEqual(closeTo(6.05));
  });

  it("tells two entries for one sequence apart: it is the entry it has gone on to, not the first that names it", () => {
    const s = setup({ song: songWith(2, [entry(0), entry(1), entry(0, 2)]) });
    playAll(s);
    run(s, 11.2); // the passes: 0, 1, 0, 0 (the third entry twice), 0 (the first entry again), 1
    expect(timesOf(s, 0)).toEqual(closeTo(0.05, 4.05, 6.05, 8.05));
    expect(timesOf(s, 1)).toEqual(closeTo(2.05, 10.05));
  });

  it("goes round in the length of each sequence, repeats included", () => {
    const s = setup({ song: songWith(2, [entry(0, 2), entry(1)], { bars: [2, 1] }) });
    playAll(s);
    run(s, 15.2); // two passes of 4 s, one of 2 s, and round
    expect(timesOf(s, 0)).toEqual(closeTo(0.05, 4.05, 10.05, 14.05));
    expect(timesOf(s, 1)).toEqual(closeTo(8.05));
  });

  it("is the same as it was when there is no arrangement: every sequence once, in order", () => {
    const plain = setup({ song: songWith(3, null) });
    const explicit = setup({ song: songWith(3, [entry(0), entry(1), entry(2)]) });
    for (const s of [plain, explicit]) {
      playAll(s);
      run(s, 8.2);
    }
    for (const pad of [0, 1, 2]) expect(timesOf(explicit, pad)).toEqual(timesOf(plain, pad));
  });

  it("says nothing and saves nothing for a repeat, and the sequence showing stays", () => {
    const s = setup({ song: songWith(2, [entry(0, 3), entry(1)]) });
    playAll(s);
    run(s, 0.5);
    s.message.mockClear();
    s.songChange.mockClear();
    s.change.mockClear();
    run(s, 3.6); // 4.1 s: the second pass has begun, and the third at 4.05 s
    expect(s.sampler.getState().sequence).toBe(0);
    expect(s.message).not.toHaveBeenCalled();
    expect(s.songChange).not.toHaveBeenCalled();
    expect(s.change).not.toHaveBeenCalled(); // nothing took over, so nothing on the page is out of date
  });

  describe("a queued sequence", () => {
    it("goes first, and the song goes on from the first entry that names it, with its repeats", () => {
      const s = setup({ song: songWith(3, [entry(0, 2), entry(1, 2), entry(2)]) });
      playAll(s);
      run(s, 0.3);
      s.sampler.queueSequence(1);
      run(s, 9.0); // 9.3 s
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 8.05)); // the first pass; then the queued one, its second repeat, the third entry, and round
      expect(timesOf(s, 1)).toEqual(closeTo(2.05, 4.05));
      expect(timesOf(s, 2)).toEqual(closeTo(6.05));
    });

    it("plays once, and the song begins again at its first entry, when no entry names it", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1)]), maxSequences: 6 });
      playAll(s);
      run(s, 0.3);
      s.sampler.queueSequence(2);
      run(s, 7.0); // 7.3 s
      expect(timesOf(s, 2)).toEqual(closeTo(2.05)); // once
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 4.05));
      expect(timesOf(s, 1)).toEqual(closeTo(6.05));
    });

    it("takes over late, just ahead of a downbeat, and the song goes on from it all the same", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1, 2), entry(2)]) });
      playAll(s);
      tick(s, 38); // 1.9 s: the pass has ended in the scheduler, and the chain has picked the second sequence for it
      s.sampler.queueSequence(2); // a person asks for the third in that moment, and it takes over there instead
      run(s, 6.3); // 8.2 s: the third sequence at 2.05 s, then the song goes on from its entry: the first, then the second twice
      expect(timesOf(s, 2)).toEqual(closeTo(2.05));
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 4.05));
      expect(timesOf(s, 1)).toEqual(closeTo(6.05, 8.05));
    });
  });

  it("goes on from the first entry that names a queued sequence, wherever it is in the list", () => {
    const s = setup({ song: songWith(3, [entry(2), entry(1), entry(2)]) });
    s.sampler.setSequence(1);
    playAll(s);
    run(s, 0.3);
    s.sampler.queueSequence(2); // the third sequence is named first by the first entry, not by the third
    run(s, 9.9); // 10.2 s
    expect(timesOf(s, 1)).toEqual(closeTo(0.05, 4.05, 10.05));
    expect(timesOf(s, 2)).toEqual(closeTo(2.05, 6.05, 8.05));
  });

  it("goes on from the first entry that names a sequence a person has picked, with its repeats", () => {
    const s = setup({ song: songWith(3, [entry(0), entry(1, 2), entry(2)]) });
    playAll(s);
    run(s, 0.5);
    s.sampler.setSequence(1); // now: the loop carries on in it, and the song goes on from where it is at the end of the pass
    run(s, 6.0); // 6.5 s
    expect(timesOf(s, 1)).toEqual(closeTo(2.05)); // the second repeat of that entry
    expect(timesOf(s, 2)).toEqual(closeTo(4.05));
    expect(timesOf(s, 0)).toEqual(closeTo(0.05, 6.05));
  });

  it("begins at the sequence showing again when Play is pressed again, and counts its repeats from the first", () => {
    const s = setup({ song: songWith(3, [entry(0), entry(1, 3), entry(2)]) });
    s.sampler.setSequence(1);
    playAll(s);
    run(s, 4.2); // 4.05 s: the third pass of the entry has begun
    const restart = s.audio.ctx.currentTime;
    s.sampler.start();
    run(s, 6.5);
    expect(timesOf(s, 1).slice(3)).toEqual(closeTo(restart + 0.05, restart + 2.05, restart + 4.05));
    expect(timesOf(s, 2)).toEqual(closeTo(restart + 6.05));
  });

  it("goes on by one entry or repeat for each pass end a stall crosses, in order", () => {
    const s = setup({ song: songWith(2, [entry(0, 2), entry(1)]) });
    playAll(s);
    s.advance(0.1);
    s.advance(5); // the timer was held up: the passes ended at 2.05 s and 4.05 s while nothing was scheduled
    s.sampler.poll();
    // the first pass end was the repeat, and the second went on to the second entry
    expect(s.sampler.getState().sequence).toBe(1);
  });

  describe("turned on or off just ahead of the end of a pass that repeats", () => {
    it("does nothing when turned on at an end where the entry repeats: it is not taken back and built again", () => {
      const s = setup({ song: songWith(2, [entry(0, 2), entry(1)]) });
      s.sampler.start();
      tick(s, 39); // 1.95 s: the pass has ended in the scheduler, and the first step of the next (at 2.05 s) is built from this sequence
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 2.05));
      const built = busOf(s.sounds[0].play.mock.calls.at(-1)[1]);
      s.sampler.togglePlayAll();
      expect(built.disconnect).not.toHaveBeenCalled();
      expect(s.sampler.getState().sequence).toBe(0);
      run(s, 2.6); // 4.5 s: and the pass after that goes on to the second entry
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 2.05));
      expect(timesOf(s, 1)).toEqual(closeTo(4.05));
    });

    it("does not take back the pick of the pass end before when turned off at an end where the entry repeats", () => {
      const s = setup({ song: songWith(2, [entry(0), entry(1, 3)]) });
      playAll(s);
      tick(s, 78); // 3.9 s: the chain picked the second sequence at 2.05 s, and this end is a repeat of it
      expect(s.sampler.getState().sequence).toBe(1);
      s.sampler.togglePlayAll();
      expect(s.sampler.getState().sequence).toBe(1); // not sent back to the first
      run(s, 3.2); // 7.1 s
      expect(timesOf(s, 0)).toEqual(closeTo(0.05));
      expect(timesOf(s, 1)).toEqual(closeTo(2.05, 4.05, 6.05)); // and it goes on in the second, as it does with no chain
    });
  });

  describe("when the steps already handed over are built again just before a pass end where an entry goes round again", () => {
    // The pass that follows has no sequence of its own to mark it, so the scheduler, which goes back over the pass end to build them
    // again, tells it a second time: the song must go on once for a pass end, not once for each time it is told.
    it("goes on once for that pass end when the sounds change", () => {
      const s = setup({ song: songWith(2, [entry(0, 3), entry(1)]) });
      playAll(s);
      tick(s, 37); // 1.85 s: the pass end at 2.05 s has been reached, and the first step after it is built
      s.sampler.kitChanged("sound");
      run(s, 6.4); // 8.25 s
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 2.05, 4.05, 8.05)); // three passes of the entry, and again from the first
      expect(timesOf(s, 1)).toEqual(closeTo(6.05));
    });

    it("goes on once for that pass end when the sequence is made shorter", () => {
      const s = setup({ song: songWith(2, [entry(0, 3), entry(1)], { bars: [2, 1] }) });
      playAll(s);
      tick(s, 77); // 3.85 s: the end of the first pass (4.05 s) has been reached
      s.sampler.setBars(1);
      run(s, 12);
      // each time round the entry is one pass of the sequence, in the length it has: the entry is three passes long, then the second
      const first = timesOf(s, 1)[0];
      expect(timesOf(s, 0).filter((time) => time < first)).toHaveLength(3);
    });

    it("goes on once for that pass end when the sequence is made shorter and the loop ends where the scheduler is", () => {
      const s = setup({ song: songWith(2, [entry(0, 2), entry(1)], { bars: [2, 1] }) });
      playAll(s);
      tick(s, 37); // 1.85 s, in the first pass of two bars
      s.sampler.setBars(1); // the loop of one bar ends here: that is the pass end
      run(s, 6); // 7.85 s
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 2.05, 6.05));
      expect(timesOf(s, 1)).toEqual(closeTo(4.05));
    });

    it("takes back the decision at a pass end that is not one after all, when the sequence is made longer past it", () => {
      const s = setup({ song: songWith(2, [entry(0, 3), entry(1)]) });
      playAll(s);
      tick(s, 37); // 1.85 s: the pass end at 2.05 s has been reached, and the entry goes round again
      s.sampler.setBars(2); // the loop carries on past it: it was not a pass end, so that was not a time round
      run(s, 12); // 13.85 s
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 4.05, 8.05)); // three passes of two bars
      expect(timesOf(s, 1)).toEqual(closeTo(12.05));
    });

    it("keeps a time round that has begun when the sequence is made longer later in it: that pass end is behind", () => {
      const s = setup({ song: songWith(2, [entry(0, 3), entry(1)]) });
      playAll(s);
      run(s, 3.0); // the second time round began at 2.05 s, and its first step has sounded
      s.sampler.setBars(2);
      run(s, 8.2); // 11.2 s: the second time round is now two bars (to 6.05 s), then the third (to 10.05 s), then the second entry
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 2.05, 6.05));
      expect(timesOf(s, 1)).toEqual(closeTo(10.05));
    });

    it("goes on once for a pass end that Play All was turned on at, when the sounds change after it", () => {
      const s = setup({ song: songWith(2, [entry(0, 3), entry(1)]) });
      s.sampler.start();
      tick(s, 38); // 1.9 s: the pass end at 2.05 s has been reached, and the last step before it (at 1.9375 s) is still to sound
      s.sampler.togglePlayAll(); // the entry goes round again there
      s.sampler.kitChanged("sound"); // the steps are built again from that one, and the scheduler tells that pass end again
      run(s, 6.2); // 8.1 s
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 2.05, 4.05, 8.05));
      expect(timesOf(s, 1)).toEqual(closeTo(6.05));
    });

    it("does not carry what was decided at a pass end over a pick a person makes before it is told again", () => {
      const s = setup({ song: songWith(2, [entry(1), entry(0, 3)]) });
      playAll(s);
      tick(s, 78); // 3.9 s: the pass end at 4.05 s has been reached, the last step before it is still to sound, and the song went
      // round the entry again at 2.05 s and does again at this one
      s.sampler.setSequence(1);
      s.sampler.setSequence(0); // the steps are built again, the pass end is told again, and the song goes on from the first entry
      run(s, 6); // 9.9 s: that names the sequence, as for any pick: the time round at 4.05 s is its second, so the entry ends at 8.05 s
      expect(timesOf(s, 1)).toEqual(closeTo(8.05));
    });

    it("goes on once for each pass end when the sounds change at each of them", () => {
      const s = setup({ song: songWith(2, [entry(0, 3), entry(1, 2)]) });
      playAll(s);
      for (let pass = 0; pass < 6; pass++) {
        tick(s, pass === 0 ? 37 : 40);
        s.sampler.kitChanged("sound");
      }
      run(s, 7); // 18.85 s: the tenth pass began at 18.05 s
      const order = [...timesOf(s, 0).map((time) => [time, 0]), ...timesOf(s, 1).map((time) => [time, 1])]
        .sort((a, b) => a[0] - b[0])
        .map(([, pad]) => pad);
      expect(order.slice(0, 10)).toEqual([0, 0, 0, 1, 1, 0, 0, 0, 1, 1]);
    });
  });

  describe("forgets where it was, so that a stale position is not taken for one that fits", () => {
    it("when a sequence was queued, and then another, which brings it back to a sequence the song had been at", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1), entry(2), entry(1, 2)]) });
      s.sampler.setSequence(1);
      playAll(s); // the sequences 1 and 2, then 1 again, at its last entry
      run(s, 4.3);
      s.sampler.queueSequence(0); // takes over at 6.05 s
      run(s, 2.0);
      s.sampler.queueSequence(1); // takes over at 8.05 s, and the song goes on from the first entry that names it, not the one it was at
      run(s, 4.0); // 10.3 s
      expect(timesOf(s, 1)).toEqual(closeTo(0.05, 4.05, 8.05));
      expect(timesOf(s, 0)).toEqual(closeTo(6.05));
      expect(timesOf(s, 2)).toEqual(closeTo(2.05, 10.05));
    });

    it("when a person has picked another sequence and then this one again", () => {
      const s = setup({ song: songWith(2, [entry(0), entry(1, 3)]) });
      playAll(s);
      run(s, 4.3); // the second entry, its second time round
      s.sampler.setSequence(0);
      s.sampler.setSequence(1);
      run(s, 5.0); // 9.3 s: from the first time round it again, so the song is not at the end of the entry at 8.05 s
      expect(timesOf(s, 0)).toEqual(closeTo(0.05));
      expect(timesOf(s, 1)).toEqual(closeTo(2.05, 4.05, 6.05, 8.05));
    });

    it("when Play All was turned off and on again", () => {
      const s = setup({ song: songWith(2, [entry(0), entry(1, 3)]) });
      playAll(s);
      run(s, 4.3);
      s.sampler.togglePlayAll();
      s.sampler.togglePlayAll();
      run(s, 5.0); // 9.3 s
      expect(timesOf(s, 0)).toEqual(closeTo(0.05));
      expect(timesOf(s, 1)).toEqual(closeTo(2.05, 4.05, 6.05, 8.05));
    });
  });
});

describe("editing the song's entries", () => {
  // 120 BPM: a pass of one bar is 2 s, its first step at 0.05 s, so the passes begin at 0.05, 2.05, 4.05 s and so on. Sequence i has a
  // step 0 on pad i, to tell which one is sounding.
  const entry = (sequence, repeats = 1) => ({ sequence, repeats });
  const songWith = (count, arrangement) => {
    const base = songOf(count, { bpm: 120 });
    for (let i = 0; i < count; i++) base.sequences[i] = { bars: 1, pattern: { [i]: [0] }, velocities: {} };
    return arrangement ? { ...base, arrangement } : base;
  };
  const tick = (s, count) => {
    for (let i = 0; i < count; i++) {
      s.advance(0.05);
      s.sampler.poll();
    }
  };
  const run = (s, seconds) => tick(s, Math.round(seconds / 0.05));
  const timesOf = (s, pad) => s.sounds[pad].play.mock.calls.map((call) => call[2]);
  const closeTo = (...times) => times.map((time) => expect.closeTo(time, 2));
  const playAll = (s) => {
    s.sampler.togglePlayAll();
    s.sampler.start();
  };
  const entriesOf = (s) => s.sampler.getState().arrangement;

  describe("what the state says", () => {
    it("lists the entries as they play: every sequence once, in order, while nobody has edited the song", () => {
      const s = setup({ song: songWith(3, null) });
      expect(entriesOf(s)).toEqual([entry(0), entry(1), entry(2)]);
      expect(s.sampler.getState()).toMatchObject({ arrangementEdited: false, canAddEntry: true, canRemoveEntry: true });
    });

    it("lists the arrangement once there is one, and says it has been edited", () => {
      const s = setup({ song: songWith(3, [entry(2, 4), entry(0)]) });
      expect(entriesOf(s)).toEqual([entry(2, 4), entry(0)]);
      expect(s.sampler.getState().arrangementEdited).toBe(true);
    });

    it("hands the entries over as a copy", () => {
      const s = setup({ song: songWith(3, [entry(2, 4)]) });
      entriesOf(s)[0].repeats = 9;
      entriesOf(s).push(entry(0));
      expect(entriesOf(s)).toEqual([entry(2, 4)]);
    });

    it("says an entry cannot be added when there are as many as there can be, and one cannot be removed when there is one", () => {
      const full = setup({
        song: songWith(
          3,
          Array.from({ length: 32 }, (_, i) => entry(i % 3)),
        ),
      });
      expect(full.sampler.getState()).toMatchObject({ canAddEntry: false, canRemoveEntry: true });
      const one = setup({ song: songWith(3, [entry(1)]) });
      expect(one.sampler.getState()).toMatchObject({ canAddEntry: true, canRemoveEntry: false });
    });

    it("says where the song is while Play All plays it, and nothing otherwise", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1, 2), entry(2)]) });
      expect(s.sampler.getState().songPass).toBeNull(); // stopped
      s.sampler.start();
      run(s, 0.5);
      expect(s.sampler.getState().songPass).toBeNull(); // Play All is off
      s.sampler.togglePlayAll();
      expect(s.sampler.getState().songPass).toEqual({ entry: 0, rep: 0 }); // the first entry that names the sequence showing
      run(s, 2.0); // 2.5 s: the second entry's first time round has begun
      expect(s.sampler.getState().songPass).toEqual({ entry: 1, rep: 0 });
      run(s, 2.0); // 4.5 s
      expect(s.sampler.getState().songPass).toEqual({ entry: 1, rep: 1 });
      s.sampler.stop();
      expect(s.sampler.getState().songPass).toBeNull();
    });

    it("hands over where the song is as a copy", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1, 3), entry(2)]) });
      playAll(s);
      run(s, 2.5); // the second entry's first time round
      s.sampler.getState().songPass.rep = 9;
      s.sampler.getState().songPass.entry = 2;
      expect(s.sampler.getState().songPass).toEqual({ entry: 1, rep: 0 });
    });

    it("says nothing about where the song is when the sequence playing is in no entry", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1)]) });
      s.sampler.setSequence(2);
      playAll(s);
      expect(s.sampler.getState().songPass).toBeNull();
    });
  });

  describe("addEntry", () => {
    it("puts the sequence showing at the end of the song, once, and gives back where it is", () => {
      const s = setup({ song: songWith(3, null) });
      s.sampler.setSequence(1);
      expect(s.sampler.addEntry()).toBe(3);
      expect(entriesOf(s)).toEqual([entry(0), entry(1), entry(2), entry(1)]);
      expect(s.sampler.getState().arrangementEdited).toBe(true);
    });

    it("gives back where it went when the place is outside the song: the start, or the end", () => {
      const s = setup({ song: songWith(3, [entry(2, 4), entry(0), entry(1)]) });
      expect(s.sampler.addEntry(-3)).toBe(0);
      expect(s.sampler.addEntry(99)).toBe(4);
      expect(entriesOf(s)).toEqual([entry(0), entry(2, 4), entry(0), entry(1), entry(0)]);
    });

    it("puts it at the place it is given", () => {
      const s = setup({ song: songWith(3, [entry(2, 4), entry(0)]) });
      s.sampler.setSequence(1);
      expect(s.sampler.addEntry(1)).toBe(1);
      expect(entriesOf(s)).toEqual([entry(2, 4), entry(1), entry(0)]);
      expect(s.sampler.addEntry(0)).toBe(0);
      expect(entriesOf(s)[0]).toEqual(entry(1));
    });

    it("says so, saves and redraws", () => {
      const s = setup({ song: songWith(3, null) });
      s.message.mockClear();
      s.songChange.mockClear();
      s.change.mockClear();
      s.sampler.addEntry();
      expect(s.message).toHaveBeenLastCalledWith("ENTRY 04 ADDED");
      expect(s.songChange).toHaveBeenCalled();
      expect(s.change).toHaveBeenCalled();
      expect(s.sampler.getSong().arrangement).toEqual([entry(0), entry(1), entry(2), entry(0)]);
    });

    it("says so and changes nothing when there are as many entries as there can be", () => {
      const full = Array.from({ length: 32 }, (_, i) => entry(i % 3));
      const s = setup({ song: songWith(3, full) });
      s.songChange.mockClear();
      expect(s.sampler.addEntry()).toBe(-1);
      expect(s.message).toHaveBeenLastCalledWith("32 ENTRIES MAX");
      expect(entriesOf(s)).toEqual(full);
      expect(s.songChange).not.toHaveBeenCalled();
    });

    it("does not touch the sequences", () => {
      const s = setup({ song: songWith(3, null) });
      const before = s.sampler.getSong().sequences;
      s.sampler.addEntry();
      expect(s.sampler.getSong().sequences).toEqual(before);
    });
  });

  describe("removeEntry", () => {
    it("takes the entry out, and gives back the one to be on after it: the next, or the last", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1, 2), entry(2)]) });
      expect(s.sampler.removeEntry(1)).toBe(1);
      expect(entriesOf(s)).toEqual([entry(0), entry(2)]);
      expect(s.sampler.removeEntry(1)).toBe(0);
      expect(entriesOf(s)).toEqual([entry(0)]);
    });

    it("says so, saves and redraws", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1)]) });
      s.songChange.mockClear();
      s.change.mockClear();
      s.sampler.removeEntry(0);
      expect(s.message).toHaveBeenLastCalledWith("ENTRY 01 REMOVED");
      expect(s.songChange).toHaveBeenCalled();
      expect(s.change).toHaveBeenCalled();
    });

    it("cannot take the last entry, and says so", () => {
      const s = setup({ song: songWith(3, [entry(1, 3)]) });
      s.songChange.mockClear();
      expect(s.sampler.removeEntry(0)).toBe(-1);
      expect(s.message).toHaveBeenLastCalledWith("CANNOT REMOVE LAST ENTRY");
      expect(entriesOf(s)).toEqual([entry(1, 3)]);
      expect(s.songChange).not.toHaveBeenCalled();
    });

    it("says nothing, and changes nothing, for an entry that is not there", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1), entry(2)]) });
      s.message.mockClear();
      s.songChange.mockClear();
      expect(s.sampler.removeEntry(7)).toBe(-1);
      expect(s.message).not.toHaveBeenCalled();
      expect(s.songChange).not.toHaveBeenCalled();
      expect(entriesOf(s)).toEqual([entry(0), entry(1), entry(2)]);
    });

    it("works on the entries a song nobody edited has", () => {
      const s = setup({ song: songWith(3, null) });
      s.sampler.removeEntry(1);
      expect(entriesOf(s)).toEqual([entry(0), entry(2)]);
    });
  });

  describe("moveEntry", () => {
    it("moves an entry one place earlier or later, and gives back where it is", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1, 2), entry(2)]) });
      expect(s.sampler.moveEntry(1, 1)).toBe(2);
      expect(entriesOf(s)).toEqual([entry(0), entry(2), entry(1, 2)]);
      expect(s.sampler.moveEntry(2, -2)).toBe(0);
      expect(entriesOf(s)).toEqual([entry(1, 2), entry(0), entry(2)]);
    });

    it("moves it as far as there is room when it is asked for more than that", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1), entry(2)]) });
      expect(s.sampler.moveEntry(0, 9)).toBe(2);
      expect(entriesOf(s)).toEqual([entry(1), entry(2), entry(0)]);
      expect(s.sampler.moveEntry(1, -9)).toBe(0);
      expect(entriesOf(s)).toEqual([entry(2), entry(1), entry(0)]);
    });

    it("says so, saves and redraws", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1)]) });
      s.songChange.mockClear();
      s.change.mockClear();
      s.sampler.moveEntry(0, 1);
      expect(s.message).toHaveBeenLastCalledWith("ENTRY 01 MOVED TO 02");
      expect(s.songChange).toHaveBeenCalled();
      expect(s.change).toHaveBeenCalled();
    });

    it("keeps the entry where it is, saying nothing and saving nothing, at either end of the song", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1)]) });
      s.songChange.mockClear();
      s.message.mockClear();
      expect(s.sampler.moveEntry(0, -1)).toBe(0);
      expect(s.sampler.moveEntry(1, 1)).toBe(1);
      expect(entriesOf(s)).toEqual([entry(0), entry(1)]);
      expect(s.songChange).not.toHaveBeenCalled();
      expect(s.message).not.toHaveBeenCalled();
    });
  });

  describe("setEntryRepeats", () => {
    it("sets how many times an entry goes round, from 1 to 16, and gives back what it is now", () => {
      const s = setup({ song: songWith(3, null) });
      expect(s.sampler.setEntryRepeats(1, 3)).toBe(3);
      expect(entriesOf(s)).toEqual([entry(0), entry(1, 3), entry(2)]);
      expect(s.sampler.setEntryRepeats(1, 99)).toBe(16);
      expect(s.sampler.setEntryRepeats(1, 0)).toBe(1);
    });

    it("says so, saves and redraws", () => {
      const s = setup({ song: songWith(3, null) });
      s.songChange.mockClear();
      s.change.mockClear();
      s.sampler.setEntryRepeats(2, 4);
      expect(s.message).toHaveBeenLastCalledWith("ENTRY 03 REPEATS 4");
      expect(s.songChange).toHaveBeenCalled();
      expect(s.change).toHaveBeenCalled();
    });

    it("says nothing and saves nothing when it is what the entry has", () => {
      const s = setup({ song: songWith(3, [entry(0, 3)]) });
      s.songChange.mockClear();
      s.message.mockClear();
      expect(s.sampler.setEntryRepeats(0, 3)).toBe(3);
      expect(s.sampler.setEntryRepeats(0, 99)).toBe(16);
      s.songChange.mockClear();
      expect(s.sampler.setEntryRepeats(0, 99)).toBe(16);
      expect(s.songChange).not.toHaveBeenCalled();
    });
  });

  describe("while the song plays", () => {
    // The passes: seq 0 at 0.05 s (entry 0), seq 1 at 2.05, 4.05, 6.05 (the three times round entry 1), seq 2 at 8.05 (entry 2), then
    // the song goes round to seq 0 at 10.05. Each edit is made in the middle of the second time round, at 4.3 s.
    const midway = (arrangement = [entry(0), entry(1, 3), entry(2)]) => {
      const s = setup({ song: songWith(3, arrangement) });
      playAll(s);
      run(s, 4.3);
      return s;
    };

    it("goes on from the entry it is at when an entry is put in before it", () => {
      const s = midway();
      s.sampler.addEntry(0); // names the sequence showing, the second: the song is now 1, 0, 1 x3, 2 and is at its third entry
      run(s, 6.9); // 11.2 s
      expect(timesOf(s, 1)).toEqual(closeTo(2.05, 4.05, 6.05, 10.05)); // the entry's third time round, then the new first entry
      expect(timesOf(s, 2)).toEqual(closeTo(8.05));
      expect(timesOf(s, 0)).toEqual(closeTo(0.05));
    });

    it("goes on from the entry it is at when an entry is taken out before it", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(2), entry(1), entry(2, 2), entry(0)]) });
      playAll(s);
      run(s, 6.3); // the fourth entry's first time round began at 6.05 s
      s.sampler.removeEntry(0);
      run(s, 4.9); // 11.2 s: its second time round, then the last entry, then round to the first (now the sequence 3)
      expect(timesOf(s, 2)).toEqual(closeTo(2.05, 6.05, 8.05));
      expect(timesOf(s, 1)).toEqual(closeTo(4.05));
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 10.05));
    });

    it("goes on from the entry it is at when that entry is moved", () => {
      const s = midway();
      s.sampler.moveEntry(1, 1); // the song is now 1, 3, 2 x3: the entry playing is its third
      run(s, 6.9); // 11.2 s
      expect(timesOf(s, 1)).toEqual(closeTo(2.05, 4.05, 6.05)); // the rest of its times round
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 8.05)); // then round to the first
      expect(timesOf(s, 2)).toEqual(closeTo(10.05));
    });

    it("goes on at the last time round when the entry playing is made to repeat less than it has gone round", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1, 4)]) });
      playAll(s);
      run(s, 6.3); // the third time round of the entry began at 6.05 s
      s.sampler.setEntryRepeats(1, 2); // it has been round more than that: this is its last
      run(s, 4.9); // 11.2 s
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 8.05));
      expect(timesOf(s, 1)).toEqual(closeTo(2.05, 4.05, 6.05, 10.05)); // and the entry begins again at 10.05 s
    });

    it("keeps the time round the song is at when another entry is made to repeat less than that", () => {
      const s = setup({ song: songWith(3, [entry(0, 3), entry(1, 4)]) });
      playAll(s);
      run(s, 10.3); // the first entry's three passes, and the third time round of the second (it began at 10.05 s)
      s.sampler.setEntryRepeats(0, 1); // the entry before it: the position of this one is not changed by it
      run(s, 5.0); // 15.3 s
      expect(timesOf(s, 1)).toEqual(closeTo(6.05, 8.05, 10.05, 12.05)); // all four times round, and then the song goes round
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 2.05, 4.05, 14.05));
    });

    it("goes round the entry again when it is made to repeat more, in the pass that was to be its last", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1, 2)]) });
      playAll(s);
      run(s, 4.3); // the second and last time round of the entry began at 4.05 s
      s.sampler.setEntryRepeats(1, 3);
      run(s, 4.9); // 9.2 s
      expect(timesOf(s, 1)).toEqual(closeTo(2.05, 4.05, 6.05));
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 8.05));
    });

    it("goes on once for the pass end it was at, from its new entry, when the steps are built again after an edit", () => {
      const s = setup({ song: songWith(2, [entry(0), entry(1, 3)]) });
      playAll(s);
      tick(s, 77); // 3.85 s: the pass end at 4.05 s has been reached, and the entry goes round again at it
      s.sampler.addEntry(0); // before it: the entry is now the third, and what is remembered of that pass end moves with it
      s.sampler.kitChanged("sound"); // the steps are built again, and the pass end is told again
      run(s, 7.3); // 11.15 s
      expect(timesOf(s, 1)).toEqual(closeTo(2.05, 4.05, 6.05, 8.05)); // three times round, then the new first entry (the sequence 2)
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 10.05));
    });

    it("goes on from the last time round when the entry is made to repeat less just before its pass end is told again", () => {
      const s = setup({ song: songWith(3, [entry(0), entry(1), entry(0, 4)]) });
      playAll(s);
      tick(s, 198); // 9.9 s: the third time round of the last entry began at 8.05 s, and its pass end at 10.05 s has been told
      s.sampler.setEntryRepeats(2, 2); // it has been round more than that
      s.sampler.kitChanged("sound"); // the pass end is told again, and what was remembered of it is the time round that is gone
      run(s, 3.2); // 13.1 s
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 4.05, 6.05, 8.05, 10.05)); // the first entry follows, as it would a pass later
      expect(timesOf(s, 1)).toEqual(closeTo(2.05, 12.05));
    });

    it("says a time round that the entry has, and not one past its end, when the pass end is taken back after it was made to repeat less", () => {
      const s = setup({ song: songWith(2, [entry(0, 4), entry(1)]) });
      playAll(s);
      tick(s, 118); // 5.9 s: the fourth time round's pass end at 6.05 s has been told
      s.sampler.setEntryRepeats(0, 2);
      s.sampler.setBars(2); // the loop carries on past that pass end: it was not one
      expect(s.sampler.getState().songPass).toEqual({ entry: 0, rep: 1 });
    });

    it("goes on from the entry it was on when an entry is put in before it during the first pass, before any pass end has told where it is", () => {
      const s = setup({ song: songWith(3, null) });
      s.sampler.setSequence(1);
      playAll(s);
      run(s, 0.5);
      s.sampler.addEntry(0); // the sequence showing, the second, at the start: the song is 2, 1, 2, 3 and is on its third entry
      expect(s.sampler.getState().songPass).toEqual({ entry: 2, rep: 0 });
      run(s, 6.7); // 7.2 s
      expect(timesOf(s, 1)).toEqual(closeTo(0.05, 4.05));
      expect(timesOf(s, 2)).toEqual(closeTo(2.05));
      expect(timesOf(s, 0)).toEqual(closeTo(6.05));
    });

    it("goes on from the entry it was on when another that names the same sequence is moved, before any pass end has told where it is", () => {
      const s = setup({ song: songWith(2, [entry(1), entry(0), entry(1)]) });
      s.sampler.setSequence(1);
      playAll(s);
      run(s, 0.5);
      s.sampler.moveEntry(2, -2); // the song is now 2, 2, 1: the entry it was on is its second
      expect(s.sampler.getState().songPass).toEqual({ entry: 1, rep: 0 });
      run(s, 8.0); // 8.5 s
      expect(timesOf(s, 1)).toEqual(closeTo(0.05, 4.05, 6.05));
      expect(timesOf(s, 0)).toEqual(closeTo(2.05, 8.05));
    });

    it("goes on from the entry a pass end that was told when the position was not known has gone on from, when an entry is put in before it and the pass end is told again", () => {
      const s = setup({ song: songWith(3, [entry(1, 3), entry(2)]) });
      s.sampler.setSequence(1);
      playAll(s);
      tick(s, 38); // 1.9 s: the first pass end has been told, with no position known, and the entry goes round again at it
      s.sampler.addEntry(0); // before it, naming the same sequence
      s.sampler.kitChanged("sound"); // the pass end is told again
      run(s, 7.3); // 9.2 s
      expect(timesOf(s, 1)).toEqual(closeTo(0.05, 2.05, 4.05, 8.05)); // three times round the entry, in its new place, then the next, then round to the new first
      expect(timesOf(s, 2)).toEqual(closeTo(6.05));
    });

    it("does the same when Play All was turned on at that pass end", () => {
      const s = setup({ song: songWith(3, [entry(1, 3), entry(2)]) });
      s.sampler.setSequence(1);
      s.sampler.start();
      tick(s, 38); // 1.9 s: the pass end has been told, and Play All is turned on at it
      s.sampler.togglePlayAll();
      s.sampler.addEntry(0);
      s.sampler.kitChanged("sound");
      run(s, 7.3); // 9.2 s
      expect(timesOf(s, 1)).toEqual(closeTo(0.05, 2.05, 4.05, 8.05));
      expect(timesOf(s, 2)).toEqual(closeTo(6.05));
    });

    it("says where the song is, on its new entry, after an edit before it", () => {
      const s = midway();
      s.sampler.addEntry(0);
      expect(s.sampler.getState().songPass).toEqual({ entry: 2, rep: 1 });
      s.sampler.removeEntry(0);
      expect(s.sampler.getState().songPass).toEqual({ entry: 1, rep: 1 });
    });

    it("loses where it is when the entry it is at is removed, and goes on from the first entry that names the sequence", () => {
      const s = midway();
      s.sampler.removeEntry(1); // the song is now 1, 3: the sequence 2 is playing and is in no entry
      expect(s.sampler.getState().songPass).toBeNull();
      run(s, 2.0); // 6.3 s: its pass ended at 6.05 s, and the song begins again at the first entry
      expect(timesOf(s, 0)).toEqual(closeTo(0.05, 6.05));
    });
  });
});
