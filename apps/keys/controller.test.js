import { describe, expect, it, vi } from "vitest";
import { createKeysController } from "./controller.js";
import { PARAMS } from "./params.js";
import { DEFAULT_PARAMS } from "./synth.js";

const byName = (name) => PARAMS.find((p) => p.name === name);

// A synth that records what it was told.
function fakeSynth() {
  return {
    params: { ...DEFAULT_PARAMS },
    bend: 0,
    sustain: false,
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    setSustain: vi.fn(function (on) {
      this.sustain = on;
    }),
    setBend: vi.fn(function (value) {
      this.bend = value;
    }),
    set: vi.fn(function (name, value) {
      this.params[name] = value;
    }),
  };
}

function setup() {
  const synth = fakeSynth();
  const calls = {
    change: vi.fn(),
    noteDown: vi.fn(),
    noteUp: vi.fn(),
    slider: vi.fn(),
    choice: vi.fn(),
  };
  const keys = createKeysController({
    synth,
    params: PARAMS,
    onChange: calls.change,
    onNoteDown: calls.noteDown,
    onNoteUp: calls.noteUp,
    onSlider: calls.slider,
    onChoice: calls.choice,
  });
  return { synth, keys, ...calls };
}

describe("notes", () => {
  it("starts a note at a 0-1 velocity, lights the key and remembers the last note", () => {
    const { synth, keys, noteDown, change } = setup();
    keys.noteOn(60, 127, "midi");
    expect(synth.noteOn).toHaveBeenCalledWith(60, 1);
    expect(noteDown).toHaveBeenCalledWith(60);
    expect(keys.getState().last).toEqual({ note: 60, velocity: 127 });
    expect(change).toHaveBeenCalled();
  });

  it("stops a note only when the last holder lets go", () => {
    const { synth, keys, noteUp } = setup();
    keys.noteOn(60, 100, "midi");
    keys.noteOn(60, 100, "keyboard");
    keys.noteOff(60, "midi");
    expect(synth.noteOff).not.toHaveBeenCalled();
    expect(noteUp).not.toHaveBeenCalled();
    keys.noteOff(60, "keyboard");
    expect(synth.noteOff).toHaveBeenCalledWith(60);
    expect(noteUp).toHaveBeenCalledWith(60);
  });

  it("ignores a Note Off from a source that was not holding the note", () => {
    const { synth, keys } = setup();
    keys.noteOff(60, "midi");
    expect(synth.noteOff).not.toHaveBeenCalled();
  });

  it("lets go of everything a vanished source held, but not notes others still hold", () => {
    const { synth, keys, noteUp } = setup();
    keys.noteOn(60, 100, "midi-1");
    keys.noteOn(62, 100, "midi-1");
    keys.noteOn(62, 100, "midi-2");
    keys.releaseSource("midi-1");
    expect(synth.noteOff.mock.calls).toEqual([[60]]);
    expect(noteUp.mock.calls).toEqual([[60]]);
  });
});

describe("wheels, pedal and readouts", () => {
  it("passes the pedal and bend to the synth and reports a change", () => {
    const { synth, keys, change } = setup();
    keys.setSustain(true);
    keys.setBend(-0.5);
    expect(synth.setSustain).toHaveBeenCalledWith(true);
    expect(synth.setBend).toHaveBeenCalledWith(-0.5);
    expect(keys.getState()).toMatchObject({ sustain: true, bend: -0.5 });
    expect(change).toHaveBeenCalledTimes(2);
  });

  it("keeps mod, the last CC and the last pad for the display", () => {
    const { keys, change } = setup();
    keys.setMod(64);
    keys.showCc(74, 100);
    keys.showPad({ note: 36, velocity: 90, channel: 10 });
    expect(keys.getState()).toMatchObject({
      mod: 64,
      lastCc: { cc: 74, value: 100 },
      lastPad: { note: 36, velocity: 90, channel: 10 },
    });
    expect(change).toHaveBeenCalledTimes(3);
  });
});

describe("parameters", () => {
  it("sets a slider's real value on the synth and shows its position and readout", () => {
    const { synth, keys, slider } = setup();
    const sustain = byName("sustain");
    keys.setSlider(sustain, 50);
    expect(synth.set).toHaveBeenCalledWith("sustain", 0.5);
    expect(slider).toHaveBeenCalledWith(sustain, 50, "50%");
  });

  it("sets a choice on the synth and shows it", () => {
    const { synth, keys, choice } = setup();
    const wave = byName("wave");
    keys.setChoice(wave, "square");
    expect(synth.set).toHaveBeenCalledWith("wave", "square");
    expect(choice).toHaveBeenCalledWith(wave, "square");
  });

  it("moves the matching control when a hardware knob is turned", () => {
    const { synth, keys, slider, choice } = setup();
    keys.applyKnob(2, 127); // K3 is sustain: full travel
    expect(synth.set).toHaveBeenCalledWith("sustain", 1);
    expect(slider).toHaveBeenCalledWith(byName("sustain"), 100, "100%");
    keys.applyKnob(4, 127); // K5 is the waveform: the last choice
    expect(choice).toHaveBeenCalledWith(byName("wave"), "sawtooth");
  });

  it("ignores knobs beyond the last parameter", () => {
    const { synth, keys } = setup();
    keys.applyKnob(PARAMS.length, 64);
    expect(synth.set).not.toHaveBeenCalled();
  });

  it("shows every synth value on its control", () => {
    const { keys, slider, choice } = setup();
    keys.syncParams();
    expect(slider).toHaveBeenCalledTimes(PARAMS.filter((p) => !Array.isArray(p.choices)).length);
    expect(choice).toHaveBeenCalledWith(byName("wave"), DEFAULT_PARAMS.wave);
    expect(slider).toHaveBeenCalledWith(byName("attack"), expect.closeTo(byName("attack").toSlider(0.01)), "10 ms");
  });
});
