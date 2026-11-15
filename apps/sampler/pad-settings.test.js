import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS,
  clampSetting,
  formatSetting,
  gainToLinear,
  parsePadSettings,
  pitchToRate,
  SAMPLE_SETTING_NAMES,
  SETTING_NAMES,
  SLIDER_NAMES,
  envelopeSeconds,
  DRIVE_CURVE_REACH,
  DRIVE_CURVE_SIZE,
  driveCurve,
  driveSpec,
  FILTER_Q_DB,
  HIGH_PASS_PARKED_HZ,
  LOW_PASS_PARKED_HZ,
  filterSpec,
  padEnvelope,
  panGains,
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
      0: {
        gain: -6,
        pitch: 0,
        choke: 0,
        drive: 0,
        filter: 0,
        pan: 0,
        reverb: 0,
        delay: 0,
        color: 0,
        attack: 0,
        decay: 0,
        sustain: 100,
        release: 0,
      },
      2: {
        gain: 0,
        pitch: 5,
        choke: 0,
        drive: 0,
        filter: 0,
        pan: 0,
        reverb: 0,
        delay: 0,
        color: 0,
        attack: 0,
        decay: 0,
        sustain: 100,
        release: 0,
      },
    });
  });

  it("brings values into range and fills in what is missing", () => {
    expect(parsePadSettings({ 1: { gain: 100, pitch: -50 }, 2: { gain: -3 } }, 4)).toEqual({
      1: {
        gain: 6,
        pitch: -12,
        choke: 0,
        drive: 0,
        filter: 0,
        pan: 0,
        reverb: 0,
        delay: 0,
        color: 0,
        attack: 0,
        decay: 0,
        sustain: 100,
        release: 0,
      },
      2: {
        gain: -3,
        pitch: 0,
        choke: 0,
        drive: 0,
        filter: 0,
        pan: 0,
        reverb: 0,
        delay: 0,
        color: 0,
        attack: 0,
        decay: 0,
        sustain: 100,
        release: 0,
      },
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
    expect(DEFAULT_SETTINGS).toEqual({
      gain: 0,
      pitch: 0,
      choke: 0,
      drive: 0,
      filter: 0,
      pan: 0,
      reverb: 0,
      delay: 0,
      color: 0,
      attack: 0,
      decay: 0,
      sustain: 100,
      release: 0,
    });
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
    expect(parsePadSettings({ 1: { choke: 2 } }, 4)).toEqual({
      1: {
        gain: 0,
        pitch: 0,
        choke: 2,
        drive: 0,
        filter: 0,
        pan: 0,
        reverb: 0,
        delay: 0,
        color: 0,
        attack: 0,
        decay: 0,
        sustain: 100,
        release: 0,
      },
    });
  });

  it("is brought into range, and filled in as no group when it is missing (a beat saved before it existed)", () => {
    expect(parsePadSettings({ 0: { gain: -3, choke: 50 }, 1: { gain: 2, pitch: 1 } }, 4)).toEqual({
      0: {
        gain: -3,
        pitch: 0,
        choke: 8,
        drive: 0,
        filter: 0,
        pan: 0,
        reverb: 0,
        delay: 0,
        color: 0,
        attack: 0,
        decay: 0,
        sustain: 100,
        release: 0,
      },
      1: {
        gain: 2,
        pitch: 1,
        choke: 0,
        drive: 0,
        filter: 0,
        pan: 0,
        reverb: 0,
        delay: 0,
        color: 0,
        attack: 0,
        decay: 0,
        sustain: 100,
        release: 0,
      },
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
    expect(SLIDER_NAMES).toEqual([
      "gain",
      "pitch",
      "choke",
      "attack",
      "decay",
      "sustain",
      "release",
      "drive",
      "filter",
      "pan",
      "reverb",
      "delay",
    ]);
    expect(SETTING_NAMES).toContain("color");
  });

  it("makes a pad count as not at the defaults when it is the only thing set, and fills in none when missing", () => {
    expect(parsePadSettings({ 2: { color: 4 } }, 4)).toEqual({
      2: {
        gain: 0,
        pitch: 0,
        choke: 0,
        drive: 0,
        filter: 0,
        pan: 0,
        reverb: 0,
        delay: 0,
        color: 4,
        attack: 0,
        decay: 0,
        sustain: 100,
        release: 0,
      },
    });
    expect(parsePadSettings({ 1: { gain: -2 } }, 4)).toEqual({
      1: {
        gain: -2,
        pitch: 0,
        choke: 0,
        drive: 0,
        filter: 0,
        pan: 0,
        reverb: 0,
        delay: 0,
        color: 0,
        attack: 0,
        decay: 0,
        sustain: 100,
        release: 0,
      },
    });
  });
});

describe("the envelope settings", () => {
  it("are slider positions from 0 to 100, with sustain at 100 (no change) by default", () => {
    for (const name of ["attack", "decay", "release", "sustain"])
      expect(SETTINGS[name]).toMatchObject({ min: 0, max: 100 });
    expect(DEFAULT_SETTINGS).toMatchObject({ attack: 0, decay: 0, sustain: 100, release: 0 });
    expect(clampSetting("attack", 250)).toBe(100);
    expect(clampSetting("sustain", "x")).toBe(100);
  });

  it("are for loaded samples, like pitch", () => {
    expect(SAMPLE_SETTING_NAMES).toEqual(["pitch", "attack", "decay", "sustain", "release"]);
  });

  it("turn a position into a time: none at 0, finer control over short times, the longest at 100", () => {
    expect(envelopeSeconds("attack", 0)).toBe(0);
    expect(envelopeSeconds("attack", 100)).toBe(2);
    expect(envelopeSeconds("decay", 100)).toBe(2);
    expect(envelopeSeconds("release", 100)).toBe(5);
    expect(envelopeSeconds("attack", 50)).toBeCloseTo(0.25);
    expect(envelopeSeconds("attack", 10)).toBeCloseTo(0.002);
    expect(envelopeSeconds("attack", 50)).toBeLessThan(envelopeSeconds("attack", 100) / 2);
  });

  it("count anything under a millisecond as no time at all, so it is shown as 0 MS and is no envelope", () => {
    expect(envelopeSeconds("attack", 1)).toBe(0); // 2 microseconds
    expect(envelopeSeconds("attack", 7)).toBe(0); // 0.7 ms
    expect(envelopeSeconds("attack", 8)).toBeGreaterThan(0.001);
    expect(formatSetting("attack", 1)).toBe("0 MS");
    expect(padEnvelope({ ...DEFAULT_SETTINGS, attack: 1 })).toBeNull();
  });

  it("are shown as the time, not the position, and the sustain as a percentage", () => {
    expect(formatSetting("attack", 0)).toBe("0 MS");
    expect(formatSetting("attack", 10)).toBe("2 MS");
    expect(formatSetting("attack", 50)).toBe("250 MS");
    expect(formatSetting("release", 100)).toBe("5.00 S");
    expect(formatSetting("sustain", 60)).toBe("60 %");
    expect(formatSetting("sustain", 100)).toBe("100 %");
  });

  it("make an envelope in seconds and levels, or none when they change nothing", () => {
    expect(padEnvelope({ ...DEFAULT_SETTINGS })).toBeNull();
    expect(padEnvelope({ ...DEFAULT_SETTINGS, decay: 80 })).toBeNull(); // a decay to the level it is at
    expect(padEnvelope({ ...DEFAULT_SETTINGS, attack: 100, sustain: 50, release: 100 })).toEqual({
      attack: 2,
      decay: 0,
      sustain: 0.5,
      release: 5,
    });
  });

  it("make a pad count as not at the defaults when only one is set, and fill in the defaults when missing", () => {
    expect(parsePadSettings({ 0: { sustain: 70 } }, 2)).toEqual({
      0: {
        gain: 0,
        pitch: 0,
        choke: 0,
        drive: 0,
        filter: 0,
        pan: 0,
        reverb: 0,
        delay: 0,
        color: 0,
        attack: 0,
        decay: 0,
        sustain: 70,
        release: 0,
      },
    });
    expect(parsePadSettings({ 0: { gain: 2 } }, 2)[0]).toMatchObject({ sustain: 100, attack: 0 });
  });
});

describe("the filter setting", () => {
  it("is off in the middle, a low-pass below it and a high-pass above it, for any sound", () => {
    expect(SETTINGS.filter).toMatchObject({ min: -100, max: 100, default: 0 });
    expect(SETTINGS.filter.samples).toBeUndefined(); // a built-in sound has it too
    expect(filterSpec(0)).toEqual({ type: "off" }); // no filter at all: the strip's dry path
    expect(filterSpec(-40).type).toBe("lowpass");
    expect(filterSpec(40).type).toBe("highpass");
  });

  it("brings a low-pass down from the top of hearing to 80 Hz, and a high-pass up from the bottom to 8 kHz, in equal ratios", () => {
    expect(filterSpec(-100).frequency).toBeCloseTo(80, 6);
    expect(filterSpec(100).frequency).toBeCloseTo(8000, 6);
    expect(filterSpec(-1).frequency).toBeGreaterThan(18000);
    expect(filterSpec(1).frequency).toBeLessThan(22);
    // an equal step is an equal ratio
    const ratio = (a, b) => filterSpec(a).frequency / filterSpec(b).frequency;
    expect(ratio(-40, -50)).toBeCloseTo(ratio(-60, -70), 6);
    expect(ratio(60, 50)).toBeCloseTo(ratio(40, 30), 6);
    // more of either makes it do more: a lower cutoff for the low-pass, a higher one for the high-pass
    expect(filterSpec(-60).frequency).toBeLessThan(filterSpec(-30).frequency);
    expect(filterSpec(60).frequency).toBeGreaterThan(filterSpec(30).frequency);
  });

  it("has a Butterworth Q, in the decibels a low-pass and a high-pass are given it in", () => {
    expect(10 ** (FILTER_Q_DB / 20)).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("parks each filter at the end of its range where it is nearly out of the way", () => {
    expect(LOW_PASS_PARKED_HZ).toBeCloseTo(20000, 6);
    expect(HIGH_PASS_PARKED_HZ).toBeCloseTo(20, 6);
    // the parking places are the ends the sliders start from
    expect(filterSpec(-1).frequency).toBeLessThan(LOW_PASS_PARKED_HZ);
    expect(filterSpec(1).frequency).toBeGreaterThan(HIGH_PASS_PARKED_HZ);
  });

  it("is a whole number inside the range, and 0 when it is not a number", () => {
    expect(clampSetting("filter", 150)).toBe(100);
    expect(clampSetting("filter", -150)).toBe(-100);
    expect(clampSetting("filter", -12.6)).toBe(-13);
    expect(clampSetting("filter", NaN)).toBe(0);
  });

  it("says off, or which pass and where", () => {
    expect(formatSetting("filter", 0)).toBe("OFF");
    expect(formatSetting("filter", -100)).toBe("LP 80 HZ");
    expect(formatSetting("filter", 100)).toBe("HP 8.0 KHZ");
    expect(formatSetting("filter", -1)).toMatch(/^LP 1\d\.\d KHZ$/);
    expect(formatSetting("filter", 1)).toBe("HP 21 HZ");
  });
});

describe("the pan setting", () => {
  it("is the centre in the middle, and for any sound", () => {
    expect(SETTINGS.pan).toMatchObject({ min: -100, max: 100, default: 0 });
    expect(SETTINGS.pan.samples).toBeUndefined();
  });

  it("leaves both sides as they are at the centre, and turns the far side down to nothing at the edge", () => {
    expect(panGains(0)).toEqual({ left: 1, right: 1 });
    expect(panGains(100)).toEqual({ left: 0, right: 1 });
    expect(panGains(-100)).toEqual({ left: 1, right: 0 });
  });

  it("turns only the side that is moved away from down, in a straight line", () => {
    expect(panGains(50)).toEqual({ left: 0.5, right: 1 });
    expect(panGains(-25)).toEqual({ left: 1, right: 0.75 });
  });

  it("is a whole number inside the range, and the centre when it is not a number", () => {
    expect(clampSetting("pan", 400)).toBe(100);
    expect(clampSetting("pan", -400)).toBe(-100);
    expect(clampSetting("pan", undefined)).toBe(0);
  });

  it("says the centre, or which side and how far", () => {
    expect(formatSetting("pan", 0)).toBe("CENTER");
    expect(formatSetting("pan", -30)).toBe("L 30");
    expect(formatSetting("pan", 100)).toBe("R 100");
  });
});

describe("a pad with only a filter or a pan set", () => {
  it("is kept by parsePadSettings, with the rest at the defaults", () => {
    expect(parsePadSettings({ 1: { filter: -40 }, 2: { pan: 25 } }, 4)).toEqual({
      1: { ...DEFAULT_SETTINGS, filter: -40 },
      2: { ...DEFAULT_SETTINGS, pan: 25 },
    });
  });
});

describe("the reverb and delay sends", () => {
  it("are for any sound, a built-in one as well as a sample, and start at none", () => {
    for (const name of ["reverb", "delay"]) {
      expect(SETTINGS[name]).toMatchObject({ min: 0, max: 100, default: 0 });
      expect(SETTINGS[name].samples).toBeUndefined(); // acts on what comes out of the pad, as the filter does
      expect(SLIDER_NAMES).toContain(name);
    }
  });

  it("are a whole number from 0 to 100, and none when it is not a number", () => {
    expect(clampSetting("reverb", 140)).toBe(100);
    expect(clampSetting("reverb", -5)).toBe(0);
    expect(clampSetting("delay", 33.4)).toBe(33);
    expect(clampSetting("delay", "x")).toBe(0);
  });

  it("are shown as a per cent, without a plus sign", () => {
    expect(formatSetting("reverb", 0)).toBe("0 %");
    expect(formatSetting("reverb", 40)).toBe("40 %");
    expect(formatSetting("delay", 100)).toBe("100 %");
  });

  it("are kept by parsePadSettings for a pad with only a send set", () => {
    expect(parsePadSettings({ 3: { reverb: 60 }, 5: { delay: 25 } }, 8)).toEqual({
      3: { ...DEFAULT_SETTINGS, reverb: 60 },
      5: { ...DEFAULT_SETTINGS, delay: 25 },
    });
  });
});

describe("the drive setting", () => {
  it("is a whole number from 0 to 100, off at 0, and off when it is not a number", () => {
    expect(clampSetting("drive", 140)).toBe(100);
    expect(clampSetting("drive", -5)).toBe(0);
    expect(clampSetting("drive", 33.4)).toBe(33);
    expect(clampSetting("drive", "x")).toBe(0);
    expect(DEFAULT_SETTINGS.drive).toBe(0);
  });

  it("is shown as a per cent, without a plus sign", () => {
    expect(formatSetting("drive", 0)).toBe("0 %");
    expect(formatSetting("drive", 45)).toBe("45 %");
  });

  it("is kept by parsePadSettings for a pad with only a drive set", () => {
    expect(parsePadSettings({ 4: { drive: 70 } }, 8)).toEqual({ 4: { ...DEFAULT_SETTINGS, drive: 70 } });
  });

  it("is no shaping at all at 0: the strip's dry path alone", () => {
    expect(driveSpec(0)).toEqual({ on: false });
  });

  it("starts as a gentle bend that is hardly more than the sound, and ends as the hardest clip, in equal ratios", () => {
    const first = driveSpec(1);
    expect(first.on).toBe(true);
    // The gain into tanh is the pre-gain times the curve's reach: 1 at the bottom of the range, 40 at the top.
    expect(first.preGain * DRIVE_CURVE_REACH).toBeCloseTo(40 ** 0.01, 6);
    expect(driveSpec(100).preGain * DRIVE_CURVE_REACH).toBeCloseTo(40, 6);
    const reach = (value) => driveSpec(value).preGain;
    expect(reach(50) / reach(25)).toBeCloseTo(reach(75) / reach(50), 6);
  });

  it("brings the sound back down by the root of what it was pushed up by, so its loudness stays about where it was", () => {
    for (const value of [1, 20, 50, 80, 100]) {
      const { preGain, postGain } = driveSpec(value);
      expect(postGain).toBeCloseTo(1 / Math.sqrt(preGain * DRIVE_CURVE_REACH), 9);
    }
    // At the bottom of the range the shaped path is the dry one to within a hair, so crossing 0 does not jump in level.
    const small = driveSpec(1);
    const x = 0.1; // a quiet sound; tanh(g x) / sqrt(g) against x
    expect(Math.tanh(small.preGain * DRIVE_CURVE_REACH * x) * small.postGain).toBeCloseTo(x, 2);
  });

  it("has a curve that is tanh over the range the shaper takes: odd, through 0, flat at the ends, and the same every time", () => {
    const curve = driveCurve();
    expect(curve).toBeInstanceOf(Float32Array);
    expect(curve).toHaveLength(DRIVE_CURVE_SIZE);
    const middle = (DRIVE_CURVE_SIZE - 1) / 2;
    expect(curve[middle]).toBe(0);
    for (const at of [1, 100, 1000, middle - 1]) expect(curve[middle + at]).toBeCloseTo(-curve[middle - at], 6); // no DC from an odd curve
    expect(curve[curve.length - 1]).toBeCloseTo(Math.tanh(DRIVE_CURVE_REACH), 6);
    expect(curve[curve.length - 1]).toBeLessThan(1);
    expect(curve[curve.length - 1]).toBeGreaterThan(0.999);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThan(curve[i - 1]); // rising all the way: it never folds back
    expect(Array.from(driveCurve(65))).toEqual(Array.from(driveCurve(65)));
  });
});
