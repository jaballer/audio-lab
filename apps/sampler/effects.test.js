import { describe, expect, it } from "vitest";
import {
  DEFAULT_EFFECTS,
  DELAY_DIVISIONS,
  EFFECTS,
  EFFECT_NAMES,
  MAX_TAIL_SECONDS,
  clampEffect,
  delaySeconds,
  delayTailSeconds,
  effectsOf,
  effectsTail,
  feedbackGain,
  formatEffect,
  isDefaultEffects,
  parseEffects,
  REVERB_RETURN_GAIN,
  delayGain,
  reverbGain,
  reverbImpulse,
  reverbSeconds,
  sendGain,
} from "./effects.js";

describe("clampEffect", () => {
  it("keeps a value inside the range, as a whole number", () => {
    expect(clampEffect("reverbSize", 140)).toBe(100);
    expect(clampEffect("reverbLevel", -3)).toBe(0);
    expect(clampEffect("delayFeedback", 99)).toBe(90); // never an echo that does not die away
    expect(clampEffect("delayLevel", 33.6)).toBe(34);
    expect(clampEffect("delayDivision", 9)).toBe(DELAY_DIVISIONS.length - 1);
    expect(clampEffect("pingPong", 5)).toBe(1);
    expect(clampEffect("masterFilter", 140)).toBe(100);
    expect(clampEffect("masterFilter", -140)).toBe(-100); // below the middle: a low-pass, as a pad's Filter
    expect(clampEffect("masterFilter", 0)).toBe(0);
  });

  it("is the default when it is not a number", () => {
    for (const name of EFFECT_NAMES) {
      expect(clampEffect(name, undefined)).toBe(EFFECTS[name].default);
      expect(clampEffect(name, "loud")).toBe(EFFECTS[name].default);
      expect(clampEffect(name, NaN)).toBe(EFFECTS[name].default);
    }
  });
});

describe("parseEffects", () => {
  it("is null for what is not an object, and for an object of only the defaults (a beat with none to keep)", () => {
    for (const stored of [undefined, null, 5, "x", [], [1, 2]]) expect(parseEffects(stored)).toBeNull();
    expect(parseEffects({})).toBeNull();
    expect(parseEffects({ ...DEFAULT_EFFECTS })).toBeNull();
  });

  it("gives every setting once one is not the default, the rest brought into range or left at the default", () => {
    expect(parseEffects({ reverbSize: 80 })).toEqual({ ...DEFAULT_EFFECTS, reverbSize: 80 });
    expect(parseEffects({ delayFeedback: 500, pingPong: 1, delayDivision: -4 })).toEqual({
      ...DEFAULT_EFFECTS,
      delayFeedback: 90,
      pingPong: 1,
      delayDivision: 0,
    });
  });

  it("keeps a master filter that is the only setting that is not the default", () => {
    expect(parseEffects({ masterFilter: -30 })).toEqual({ ...DEFAULT_EFFECTS, masterFilter: -30 });
    expect(parseEffects({ masterFilter: 0 })).toBeNull();
  });

  it("leaves out what it does not know", () => {
    expect(parseEffects({ reverbSize: 80, mysteryKnob: 30, extra: true })).toEqual({
      ...DEFAULT_EFFECTS,
      reverbSize: 80,
    });
  });

  it("gives the same back for what it gave", () => {
    const once = parseEffects({ reverbLevel: 10, pingPong: 1 });
    expect(parseEffects(once)).toEqual(once);
  });
});

describe("effectsOf and isDefaultEffects", () => {
  it("reads the effects of a beat, and the defaults when it has none", () => {
    expect(effectsOf({})).toBe(DEFAULT_EFFECTS);
    expect(effectsOf(undefined)).toBe(DEFAULT_EFFECTS);
    expect(effectsOf({ effects: { reverbLevel: 90 } }).reverbLevel).toBe(90);
    expect(effectsOf({ effects: { reverbLevel: 90 } }).delayFeedback).toBe(EFFECTS.delayFeedback.default);
  });

  it("knows the defaults", () => {
    expect(isDefaultEffects(DEFAULT_EFFECTS)).toBe(true);
    expect(isDefaultEffects({ ...DEFAULT_EFFECTS, pingPong: 1 })).toBe(false);
  });
});

describe("delaySeconds", () => {
  it("follows the tempo: a note is a share of a beat, and a beat is 60 / BPM", () => {
    expect(delaySeconds(3, 120)).toBeCloseTo(0.5); // a quarter
    expect(delaySeconds(1, 120)).toBeCloseTo(0.25); // an eighth
    expect(delaySeconds(0, 120)).toBeCloseTo(0.125); // a sixteenth
    expect(delaySeconds(2, 120)).toBeCloseTo(0.375); // a dotted eighth is three sixteenths
    expect(delaySeconds(1, 60)).toBeCloseTo(0.5);
  });

  it("is at most a second and a half at the slowest tempo, which is what the delay lines are sized for", () => {
    expect(delaySeconds(3, 40)).toBeCloseTo(1.5);
  });
});

describe("the gains", () => {
  it("send, level and feedback are a straight share of full", () => {
    expect(sendGain(0)).toBe(0);
    expect(sendGain(50)).toBe(0.5);
    expect(feedbackGain(90)).toBeCloseTo(0.9);
    expect(delayGain(0)).toBe(0);
    expect(delayGain(100)).toBe(1); // the first echo of a pad sent fully is as loud as the pad
  });

  it("brings the reverb up by the amount it was measured to be under the dry sound, and is silent at 0", () => {
    expect(reverbGain(0)).toBe(0);
    expect(reverbGain(100)).toBe(REVERB_RETURN_GAIN);
    expect(reverbGain(50)).toBeCloseTo(REVERB_RETURN_GAIN / 2, 9);
    expect(REVERB_RETURN_GAIN).toBeGreaterThan(1); // a convolver is normalized to about this much under the dry sound
  });
});

describe("reverbSeconds", () => {
  it("runs from a small room to three seconds, in equal ratios", () => {
    expect(reverbSeconds(0)).toBeCloseTo(0.3, 6);
    expect(reverbSeconds(100)).toBeCloseTo(3, 6);
    expect(reverbSeconds(50) / reverbSeconds(0)).toBeCloseTo(reverbSeconds(100) / reverbSeconds(50), 6);
  });
});

describe("effectsTail", () => {
  const room = { ...DEFAULT_EFFECTS, reverbSize: 100, reverbLevel: 100, delayLevel: 100, delayFeedback: 50 };

  it("is nothing when no pad sends to either, and not made longer by a master filter (it only takes away from what rings)", () => {
    expect(effectsTail({ ...room, masterFilter: -80 }, 120, { reverb: false, delay: false })).toBe(0);
    expect(effectsTail({ ...room, masterFilter: 80 }, 120, { reverb: true })).toBe(
      effectsTail(room, 120, { reverb: true }),
    );
  });

  it("is nothing when no pad sends to either", () => {
    expect(effectsTail(room, 120, { reverb: false, delay: false })).toBe(0);
    expect(effectsTail(room, 120, {})).toBe(0);
  });

  it("is the room's length for a pad that sends to the reverb", () => {
    expect(effectsTail(room, 120, { reverb: true })).toBeCloseTo(3, 6);
  });

  it("is nothing for an effect that is turned right down, whoever sends to it", () => {
    expect(effectsTail({ ...room, reverbLevel: 0 }, 120, { reverb: true })).toBe(0);
    expect(effectsTail({ ...room, delayLevel: 0 }, 120, { delay: true })).toBe(0);
  });

  it("is the longer of the two when a pad sends to both", () => {
    const both = effectsTail({ ...room, delayDivision: 3, delayFeedback: 80 }, 60, { reverb: true, delay: true });
    expect(both).toBeGreaterThan(3);
  });

  it("is the time the echoes take to come 60 dB down for the delay", () => {
    // Half comes round each time: ten repeats take it under a thousandth (2 ** -10), so eleven echoes' length.
    expect(delayTailSeconds({ delayDivision: 1, delayFeedback: 50 }, 120)).toBeCloseTo(0.25 * 11, 6);
    // No feedback is the one echo.
    expect(delayTailSeconds({ delayDivision: 1, delayFeedback: 0 }, 120)).toBeCloseTo(0.25, 6);
  });

  it("follows the tempo, and is cut at a limit: a long, slow, high-feedback echo rings on for minutes", () => {
    const slow = { ...room, delayDivision: 3, delayFeedback: 90 };
    expect(effectsTail(slow, 40, { delay: true })).toBe(MAX_TAIL_SECONDS);
    expect(effectsTail({ ...room, delayFeedback: 20 }, 120, { delay: true })).toBeLessThan(
      effectsTail({ ...room, delayFeedback: 20 }, 60, { delay: true }),
    );
  });
});

describe("reverbImpulse", () => {
  const rate = 44100;

  it("is two sides of the length the size says, the same every time it is made", () => {
    const [left, right] = reverbImpulse(40, rate);
    expect(left).toBeInstanceOf(Float32Array);
    expect(left.length).toBe(Math.ceil(reverbSeconds(40) * rate));
    expect(right.length).toBe(left.length);
    const [again] = reverbImpulse(40, rate);
    expect(Array.from(again.slice(0, 2000))).toEqual(Array.from(left.slice(0, 2000)));
    expect(again[again.length - 1]).toBe(left[left.length - 1]);
  });

  it("has a different room on each side, so it is not heard as one in the middle", () => {
    const [left, right] = reverbImpulse(40, rate);
    let same = 0;
    for (let i = 1000; i < 3000; i++) if (left[i] === right[i]) same++;
    expect(same).toBeLessThan(20);
  });

  it("is longer for a bigger size, at any rate", () => {
    expect(reverbImpulse(80, rate)[0].length).toBeGreaterThan(reverbImpulse(20, rate)[0].length);
    expect(reverbImpulse(40, 22050)[0].length).toBeCloseTo(reverbImpulse(40, 44100)[0].length / 2, -1);
  });

  it("dies away: the end of it is far quieter than the start, and it never begins with a click", () => {
    const [left] = reverbImpulse(40, rate);
    const rms = (from, to) => Math.sqrt(left.slice(from, to).reduce((sum, x) => sum + x * x, 0) / (to - from));
    const tenth = Math.floor(left.length / 10);
    expect(rms(left.length - tenth, left.length)).toBeLessThan(rms(0, tenth) / 100);
    expect(Math.abs(left[0])).toBeLessThan(0.05); // fades in over a couple of milliseconds
  });

  it("stays between -1 and 1, with no gaps or bad numbers", () => {
    for (const side of reverbImpulse(100, rate)) {
      for (let i = 0; i < side.length; i += 7) {
        expect(Number.isFinite(side[i])).toBe(true);
        expect(Math.abs(side[i])).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("formatEffect", () => {
  it("shows the size as a time, the division as a note, the switch as ON or OFF, the rest as a per cent", () => {
    expect(formatEffect("reverbSize", 0)).toBe("0.3 S");
    expect(formatEffect("reverbSize", 100)).toBe("3.0 S");
    expect(formatEffect("delayDivision", 2)).toBe("1/8.");
    expect(formatEffect("pingPong", 1)).toBe("ON");
    expect(formatEffect("pingPong", 0)).toBe("OFF");
    expect(formatEffect("reverbLevel", 50)).toBe("50 %");
    expect(formatEffect("delayFeedback", 35)).toBe("35 %");
  });

  it("shows the master filter as a pad's Filter is shown: off, or a low-pass or a high-pass at its cutoff", () => {
    expect(formatEffect("masterFilter", 0)).toBe("OFF");
    expect(formatEffect("masterFilter", -50)).toBe("LP 1.3 KHZ");
    expect(formatEffect("masterFilter", -100)).toBe("LP 80 HZ");
    expect(formatEffect("masterFilter", 100)).toBe("HP 8.0 KHZ");
    expect(formatEffect("masterFilter", 20)).toMatch(/^HP \d+ HZ$/);
  });
});
