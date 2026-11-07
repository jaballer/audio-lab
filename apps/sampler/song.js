// The part of the sampler worth keeping between visits: the pattern, the tempo
// and the volume. No DOM, and no storage of its own (the caller passes `save`),
// so it can be tested. Storage itself is shared/storage.js.
//
//   const song = parseSong(loadJson(SONG_KEY), { rows: 16, steps: 16 });   // null if unusable
//   const saver = createSongSaver({ read, save });
//   saver.schedule();   // something changed: save once things settle
//   saver.flush();      // about to leave the page: save now if a change is waiting

import { clampBpm } from "./tempo.js";

export const SONG_KEY = "pad-sampler:song";

// Bump this when the saved shape changes; a song with any other version is
// ignored, so an old page never misreads a newer song (or the other way round).
export const SONG_VERSION = 1;

const VOLUME_MAX = 100;

// `pattern` is pattern.snapshot(): { pad row: [steps that are on] }.
export const serializeSong = ({ bpm, volume, pattern }) => ({ version: SONG_VERSION, bpm, volume, pattern });

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isIndex = (value, length) => Number.isInteger(value) && value >= 0 && value < length;

// Keep only pads and steps that exist. An empty pattern is fine (it is what
// "clear all" leaves), but a pad with no valid steps is dropped.
function cleanPattern(pattern, { rows, steps }) {
  const clean = {};
  for (const [key, on] of Object.entries(pattern)) {
    // `key` is a string; "1.5" and "x" fail the integer test once converted.
    const row = Number(key);
    if (!isIndex(row, rows) || String(row) !== key || !Array.isArray(on)) continue;
    const valid = [...new Set(on.filter((step) => isIndex(step, steps)))].sort((a, b) => a - b);
    if (valid.length) clean[row] = valid;
  }
  return clean;
}

// Turn whatever was in storage into a song, or null when it is not one we can
// trust (missing, corrupt, from another version). Values that are the right
// kind but out of range are brought back into range rather than rejected.
export function parseSong(raw, { rows, steps }) {
  if (!isObject(raw) || raw.version !== SONG_VERSION) return null;
  if (!Number.isFinite(raw.bpm) || !Number.isFinite(raw.volume) || !isObject(raw.pattern)) return null;

  return {
    bpm: clampBpm(raw.bpm),
    volume: Math.round(Math.min(VOLUME_MAX, Math.max(0, raw.volume))),
    pattern: cleanPattern(raw.pattern, { rows, steps }),
  };
}

// Writing on every change would mean a write per pixel of a knob drag, so wait
// until the changes stop. This is a timer for a write, not for a sound, which
// is the kind of thing a timer is fine for.
//
// `read()` returns the current song (what serializeSong takes); `save(song)`
// stores it.
export function createSongSaver({ read, save, delayMs = 300 }) {
  let timer = null;

  function write() {
    timer = null;
    save(serializeSong(read()));
  }

  return {
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(write, delayMs);
    },
    flush() {
      if (timer === null) return;
      clearTimeout(timer);
      write();
    },
  };
}
