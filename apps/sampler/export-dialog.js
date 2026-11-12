// The Export dialog: what the file will be (the sequence showing or the song, the mix or a stem for each pad, loops, stereo
// or mono, and how long and how big that makes it), a button to make it, and how far along the render is. This file is only the dialog: it shows what it is told and
// reports what is pressed; the page decides what an export is (export-wav.js) and when it may run.
//
//   const dialog = createExportDialog(element, {   // a <dialog> whose markup has the parts named by data-export (index.html)
//     onChange: (options) => {},   // a choice was pressed: { loops, channels, files, scope }
//     onExport: () => {},          // Export WAV (or Export ZIP, for stems) was pressed
//     onCancel: () => {},          // Cancel export was pressed, or Escape, while it renders
//     opener: button,              // optional: the button that opens it, which gets the focus back when it closes
//   });
//   dialog.open(); dialog.close(); dialog.isOpen;
//   dialog.setOptions({ loops: 2, channels: "mono", files: "mix", scope: "sequence" }); // which choices are lit, and what the button says
//   dialog.refresh({ title, readout, format, note, hint, blocked }); // for the sequence showing: `note` is what to know before it
//                                                             is made (bars with no steps, how much memory it takes);
//                                                             `hint` is about the choice of files ("": the dialog's own);
//                                                             `blocked` is why Export is off (a sentence), or "" when on
//   dialog.setBusy(true); dialog.setProgress(0.4);            // while it renders (null: not known yet)
//   dialog.setStem({ number: 3, count: 5 });                  // which stem it is on, for stems
//   dialog.setCancelling();                                   // a cancel was asked for, and the render is still stopping
//   dialog.showMessage("EXPORT CANCELLED");                   // the LCD's short messages, again: the LCD is behind the dialog
//
// A native <dialog> opened with showModal(), so the page behind it cannot be reached by key or pointer, Tab stays
// inside it, Escape closes it and focus goes back to the button that opened it. While it renders it cannot be
// closed (the × is off, a click outside is ignored), and Escape cancels the render instead: the render goes on in the
// background, and a dialog that closed would leave nothing to say how far it had got, or a way to stop it.

import { setAttr, setDisabled, setHidden, setText } from "../../shared/dom-updates.js";
import { dialogState, isEarlyPress } from "./export-dialog-state.js";
import { CHANNEL_CHOICES, FILE_CHOICES, LOOP_CHOICES, SCOPE_CHOICES, renderingLabel } from "./export-options.js";

const CHANNEL_NAMES = { stereo: "Stereo", mono: "Mono" };
const SCOPE_NAMES = { sequence: "Showing", song: "Song" };
const SCOPE_DESCRIPTIONS = {
  sequence: "The sequence showing",
  song: "The song, in the order of the Song panel, each entry as often as it repeats",
};
const FILE_NAMES = { mix: "Mix", stems: "Stems" };
const FILE_DESCRIPTIONS = { mix: "One file: the mix", stems: "Stems: a file for each pad, in a zip" };
const PERCENT = 100;

export function createExportDialog(root, { onChange, onExport, onCancel, opener = null }) {
  const part = (name) => root.querySelector(`[data-export="${name}"]`);
  const title = part("title");
  const readout = part("readout");
  const format = part("format");
  const note = part("note");
  const hint = part("hint");
  const defaultHint = hint.textContent.replace(/\s+/g, " ").trim();
  const bar = part("bar");
  const fill = bar.firstElementChild;
  const progress = part("progress");
  const message = part("message");
  const closeButton = part("close");
  const cancelButton = part("cancel");
  const goButton = part("go");

  let busy = false;
  let cancelling = false;
  let blocked = "";
  let changedAt = -Infinity; // when a render last started or stopped, in the clock of event.timeStamp
  let latest = ""; // the last message said while it renders, shown when it stops: "EXPORTING..." is the progress bar's job
  let current = {
    loops: LOOP_CHOICES[0],
    channels: CHANNEL_CHOICES[0],
    files: FILE_CHOICES[0],
    scope: SCOPE_CHOICES[0],
  };
  const loopsRow = part("loops-row"); // the song has no loops to repeat: the row goes
  let stem = null; // which stem a render is on, for the label: { number, count }
  let fraction = null; // how far along it is, kept so that a change of stem can say it again

  // One button per choice, the chosen one lit, like the length keys on the page.
  function choices(group, option, values, labelOf, nameOf) {
    return values.map((value) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-small btn-led";
      button.textContent = labelOf(value);
      button.setAttribute("aria-label", nameOf(value));
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => onChange({ ...current, [option]: value }));
      group.append(button);
      return { value, button };
    });
  }
  const scopeButtons = choices(
    part("scope"),
    "scope",
    SCOPE_CHOICES,
    (name) => SCOPE_NAMES[name],
    (name) => SCOPE_DESCRIPTIONS[name],
  );
  const fileButtons = choices(
    part("files"),
    "files",
    FILE_CHOICES,
    (name) => FILE_NAMES[name],
    (name) => FILE_DESCRIPTIONS[name],
  );
  const loopButtons = choices(part("loops"), "loops", LOOP_CHOICES, String, (n) => (n === 1 ? "1 loop" : `${n} loops`));
  const channelButtons = choices(
    part("channels"),
    "channels",
    CHANNEL_CHOICES,
    (name) => CHANNEL_NAMES[name],
    (name) => CHANNEL_NAMES[name],
  );

  const isOpen = () => root.hasAttribute("open");

  function open() {
    if (!isOpen()) {
      setText(message, ""); // whatever the last export said is old news
      changedAt = -Infinity; // and a press now is meant for what it shows now: nothing ran before it was opened
      if (typeof root.showModal === "function") root.showModal();
      else root.setAttribute("open", ""); // a browser without <dialog>: not modal, but the page ignores its keys while it is open
    }
    // Export WAV when it can be pressed, otherwise Cancel (a disabled button cannot take focus, and the first one in the
    // dialog would be the ×, with nothing said about why the export is off: see `blocked` in draw()).
    [goButton, cancelButton].find((button) => !button.disabled && !button.hidden)?.focus();
  }

  function close() {
    if (busy) return;
    if (typeof root.close === "function") root.close();
    else root.removeAttribute("open");
  }

  // What can be pressed and what is shown follow from `busy`, `cancelling` and `blocked` (dialogState decides, and is tested);
  // this writes it, and only what changed.
  function draw() {
    const state = dialogState({
      busy,
      cancelling,
      blocked,
      hasNote: note.textContent !== "",
      files: current.files,
      scope: current.scope,
    });
    root.classList.toggle("is-busy", state.busy);
    setAttr(root, "aria-busy", String(state.busy));
    for (const { button } of [...scopeButtons, ...fileButtons, ...loopButtons, ...channelButtons])
      setDisabled(button, state.optionsDisabled, cancelButton);
    setHidden(loopsRow, state.loopsHidden, cancelButton);
    setDisabled(closeButton, state.closeDisabled, cancelButton);
    setHidden(goButton, state.goHidden, cancelButton); // the Cancel export button takes its place, and the focus
    setDisabled(goButton, state.goDisabled, cancelButton);
    setHidden(bar, state.barHidden);
    setHidden(progress, state.progressHidden);
    setHidden(hint, state.hintHidden);
    setHidden(note, state.noteHidden);
    setText(cancelButton, state.cancelLabel);
    setText(goButton, state.goLabel);
    // What is wrong (the reason Export WAV is off) and what to know before pressing it (the note) are read out with the
    // dialog's name when it opens, not left to be found by browsing.
    const described = state.describedBy.map((name) => (name === "hint" ? hint : note).id).join(" ");
    if (described) setAttr(root, "aria-describedby", described);
    else root.removeAttribute("aria-describedby");
  }

  function setProgress(next) {
    fraction = next;
    const label = renderingLabel(fraction, stem);
    setText(progress, label);
    if (fraction === null) {
      bar.removeAttribute("aria-valuenow"); // not known yet: a bar with no value says it is working, not that it is at 0
      bar.removeAttribute("aria-valuetext");
      fill.style.width = "0%";
      return;
    }
    const value = Math.round(Math.min(1, Math.max(0, fraction)) * PERCENT);
    if (fill.style.width !== `${value}%`) fill.style.width = `${value}%`;
    setAttr(bar, "aria-valuenow", String(value));
    setAttr(bar, "aria-valuetext", label);
  }

  closeButton.addEventListener("click", close);
  cancelButton.addEventListener("click", (event) => {
    if (isEarlyPress(event.timeStamp, changedAt)) return;
    if (busy) onCancel();
    else close();
  });
  goButton.addEventListener("click", (event) => {
    if (isEarlyPress(event.timeStamp, changedAt)) return;
    onExport();
  });
  // Escape, while it renders, stops the render and leaves the dialog where it is. The key's own default (a close
  // request) is stopped first: a browser lets a page refuse a close request only once per user interaction, and a
  // second Escape while the render is stopping would close the dialog on it.
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !busy) return;
    event.preventDefault();
    onCancel();
  });
  // Any other way to ask a dialog to close (the back gesture on a phone) is refused the same way while it renders.
  root.addEventListener("cancel", (event) => {
    if (!busy) return;
    event.preventDefault();
    onCancel();
  });
  // If a browser closes it anyway, it is put back: a render with no dialog has nothing to say how far it has got.
  // A browser that does not focus a button when it is clicked (Safari) has nothing for the dialog to give focus back to.
  root.addEventListener("close", () => {
    if (busy && typeof root.showModal === "function") root.showModal();
    else opener?.focus();
  });
  // A click on the backdrop (the dialog element itself: its plate fills it, so only the dimmed page around it is the
  // dialog's own) closes it. Both ends of the click must be on it: a drag that starts inside, on a choice or the
  // readout, and lets go outside is a click on the dialog too.
  let pressedOnBackdrop = false;
  root.addEventListener("pointerdown", (event) => {
    pressedOnBackdrop = event.target === root;
  });
  root.addEventListener("click", (event) => {
    if (event.target === root && pressedOnBackdrop) close();
  });

  return {
    open,
    close,
    get isOpen() {
      return isOpen();
    },
    setOptions(next) {
      current = { ...next };
      for (const { value, button } of scopeButtons) setAttr(button, "aria-pressed", String(value === next.scope));
      for (const { value, button } of fileButtons) setAttr(button, "aria-pressed", String(value === next.files));
      for (const { value, button } of loopButtons) setAttr(button, "aria-pressed", String(value === next.loops));
      for (const { value, button } of channelButtons) setAttr(button, "aria-pressed", String(value === next.channels));
    },
    // What it says is what was pressed: not while it renders, when the song may move under it (a tempo knob on a
    // controller) and the file is already being made from the song as it was.
    refresh(next) {
      if (busy) return;
      setText(title, next.title);
      setText(readout, next.readout);
      setText(format, next.format);
      setText(note, next.note ?? "");
      if (next.blocked !== undefined) blocked = next.blocked;
      setText(hint, blocked || next.hint || defaultHint); // the reason Export is off takes the hint's place
      draw(); // the button says what it will make
    },
    setBusy(next) {
      busy = next;
      changedAt = performance.now();
      if (busy) {
        latest = "";
        stem = null;
        setText(message, "");
        setProgress(null);
        draw();
      } else {
        cancelling = false;
        draw(); // first, so that the message is not written into a region that still says it is busy
        setText(message, latest);
      }
    },
    setProgress,
    // Which stem the render is on: the label says it from now on (and at once, as far along as it has got).
    setStem(next) {
      stem = next;
      setProgress(fraction);
    },
    setCancelling() {
      cancelling = true;
      draw();
    },
    showMessage(text) {
      latest = text;
      if (!busy) setText(message, text);
    },
  };
}
