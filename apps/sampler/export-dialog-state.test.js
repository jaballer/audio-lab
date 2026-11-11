import { describe, expect, it } from "vitest";
import { EXPORT_SAMPLE_RATE } from "./export-wav.js";
import { SETTLE_MS, dialogState, exportDialogModel, isEarlyPress } from "./export-dialog-state.js";
import { createKit } from "./kit.js";

const idle = { busy: false, cancelling: false, blocked: "", hasNote: false };

describe("dialogState", () => {
  it("is every control on, and the file box showing its hint, when it is idle", () => {
    expect(dialogState(idle)).toEqual({
      busy: false,
      optionsDisabled: false,
      closeDisabled: false,
      goHidden: false,
      goDisabled: false,
      barHidden: true,
      progressHidden: true,
      hintHidden: false,
      noteHidden: true,
      cancelLabel: "Cancel",
      goLabel: "Export WAV",
      loopsHidden: false,
      describedBy: [],
    });
  });

  it("takes the loops off for all the sequences, which have none to repeat, and for nothing else", () => {
    expect(dialogState({ ...idle, scope: "all" }).loopsHidden).toBe(true);
    expect(dialogState({ ...idle, scope: "sequence" }).loopsHidden).toBe(false);
    expect(dialogState({ ...idle }).loopsHidden).toBe(false);
  });

  it("says Export ZIP on the button when it is the stems that will be made, and Export WAV for the mix", () => {
    expect(dialogState({ ...idle, files: "stems" }).goLabel).toBe("Export ZIP");
    expect(dialogState({ ...idle, files: "mix" }).goLabel).toBe("Export WAV");
    expect(dialogState({ ...idle, files: "anything else" }).goLabel).toBe("Export WAV");
  });

  it("shows the note, and describes the dialog by it, when there is one", () => {
    const state = dialogState({ ...idle, hasNote: true });
    expect(state.noteHidden).toBe(false);
    expect(state.describedBy).toEqual(["note"]);
  });

  it("turns Export WAV off, and describes the dialog by the reason, when it is blocked", () => {
    const state = dialogState({ ...idle, blocked: "No steps." });
    expect(state.goDisabled).toBe(true);
    expect(state.hintHidden).toBe(false); // the reason is in the hint's place
    expect(state.describedBy).toEqual(["hint"]);
  });

  it("describes it by both, the reason first, when it is blocked and has a note", () => {
    expect(dialogState({ ...idle, blocked: "No.", hasNote: true }).describedBy).toEqual(["hint", "note"]);
  });

  it("locks the choices and the close button, swaps Export WAV for Cancel export, and shows the progress, while it renders", () => {
    const state = dialogState({ ...idle, busy: true });
    expect(state).toMatchObject({
      busy: true,
      optionsDisabled: true,
      closeDisabled: true,
      goHidden: true,
      barHidden: false,
      progressHidden: false,
      hintHidden: true,
      cancelLabel: "Cancel export",
    });
  });

  it("hides the note while it renders, and does not describe the dialog by it", () => {
    const state = dialogState({ ...idle, busy: true, hasNote: true });
    expect(state.noteHidden).toBe(true);
    expect(state.describedBy).toEqual([]);
  });

  it("says Cancelling while a cancel is being waited for", () => {
    expect(dialogState({ ...idle, busy: true, cancelling: true }).cancelLabel).toBe("Cancelling…");
  });

  it("goes by what it is told: the dialog clears `cancelling` when the render stops, and the state does not second-guess it", () => {
    expect(dialogState({ ...idle, busy: false, cancelling: true }).cancelLabel).toBe("Cancelling…");
    expect(dialogState({ ...idle, busy: false, cancelling: false }).cancelLabel).toBe("Cancel");
  });
});

describe("isEarlyPress", () => {
  it("is a press within half a second of a render starting or stopping: it was meant for the button that was there", () => {
    expect(SETTLE_MS).toBe(500);
    expect(isEarlyPress(1000, 700)).toBe(true);
    expect(isEarlyPress(1000, 501)).toBe(true);
  });

  it("is not a press at or after half a second", () => {
    expect(isEarlyPress(1000, 500)).toBe(false);
    expect(isEarlyPress(1000, 0)).toBe(false);
  });

  it("is not a press when nothing has ever started or stopped (a dialog that was just opened)", () => {
    expect(isEarlyPress(1000, -Infinity)).toBe(false);
  });
});

describe("exportDialogModel", () => {
  const sound = () => ({ id: "s", name: "s", play() {} });
  const kit = createKit(Array.from({ length: 16 }, sound)); // the pads of the page
  const song = (bars, pattern, bpm = 120) => ({
    bpm,
    volume: 80,
    current: 0,
    sequences: [{ bars, pattern, velocities: {} }],
  });
  const model = (songValue, options = { loops: 1, channels: "stereo" }, supported = true) =>
    exportDialogModel({ song: songValue, kit, options, stepsPerBar: 16, sampleRate: EXPORT_SAMPLE_RATE, supported });

  it("is the heading, what the file will be, its format, and nothing to warn of or to block, for an ordinary sequence", () => {
    expect(model(song(1, { 0: [0, 4] }))).toEqual({
      title: "SEQ 01 · 1 BAR · 120 BPM",
      readout: "2.0 s · stereo · 345 KB",
      format: "16-bit 44.1 kHz",
      note: "",
      hint: "",
      blocked: "",
    });
  });

  describe("for stems", () => {
    const stems = { loops: 1, channels: "stereo", files: "stems" };
    // Pads 0, 3 and 9 have steps: three stems
    const three = song(1, { 0: [0, 4], 3: [8], 9: [12] });

    it("counts a stem for each pad that has steps, in the readout, and says what they are in the hint", () => {
      const m = model(three, stems);
      expect(m.readout).toMatch(/^3 stems · 2\.0 s each · stereo · \d+(\.\d)? (KB|MB) zip$/);
      expect(m.hint).toMatch(/one file for each pad/i);
      expect(m.title).toBe("SEQ 01 · 1 BAR · 120 BPM");
      expect(m.format).toBe("16-bit 44.1 kHz");
    });

    it("is as big as the zip will be: a file for each pad", () => {
      // 240 BPM: a bar of a second, 172 KB a stem, so three stay in kilobytes
      const size = (pads) => Number(model(song(1, pads, 240), stems).readout.match(/([\d.]+) KB zip/)[1]);
      const one = size({ 0: [0] });
      expect(size({ 0: [0], 3: [8], 9: [12] })).toBeGreaterThan(one * 2.9);
      expect(size({ 0: [0], 3: [8], 9: [12] })).toBeLessThan(one * 3.1);
    });

    it("follows the loops and the channels", () => {
      expect(model(three, { ...stems, loops: 4, channels: "mono" }).readout).toMatch(
        /^3 stems · 8\.0 s each · mono · /,
      );
    });

    it("says the memory it takes where the stems together are large, though one mix that long would not be", () => {
      const long = song(
        8,
        { 0: [0], 1: [1], 2: [2], 3: [3], 4: [4], 5: [5], 6: [6], 7: [7], 8: [8], 9: [9], 10: [10], 11: [11] },
        40,
      );
      const mix = model(long, { loops: 4, channels: "stereo" });
      expect(mix.note).not.toMatch(/memory/);
      const many = model(long, { loops: 4, channels: "stereo", files: "stems" });
      expect(many.note).toMatch(/Making this takes about \d+ MB of memory.*Fewer loops or mono make it smaller\./);
    });

    it("is blocked for a sequence with nothing in it, as the mix is, and says it has no stems and not the mix's size", () => {
      const m = model(song(2, {}), stems);
      expect(m.readout).toBe("No stems");
      expect(m.blocked).toBe("This sequence has no steps yet, so there is nothing to export.");
      expect(m.note).toBe("");
    });

    it("leaves the mix's readout and hint as they were when the choice is the mix", () => {
      const m = model(three, { loops: 1, channels: "stereo", files: "mix" });
      expect(m.readout).toBe("2.0 s · stereo · 345 KB");
      expect(m.hint).toBe("");
    });
  });

  it("follows the options: loops and mono change the length and the size", () => {
    const m = model(song(1, { 0: [0] }), { loops: 4, channels: "mono" });
    expect(m.readout).toBe("8.0 s · mono · 689 KB");
  });

  it("says which bars have no steps", () => {
    expect(model(song(4, { 0: [0, 33] })).note).toBe(
      "Bars 2 and 4 have no steps: nothing plays in them but what is still ringing.",
    );
  });

  it("warns of a large export, and says nothing of one that fits", () => {
    const big = model(song(8, { 0: [0, 64] }, 40), { loops: 8, channels: "stereo" });
    expect(big.note).toMatch(/Making this takes about \d+ MB of memory/);
    expect(model(song(8, { 0: [0, 64] }, 40), { loops: 1, channels: "stereo" }).note).toMatch(/^Bars 2/);
    expect(model(song(8, { 0: [0, 64] }, 40), { loops: 1, channels: "stereo" }).note).not.toMatch(/memory/);
  });

  it("counts a loaded sample's long release: it adds a warm-up pass, so the memory figure is bigger", () => {
    const sample = { id: "s", name: "s", play() {}, setTrim() {} };
    const withSample = createKit([sample, sound()]);
    withSample.setSetting(0, "release", 100); // 5 s, in a loop of 48 s: a second warm-up pass
    const megabytes = (kitValue) =>
      Number(
        exportDialogModel({
          song: song(8, { 0: [0] }, 40),
          kit: kitValue,
          options: { loops: 8, channels: "stereo" },
          stepsPerBar: 16,
          sampleRate: EXPORT_SAMPLE_RATE,
          supported: true,
        }).note.match(/about (\d+) MB/)[1],
      );
    expect(megabytes(withSample)).toBeGreaterThan(megabytes(kit));
  });

  it("gives both, the bars first, when both apply", () => {
    const m = model(song(8, { 0: [0] }, 40), { loops: 8, channels: "stereo" });
    expect(m.note.indexOf("Bars 2")).toBe(0);
    expect(m.note).toMatch(/ Making this takes about /);
  });

  it("has no note, and blocks Export WAV with the reason, for a sequence with nothing in it", () => {
    const m = model(song(2, {}));
    expect(m.note).toBe("");
    expect(m.blocked).toBe("This sequence has no steps yet, so there is nothing to export.");
  });

  describe("for all the sequences", () => {
    const song3 = (patterns, bars = [1, 1, 1], extra = {}) => ({
      bpm: 120,
      volume: 80,
      current: 0,
      sequences: patterns.map((pattern, i) => ({ bars: bars[i] ?? 1, pattern, velocities: {} })),
      ...extra,
    });
    const all = { loops: 4, channels: "stereo", files: "mix", scope: "all" };

    it("is headed by how many there are, and says how long the whole is and how big, with the tail on the end", () => {
      const m = model(song3([{ 0: [0] }, { 1: [0] }]), all); // two bars of 2 s, and 4 s of tail
      expect(m.title).toBe("ALL · 2 SEQUENCES · 120 BPM");
      expect(m.readout).toMatch(/^8\.0 s · stereo · 1\.\d MB$/);
      expect(m.blocked).toBe("");
    });

    it("does not count loops, or follow them", () => {
      const one = model(song3([{ 0: [0] }]), { ...all, loops: 1 });
      expect(model(song3([{ 0: [0] }]), { ...all, loops: 8 }).readout).toBe(one.readout);
    });

    it("says what the file is in the hint, with the stems' own words for stems", () => {
      expect(model(song3([{ 0: [0] }]), all).hint).toMatch(/every sequence, in order, once each/i);
      expect(model(song3([{ 0: [0] }]), { ...all, files: "stems" }).hint).toMatch(/one file for each pad/i);
    });

    it("says which sequences have no steps, and not which bars, and that they are in the file", () => {
      const m = model(song3([{ 0: [0] }, {}, { 1: [0] }], [1, 1, 2]), all);
      expect(m.note).toBe("Sequence 2 has no steps: nothing plays in it but what is still ringing.");
    });

    it("does not list the empty bars of the sequence showing: the note is of sequences, for the whole", () => {
      const m = model(song3([{ 0: [0] }, { 1: [0] }], [2, 1]), all); // the first has two bars and a step only in the first
      expect(m.note).toBe("");
      expect(model(song3([{ 0: [0] }, { 1: [0] }], [2, 1]), { ...all, scope: "sequence" }).note).toMatch(
        /^Bar 2 has no steps/,
      );
    });

    it("exports when the sequence showing is empty and another is not, and blocks only when none has a step", () => {
      expect(model(song3([{}, { 0: [0] }]), all).blocked).toBe("");
      expect(model(song3([{}, { 0: [0] }]), { ...all, scope: "sequence" }).blocked).toMatch(
        /this sequence has no steps/i,
      );
      const none = model(song3([{}, {}]), all);
      expect(none.blocked).toBe("No sequence has any steps yet, so there is nothing to export.");
      expect(none.note).toBe("");
    });

    it("counts a stem for each pad of any sequence, each as long as the whole", () => {
      const m = model(song3([{ 0: [0] }, { 3: [0] }, { 0: [4], 9: [0] }]), { ...all, files: "stems" });
      expect(m.readout).toMatch(/^3 stems · 10\.0 s each · stereo · /); // three bars of 2 s and the tail
    });

    it("says the memory it takes where the whole is large", () => {
      const long = song3(
        Array.from({ length: 8 }, () => ({ 0: [0] })),
        Array.from({ length: 8 }, () => 8),
        { bpm: 40 },
      );
      expect(model(long, all).note).toMatch(/Making this takes about \d+ MB of memory/);
    });
  });

  it("blocks it, with the browser first, when the browser cannot render a file", () => {
    expect(model(song(1, { 0: [0] }), undefined, false).blocked).toMatch(/browser/);
    expect(model(song(1, {}), undefined, false).blocked).toMatch(/browser/);
  });
});
