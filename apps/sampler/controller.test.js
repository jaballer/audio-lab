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
  volume = 50,
  bars = 1,
  pattern = {},
  velocities = {},
  current = 0,
  padSettings = {},
} = {}) => ({
  bpm,
  volume,
  current,
  padSettings,
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
    kit: createKit(sounds),
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
    sampler.setPadSetting("color", 5);
    expect(message).toHaveBeenLastCalledWith("PAD 02 COLOR BLUE");
    expect(sampler.getState().padSettings.color).toBe(5);
    expect(sampler.getSong().padSettings).toEqual({
      1: { gain: 0, pitch: 0, choke: 0, color: 5, attack: 0, decay: 0, sustain: 100, release: 0 },
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
