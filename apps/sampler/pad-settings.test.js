import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS,
  clampSetting,
  formatSetting,
  gainToLinear,
  parsePadSettings,
  pitchToRate,
} from "./pad-settings.js";

describe("clampSetting", () => {
  it("keeps a value inside the range, as a whole number", () => {
    expect(clampSetting("gain", -3.4)).toBe(-3);
    expect(clampSetting("gain", 99)).toBe(SETTINGS.gain.max);
    expect(clampSetting("gain", -99)).toBe(SETTINGS.gain.min);
    expect(clampSetting("pitch", 12.6)).toBe(12);
    expect(clampSetting("pitch", -20)).toBe(-12);
  });

  it("is the default for what is not a number", () => {
    for (const value of [NaN, undefined, null, "loud", Infinity, {}]) {
      expect(clampSetting("gain", value)).toBe(0);
      expect(clampSetting("pitch", value)).toBe(0);
    }
  });
});

describe("conversions", () => {
  it("turns decibels into a multiplier, with 0 dB leaving the sound as it is", () => {
    expect(gainToLinear(0)).toBe(1);
    expect(gainToLinear(-6)).toBeCloseTo(0.501, 3);
    expect(gainToLinear(6)).toBeCloseTo(1.995, 3);
    expect(gainToLinear(-20)).toBeCloseTo(0.1, 5);
  });

  it("turns semitones into a playback rate: twelve make an octave", () => {
    expect(pitchToRate(0)).toBe(1);
    expect(pitchToRate(12)).toBe(2);
    expect(pitchToRate(-12)).toBe(0.5);
    expect(pitchToRate(7)).toBeCloseTo(1.4983, 4); // a fifth
  });
});

describe("formatSetting", () => {
  it("shows the sign of a positive value and the unit", () => {
    expect(formatSetting("gain", -3)).toBe("-3 dB");
    expect(formatSetting("gain", 0)).toBe("0 dB");
    expect(formatSetting("pitch", 2)).toBe("+2 st");
  });
});

describe("parsePadSettings", () => {
  it("keeps the pads that exist and differ from the defaults", () => {
    const stored = {
      0: { gain: -6, pitch: 0 },
      2: { gain: 0, pitch: 5 },
      3: { gain: 0, pitch: 0 },
      9: { gain: -1, pitch: 0 },
    };
    expect(parsePadSettings(stored, 4)).toEqual({ 0: { gain: -6, pitch: 0 }, 2: { gain: 0, pitch: 5 } });
  });

  it("brings values into range and fills in what is missing", () => {
    expect(parsePadSettings({ 1: { gain: 100, pitch: -50 }, 2: { gain: -3 } }, 4)).toEqual({
      1: { gain: 6, pitch: -12 },
      2: { gain: -3, pitch: 0 },
    });
  });

  it("drops what is not a pad, or not settings", () => {
    const stored = { x: { gain: 1 }, "-1": { gain: 1 }, 1.5: { gain: 1 }, 1: "loud", 2: [1], 3: null };
    expect(parsePadSettings(stored, 4)).toEqual({});
  });

  it("gives nothing for what is not an object", () => {
    for (const stored of [null, undefined, "x", 5, [], [{ gain: 1 }]]) expect(parsePadSettings(stored, 4)).toEqual({});
  });

  it("agrees with the defaults it is compared to", () => {
    expect(DEFAULT_SETTINGS).toEqual({ gain: 0, pitch: 0 });
  });
});
