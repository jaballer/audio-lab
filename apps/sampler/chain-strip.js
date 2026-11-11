// The song's strip: a cell for each entry of the song (arrangement.js) in the order it plays them, each with its sequence and how many
// times it goes round, and the tools to add, remove, move and repeat the entry that is selected. It shows and reports; the sampler
// decides (addEntry, removeEntry, moveEntry, setEntryRepeats), and which entry is selected is the page's.
//
//   const strip = createChainStrip({ strip: element, tools: element }, { onSelect, onAdd, onRemove, onMove, onRepeats });
//   strip.refresh({ entries, selected: 1, at: { entry: 1, rep: 0 }, canAdd: true, canRemove: true });   // `at`: where Play All is, or null
//   entryCells(entries, 1, at)    // [{ index, label: "3", times: "×2", name: "Entry 2, sequence 3, 2 times", pressed, playing }, ...]
//   neighbourEntry(2, "ArrowLeft", 5)   // 1: where a key moves the selection (-1 for a key that does not)
//
// The cells are one joined group like the sequence keys, a button with aria-pressed for the entry that is selected. There can be 32, so
// only the selected one is a stop for Tab (the arrow keys, Home and End move the selection along the row, as in a toolbar), and the rest
// are reached from it. The entry that Play All is playing is marked (`data-playing`), with its time round while it repeats.
// Selecting an entry changes nothing about what plays: it is the one the tools act on.

import { MAX_REPEATS } from "./arrangement.js";
import { setAttr, setDisabledMany, setText } from "../../shared/dom-updates.js";

// What a cell shows and says. `at` is where the song is ({ entry, rep } with rep from 0) or null. The times round read "2/3" while it is
// the entry playing, "×3" otherwise, and nothing for an entry that goes round once.
export function entryCells(entries, selected, at = null) {
  return entries.map(({ sequence, repeats }, index) => {
    const playing = at !== null && at.entry === index;
    const times = repeats < 2 ? "" : playing ? `${at.rep + 1}/${repeats}` : `×${repeats}`;
    const said = [`Entry ${index + 1}`, `sequence ${sequence + 1}`];
    said.push(repeats < 2 ? "once" : `${repeats} times`);
    if (playing) said.push(repeats < 2 ? "playing" : `playing, time ${at.rep + 1} of ${repeats}`);
    return { index, label: String(sequence + 1), times, name: said.join(", "), pressed: index === selected, playing };
  });
}

// The entry an arrow key, Home or End moves the selection to, or -1 for any other key.
export function neighbourEntry(index, key, count) {
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, index - 1);
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(count - 1, index + 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return -1;
}

const button = (text, className, attributes = {}) => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `btn btn-small ${className}`.trim();
  element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
};

const span = (className) => {
  const element = document.createElement("span");
  element.className = className;
  return element;
};

export function createChainStrip({ strip, tools }, { onSelect, onAdd, onRemove, onMove, onRepeats }) {
  strip.setAttribute("role", "group");
  strip.setAttribute("aria-label", "Entries of the song, in the order they play");
  strip.classList.add("btn-group", "song-strip");

  const add = button("Add Entry", "", { title: "Add the sequence showing to the song, after the entry selected" });
  const remove = button("Remove Entry", "");
  const earlier = button("Move Earlier", "");
  const later = button("Move Later", "");
  // The signs are the visible text; the names say what a press does.
  const fewer = button("Repeats −", "", { "aria-label": "Fewer repeats" });
  const more = button("Repeats +", "", { "aria-label": "More repeats" });
  tools.append(add, remove, earlier, later, fewer, more);
  add.addEventListener("click", () => onAdd());
  remove.addEventListener("click", () => onRemove());
  earlier.addEventListener("click", () => onMove(-1));
  later.addEventListener("click", () => onMove(1));
  fewer.addEventListener("click", () => onRepeats(-1));
  more.addEventListener("click", () => onRepeats(1));

  const cells = []; // { button, sequence, times }: made when there are more entries and let go of when there are fewer
  let count = 0; // as of the last refresh: the keys read it

  function syncCells(wanted) {
    while (cells.length < wanted) {
      const index = cells.length;
      const element = button("", "song-cell", { "aria-pressed": "false", tabindex: "-1" });
      const sequence = span("song-cell-sequence");
      const times = span("song-cell-times");
      element.append(sequence, times);
      element.addEventListener("click", () => onSelect(index));
      element.addEventListener("keydown", (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const next = neighbourEntry(index, event.key, count);
        if (next === -1) return;
        event.preventDefault();
        if (next === index) return;
        onSelect(next);
        cells[next]?.button.focus();
      });
      strip.appendChild(element);
      cells.push({ button: element, sequence, times });
    }
    while (cells.length > wanted) cells.pop().button.remove();
  }

  return {
    refresh({ entries, selected, at = null, canAdd, canRemove }) {
      count = entries.length;
      syncCells(count);
      for (const { index, label, times, name, pressed, playing } of entryCells(entries, selected, at)) {
        const cell = cells[index];
        setText(cell.sequence, label);
        setText(cell.times, times);
        setAttr(cell.button, "aria-label", name);
        setAttr(cell.button, "aria-pressed", String(pressed));
        setAttr(cell.button, "data-playing", String(playing));
        setAttr(cell.button, "tabindex", pressed ? "0" : "-1");
      }
      const chosen = cells[selected]?.button ?? cells[0].button;
      const repeats = entries[selected]?.repeats ?? 1;
      // A title only to say why a button is off: when it is on, it would only repeat the name a screen reader reads out.
      setAttr(remove, "title", canRemove ? "" : "A song keeps at least one entry");
      setAttr(
        add,
        "title",
        canAdd
          ? "Add the sequence showing to the song, after the entry selected"
          : "The song has as many entries as it can",
      );
      setDisabledMany([
        [add, !canAdd, chosen],
        [remove, !canRemove, [chosen, add]],
        [earlier, selected <= 0, [later, chosen]],
        [later, selected >= count - 1, [earlier, chosen]],
        [fewer, repeats <= 1, [more, chosen]],
        [more, repeats >= MAX_REPEATS, [fewer, chosen]],
      ]);
    },
  };
}
