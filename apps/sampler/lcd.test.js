import { describe, expect, it } from "vitest";
import { formatLcd } from "./lcd.js";

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
