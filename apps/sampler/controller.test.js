import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VOLUME, createSampler } from "./controller.js";
import { STARTER_BEAT } from "./pattern.js";
import { LOOKAHEAD_MS } from "./transport.js";

const STEPS = 16;
const PADS = 4;

// An audio engine whose clock is whatever the test says it is, and whose gain
// nodes just remember what they were given.
function fakeAudio() {
  const master = { id: "master" };
  const ctx = {
    currentTime: 0,
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })),
  };
  return { ctx, master, ensure: vi.fn(() => ctx), setVolume: vi.fn() };
}

function setup({ song = null, bpm } = {}) {
  const audio = fakeAudio();
  const sounds = Array.from({ length: PADS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, play: vi.fn() }));
  const calls = { change: vi.fn(), message: vi.fn(), padHit: vi.fn(), songChange: vi.fn() };
  let clock = 0;
  const sampler = createSampler({
    audio,
    sounds,
    steps: STEPS,
    song: song ?? (bpm ? { bpm, volume: 50, pattern: {} } : null),
    now: () => clock,
    onChange: calls.change,
    onMessage: calls.message,
    onPadHit: calls.padHit,
    onSongChange: calls.songChange,
  });
  // Move the audio clock forward and let the scheduler wake up.
  const advance = (seconds) => {
    audio.ctx.currentTime += seconds;
    vi.advanceTimersByTime(LOOKAHEAD_MS);
  };
  const tapAt = (ms) => {
    clock = ms;
    sampler.tapTempo();
  };
  return { audio, sounds, sampler, advance, tapAt, ...calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("starting state", () => {
  it("starts from the starter beat, the default volume and nothing selected but pad 1", () => {
    const { sampler } = setup();
    expect(sampler.getSong()).toMatchObject({ bpm: 100, volume: DEFAULT_VOLUME, pattern: STARTER_BEAT });
    expect(sampler.getState()).toMatchObject({ selected: 0, recording: false, playing: false, playheadStep: -1 });
  });

  it("starts from a saved song", () => {
    const song = { bpm: 133.5, volume: 35, pattern: { 1: [2, 6] } };
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

  it("clears the selected pad and names it", () => {
    const { sampler, message } = setup();
    expect(sampler.getState().stepsOn.some(Boolean)).toBe(true); // the starter kick
    sampler.clearPad();
    expect(sampler.getState().stepsOn.some(Boolean)).toBe(false);
    expect(message).toHaveBeenLastCalledWith("PAD 01 CLEARED");
  });

  it("clears every pad", () => {
    const { sampler, message } = setup();
    sampler.clearAll();
    expect(sampler.getSong().pattern).toEqual({});
    expect(message).toHaveBeenLastCalledWith("ALL PADS CLEARED");
  });
});

describe("transport", () => {
  it("start and stop report a change; a second start does not", () => {
    const { sampler, change } = setup();
    sampler.start();
    expect(sampler.getState().playing).toBe(true);
    expect(change).toHaveBeenCalledTimes(1);
    sampler.start();
    expect(change).toHaveBeenCalledTimes(1);
    sampler.stop();
    expect(sampler.getState().playing).toBe(false);
    expect(change).toHaveBeenCalledTimes(2);
  });

  it("plays the pads that are on at each step, at the time the scheduler gives", () => {
    const { audio, sounds, sampler, advance } = setup({ song: { bpm: 120, volume: 50, pattern: STARTER_BEAT } });
    sampler.start();
    advance(0);
    // The starter beat: kick on step 0, closed hat (pad 2) on step 0, snare not yet.
    expect(sounds[0].play).toHaveBeenCalledWith(audio.ctx, audio.master, expect.closeTo(0.05));
    expect(sounds[2].play).toHaveBeenCalledTimes(1);
    expect(sounds[1].play).not.toHaveBeenCalled();
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
