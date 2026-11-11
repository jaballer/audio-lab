// The sequence row under the Bars row: a key for each sequence, the one showing pressed in, and buttons to add an empty
// sequence, copy the one showing and remove it. It shows and reports; the sampler decides (addSequence, copySequence,
// removeSequence, setSequence), and the page asks before a sequence with steps is removed.
//
//   const row = createSequenceRow(element, { onSelect, onAdd, onCopy, onRemove });   // onSelect(index), 0-based
//   row.refresh({ count: 3, current: 1, canAdd: true, canRemove: true });
//   sequenceKeys(3, 1)       // [{ index: 0, label: "1", name: "Sequence 1", pressed: false }, ...]
//
// The keys are one joined group like the bar lengths (a button with aria-pressed), made as the number of sequences
// changes. Focus is handed on when a button goes disabled, so the keyboard stays where it was (dom-updates.js).

import { setAttr, setDisabledMany } from "../../shared/dom-updates.js";

// What each key says and whether it is the pressed one: the number on its face, its name for a screen reader (the
// number alone says little out of its row), and whether it is the sequence showing.
export function sequenceKeys(count, current) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    label: String(index + 1),
    name: `Sequence ${index + 1}`,
    pressed: index === current,
  }));
}

const button = (text, className, attributes = {}) => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `btn btn-small ${className}`.trim();
  element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
};

export function createSequenceRow(element, { onSelect, onAdd, onCopy, onRemove }) {
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
  actions.setAttribute("aria-label", "Add, copy or remove a sequence");
  const add = button("+", "", { "aria-label": "Add an empty sequence" });
  const copy = button("Copy", "", { "aria-label": "Copy this sequence to a new one" });
  const remove = button("−", "", { "aria-label": "Remove this sequence" });
  actions.append(add, copy, remove);
  add.addEventListener("click", () => onAdd());
  copy.addEventListener("click", () => onCopy());
  remove.addEventListener("click", () => onRemove());

  element.append(label, keys, actions);

  const chips = []; // the key for each sequence, made when there are more and let go of when there are fewer

  function syncChips(count) {
    while (chips.length < count) {
      const index = chips.length;
      const chip = button(String(index + 1), "", { "aria-label": `Sequence ${index + 1}` });
      chip.addEventListener("click", () => onSelect(index));
      keys.appendChild(chip);
      chips.push(chip);
    }
    while (chips.length > count) chips.pop().remove();
  }

  return {
    refresh({ count, current, canAdd, canRemove }) {
      syncChips(count);
      for (const { index, pressed } of sequenceKeys(count, current))
        setAttr(chips[index], "aria-pressed", String(pressed));
      const showing = chips[current] ?? chips[0];
      setAttr(add, "title", canAdd ? "Add an empty sequence" : "There is no room for another sequence");
      setAttr(copy, "title", canAdd ? "Copy this sequence to a new one" : "There is no room for another sequence");
      setAttr(remove, "title", canRemove ? "Remove this sequence" : "A beat keeps at least one sequence");
      setDisabledMany([
        [add, !canAdd, showing],
        [copy, !canAdd, showing],
        [remove, !canRemove, [add, copy, showing]],
      ]);
    },
  };
}
