// What the Export dialog shows and allows, decided apart from the DOM it is drawn into (export-dialog.js), so that it can be
// tested: which controls are on, which parts are showing, what the Cancel button says, and what the dialog is described by;
// when a press is too soon after a render started or stopped to be meant for the button that is there now; and what the
// page tells the dialog about the sequence showing (its heading, what the file will be, a note, why it cannot be made).
// No DOM, and nothing at import time.
//
//   const state = dialogState({ busy, cancelling, blocked, hasNote, files });   // { optionsDisabled, goHidden, cancelLabel, ... }
//   isEarlyPress(event.timeStamp, changedAt)                             // a double click's second press, say
//   exportDialogModel({ song, kit, options, stepsPerBar, sampleRate, supported })   // what `dialog.refresh` is given

import {
  exportBlockedReason,
  exportFormat,
  exportHint,
  exportInfo,
  exportNote,
  exportReadout,
  exportTitle,
  stemsInfo,
} from "./export-options.js";
import { emptyBars, hasSteps, planRender, stemPads } from "./export-wav.js";

// A press this soon after a render started or stopped was meant for the button that was there before it (a double click on
// Export WAV, or on Cancel export), and not for the one in its place now.
export const SETTLE_MS = 500;

export const isEarlyPress = (eventTime, changedAt) => eventTime - changedAt < SETTLE_MS;

// `busy`: a render is going on. `cancelling`: a cancel has been asked for and the render is still stopping. `blocked`: why
// Export WAV is off ("" when it is on). `hasNote`: there is a note to show. `describedBy` names the parts of the dialog
// that are read out with its name when it opens ("hint", "note"): what is wrong, and what to know before pressing. `files`
// is what will be made, "mix" or "stems", which the button says.
export function dialogState({ busy, cancelling, blocked, hasNote, files = "mix" }) {
  return {
    busy,
    optionsDisabled: busy,
    closeDisabled: busy,
    goHidden: busy, // the Cancel export button takes its place, and the focus
    goDisabled: blocked !== "",
    barHidden: !busy,
    progressHidden: !busy,
    hintHidden: busy,
    noteHidden: busy || !hasNote,
    cancelLabel: cancelling ? "Cancelling…" : busy ? "Cancel export" : "Cancel",
    goLabel: files === "stems" ? "Export ZIP" : "Export WAV",
    describedBy: [blocked !== "" && "hint", hasNote && !busy && "note"].filter(Boolean),
  };
}

// What the page gives the dialog for the sequence showing: its heading, what the file will be and in what format, a hint
// for the choice of files ("" for the mix: the dialog's own), a note
// (bars with no steps, how much memory it takes) and `blocked`, the reason Export WAV is off. `supported` is whether the
// browser can render audio to a file. A sequence with nothing in it is blocked with its own reason and has no note: that is
// said once.
export function exportDialogModel({ song, kit, options, stepsPerBar, sampleRate, supported }) {
  const nothing = !hasSteps(song, stepsPerBar);
  const stems = options.files === "stems" ? stemPads(song, stepsPerBar).length : 0;
  const memory = stems ? { stems, channels: options.channels } : {};
  const note = nothing
    ? ""
    : exportNote(
        planRender({ song, kit, stepsPerBar, sampleRate, loops: options.loops }),
        emptyBars(song, stepsPerBar),
        memory,
      );
  const info = stems
    ? stemsInfo(song, options, stepsPerBar, sampleRate, stems)
    : exportInfo(song, options, stepsPerBar, sampleRate);
  return {
    title: exportTitle(song),
    readout: exportReadout(info),
    format: exportFormat(sampleRate),
    note,
    hint: exportHint(options.files),
    blocked: exportBlockedReason({ supported, hasSteps: !nothing }),
  };
}
