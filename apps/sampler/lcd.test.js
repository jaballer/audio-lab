import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatLcd, lcdProgress, progressVars } from "./lcd.js";

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
    expect(formatLcd(stopped).lines).toEqual([
      "SEQ 01  STOPPED",
      "PAD 01  Kick",
      "BPM 100.0",
      "BAR --/01",
      "STEP --/16",
    ]);
  });

  it("has a line on the page for each line it gives", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const ids = [...html.matchAll(/id="lcd-(\d+)"/g)].map((match) => Number(match[1]));
    expect(ids).toEqual(Array.from({ length: formatLcd(stopped).lines.length }, (_, i) => i + 1));
  });

  it("leaves the count off when there is none to show, or it is zero", () => {
    expect(formatLcd({ ...stopped, sequenceCount: 0 }).lines[0]).toBe("SEQ 01  STOPPED");
    expect(formatLcd({ ...stopped, sequenceCount: undefined }).lines[0]).toBe("SEQ 01  STOPPED");
  });

  describe("the song screen", () => {
    // Where the song is (what sounds, or where Play would begin): entry 2 of 5, sequence 3 on its 2nd time round of 4, then sequence 1.
    const song = { entry: 1, entries: 5, sequence: 2, rep: 1, repeats: 4, next: 0 };
    const inSong = { ...stopped, songMode: true, song };

    it("is chosen by the mode: the same state reads as the pattern screen with Song mode off", () => {
      expect(formatLcd({ ...inSong, songMode: false }).lines).toEqual(formatLcd(stopped).lines);
      expect(formatLcd(inSong).lines).not.toEqual(formatLcd(stopped).lines);
    });

    it("has the five lines the page has, the first three doing the jobs they do in the pattern screen", () => {
      const lines = formatLcd(inSong).lines;
      expect(lines).toHaveLength(formatLcd(stopped).lines.length);
      expect(lines.slice(1, 3)).toEqual(formatLcd(stopped).lines.slice(1, 3)); // the pad and the tempo
    });

    it("says where the song is on its first line, and whether it plays, with REC after it", () => {
      expect(formatLcd(inSong).lines[0]).toBe("SONG 02/05  STOPPED");
      expect(formatLcd({ ...inSong, playing: true }).lines[0]).toBe("SONG 02/05  PLAYING");
      expect(formatLcd({ ...inSong, playing: true, recording: true }).lines[0]).toBe("SONG 02/05  PLAYING  REC");
    });

    it("gives the sequence and the time round it, then the sequence that comes next", () => {
      expect(formatLcd(inSong).lines.slice(3)).toEqual(["SEQ 03  REPEAT 2/4", "NEXT SEQ 01"]);
    });

    it("counts from 1, and says a song of one entry that goes round once as it is", () => {
      const once = { entry: 0, entries: 1, sequence: 0, rep: 0, repeats: 1, next: 0 };
      expect(formatLcd({ ...inSong, song: once }).lines).toEqual([
        "SONG 01/01  STOPPED",
        "PAD 01  Kick",
        "BPM 100.0",
        "SEQ 01  REPEAT 1/1",
        "NEXT SEQ 01",
      ]);
    });

    it("leaves the place and the time round blank while it is not known, and still says the sequence and what is next", () => {
      const unknown = { entry: -1, entries: 5, sequence: 2, rep: -1, repeats: 0, next: 0 };
      const lines = formatLcd({ ...inSong, playing: true, song: unknown }).lines;
      expect(lines[0]).toBe("SONG --/05  PLAYING");
      expect(lines.slice(3)).toEqual(["SEQ 03  REPEAT --", "NEXT SEQ 01"]);
    });

    it("falls back to the pattern screen when Song mode is on and nothing is said of the song", () => {
      expect(formatLcd({ ...stopped, songMode: true }).lines).toEqual(formatLcd(stopped).lines);
    });

    it("does not need the sequence count, which is the pattern screen's", () => {
      expect(formatLcd({ ...inSong, sequenceCount: 8, sequence: 6 }).lines).toEqual(formatLcd(inSong).lines);
    });
  });

  it("says SEQ when Song mode is off or not said", () => {
    expect(formatLcd({ ...stopped, sequence: 1, sequenceCount: 4, songMode: false }).lines[0]).toBe(
      "SEQ 02/04  STOPPED",
    );
    expect(formatLcd({ ...stopped, sequence: 1, sequenceCount: 4 }).lines[0]).toBe("SEQ 02/04  STOPPED");
  });

  it("shows the sequence number, counting from 1", () => {
    expect(formatLcd({ ...stopped, sequence: 2 }).lines[0]).toBe("SEQ 03  STOPPED");
  });

  it("shows how many sequences there are after the number, when it is told", () => {
    expect(formatLcd({ ...stopped, sequence: 0, sequenceCount: 4 }).lines[0]).toBe("SEQ 01/04  STOPPED");
    expect(formatLcd({ ...stopped, sequence: 7, sequenceCount: 8, playing: true, recording: true }).lines[0]).toBe(
      "SEQ 08/08  PLAYING  REC",
    );
  });

  it("shows PLAYING and the step number, counting from 1", () => {
    const text = formatLcd({ ...stopped, playing: true, playheadStep: 4 });
    expect(text.lines[0]).toBe("SEQ 01  PLAYING");
    expect(text.lines.slice(3)).toEqual(["BAR 01/01", "STEP 05/16"]);
  });

  it("shows the bar the playhead is in, out of all the bars, and the step in the whole sequence", () => {
    const text = formatLcd({ ...stopped, playing: true, bars: 4, playheadPosition: 37, playheadStep: -1 });
    expect(text.lines.slice(3)).toEqual(["BAR 03/04", "STEP 38/64"]);
  });

  it("counts the steps of every bar, as the step keys are numbered", () => {
    const at = (playheadPosition) => formatLcd({ ...stopped, playing: true, bars: 2, playheadPosition });
    expect(at(0).lines.slice(3)).toEqual(["BAR 01/02", "STEP 01/32"]);
    expect(at(15).lines.slice(3)).toEqual(["BAR 01/02", "STEP 16/32"]);
    expect(at(16).lines.slice(3)).toEqual(["BAR 02/02", "STEP 17/32"]);
    expect(at(31).lines.slice(3)).toEqual(["BAR 02/02", "STEP 32/32"]);
    expect(formatLcd({ ...stopped, bars: 2 }).lines.slice(3)).toEqual(["BAR --/02", "STEP --/32"]);
  });

  it("counts up to the last step of the longest sequence", () => {
    const last = formatLcd({ ...stopped, playing: true, bars: 8, playheadPosition: 127 });
    expect(last.lines.slice(3)).toEqual(["BAR 08/08", "STEP 128/128"]);
  });

  it("hides a stale playhead step while stopped", () => {
    expect(formatLcd({ ...stopped, playheadStep: 7 }).lines.slice(3)).toEqual(["BAR --/01", "STEP --/16"]);
  });

  it("shows no step before the first one plays", () => {
    expect(formatLcd({ ...stopped, playing: true, playheadStep: -1 }).lines[4]).toBe("STEP --/16");
  });

  it("flags recording", () => {
    expect(formatLcd({ ...stopped, recording: true }).lines[0]).toBe("SEQ 01  STOPPED  REC");
    expect(formatLcd({ ...stopped, playing: true, recording: true }).lines[0]).toBe("SEQ 01  PLAYING  REC");
  });

  it("names the selected pad, counting from 1", () => {
    expect(formatLcd({ ...stopped, selected: 11, soundName: "Bass" }).lines[1]).toBe("PAD 12  Bass");
  });

  it("shows the tempo to one decimal place", () => {
    expect(formatLcd({ ...stopped, bpm: 99.9 }).lines[2]).toBe("BPM 99.9");
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

  it("is one bar for a one-bar sequence, filled to half at the middle step", () => {
    const result = lcdProgress({ playing: true, steps: 16, bars: 1, page: 0, playheadPosition: 7 });
    expect(result).toEqual({ bars: 1, shown: 0, fraction: 0.5 });
  });

  it("defaults to one bar and the first", () => {
    expect(lcdProgress({ playing: true, steps: 16, playheadPosition: 15 })).toEqual({ bars: 1, shown: 0, fraction: 1 });
  });
});

describe("lcdProgress with nothing to go on", () => {
  it("is empty when the steps or the bars are not there, and does not throw", () => {
    expect(lcdProgress({ playing: true, playheadPosition: 3 }).fraction).toBe(0);
    expect(lcdProgress({ playing: true, steps: 0, bars: 4, playheadPosition: 3 }).fraction).toBe(0);
    expect(lcdProgress({ playing: true, steps: 16, bars: 0, playheadPosition: 3 }).fraction).toBe(0);
  });
});

describe("progressVars", () => {
  it("gives the values the CSS draws from, as text", () => {
    expect(progressVars({ bars: 4, shown: 2, fraction: 0.5 })).toEqual({
      "--progress": "0.5",
      "--bars": "4",
      "--shown": "2",
      multi: true,
    });
  });

  it("rounds the fraction to four decimals, so a step does not write a long number", () => {
    expect(progressVars({ bars: 3, shown: 0, fraction: 1 / 3 })["--progress"]).toBe("0.3333");
    expect(progressVars({ bars: 3, shown: 0, fraction: 41 / 64 })["--progress"]).toBe("0.6406");
  });

  it("writes the same text for the same step, so nothing is rewritten while it stays", () => {
    const a = progressVars({ bars: 4, shown: 1, fraction: 0.25 });
    const b = progressVars({ bars: 4, shown: 1, fraction: 0.25 });
    expect(a).toEqual(b);
  });

  it("is not several bars for one bar: the line under the progress would be all of it", () => {
    expect(progressVars({ bars: 1, shown: 0, fraction: 0 }).multi).toBe(false);
    expect(progressVars({ bars: 2, shown: 0, fraction: 0 }).multi).toBe(true);
  });

  it("is empty at zero and full at one", () => {
    expect(progressVars({ bars: 2, shown: 0, fraction: 0 })["--progress"]).toBe("0");
    expect(progressVars({ bars: 2, shown: 0, fraction: 1 })["--progress"]).toBe("1");
  });
});
