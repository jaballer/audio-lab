import { describe, expect, it } from "vitest";
import {
  GROUPS,
  PARAMS,
  choiceKnob,
  choiceLabel,
  clampKnob,
  isChoice,
  knobChoice,
  knobForChoice,
  knobPosition,
  labelFor,
  positionKnob,
} from "./params.js";
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

describe("positionKnob", () => {
  it("is the way back from knobPosition", () => {
    expect(positionKnob(0)).toBe(0);
    expect(positionKnob(100)).toBe(127);
    for (const v of [0, 1, 40, 64, 127]) expect(positionKnob(knobPosition(v))).toBeCloseTo(v);
  });
});

describe("clampKnob", () => {
  it("keeps a dragged value inside the knob's travel", () => {
    expect(clampKnob(-5)).toBe(0);
    expect(clampKnob(64.5)).toBe(64.5);
    expect(clampKnob(300)).toBe(127);
  });
});

describe("choiceKnob", () => {
  it("sits inside the choice's own part of the travel", () => {
    for (const choice of WAVES) expect(knobChoice(choiceKnob(choice, WAVES), WAVES)).toBe(choice);
  });

  it("puts the first choice low and the last one high", () => {
    expect(choiceKnob("sine", WAVES)).toBeLessThan(choiceKnob("sawtooth", WAVES));
    expect(choiceKnob("sawtooth", WAVES)).toBeLessThanOrEqual(127);
  });
});

describe("knobForChoice", () => {
  it("keeps a position that already means the choice", () => {
    expect(knobForChoice(50, "triangle", WAVES)).toBe(50);
    expect(knobForChoice(0, "sine", WAVES)).toBe(0);
  });

  it("moves to the middle of the choice when the position means another", () => {
    expect(knobForChoice(50, "sawtooth", WAVES)).toBe(choiceKnob("sawtooth", WAVES));
  });
});

describe("labels", () => {
  it("names a control after its parameter", () => {
    expect(labelFor(byName("attack"))).toBe("Attack");
    expect(labelFor(byName("resonance"))).toBe("Resonance");
  });

  it("names a waveform, with the saw shortened", () => {
    expect(WAVES.map(choiceLabel)).toEqual(["Sine", "Triangle", "Square", "Saw"]);
  });
});

describe("GROUPS", () => {
  it("has a section for every group a parameter uses, and no empty ones", () => {
    const used = new Set(PARAMS.map((p) => p.group));
    expect(new Set(GROUPS.map((g) => g.id))).toEqual(used);
  });
});
