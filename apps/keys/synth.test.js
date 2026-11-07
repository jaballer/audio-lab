import { describe, expect, it, vi } from "vitest";
import { BEND_RANGE, DEFAULT_PARAMS, createSynth } from "./synth.js";

// Just enough of the Web Audio API for the synth: nodes that connect, params
// that record what was scheduled, and oscillators that remember when they stopped.
function fakeParam() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

function fakeAudio() {
  const oscillators = [];
  const filters = [];
  const node = (extra) => ({ connect: (next) => next, ...extra });
  const ctx = {
    currentTime: 1,
    createOscillator() {
      const osc = node({ frequency: fakeParam(), detune: fakeParam(), start: vi.fn(), stop: vi.fn() });
      oscillators.push(osc);
      return osc;
    },
    createBiquadFilter() {
      const filter = node({ frequency: fakeParam(), Q: fakeParam() });
      filters.push(filter);
      return filter;
    },
    createGain: () => node({ gain: fakeParam() }),
  };
  return {
    ctx,
    ensure: () => ctx,
    master: node({}),
    setVolume: vi.fn(),
    oscillators,
    filters,
  };
}

describe("createSynth", () => {
  it("starts with the default parameters", () => {
    expect(createSynth(fakeAudio()).params).toEqual(DEFAULT_PARAMS);
  });

  it("rejects unknown parameter names", () => {
    expect(() => createSynth(fakeAudio()).set("nope", 1)).toThrow(/Unknown synth parameter/);
  });

  it("starts the oscillator at the note's frequency", () => {
    const audio = fakeAudio();
    createSynth(audio).noteOn(69, 1);
    expect(audio.oscillators[0].frequency.value).toBeCloseTo(440);
  });

  it("releases a note on note off", () => {
    const audio = fakeAudio();
    const synth = createSynth(audio);
    synth.noteOn(60, 1);
    synth.noteOff(60);
    expect(audio.oscillators[0].stop).toHaveBeenCalled();
  });

  it("keeps released notes sounding while the pedal is down, then releases them", () => {
    const audio = fakeAudio();
    const synth = createSynth(audio);
    synth.noteOn(60, 1);
    synth.setSustain(true);
    synth.noteOff(60);
    expect(audio.oscillators[0].stop).not.toHaveBeenCalled();
    expect(synth.sustain).toBe(true);

    synth.setSustain(false);
    expect(audio.oscillators[0].stop).toHaveBeenCalled();
    expect(synth.sustain).toBe(false);
  });

  it("replaces a note that is struck again instead of stacking voices", () => {
    const audio = fakeAudio();
    const synth = createSynth(audio);
    synth.noteOn(60, 1);
    synth.noteOn(60, 1);
    expect(audio.oscillators[0].stop).toHaveBeenCalled();
    expect(audio.oscillators[1].stop).not.toHaveBeenCalled();
  });

  it("detunes new notes by the current pitch bend", () => {
    const audio = fakeAudio();
    const synth = createSynth(audio);
    synth.setBend(0.5);
    synth.noteOn(60, 1);
    expect(audio.oscillators[0].detune.value).toBeCloseTo(0.5 * BEND_RANGE * 100);
  });

  it("moves sounding notes when the bend changes", () => {
    const audio = fakeAudio();
    const synth = createSynth(audio);
    synth.noteOn(60, 1);
    synth.setBend(-1);
    expect(audio.oscillators[0].detune.setTargetAtTime).toHaveBeenCalledWith(-BEND_RANGE * 100, 1, 0.01);
  });

  it("applies cutoff and resonance to sounding notes", () => {
    const audio = fakeAudio();
    const synth = createSynth(audio);
    synth.noteOn(60, 1);
    synth.set("cutoff", 1000);
    synth.set("resonance", 6);
    expect(audio.filters[0].frequency.setTargetAtTime).toHaveBeenCalledWith(1000, 1, 0.01);
    expect(audio.filters[0].Q.setTargetAtTime).toHaveBeenCalledWith(6, 1, 0.01);
  });

  it("sends volume to the audio engine, even before any note has played", () => {
    const audio = fakeAudio();
    createSynth(audio).set("volume", 0.2);
    expect(audio.setVolume).toHaveBeenCalledWith(0.2);
  });

  it("does not touch the audio context for parameters changed before it exists", () => {
    const audio = { ...fakeAudio(), ctx: null };
    expect(() => createSynth(audio).set("cutoff", 500)).not.toThrow();
  });
});
