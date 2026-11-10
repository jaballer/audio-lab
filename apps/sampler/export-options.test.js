import { describe, expect, it } from "vitest";
import {
  CHANNEL_CHOICES,
  DEFAULT_EXPORT_OPTIONS,
  LOOP_CHOICES,
  channelCount,
  emptyBarsNote,
  exportFrames,
  exportBlockedReason,
  exportFormat,
  exportInfo,
  exportMemoryBytes,
  exportNote,
  exportReadout,
  exportTitle,
  formatDuration,
  LARGE_EXPORT_BYTES,
  largeExportNote,
  normalizeExportOptions,
  renderingLabel,
} from "./export-options.js";

// 120 BPM: a sixteenth is 0.125 s, a bar of 16 steps is 2 s
const songOf = (bars, extra = {}) => ({ bpm: 120, current: 0, sequences: [{ bars }], ...extra });

describe("the choices", () => {
  it("are the sequence as it is by default: one loop, in stereo, as the export has always been", () => {
    expect(DEFAULT_EXPORT_OPTIONS).toEqual({ loops: 1, channels: "stereo" });
    expect(LOOP_CHOICES).toContain(DEFAULT_EXPORT_OPTIONS.loops);
    expect(CHANNEL_CHOICES).toContain(DEFAULT_EXPORT_OPTIONS.channels);
  });

  it("offer 1, 2, 4 and 8 loops, and stereo or mono", () => {
    expect(LOOP_CHOICES).toEqual([1, 2, 4, 8]);
    expect(CHANNEL_CHOICES).toEqual(["stereo", "mono"]);
  });
});

describe("normalizeExportOptions", () => {
  it("keeps options that are choices", () => {
    expect(normalizeExportOptions({ loops: 4, channels: "mono" })).toEqual({ loops: 4, channels: "mono" });
  });

  it("falls back to the default for anything saved that is not a choice, each option on its own", () => {
    expect(normalizeExportOptions({ loops: 3, channels: "mono" })).toEqual({ loops: 1, channels: "mono" });
    expect(normalizeExportOptions({ loops: 8, channels: "quad" })).toEqual({ loops: 8, channels: "stereo" });
    expect(normalizeExportOptions({ loops: "4", channels: 2 })).toEqual(DEFAULT_EXPORT_OPTIONS);
  });

  it("gives the defaults for nothing, or for something that is not an object", () => {
    for (const raw of [undefined, null, 5, "mono", []])
      expect(normalizeExportOptions(raw)).toEqual(DEFAULT_EXPORT_OPTIONS);
  });

  it("returns a new object each time, so a caller that changes it does not change the default", () => {
    const options = normalizeExportOptions(null);
    options.loops = 8;
    expect(DEFAULT_EXPORT_OPTIONS.loops).toBe(1);
    expect(normalizeExportOptions(null).loops).toBe(1);
  });
});

describe("channelCount", () => {
  it("is one for mono and two for anything else", () => {
    expect(channelCount("mono")).toBe(1);
    expect(channelCount("stereo")).toBe(2);
  });
});

describe("exportFrames", () => {
  it("is the length of the bars times the loops, in frames", () => {
    expect(exportFrames(songOf(1), 16, 1, 1000)).toBe(2000);
    expect(exportFrames(songOf(1), 16, 4, 1000)).toBe(8000);
    expect(exportFrames(songOf(2), 16, 2, 1000)).toBe(8000);
  });

  it("follows the tempo, and the sequence showing", () => {
    expect(exportFrames(songOf(1, { bpm: 60 }), 16, 1, 1000)).toBe(4000);
    const second = { bpm: 120, current: 1, sequences: [{ bars: 1 }, { bars: 4 }] };
    expect(exportFrames(second, 16, 1, 1000)).toBe(8000);
  });

  it("rounds once, so eight loops are eight times the length and not eight roundings of it", () => {
    // 123 BPM: a bar is 1.95122 s, which is 86048.78 frames at 44100
    const song = songOf(1, { bpm: 123 });
    expect(exportFrames(song, 16, 1, 44100)).toBe(86049);
    expect(exportFrames(song, 16, 8, 44100)).toBe(688390); // not 8 * 86049 = 688392
  });
});

describe("exportInfo", () => {
  it("says how long and how big the file will be: two bytes a sample, a channel each, and the header", () => {
    const info = exportInfo(songOf(1), { loops: 1, channels: "stereo" }, 16, 1000);
    expect(info).toEqual({ frames: 2000, seconds: 2, bytes: 44 + 2000 * 2 * 2, channels: "stereo" });
  });

  it("is half the size in mono", () => {
    const stereo = exportInfo(songOf(1), { loops: 1, channels: "stereo" }, 16, 1000);
    const mono = exportInfo(songOf(1), { loops: 1, channels: "mono" }, 16, 1000);
    expect(mono.bytes - 44).toBe((stereo.bytes - 44) / 2);
    expect(mono.seconds).toBe(stereo.seconds);
  });

  it("grows with the loops", () => {
    const eight = exportInfo(songOf(2), { loops: 8, channels: "mono" }, 16, 1000);
    expect(eight.seconds).toBe(32);
    expect(eight.bytes).toBe(44 + 32000 * 2);
  });

  it("treats options that are not choices as the defaults, as the export does", () => {
    expect(exportInfo(songOf(1), { loops: 3, channels: "quad" }, 16, 1000)).toEqual(
      exportInfo(songOf(1), DEFAULT_EXPORT_OPTIONS, 16, 1000),
    );
  });
});

describe("formatDuration", () => {
  it("is seconds to a tenth under a minute", () => {
    expect(formatDuration(4.8)).toBe("4.8 s");
    expect(formatDuration(0)).toBe("0.0 s");
    expect(formatDuration(59.94)).toBe("59.9 s");
  });

  it("is minutes and whole seconds from a minute", () => {
    expect(formatDuration(60)).toBe("1 min 0 s");
    expect(formatDuration(125)).toBe("2 min 5 s");
  });

  it("does not say sixty seconds: it rounds before it splits", () => {
    expect(formatDuration(119.6)).toBe("2 min 0 s");
  });

  it("does not round up to 60.0 s either: just under a minute is a minute", () => {
    expect(formatDuration(59.96)).toBe("1 min 0 s"); // 8 loops of 4 bars at 128.1 BPM is 59.953 s
    expect(formatDuration(59.949)).toBe("59.9 s");
  });
});

describe("exportReadout", () => {
  it("says the length, the channels and the size, in one line", () => {
    const info = { seconds: 4.8, channels: "mono", bytes: 423404 };
    expect(exportReadout(info)).toBe("4.8 s · mono · 413 KB");
    expect(exportReadout({ seconds: 154, channels: "stereo", bytes: 27_000_000 })).toBe(
      "2 min 34 s · stereo · 25.7 MB",
    );
  });
});

describe("exportFormat", () => {
  it("says the bit depth and the sample rate the file is written at", () => {
    expect(exportFormat(44100)).toBe("16-bit 44.1 kHz");
    expect(exportFormat(48000)).toBe("16-bit 48 kHz");
  });
});

describe("exportTitle", () => {
  it("names the sequence, its length and the tempo", () => {
    expect(exportTitle(songOf(1))).toBe("SEQ 01 · 1 BAR · 120 BPM");
    expect(exportTitle(songOf(4, { bpm: 96.5 }))).toBe("SEQ 01 · 4 BARS · 97 BPM");
    expect(exportTitle({ bpm: 100, current: 7, sequences: Array.from({ length: 8 }, () => ({ bars: 2 })) })).toBe(
      "SEQ 08 · 2 BARS · 100 BPM",
    );
  });
});

describe("renderingLabel", () => {
  it("says how far along it is, in whole per cent", () => {
    expect(renderingLabel(0.4)).toBe("Rendering… 40%");
    expect(renderingLabel(0.456)).toBe("Rendering… 46%");
    expect(renderingLabel(1)).toBe("Rendering… 100%");
  });

  it("keeps the number within 0 to 100", () => {
    expect(renderingLabel(-0.5)).toBe("Rendering… 0%");
    expect(renderingLabel(7)).toBe("Rendering… 100%");
  });

  it("only says it is working before the first report", () => {
    expect(renderingLabel(null)).toBe("Rendering…");
    expect(renderingLabel(undefined)).toBe("Rendering…");
  });
});

describe("emptyBarsNote", () => {
  it("is nothing when every bar has steps", () => {
    expect(emptyBarsNote([])).toBe("");
  });

  it("names one bar", () => {
    expect(emptyBarsNote([3])).toBe("Bar 3 has no steps: nothing plays in it but what is still ringing.");
  });

  it("names a run of bars as a range, the way a trailing silence shows up", () => {
    expect(emptyBarsNote([2, 3, 4, 5, 6, 7, 8])).toBe(
      "Bars 2–8 have no steps: nothing plays in them but what is still ringing.",
    );
    expect(emptyBarsNote([3, 4])).toBe("Bars 3–4 have no steps: nothing plays in them but what is still ringing.");
  });

  it("lists separate bars and runs, in order", () => {
    expect(emptyBarsNote([1, 3])).toBe("Bars 1 and 3 have no steps: nothing plays in them but what is still ringing.");
    expect(emptyBarsNote([1, 2, 4, 5])).toBe(
      "Bars 1–2 and 4–5 have no steps: nothing plays in them but what is still ringing.",
    );
    expect(emptyBarsNote([1, 3, 5, 6, 8])).toBe(
      "Bars 1, 3, 5–6 and 8 have no steps: nothing plays in them but what is still ringing.",
    );
  });
});

describe("exportBlockedReason", () => {
  it("is nothing when the export can be made", () => {
    expect(exportBlockedReason({ supported: true, hasSteps: true })).toBe("");
  });

  it("says why when the browser cannot render audio to a file, before anything is pressed", () => {
    expect(exportBlockedReason({ supported: false, hasSteps: true })).toBe(
      "This browser cannot render audio to a file, so Export is not available.",
    );
  });

  it("says when the sequence has no steps", () => {
    expect(exportBlockedReason({ supported: true, hasSteps: false })).toBe(
      "This sequence has no steps yet, so there is nothing to export.",
    );
  });

  it("puts the browser first when both are true: an empty sequence is not the problem to fix", () => {
    expect(exportBlockedReason({ supported: false, hasSteps: false })).toMatch(/browser/);
  });
});

const MiB = 1024 * 1024;

describe("exportMemoryBytes", () => {
  it("is the whole render at eight bytes a frame (two float channels, the warm-up included) and the file at eight more", () => {
    expect(exportMemoryBytes({ total: 2000, frames: 1000 })).toBe(8 * 2000 + 8 * 1000);
  });

  it("is a little under what the biggest export took in Chromium (297 MiB for a 384 s file after a 48 s warm-up)", () => {
    const sampleRate = 44100;
    const bytes = exportMemoryBytes({ total: 432 * sampleRate, frames: 384 * sampleRate });
    expect(bytes / MiB).toBeGreaterThan(270);
    expect(bytes / MiB).toBeLessThan(310);
  });
});

describe("largeExportNote", () => {
  it("is nothing for an export that fits easily", () => {
    expect(largeExportNote(LARGE_EXPORT_BYTES - 1)).toBe("");
    expect(largeExportNote(20 * MiB)).toBe("");
  });

  it("says how much memory it takes, to the nearest ten megabytes, and what makes it smaller, from the threshold up", () => {
    expect(largeExportNote(LARGE_EXPORT_BYTES)).toBe(
      "Making this takes about 200 MB of memory, which a phone may not have to spare. Fewer loops make it smaller.",
    );
    expect(largeExportNote(288 * MiB)).toBe(
      "Making this takes about 290 MB of memory, which a phone may not have to spare. Fewer loops make it smaller.",
    );
  });

  it("warns for the biggest single export and not for a long one that fits", () => {
    const rate = 44100;
    // 8 bars at 40 BPM: a loop of 48 s, one warm-up pass of it
    const biggest = exportMemoryBytes({ total: (48 + 8 * 48) * rate, frames: 8 * 48 * rate });
    const fits = exportMemoryBytes({ total: (48 + 4 * 48) * rate, frames: 4 * 48 * rate });
    expect(largeExportNote(biggest)).toMatch(/^Making this takes about 2[78]0 MB/);
    expect(largeExportNote(fits)).toBe("");
  });
});

describe("exportNote", () => {
  const rate = 44100;
  const small = { total: 2 * 10 * rate, frames: 10 * rate };
  const large = { total: 432 * rate, frames: 384 * rate };

  it("is nothing when there is nothing to say", () => {
    expect(exportNote(small, [])).toBe("");
  });

  it("is the bars with no steps, alone, for a small export", () => {
    expect(exportNote(small, [2, 3])).toBe(emptyBarsNote([2, 3]));
  });

  it("is the memory warning, alone, for a large export with every bar filled", () => {
    expect(exportNote(large, [])).toBe(largeExportNote(exportMemoryBytes(large)));
  });

  it("is both, the bars first, in one line", () => {
    expect(exportNote(large, [2])).toBe(`${emptyBarsNote([2])} ${largeExportNote(exportMemoryBytes(large))}`);
  });

  it("counts the render and the file each on its own: the line is 26,214,400 frames at 8 bytes", () => {
    const frames = LARGE_EXPORT_BYTES / 8;
    expect(exportNote({ total: frames, frames: 0 }, [])).not.toBe("");
    expect(exportNote({ total: 0, frames }, [])).not.toBe("");
    expect(exportNote({ total: frames - 1, frames: 0 }, [])).toBe("");
    expect(exportNote({ total: 0, frames: frames - 1 }, [])).toBe("");
  });
});
