import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS,
  clampSetting,
  formatSetting,
  gainToLinear,
  parsePadSettings,
  pitchToRate,
  SETTING_NAMES,
  SLIDER_NAMES,
} from "./pad-settings.js";
import { COLOR_COUNT, padColorName } from "./pad-colors.js";

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
    expect(parsePadSettings(stored, 4)).toEqual({
      0: { gain: -6, pitch: 0, choke: 0, color: 0 },
      2: { gain: 0, pitch: 5, choke: 0, color: 0 },
    });
  });

  it("brings values into range and fills in what is missing", () => {
    expect(parsePadSettings({ 1: { gain: 100, pitch: -50 }, 2: { gain: -3 } }, 4)).toEqual({
      1: { gain: 6, pitch: -12, choke: 0, color: 0 },
      2: { gain: -3, pitch: 0, choke: 0, color: 0 },
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
    expect(DEFAULT_SETTINGS).toEqual({ gain: 0, pitch: 0, choke: 0, color: 0 });
  });
});

describe("the choke setting", () => {
  it("is a whole number from 0 (no group) to 8", () => {
    expect(SETTINGS.choke).toMatchObject({ min: 0, max: 8, default: 0 });
    expect(clampSetting("choke", 3.4)).toBe(3);
    expect(clampSetting("choke", -2)).toBe(0);
    expect(clampSetting("choke", 99)).toBe(8);
    expect(clampSetting("choke", "x")).toBe(0);
  });

  it("is shown as OFF or as the group", () => {
    expect(formatSetting("choke", 0)).toBe("OFF");
    expect(formatSetting("choke", 3)).toBe("GROUP 3");
  });

  it("makes a pad count as not at the defaults when it is the only thing set", () => {
    expect(parsePadSettings({ 1: { choke: 2 } }, 4)).toEqual({ 1: { gain: 0, pitch: 0, choke: 2, color: 0 } });
  });

  it("is brought into range, and filled in as no group when it is missing (a song saved before it existed)", () => {
    expect(parsePadSettings({ 0: { gain: -3, choke: 50 }, 1: { gain: 2, pitch: 1 } }, 4)).toEqual({
      0: { gain: -3, pitch: 0, choke: 8, color: 0 },
      1: { gain: 2, pitch: 1, choke: 0, color: 0 },
    });
  });
});

describe("the color setting", () => {
  it("is a swatch number: 0 (none) up to the number of colours", () => {
    expect(SETTINGS.color).toMatchObject({ min: 0, max: COLOR_COUNT, default: 0, swatches: true });
    expect(clampSetting("color", 3.4)).toBe(3);
    expect(clampSetting("color", -1)).toBe(0);
    expect(clampSetting("color", 99)).toBe(COLOR_COUNT);
    expect(clampSetting("color", "x")).toBe(0);
  });

  it("is shown as the colour's name, in capitals", () => {
    expect(formatSetting("color", 0)).toBe("NONE");
    expect(formatSetting("color", 5)).toBe(padColorName(5).toUpperCase());
  });

  it("has no slider: the sliders are the other settings", () => {
    expect(SLIDER_NAMES).toEqual(["gain", "pitch", "choke"]);
    expect(SETTING_NAMES).toContain("color");
  });

  it("makes a pad count as not at the defaults when it is the only thing set, and fills in none when missing", () => {
    expect(parsePadSettings({ 2: { color: 4 } }, 4)).toEqual({ 2: { gain: 0, pitch: 0, choke: 0, color: 4 } });
    expect(parsePadSettings({ 1: { gain: -2 } }, 4)).toEqual({ 1: { gain: -2, pitch: 0, choke: 0, color: 0 } });
  });
});
