import { describe, expect, it } from "vitest";
import { PARAMS, isChoice, knobChoice, knobPosition } from "./params.js";
import { DEFAULT_PARAMS, WAVES } from "./synth.js";

const byName = (name) => PARAMS.find((p) => p.name === name);

describe("PARAMS", () => {
  it("covers exactly the synth's parameters, once each", () => {
    expect(PARAMS.map((p) => p.name).sort()).toEqual(Object.keys(DEFAULT_PARAMS).sort());
  });

  it("has one entry per hardware knob, in K1-K8 order", () => {
    expect(PARAMS.map((p) => p.name)).toEqual([
      "attack",
      "decay",
      "sustain",
      "release",
      "wave",
      "cutoff",
      "resonance",
      "volume",
    ]);
  });

  it("puts every default on its slider", () => {
    for (const p of PARAMS.filter((p) => !isChoice(p))) {
      const position = p.toSlider(DEFAULT_PARAMS[p.name]);
      expect(position, p.name).toBeGreaterThanOrEqual(0);
      expect(position, p.name).toBeLessThanOrEqual(100);
    }
  });

  it("displays the defaults the way the page always has", () => {
    const shown = (name) => byName(name).format(DEFAULT_PARAMS[name]);
    expect(shown("attack")).toBe("10 ms");
    expect(shown("decay")).toBe("300 ms");
    expect(shown("sustain")).toBe("60%");
    expect(shown("release")).toBe("250 ms");
    expect(shown("cutoff")).toBe("16.0 kHz");
    expect(shown("resonance")).toBe("0.0 dB");
    expect(shown("volume")).toBe("71%");
  });

  it("formats times as ms below a second and seconds above", () => {
    expect(byName("attack").format(0.999)).toBe("999 ms");
    expect(byName("attack").format(1.5)).toBe("1.50 s");
  });

  it("formats cutoff as Hz below 1 kHz and kHz above", () => {
    expect(byName("cutoff").format(560)).toBe("560 Hz");
    expect(byName("cutoff").format(2500)).toBe("2.5 kHz");
  });

  it("marks only the waveform as a choice, offering every waveform", () => {
    expect(PARAMS.filter(isChoice).map((p) => p.name)).toEqual(["wave"]);
    expect(byName("wave").choices).toEqual(WAVES);
  });
});

describe("knobPosition", () => {
  it("maps the knob's travel onto the slider's", () => {
    expect(knobPosition(0)).toBe(0);
    expect(knobPosition(127)).toBe(100);
    expect(knobPosition(63.5)).toBeCloseTo(50);
  });
});

describe("knobChoice", () => {
  it("splits the travel into equal parts, one per choice", () => {
    expect(knobChoice(0, WAVES)).toBe("sine");
    expect(knobChoice(31, WAVES)).toBe("sine");
    expect(knobChoice(32, WAVES)).toBe("triangle");
    expect(knobChoice(63, WAVES)).toBe("triangle");
    expect(knobChoice(64, WAVES)).toBe("square");
    expect(knobChoice(96, WAVES)).toBe("sawtooth");
    expect(knobChoice(127, WAVES)).toBe("sawtooth");
  });
});
