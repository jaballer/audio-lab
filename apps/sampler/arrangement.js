// The order a song plays its sequences in: a list of entries, each one a sequence and how many times it plays
// before the next entry (its repeats). No DOM, and nothing at import time.
//
//   [{ sequence: 2, repeats: 4 }, { sequence: 0, repeats: 1 }]   // sequence 3 four times, then sequence 1 once (0-based)
//
// A song nobody has edited has no arrangement (`null`), and that means every sequence once, in order, including one made
// or removed later: nothing is made up for it, so it cannot go out of step with the sequences. The first edit (insertEntry and
// the others below) makes the list explicit; from then on a sequence made or removed has to be
// followed here (afterSequenceAdded, afterSequenceRemoved), and `beat.js` keeps it through saving and loading
// (cleanArrangement).
//
//   cleanArrangement(raw, count)         // what storage gave, as a list of entries or null
//   resolveArrangement(arrangement, count)   // the entries as they play: the list, or every sequence once
//   passOrder(arrangement, count)        // the sequence of each pass, repeats counted out: [2, 2, 2, 2, 0]
//   positionOf(arrangement, count, sequence)   // where a sequence first comes in the song, or null
//   wherePassWas(arrangement, count, played, sequence)   // where the pass that has just ended was, or null
//   nextPass(arrangement, count, played, sequence)   // the pass after the one that has just ended (what a chain walks)
//   isLastPass(arrangement, count, at)   // is the pass at that place the last of the song? (where it ends, or goes round)
//   insertEntry / removeEntry / moveEntry / setRepeats(arrangement, count, …)   // the edits the strip makes

// At most this many entries, and each one repeats from MIN_REPEATS to MAX_REPEATS times: with the sequences' own
// length (up to eight bars) a song can be long, and the export has to hold all of it in memory.
export const MAX_ENTRIES = 32;
export const MIN_REPEATS = 1;
export const MAX_REPEATS = 16;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// Turn whatever was in storage into a list of entries, or null when there is nothing usable in it, which is a beat with no
// arrangement: an entry for a sequence the beat does not have is dropped (the beat can have fewer than when it was saved),
// repeats are brought into range (one that is not a whole number reads as 1, as a sequence with no length reads as one bar),
// and only the first MAX_ENTRIES that are kept count. An arrangement with nothing left in it is none, not an empty song: a
// person is never left with a song that plays nothing.
export function cleanArrangement(raw, count) {
  if (!Array.isArray(raw)) return null;
  const clean = [];
  for (const saved of raw) {
    if (clean.length === MAX_ENTRIES) break;
    if (!isObject(saved) || !Number.isInteger(saved.sequence) || saved.sequence < 0 || saved.sequence >= count)
      continue;
    const repeats = Number.isInteger(saved.repeats)
      ? Math.min(MAX_REPEATS, Math.max(MIN_REPEATS, saved.repeats))
      : MIN_REPEATS;
    clean.push({ sequence: saved.sequence, repeats });
  }
  return clean.length ? clean : null;
}

// The entries as they play: the arrangement, or with none every sequence once, in order.
export const resolveArrangement = (arrangement, count) =>
  arrangement ?? Array.from({ length: count }, (_, sequence) => ({ sequence, repeats: MIN_REPEATS }));

// The sequence each pass plays, in order, with every entry's repeats counted out (the list playback and export both walk).
export const passOrder = (arrangement, count) =>
  resolveArrangement(arrangement, count).flatMap(({ sequence, repeats }) => Array(repeats).fill(sequence));

// A sequence has been made (at the end of the list: a new one is always last). With no arrangement it is in the song already;
// with one it gets an entry at the end, once, unless the list is full, in which case the sequence is not in the song until a
// person makes room.
export function afterSequenceAdded(arrangement, sequence) {
  if (!arrangement || arrangement.length >= MAX_ENTRIES) return arrangement;
  return [...arrangement, { sequence, repeats: MIN_REPEATS }];
}

// A sequence has been removed, and the ones after it have each moved down one. Every entry that named it goes, the entries
// for the ones after it follow them down, and the order and repeats of the rest are as they were. With no entry left it is no
// arrangement: the sequences that remain play once each.
export function afterSequenceRemoved(arrangement, removed) {
  if (!arrangement) return null;
  const kept = arrangement
    .filter(({ sequence }) => sequence !== removed)
    .map(({ sequence, repeats }) => ({ sequence: sequence > removed ? sequence - 1 : sequence, repeats }));
  return kept.length ? kept : null;
}

// Where a pass sits in the song: `entry` is the index of an entry as the song plays them (resolveArrangement), and `rep` is
// which time round that entry it is, from 0.

// Where a sequence first comes in the song, at its first time round, or null when no entry names it (it is not in the song).
export function positionOf(arrangement, count, sequence) {
  const entry = resolveArrangement(arrangement, count).findIndex((each) => each.sequence === sequence);
  return entry === -1 ? null : { entry, rep: 0 };
}

// Where the pass that has just ended was. `played` is where the controller says it was, and `sequence` is the sequence that played:
// what it says is believed only while it still fits (the entry is there, names that sequence, and has that time round), since a
// sequence picked by a person, or added or removed, leaves a position that means nothing. Otherwise the pass counts as the first time
// round the first entry that names the sequence, which is also where a song that has just begun is; null when no entry names it.
export function wherePassWas(arrangement, count, played, sequence) {
  const entries = resolveArrangement(arrangement, count);
  const fits = played && entries[played.entry]?.sequence === sequence && played.rep < entries[played.entry].repeats;
  return fits ? { entry: played.entry, rep: played.rep } : positionOf(arrangement, count, sequence);
}

// The pass that follows the one that has just ended: the next time round its entry if it repeats, else the next entry, and the first
// entry after the last: this is the walk of a song that goes round, and whether it does is not decided here (isLastPass says where
// the song is at its end, and the controller stops there unless Loop is on). A sequence that is not in the song hands over to the
// song's first entry.
export function nextPass(arrangement, count, played, sequence) {
  const entries = resolveArrangement(arrangement, count);
  const pass = (entry, rep) => ({ entry, rep, sequence: entries[entry].sequence });
  const here = wherePassWas(arrangement, count, played, sequence);
  if (!here) return pass(0, 0);
  if (here.rep + 1 < entries[here.entry].repeats) return pass(here.entry, here.rep + 1);
  return pass((here.entry + 1) % entries.length, 0);
}

// Is the pass at `at` (a place, as above: where the controller or wherePassWas says a pass was) the last of the song: the last time
// round the last entry? Not when the place is not known (null), which is a sequence that is in no entry: the song has not come to
// its end, it has not begun. A time round past the last, which an edit that gave an entry fewer repeats can leave behind, counts as
// the last.
export function isLastPass(arrangement, count, at) {
  if (!at) return false;
  const entries = resolveArrangement(arrangement, count);
  const last = entries.length - 1;
  return at.entry === last && at.rep >= entries[last].repeats - 1;
}

// ---------- Editing ----------
// What the strip does. Each edit takes the arrangement (null: every sequence once) and the number of sequences, and gives back
// the list after it, new (what it was given is left alone, entries and all), with `entryAfter(index)`, which says where an entry
// that was at `index` is now (-1 when it is gone) so that whatever points at one can follow it. It gives back null when nothing can
// be done: the list is full, the entry is the last (a song is never left playing nothing), something is not where it can be, or the
// edit would change nothing. An edit makes the list explicit, so a song nobody edited has its entries to edit from.

const isIndex = (value, length) => Number.isInteger(value) && value >= 0 && value < length;
const copyOf = (arrangement, count) =>
  resolveArrangement(arrangement, count).map(({ sequence, repeats }) => ({ sequence, repeats }));

// An entry for `sequence`, once, at the place `at` (0 is the start of the song, the length of the list the end).
export function insertEntry(arrangement, count, at, sequence) {
  const entries = copyOf(arrangement, count);
  if (entries.length >= MAX_ENTRIES || !isIndex(sequence, count) || !Number.isInteger(at)) return null;
  const place = Math.min(entries.length, Math.max(0, at));
  entries.splice(place, 0, { sequence, repeats: MIN_REPEATS });
  return { arrangement: entries, entryAfter: (index) => (index >= place ? index + 1 : index) };
}

// The entry at `index` goes, and the ones after it move down.
export function removeEntry(arrangement, count, index) {
  const entries = copyOf(arrangement, count);
  if (entries.length < 2 || !isIndex(index, entries.length)) return null;
  entries.splice(index, 1);
  return { arrangement: entries, entryAfter: (at) => (at < index ? at : at === index ? -1 : at - 1) };
}

// The entry at `from` goes to the place `to`, and the ones between move over by one.
export function moveEntry(arrangement, count, from, to) {
  const entries = copyOf(arrangement, count);
  if (!isIndex(from, entries.length) || !isIndex(to, entries.length) || from === to) return null;
  entries.splice(to, 0, ...entries.splice(from, 1));
  const entryAfter = (at) => {
    if (at === from) return to;
    if (from < to) return at > from && at <= to ? at - 1 : at;
    return at >= to && at < from ? at + 1 : at;
  };
  return { arrangement: entries, entryAfter };
}

// How many times the entry at `index` goes round, brought into MIN_REPEATS to MAX_REPEATS; nothing when that is what it has.
export function setRepeats(arrangement, count, index, repeats) {
  const entries = copyOf(arrangement, count);
  if (!isIndex(index, entries.length) || !Number.isInteger(repeats)) return null;
  const next = Math.min(MAX_REPEATS, Math.max(MIN_REPEATS, repeats));
  if (next === entries[index].repeats) return null;
  entries[index].repeats = next;
  return { arrangement: entries, entryAfter: (at) => at };
}
