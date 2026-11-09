import { describe, expect, it } from "vitest";
import { formatLcd, lcdProgress } from "./lcd.js";

const stopped = {
  playing: false,
  recording: false,
  selected: 0,
  soundName: "Kick",
  bpm: 100,
  playheadStep: -1,
  steps: 16,
  stepsOn: new Array(16).fill(false),
};

describe("formatLcd", () => {
  it("shows the stopped state with no playhead", () => {
    expect(formatLcd(stopped)).toMatchObject({
      line1: "SEQ 01  STOPPED",
      line2: "PAD 01  Kick",
      line3: "BPM 100.0  BAR --/01  STEP --/16",
    });
  });

  it("shows the sequence number, counting from 1", () => {
    expect(formatLcd({ ...stopped, sequence: 2 }).line1).toBe("SEQ 03  STOPPED");
  });

  it("shows PLAYING and the step number, counting from 1", () => {
    const text = formatLcd({ ...stopped, playing: true, playheadStep: 4 });
    expect(text.line1).toBe("SEQ 01  PLAYING");
    expect(text.line3).toBe("BPM 100.0  BAR 01/01  STEP 05/16");
  });

  it("shows the bar the playhead is in, out of all the bars, and the step within it", () => {
    const text = formatLcd({ ...stopped, playing: true, bars: 4, playheadPosition: 37, playheadStep: -1 });
    expect(text.line3).toBe("BPM 100.0  BAR 03/04  STEP 06/16");
  });

  it("hides a stale playhead step while stopped", () => {
    expect(formatLcd({ ...stopped, playheadStep: 7 }).line3).toBe("BPM 100.0  BAR --/01  STEP --/16");
  });

  it("shows no step before the first one plays", () => {
    expect(formatLcd({ ...stopped, playing: true, playheadStep: -1 }).line3).toContain("STEP --");
  });

  it("flags recording", () => {
    expect(formatLcd({ ...stopped, recording: true }).line1).toBe("SEQ 01  STOPPED  REC");
    expect(formatLcd({ ...stopped, playing: true, recording: true }).line1).toBe("SEQ 01  PLAYING  REC");
  });

  it("names the selected pad, counting from 1", () => {
    expect(formatLcd({ ...stopped, selected: 11, soundName: "Bass" }).line2).toBe("PAD 12  Bass");
  });

  it("shows the tempo to one decimal place", () => {
    expect(formatLcd({ ...stopped, bpm: 99.9 }).line3).toContain("BPM 99.9");
  });

  it("marks the steps that are on, and the playhead only while playing", () => {
    const stepsOn = stopped.stepsOn.map((_, i) => i % 4 === 0);
    const playing = formatLcd({ ...stopped, stepsOn, playing: true, playheadStep: 4 }).ruler;
    expect(playing.map((c) => c.on)).toEqual(stepsOn);
    expect(playing.filter((c) => c.now)).toEqual([{ on: true, now: true }]);
    expect(playing[4].now).toBe(true);

    const idle = formatLcd({ ...stopped, stepsOn, playheadStep: 4 }).ruler;
    expect(idle.some((c) => c.now)).toBe(false);
  });
});

describe("lcdProgress", () => {
  const playing = { playing: true, steps: 16, bars: 4, page: 0 };

  it("is empty while stopped, however far the playhead was", () => {
    expect(lcdProgress({ ...playing, playing: false, playheadPosition: 30 })).toEqual({
      bars: 4,
      shown: 0,
      fraction: 0,
    });
  });

  it("is empty before the first step has played", () => {
    expect(lcdProgress({ ...playing, playheadPosition: -1 }).fraction).toBe(0);
  });

  it("is the share of the whole sequence played up to the step the playhead is on", () => {
    expect(lcdProgress({ ...playing, playheadPosition: 0 }).fraction).toBeCloseTo(1 / 64);
    expect(lcdProgress({ ...playing, playheadPosition: 15 }).fraction).toBeCloseTo(0.25); // the end of the first bar
    expect(lcdProgress({ ...playing, playheadPosition: 31 }).fraction).toBeCloseTo(0.5);
  });

  it("is full on the last step of the last bar", () => {
    expect(lcdProgress({ ...playing, playheadPosition: 63 }).fraction).toBe(1);
  });

  it("never goes past full, as when the sequence has just been made shorter than the playhead", () => {
    expect(lcdProgress({ ...playing, playheadPosition: 70 }).fraction).toBe(1);
  });

  it("counts every bar of the sequence, not the bar the step keys show", () => {
    const a = lcdProgress({ ...playing, playheadPosition: 40, page: 0 });
    const b = lcdProgress({ ...playing, playheadPosition: 40, page: 3 });
    expect(a.fraction).toBe(b.fraction);
    expect(a.fraction).toBeCloseTo(41 / 64);
  });

  it("says which bar the step keys show, and how many bars there are", () => {
    expect(lcdProgress({ ...playing, playheadPosition: 5, page: 2 })).toMatchObject({ bars: 4, shown: 2 });
  });

  it("keeps the bar shown within the bars there are", () => {
    expect(lcdProgress({ ...playing, bars: 2, page: 5, playheadPosition: 0 }).shown).toBe(1);
    expect(lcdProgress({ ...playing, page: -1, playheadPosition: 0 }).shown).toBe(0);
  });

  it("is one bar for a one-bar sequence, filling across the whole width over the bar", () => {
    const result = lcdProgress({ playing: true, steps: 16, bars: 1, page: 0, playheadPosition: 7 });
    expect(result).toEqual({ bars: 1, shown: 0, fraction: 0.5 });
  });

  it("defaults to one bar and the first", () => {
    expect(lcdProgress({ playing: true, steps: 16, playheadPosition: 15 })).toEqual({ bars: 1, shown: 0, fraction: 1 });
  });
});
