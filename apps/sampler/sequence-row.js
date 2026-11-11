// The sequence row above the Bars row: a key for each sequence, the one showing pressed in, and buttons to add an empty
// sequence, copy the one showing and remove it. It shows and reports; the sampler decides (queueSequence, setSequence,
// addSequence, copySequence, removeSequence), and the page asks before a sequence with steps is removed.
//
//   const row = createSequenceRow(element, { onSelect, onLatch, onAdd, onCopy, onRemove });   // onSelect(index, { now }), 0-based
//   row.refresh({ count: 3, current: 1, queued: 2, playing: true, latched: true, canAdd: true, canRemove: true });
//   sequenceKeys(3, 1, { queued: 2, playing: true, latched: true })   // [{ index: 0, label: "1", name: "Sequence 1", pressed: false, queued: false, title: "..." }, ...]
//   sequenceKey(2)           // { index: 2, label: "3", name: "Sequence 3" }: what the view puts on a key and names it
//
// The keys are one joined group like the bar lengths (a button with aria-pressed), made as the number of sequences
// changes. Focus is handed on when a button goes disabled, so the keyboard stays where it was (dom-updates.js).
//
// A press asks for that sequence to play next, and the sampler decides what that means: while the beat plays it waits for
// the end of the pass, and `now` asks for it at once; stopped, it is shown at once. `now` is Shift held, or the other way
// round when the Next latch is off (a touch screen has no Shift, so the latch is how it switches at once): pressIsNow. The key
// that plays next is marked (`data-queued`, which the style blinks) and named so for a screen reader.

import { setAttr, setDisabledMany } from "../../shared/dom-updates.js";

// What a key says: the number on its face and its name for a screen reader (the number alone says little out of its row).
export const sequenceKey = (index) => ({ index, label: String(index + 1), name: `Sequence ${index + 1}` });

// Does a press on a sequence key switch to it at once (and not wait for the end of the pass)? With the latch on a press waits and
// Shift switches; with it off a press switches and Shift waits.
export const pressIsNow = ({ latched, shift }) => latched === shift;

// What a press does is only worth saying while the beat plays, when it can wait for the end of the pass instead of switching.
function keyTitle({ playing, pressed, queued, waiting, latched }) {
  if (!playing) return "";
  // A press on the one showing takes back what was queued, whichever way the latch is.
  if (pressed) return waiting ? "Press to take back the sequence that plays next" : "";
  // Read after the key's name as its description, so an instruction: "Sequence 2, Plays next" would say it is already queued.
  // The queued key's name says so already.
  if (latched)
    return queued ? "Press again to take it back" : "Press to play next, after this pass. Hold Shift to switch now";
  return queued
    ? "Press to switch to it now. Hold Shift, or press the sequence showing, to take it back"
    : "Press to switch now. Hold Shift to play next, after this pass";
}

// Each key: whether it is the pressed one (the sequence showing), whether it is the one that plays next, and a title for
// what a press does. `queued` is the index of the sequence waiting for the end of the pass, or -1.
export function sequenceKeys(count, current, { queued = -1, playing = false, latched = true } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const key = sequenceKey(index);
    const next = index === queued;
    const pressed = index === current;
    return {
      ...key,
      name: next ? `${key.name}, plays next` : key.name,
      pressed,
      queued: next,
      title: keyTitle({ playing, pressed, queued: next, waiting: queued >= 0, latched }),
    };
  });
}

const button = (text, className, attributes = {}) => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `btn btn-small ${className}`.trim();
  element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
};

export function createSequenceRow(element, { onSelect, onLatch, onAdd, onCopy, onRemove }) {
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", "Sequences");

  const label = document.createElement("span");
  label.className = "small-label";
  label.textContent = "Seq";

  const keys = document.createElement("div");
  keys.className = "seq-chips btn-group";
  keys.setAttribute("role", "group");
  keys.setAttribute("aria-label", "Choose a sequence");

  const actions = document.createElement("div");
  actions.className = "btn-group";
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Sequence tools");
  // Whether a press on a sequence waits for the end of the pass (on, as it is until a person turns it off) or switches at once.
  const latch = button("Next", "seq-latch", { "aria-label": "Next sequence" });
  const add = button("+", "", { "aria-label": "Add an empty sequence" });
  const copy = button("Copy", "", { "aria-label": "Copy this sequence to a new one" });
  const remove = button("−", "", { "aria-label": "Remove this sequence" });
  actions.append(latch, add, copy, remove);
  latch.addEventListener("click", () => onLatch(!latched));
  add.addEventListener("click", () => onAdd());
  copy.addEventListener("click", () => onCopy());
  remove.addEventListener("click", () => onRemove());

  element.append(label, keys, actions);

  const chips = []; // the key for each sequence, made when there are more and let go of when there are fewer
  let latched = true; // as of the last refresh: a press on a key is read by it

  function syncChips(count) {
    while (chips.length < count) {
      const index = chips.length;
      const { label, name } = sequenceKey(index);
      const chip = button(label, "", { "aria-label": name });
      // Shift is held with a click, and with Enter or Space on the key, for which a browser sends a click that carries the key's state.
      chip.addEventListener("click", (event) =>
        onSelect(index, { now: pressIsNow({ latched, shift: Boolean(event.shiftKey) }) }),
      );
      keys.appendChild(chip);
      chips.push(chip);
    }
    while (chips.length > count) chips.pop().remove();
  }

  return {
    refresh({ count, current, queued = -1, playing = false, latched: on = true, canAdd, canRemove }) {
      latched = on;
      syncChips(count);
      setAttr(latch, "aria-pressed", String(on));
      setAttr(
        latch,
        "title",
        on
          ? "On: a press on a sequence waits for the end of the pass (Shift: at once)"
          : "Off: a press on a sequence switches at once (Shift: waits for the end of the pass)",
      );
      for (const { index, pressed, queued: next, name, title } of sequenceKeys(count, current, {
        queued,
        playing,
        latched: on,
      })) {
        setAttr(chips[index], "aria-pressed", String(pressed));
        setAttr(chips[index], "data-queued", String(next));
        setAttr(chips[index], "aria-label", name);
        setAttr(chips[index], "title", title);
      }
      const showing = chips[current] ?? chips[0];
      // A title only to say why a button is off: when it is on, it would only repeat the name a screen reader reads out.
      setAttr(add, "title", canAdd ? "" : "There is no room for another sequence");
      setAttr(copy, "title", canAdd ? "" : "There is no room for another sequence");
      setAttr(remove, "title", canRemove ? "" : "A beat keeps at least one sequence");
      setDisabledMany([
        [add, !canAdd, showing],
        [copy, !canAdd, showing],
        // Not to Add: a key held down on Remove would turn into one held down on Add, and take away what it had just removed.
        [remove, !canRemove, [showing, add, copy]],
      ]);
    },
  };
}
