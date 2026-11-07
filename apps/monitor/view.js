// The monitor's on-screen lists. Draws into the elements it is handed and
// decides nothing: main.js says what to show.
//
//   const view = createMonitorView({ list, notes });
//   view.append(entry);        // newest message goes on top
//   view.reset(entries);       // redraw after a filter changed (oldest first)
//   view.showNotes(hits);      // the table of notes that were hit
//
// An entry is a describeMessage() result plus `time` and `source` (see main.js).

import { noteName } from "../../shared/notes.js";

// Rows kept in the page. The log in log.js is the record; this only bounds the DOM.
const MAX_ROWS = 300;

function cell(text, className) {
  const td = document.createElement("span");
  td.className = className;
  td.textContent = text;
  return td;
}

function messageRow(entry) {
  const row = document.createElement("li");
  row.className = `msg msg-${entry.kind}`;
  row.title = entry.source;
  row.append(
    cell((entry.time / 1000).toFixed(3), "msg-time"),
    cell(entry.channel === null ? "" : `ch ${entry.channel}`, "msg-ch"),
    cell(entry.name, "msg-name"),
    cell(entry.detail, "msg-detail"),
    cell(entry.hex, "msg-hex"),
  );
  return row;
}

export function createMonitorView({ list, notes }) {
  function append(entry) {
    list.prepend(messageRow(entry));
    while (list.children.length > MAX_ROWS) list.lastElementChild.remove();
  }

  function reset(entries) {
    list.replaceChildren();
    for (const entry of entries.slice(-MAX_ROWS)) append(entry);
  }

  function showNotes(hits) {
    notes.replaceChildren(
      ...hits.map((hit) => {
        const row = document.createElement("tr");
        const values = [hit.channel, hit.note, noteName(hit.note), hit.count, hit.maxVelocity];
        for (const value of values) {
          const td = document.createElement("td");
          td.textContent = String(value);
          row.append(td);
        }
        return row;
      }),
    );
  }

  return { append, reset, showNotes };
}
