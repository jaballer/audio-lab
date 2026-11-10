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
      describedBy: [],
    });
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
  const kit = createKit([sound(), sound()]);
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
      blocked: "",
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

  it("blocks it, with the browser first, when the browser cannot render a file", () => {
    expect(model(song(1, { 0: [0] }), undefined, false).blocked).toMatch(/browser/);
    expect(model(song(1, {}), undefined, false).blocked).toMatch(/browser/);
  });
});
