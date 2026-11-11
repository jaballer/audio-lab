// The order a song plays its sequences in: a list of entries, each one a sequence and how many times it plays
// before the next entry (its repeats). No DOM, and nothing at import time.
//
//   [{ sequence: 2, repeats: 4 }, { sequence: 0, repeats: 1 }]   // sequence 3 four times, then sequence 1 once (0-based)
//
// A song nobody has edited has no arrangement (`null`), and that means every sequence once, in order, including one made
// or removed later: nothing is made up for it, so it cannot go out of step with the sequences. The first edit makes the
// list explicit (the editing helpers come with the strip that edits it); from then on a sequence made or removed has to be
// followed here (afterSequenceAdded, afterSequenceRemoved), and `song.js` keeps it through saving and loading
// (cleanArrangement).
//
//   cleanArrangement(raw, count)         // what storage gave, as a list of entries or null
//   resolveArrangement(arrangement, count)   // the entries as they play: the list, or every sequence once
//   passOrder(arrangement, count)        // the sequence of each pass, repeats counted out: [2, 2, 2, 2, 0]

// At most this many entries, and each one repeats from MIN_REPEATS to MAX_REPEATS times: with the sequences' own
// length (up to eight bars) a song can be long, and the export has to hold all of it in memory.
export const MAX_ENTRIES = 32;
export const MIN_REPEATS = 1;
export const MAX_REPEATS = 16;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// Turn whatever was in storage into a list of entries, or null when there is nothing usable in it, which is a song with no
// arrangement: an entry for a sequence the song does not have is dropped (the song can have fewer than when it was saved),
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
