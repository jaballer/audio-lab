import { describe, expect, it } from "vitest";
import {
  CHANNEL_CHOICES,
  DEFAULT_EXPORT_OPTIONS,
  FILE_CHOICES,
  LOOP_CHOICES,
  SCOPE_CHOICES,
  SONG_TAIL_SECONDS,
  ZIP_BYTES_PER_FILE,
  channelCount,
  emptyBarsNote,
  emptySequencesNote,
  exportFrames,
  exportBlockedReason,
  exportFormat,
  exportInfo,
  exportHint,
  exportMemoryBytes,
  exportNote,
  exportReadout,
  exportTitle,
  formatDuration,
  LARGE_EXPORT_BYTES,
  largeExportNote,
  normalizeExportOptions,
  renderingLabel,
  MAX_SONG_EXPORT_SECONDS,
  songPassOrder,
  songFileSeconds,
  songSteps,
  stemsInfo,
  songTooLong,
} from "./export-options.js";

// 120 BPM: a sixteenth is 0.125 s, a bar of 16 steps is 2 s
const songOf = (bars, extra = {}) => ({ bpm: 120, current: 0, sequences: [{ bars }], ...extra });

describe("the choices", () => {
  it("are the sequence as it is by default: one loop, in stereo, as the export has always been", () => {
    expect(DEFAULT_EXPORT_OPTIONS).toEqual({ loops: 1, channels: "stereo", files: "mix", scope: "sequence" });
    expect(LOOP_CHOICES).toContain(DEFAULT_EXPORT_OPTIONS.loops);
    expect(CHANNEL_CHOICES).toContain(DEFAULT_EXPORT_OPTIONS.channels);
    expect(FILE_CHOICES).toContain(DEFAULT_EXPORT_OPTIONS.files);
  });

  it("offer 1, 2, 4 and 8 loops, stereo or mono, and the mix or its stems", () => {
    expect(LOOP_CHOICES).toEqual([1, 2, 4, 8]);
    expect(CHANNEL_CHOICES).toEqual(["stereo", "mono"]);
    expect(FILE_CHOICES).toEqual(["mix", "stems"]);
  });

  it("offer the sequence showing or the song, and the sequence showing is what the export has always been", () => {
    expect(SCOPE_CHOICES).toEqual(["sequence", "song"]);
    expect(DEFAULT_EXPORT_OPTIONS.scope).toBe("sequence");
  });
});

describe("normalizeExportOptions", () => {
  it("keeps options that are choices", () => {
    expect(normalizeExportOptions({ loops: 4, channels: "mono", files: "stems", scope: "song" })).toEqual({
      loops: 4,
      channels: "mono",
      files: "stems",
      scope: "song",
    });
  });

  it("reads the scope an earlier version called all as the song, which it became (a saved choice is kept, not dropped)", () => {
    expect(normalizeExportOptions({ loops: 2, channels: "mono", files: "stems", scope: "all" })).toEqual({
      loops: 2,
      channels: "mono",
      files: "stems",
      scope: "song",
    });
  });

  it("takes options saved before there were stems as the mix, which is what they made, and before there was a scope as the sequence", () => {
    expect(normalizeExportOptions({ loops: 4, channels: "mono" })).toEqual({
      loops: 4,
      channels: "mono",
      files: "mix",
      scope: "sequence",
    });
  });

  it("falls back to the default for anything saved that is not a choice, each option on its own", () => {
    expect(normalizeExportOptions({ loops: 3, channels: "mono", files: "stems" })).toEqual({
      loops: 1,
      channels: "mono",
      files: "stems",
      scope: "sequence",
    });
    expect(normalizeExportOptions({ loops: 8, channels: "quad", files: "stems" })).toEqual({
      loops: 8,
      channels: "stereo",
      files: "stems",
      scope: "sequence",
    });
    expect(normalizeExportOptions({ loops: 8, channels: "mono", files: "zip", scope: "everything" })).toEqual({
      loops: 8,
      channels: "mono",
      files: "mix",
      scope: "sequence",
    });
    expect(normalizeExportOptions({ loops: "4", channels: 2, files: 1, scope: 3 })).toEqual(DEFAULT_EXPORT_OPTIONS);
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

describe("stemsInfo", () => {
  const options = { loops: 1, channels: "stereo", files: "stems" };

  it("says how many stems, how long each is, and how big the zip is: every file a whole export of its own, and the zip's headers", () => {
    const info = stemsInfo(songOf(1), options, 16, 1000, 5);
    const wav = 44 + 2000 * 2 * 2;
    expect(info).toEqual({
      frames: 2000,
      seconds: 2,
      bytes: 5 * (wav + ZIP_BYTES_PER_FILE) + 22,
      channels: "stereo",
      stems: 5,
    });
  });

  it("is as long as the mix, and follows the loops and the channels as it does", () => {
    const mix = exportInfo(songOf(2), { loops: 4, channels: "mono" }, 16, 1000);
    const stems = stemsInfo(songOf(2), { loops: 4, channels: "mono", files: "stems" }, 16, 1000, 3);
    expect(stems.frames).toBe(mix.frames);
    expect(stems.seconds).toBe(mix.seconds);
    expect(stems.channels).toBe("mono");
    expect(stems.bytes).toBe(3 * (mix.bytes + ZIP_BYTES_PER_FILE) + 22);
  });

  it("is about the headers' size when there are no stems", () => {
    expect(stemsInfo(songOf(1), options, 16, 1000, 0).bytes).toBe(22);
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

describe("exportReadout, for stems", () => {
  it("says how many stems, how long each is, the channels and the size of the zip", () => {
    expect(exportReadout({ seconds: 2, channels: "stereo", bytes: 1_800_000, stems: 5 })).toBe(
      "5 stems · 2.0 s each · stereo · 1.7 MB zip",
    );
  });

  it("says one stem, not one stems", () => {
    expect(exportReadout({ seconds: 4.8, channels: "mono", bytes: 423404, stems: 1 })).toBe(
      "1 stem · 4.8 s each · mono · 413 KB zip",
    );
  });

  it("says there are none when stems are chosen and no pad has a step", () => {
    expect(exportReadout({ seconds: 2, channels: "stereo", bytes: 22, stems: 0 })).toBe("No stems");
  });

  it("is the one line of a file when there are no stems to speak of", () => {
    expect(exportReadout({ seconds: 4.8, channels: "mono", bytes: 423404 })).toBe("4.8 s · mono · 413 KB");
  });
});

describe("exportHint", () => {
  it("is nothing for the mix: the dialog's own words about loops are its hint", () => {
    expect(exportHint("mix")).toBe("");
  });

  it("says what stems are: a file each, in a zip, not clipped, adding up to the mix", () => {
    const hint = exportHint("stems");
    expect(hint).toMatch(/one file for each pad/i);
    expect(hint).toMatch(/zip/i);
    expect(hint).toMatch(/not clipped/i);
    expect(hint).toMatch(/add up to the mix/i);
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

  it("says which stem it is on, of how many, with how far along the whole is", () => {
    expect(renderingLabel(0.4, { number: 3, count: 5 })).toBe("Rendering stem 3 of 5… 40%");
    expect(renderingLabel(null, { number: 1, count: 5 })).toBe("Rendering stem 1 of 5…");
    expect(renderingLabel(1, { number: 5, count: 5 })).toBe("Rendering stem 5 of 5… 100%");
  });

  it("does not say stem of a stem when there is only one", () => {
    expect(renderingLabel(0.5, { number: 1, count: 1 })).toBe("Rendering… 50%");
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

describe("exportMemoryBytes, for stems", () => {
  // A render is eight bytes a frame whatever the channels are; each stem's file is held until the zip is made, and the
  // zip's Blob is a copy of them: two bytes a sample, a channel each, twice
  it("is the render, and every stem's file twice (held, and copied into the zip)", () => {
    expect(exportMemoryBytes({ total: 2000, frames: 1000 }, { stems: 5, channels: "stereo" })).toBe(
      8 * 2000 + 2 * 5 * (1000 * 2 * 2),
    );
  });

  it("is smaller in mono: the files are half the size, the render is not", () => {
    const stereo = exportMemoryBytes({ total: 2000, frames: 1000 }, { stems: 5, channels: "stereo" });
    const mono = exportMemoryBytes({ total: 2000, frames: 1000 }, { stems: 5, channels: "mono" });
    expect(stereo - mono).toBe(2 * 5 * (1000 * 2));
  });

  it("grows with the number of stems, and is the same as the mix's when there are none asked for", () => {
    const plan = { total: 4000, frames: 2000 };
    expect(exportMemoryBytes(plan, { stems: 8, channels: "stereo" })).toBeGreaterThan(
      exportMemoryBytes(plan, { stems: 4, channels: "stereo" }),
    );
    expect(exportMemoryBytes(plan, { stems: 0 })).toBe(exportMemoryBytes(plan));
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

describe("largeExportNote, for stems", () => {
  it("says what makes it smaller: fewer loops, or mono (a mix has no stems to leave out)", () => {
    expect(largeExportNote(288 * MiB, { stems: 5 })).toBe(
      "Making this takes about 290 MB of memory, which a phone may not have to spare. Fewer loops or mono make it smaller.",
    );
  });

  it("is nothing under the threshold, as for a mix", () => {
    expect(largeExportNote(LARGE_EXPORT_BYTES - 1, { stems: 5 })).toBe("");
  });
});

describe("exportNote, for stems", () => {
  const rate = 44100;
  const plan = { total: 70 * rate, frames: 60 * rate }; // a minute: 10 MB a stem, and the file held twice over

  it("is nothing for a small set of stems with every bar filled", () => {
    expect(exportNote(plan, [], { stems: 4, channels: "stereo" })).toBe("");
  });

  it("warns where the stems together are large though one mix of the same length is not", () => {
    expect(exportNote(plan, [])).toBe("");
    expect(exportNote(plan, [], { stems: 16, channels: "stereo" })).toMatch(
      /^Making this takes about \d+ MB of memory/,
    );
  });

  it("puts the bars with no steps first, as for a mix", () => {
    const note = exportNote(plan, [2], { stems: 16, channels: "stereo" });
    expect(note.startsWith(emptyBarsNote([2]))).toBe(true);
    expect(note).toContain("Fewer loops or mono make it smaller.");
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

// 120 BPM: a bar is 2 s, so three sequences of 1, 2 and 1 bars are 8 s, and the tail is on the end of that.
describe("exporting the song", () => {
  const three = { bpm: 120, current: 1, sequences: [{ bars: 1 }, { bars: 2 }, { bars: 1 }] };
  // The same three sequences, in the order of a song that was edited: sequence 3 three times, then sequence 2 (whose two bars are 4 s),
  // and sequence 1 left out: 5 bars, 10 s, where the unedited song is 4 bars and 8 s.
  const edited = {
    ...three,
    arrangement: [
      { sequence: 2, repeats: 3 },
      { sequence: 1, repeats: 1 },
    ],
  };

  it("is 4 s of tail, for what rings on after the last step", () => {
    expect(SONG_TAIL_SECONDS).toBe(4);
  });

  it("counts the steps of every sequence, once each, when the song has not been edited", () => {
    expect(songSteps(three, 16)).toBe(64);
    expect(songSteps({ bpm: 120, current: 0, sequences: [{ bars: 8 }] }, 16)).toBe(128);
  });

  it("counts the steps of the song as it is arranged: each entry as often as it repeats, and a sequence left out not at all", () => {
    expect(songSteps(edited, 16)).toBe(3 * 16 + 32);
    expect(songSteps({ ...three, arrangement: [{ sequence: 0, repeats: 16 }] }, 16)).toBe(16 * 16);
  });

  it("reads an arrangement that does not fit the sequences as the song would (an entry for a sequence there is not is dropped)", () => {
    expect(
      songSteps(
        {
          ...three,
          arrangement: [
            { sequence: 5, repeats: 2 },
            { sequence: 0, repeats: 1 },
          ],
        },
        16,
      ),
    ).toBe(16);
    expect(songSteps({ ...three, arrangement: [{ sequence: 5, repeats: 2 }] }, 16)).toBe(64); // none left: every sequence once
  });

  it("lists the sequence of each pass, with the repeats counted out", () => {
    expect(songPassOrder(three)).toEqual([0, 1, 2]);
    expect(songPassOrder(edited)).toEqual([2, 2, 2, 1]);
  });

  it("is the length of the song as arranged, and the tail, in frames", () => {
    expect(exportFrames(edited, 16, 1, 1000, "song")).toBe((10 + SONG_TAIL_SECONDS) * 1000);
    expect(exportFrames({ ...three, arrangement: [{ sequence: 0, repeats: 4 }] }, 16, 1, 1000, "song")).toBe(
      (8 + SONG_TAIL_SECONDS) * 1000,
    );
  });

  it("does not change what the sequence showing is, whatever the song has", () => {
    expect(exportFrames(edited, 16, 2, 1000, "sequence")).toBe(8 * 1000); // two loops of the second sequence, as before
  });

  it("is the steps of all of them and then the tail, in frames of the rate, and loops add nothing", () => {
    expect(exportFrames(three, 16, 1, 1000, "song")).toBe((8 + SONG_TAIL_SECONDS) * 1000);
    expect(exportFrames(three, 16, 8, 1000, "song")).toBe((8 + SONG_TAIL_SECONDS) * 1000);
    expect(exportFrames(three, 16, 1, 1000, "sequence")).toBe(4 * 1000); // the one showing, the second of the three, as before
    expect(exportFrames(three, 16, 1, 1000)).toBe(4 * 1000);
  });

  it("rounds the length once, to the nearest frame, not down", () => {
    // 130 BPM: a bar is 1.846153… s, and with the tail 5.846153… s, which at 1900 Hz is 11107.69 frames
    const song = { bpm: 130, current: 0, sequences: [{ bars: 1 }] };
    expect(exportFrames(song, 16, 1, 1900, "song")).toBe(11108);
  });

  it("says how long and how big the file will be by the scope in the options, as the loops are not counted", () => {
    const info = exportInfo(three, { loops: 4, channels: "mono", scope: "song" }, 16, 1000);
    expect(info).toMatchObject({ frames: 12000, seconds: 12, channels: "mono" });
    expect(info.bytes).toBe(44 + 12000 * 2);
    const sequence = exportInfo(three, { loops: 4, channels: "mono", scope: "sequence" }, 16, 1000);
    expect(sequence.frames).toBe(16000); // four loops of the sequence showing
  });

  it("says it for stems too: each is as long as the whole", () => {
    const info = stemsInfo(three, { scope: "song", channels: "stereo" }, 16, 1000, 3);
    expect(info.frames).toBe(12000);
    expect(info.stems).toBe(3);
  });

  it("is headed by how many entries the song has and the tempo: the sequences when it has not been edited", () => {
    expect(exportTitle(three, "song")).toBe("SONG · 3 ENTRIES · 120 BPM");
    expect(exportTitle({ ...three, sequences: [{ bars: 1 }] }, "song")).toBe("SONG · 1 ENTRY · 120 BPM");
    expect(exportTitle(edited, "song")).toBe("SONG · 2 ENTRIES · 120 BPM"); // the entries, not the passes and not the sequences
    expect(exportTitle(three, "sequence")).toBe("SEQ 02 · 2 BARS · 120 BPM");
    expect(exportTitle(three)).toBe("SEQ 02 · 2 BARS · 120 BPM");
  });

  it("says what the file is, in the hint, with the stems' own words for stems, and that a sound longer than the tail is cut", () => {
    expect(exportHint("mix", "song")).toMatch(/each entry of the song, in order/i);
    expect(exportHint("mix", "song")).toMatch(/as many times as it repeats/i);
    expect(exportHint("mix", "song")).toMatch(/4 s/);
    expect(exportHint("mix", "song")).toMatch(/longer sound is cut/i);
    expect(exportHint("mix", "sequence")).toBe("");
    expect(exportHint("stems", "song")).toMatch(/one file for each pad/i);
    expect(exportHint("stems", "song")).toMatch(/each entry of the song, in order/i);
    expect(exportHint("stems")).toBe(exportHint("stems", "sequence"));
  });

  it("says which sequences have no steps, and that they are in the file as silence", () => {
    expect(emptySequencesNote([])).toBe("");
    expect(emptySequencesNote([3])).toBe("Sequence 3 has no steps: nothing plays in it but what is still ringing.");
    expect(emptySequencesNote([2, 3, 5])).toBe(
      "Sequences 2–3 and 5 have no steps: nothing plays in them but what is still ringing.",
    );
    expect(emptySequencesNote([1, 4])).toBe(
      "Sequences 1 and 4 have no steps: nothing plays in them but what is still ringing.",
    );
  });

  it("advises what makes a large export of the song smaller: a shorter song, not loops, which it does not have", () => {
    const big = 300 * 1024 * 1024;
    expect(largeExportNote(big, { scope: "song" })).toMatch(
      /A shorter song, or one sequence at a time, makes it smaller\.$/,
    );
    expect(largeExportNote(big, { scope: "song" })).not.toMatch(/loops/);
    expect(largeExportNote(big, { scope: "song", stems: 4 })).toMatch(
      /Mono, a shorter song, or one sequence at a time, makes it smaller\.$/,
    );
    expect(largeExportNote(big, { scope: "song", stems: 4 })).not.toMatch(/loops/);
    expect(largeExportNote(big, { scope: "sequence" })).toMatch(/Fewer loops make it smaller\./);
    expect(largeExportNote(big, { stems: 4 })).toMatch(/Fewer loops or mono make it smaller\./);
    expect(largeExportNote(big, {})).toMatch(/Fewer loops make it smaller\./);
  });

  it("puts the empty sequences in the note in place of the empty bars, with the memory warning after them", () => {
    const plan = { total: 1000, frames: 1000 };
    expect(exportNote(plan, [], {}, [3])).toBe(
      "Sequence 3 has no steps: nothing plays in it but what is still ringing.",
    );
    const big = { total: 40_000_000, frames: 40_000_000 };
    expect(exportNote(big, [], {}, [3])).toMatch(/^Sequence 3 has no steps.*Making this takes about/);
    expect(exportNote(plan, [2], {}, [])).toBe(emptyBarsNote([2]));
  });

  it("is blocked for no steps in any sequence with its own words, after the browser's", () => {
    expect(exportBlockedReason({ supported: true, hasSteps: false, scope: "song" })).toMatch(
      /no sequence has any steps/i,
    );
    expect(exportBlockedReason({ supported: true, hasSteps: false, scope: "sequence" })).toMatch(
      /this sequence has no steps/i,
    );
    expect(exportBlockedReason({ supported: true, hasSteps: false })).toMatch(/this sequence has no steps/i);
    expect(exportBlockedReason({ supported: false, hasSteps: false, scope: "song" })).toMatch(/cannot render audio/);
    expect(exportBlockedReason({ supported: true, hasSteps: true, scope: "song" })).toBe("");
  });

  it("is blocked for a song longer than Export can make, with how long it is and how long Export goes to", () => {
    const reason = exportBlockedReason({ supported: true, hasSteps: true, scope: "song", seconds: 432 });
    expect(reason).toMatch(/7 min 12 s/);
    expect(reason).toMatch(/6 min 40 s/);
    expect(reason).toMatch(/fewer repeats or entries/i);
    expect(
      exportBlockedReason({ supported: true, hasSteps: true, scope: "song", seconds: MAX_SONG_EXPORT_SECONDS }),
    ).toBe(""); // as long as it may be is not too long
  });

  it("puts the browser first and no steps second, before a song that is too long: the long one is not the first thing to fix", () => {
    const long = { hasSteps: true, scope: "song", seconds: 9999 };
    expect(exportBlockedReason({ ...long, supported: false })).toMatch(/cannot render audio/);
    expect(exportBlockedReason({ ...long, supported: true, hasSteps: false })).toMatch(/no sequence has any steps/i);
  });

  it("does not say it of the sequence showing, whose length the loops make and the page's size note warns of", () => {
    expect(exportBlockedReason({ supported: true, hasSteps: true, scope: "sequence", seconds: 9999 })).toBe("");
    expect(exportBlockedReason({ supported: true, hasSteps: true, seconds: 9999 })).toBe("");
  });
});

describe("how long a song may be", () => {
  // 120 BPM: a bar of 16 steps is 2 s, so a sequence of 8 bars is 16 s.
  const long = (arrangement, sequences = [{ bars: 8 }]) => ({ bpm: 120, current: 0, sequences, arrangement });

  it("is 400 s, the file and its tail: as large as the biggest export that is made today (eight bars at 40 BPM, eight times over, is 388 s)", () => {
    expect(MAX_SONG_EXPORT_SECONDS).toBe(400);
    const biggest = { bpm: 40, current: 0, sequences: Array.from({ length: 8 }, () => ({ bars: 8 })) };
    expect(songTooLong(biggest, 16)).toBe(false);
    expect(songFileSeconds(biggest, 16)).toBe(384 + SONG_TAIL_SECONDS);
  });

  it("counts the tail with the song, and the repeats of every entry", () => {
    expect(songFileSeconds(long([{ sequence: 0, repeats: 3 }]), 16)).toBe(3 * 16 + SONG_TAIL_SECONDS);
  });

  it("allows a file of exactly the longest length and not a step more", () => {
    const sequences = [{ bars: 8 }, { bars: 6 }];
    // 24 passes of 16 s and one of 12 s are 396 s, and the tail is the rest
    const atTheCap = long(
      [
        { sequence: 0, repeats: 16 },
        { sequence: 0, repeats: 8 },
        { sequence: 1, repeats: 1 },
      ],
      sequences,
    );
    expect(songFileSeconds(atTheCap, 16)).toBe(MAX_SONG_EXPORT_SECONDS);
    expect(songTooLong(atTheCap, 16)).toBe(false);
    const over = long([...atTheCap.arrangement, { sequence: 1, repeats: 1 }], sequences);
    expect(songTooLong(over, 16)).toBe(true);
  });

  it("is a matter of the song's time, and so of the tempo: a slow song of few bars is long", () => {
    const slow = { bpm: 20, current: 0, sequences: [{ bars: 8 }], arrangement: [{ sequence: 0, repeats: 5 }] };
    expect(songTooLong(slow, 16)).toBe(true); // 8 bars at 20 BPM is 96 s: five of them are 480 s
    expect(songTooLong({ ...slow, bpm: 40 }, 16)).toBe(false);
  });

  it("is within what the arrangement can hold: the most a song can be (32 entries of 16 repeats) is far over it, so the cap is what limits it", () => {
    const most = long(Array.from({ length: 32 }, () => ({ sequence: 0, repeats: 16 })));
    expect(songTooLong(most, 16)).toBe(true);
  });
});
