// What the monitor has seen. Pure: no DOM.
//
// Keeps the most recent `limit` messages (a pad held down can send hundreds of
// pressure messages a second, so the list must be bounded) and, separately, a
// running tally of every note that was hit, which is not bounded by `limit`:
// that tally is what answers "which notes does pad 13 send?". It is kept per
// input, so two controllers on the same channel do not blend into one count.

export const DEFAULT_LIMIT = 500;

export function createLog({ limit = DEFAULT_LIMIT } = {}) {
  const entries = [];
  const hits = new Map(); // "source:channel:note" -> { source, channel, note, count, maxVelocity }

  function tallyHit(entry) {
    const key = `${entry.source}:${entry.channel}:${entry.note}`;
    const hit = hits.get(key) ?? {
      source: entry.source,
      channel: entry.channel,
      note: entry.note,
      count: 0,
      maxVelocity: 0,
    };
    hit.count += 1;
    hit.maxVelocity = Math.max(hit.maxVelocity, entry.velocity);
    hits.set(key, hit);
  }

  return {
    // `entry` is a describeMessage() result plus `time` and `source` (the input's name). A note
    // hit passes `hit: { note, velocity }` so the log need not re-parse text.
    add(entry) {
      entries.push(entry);
      if (entries.length > limit) entries.shift();
      if (entry.hit) tallyHit({ source: entry.source, channel: entry.channel, ...entry.hit });
    },

    entries: () => entries,

    // Sorted by input name, then channel, then note.
    notesHit: () =>
      [...hits.values()].sort((a, b) => a.source.localeCompare(b.source) || a.channel - b.channel || a.note - b.note),

    clear() {
      entries.length = 0;
      hits.clear();
    },
  };
}
