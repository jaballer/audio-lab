// The part of the sampler worth keeping between visits: the pattern, the tempo
// and the volume. No DOM, and no storage of its own (the caller passes `save`),
// so it can be tested. Storage itself is shared/storage.js.
//
//   const song = parseSong(loadJson(SONG_KEY), { rows: 16, steps: 16 });   // null if unusable
//   const saver = createSongSaver({ read, save });
//   saver.schedule();   // something changed: save once things settle
//   saver.flush();      // about to leave the page: save now if a change is waiting

import { clampBpm } from "./tempo.js";

// Still named after the project's old name: changing it would orphan every beat
// already saved in visitors' browsers.
export const SONG_KEY = "pad-sampler:song";

// Bump this when the saved shape changes, and add a migration from the old
// version (below) so beats saved by an older page still load. A song newer than
// this page is ignored, so an old page never misreads a newer song.
export const SONG_VERSION = 1;

// { [version]: (song) => the same song in the next version's shape }. The version
// field itself is set by upgradeSong. Empty while version 1 is the only one.
const MIGRATIONS = {};

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

// Bring a stored song up to SONG_VERSION by applying one migration after another,
// or give back null when it cannot be brought there (a version from the future,
// or an old one with no migration). `migrations` is a parameter for the tests.
export function upgradeSong(raw, migrations = MIGRATIONS) {
  if (!isObject(raw) || !Number.isInteger(raw.version) || raw.version > SONG_VERSION) return null;
  let song = raw;
  while (song.version < SONG_VERSION) {
    const migrate = migrations[song.version];
    if (!migrate) return null;
    song = { ...migrate(song), version: song.version + 1 };
  }
  return song;
}

// Turn whatever was in storage into a song, or null when it is not one we can
// trust (missing, corrupt, from a version it cannot upgrade). Values that are the right
// kind but out of range are brought back into range rather than rejected.
export function parseSong(stored, { rows, steps }) {
  const raw = upgradeSong(stored);
  if (!raw) return null;
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
