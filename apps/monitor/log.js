// What the monitor has seen. Pure: no DOM.
//
// Keeps the most recent `limit` messages (a pad held down can send hundreds of
// pressure messages a second, so the list must be bounded) and, separately, a
// running tally of every note that was hit, which is not bounded by `limit`:
// that tally is what answers "which notes does pad 13 send?".

export const DEFAULT_LIMIT = 500;

export function createLog({ limit = DEFAULT_LIMIT } = {}) {
  const entries = [];
  const hits = new Map(); // "channel:note" -> { channel, note, count, maxVelocity }

  function tallyHit(entry) {
    const key = `${entry.channel}:${entry.note}`;
    const hit = hits.get(key) ?? { channel: entry.channel, note: entry.note, count: 0, maxVelocity: 0 };
    hit.count += 1;
    hit.maxVelocity = Math.max(hit.maxVelocity, entry.velocity);
    hits.set(key, hit);
  }

  return {
    // `entry` is a describeMessage() result plus `time` and `source`. A note
    // hit passes `hit: { note, velocity }` so the log need not re-parse text.
    add(entry) {
      entries.push(entry);
      if (entries.length > limit) entries.shift();
      if (entry.hit) tallyHit({ channel: entry.channel, ...entry.hit });
    },

    entries: () => entries,

    // Sorted by channel, then note.
    notesHit: () => [...hits.values()].sort((a, b) => a.channel - b.channel || a.note - b.note),

    clear() {
      entries.length = 0;
      hits.clear();
    },
  };
}
