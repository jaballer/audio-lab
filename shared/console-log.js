// The page's console: the detail that does not belong on the device itself (every MIDI port the
// browser lists, connects and disconnects, errors). Pure: no DOM, nothing at import time.
//
//   const log = createConsoleLog({ limit: 200, onChange: () => {} });
//   log.add("Inputs (2): MPK mini, Launchpad");      // level "info"
//   log.add("MIDI permission denied", "error");      // "info" | "warn" | "error"
//   log.entries();                                    // [{ time, level, text }], oldest first
//   log.toText();                                     // one line per entry, for copying
//   log.clear();
//
// Bounded, because a long session of plugging and unplugging must not grow without end.

export const DEFAULT_LIMIT = 200;

const pad2 = (n) => String(n).padStart(2, "0");

// Local time of day: a log line is read next to the clock on the wall, not as a date.
export const formatTime = (time) => {
  const d = new Date(time);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

export function createConsoleLog({ limit = DEFAULT_LIMIT, onChange, now = () => Date.now() } = {}) {
  const entries = [];

  return {
    add(text, level = "info") {
      entries.push({ time: now(), level, text });
      if (entries.length > limit) entries.shift();
      onChange?.();
    },

    clear() {
      entries.length = 0;
      onChange?.();
    },

    entries: () => entries,

    toText: () => entries.map((e) => `${formatTime(e.time)} ${e.level.toUpperCase()} ${e.text}`).join("\n"),
  };
}
