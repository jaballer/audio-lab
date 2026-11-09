// The part of the sampler worth keeping between visits: the pattern, the tempo
// and the volume. No DOM, and no storage of its own (the caller passes `save`),
// so it can be tested. Storage itself is shared/storage.js.
//
//   const song = parseSong(loadJson(SONG_KEY), { rows: 16, steps: 16, maxBars: 8, sequenceCount: 8 });   // null if unusable
//   const saver = createSongSaver({ read, save });
//   saver.schedule();   // something changed: save once things settle
//   saver.flush();      // about to leave the page: save now if a change is waiting

import { FULL_VELOCITY, MIN_VELOCITY } from "../../shared/pattern.js";
import { clampBpm } from "../../shared/tempo.js";

// Still named after the project's old name: changing it would orphan every beat
// already saved in visitors' browsers.
export const SONG_KEY = "pad-sampler:song";

// Bump this when the saved shape changes, and add a migration from the old
// version (below) so beats saved by an older page still load. A song newer than
// this page is ignored, so an old page never misreads a newer song.
export const SONG_VERSION = 3;

// { [version]: (song) => the same song in the next version's shape }. The version
// field itself is set by upgradeSong.
const MIGRATIONS = {
  // Version 1 had one pattern; version 2 has a list of sequences, each with its own pattern and length.
  // (`bars` is read only so a pattern longer than one bar is not lost; the page did not save it at first.)
  1: ({ bars, pattern, ...rest }) => ({ ...rest, current: 0, sequences: [{ bars, pattern }] }),
  // Version 3 adds `velocities` to each sequence. A version 2 song has none, which reads as every step at full velocity.
  2: (song) => song,
};

const VOLUME_MAX = 100;

// `sequences` is a list of { bars, pattern, velocities }, where `pattern` is pattern.snapshot():
// { pad row: [steps that are on] }, and `velocities` is pattern.velocitySnapshot(): { pad row: { step: 1-127 } }
// for the steps that are not at full velocity. `current` is the index of the one that was showing.
export const serializeSong = ({ bpm, volume, current, sequences }) => ({
  version: SONG_VERSION,
  bpm,
  volume,
  current,
  sequences,
});

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

// Keep the velocities of steps that are on (in the cleaned `pattern`), as whole numbers from MIN_VELOCITY to
// FULL_VELOCITY. Full is what a step has with no entry, so it is not kept.
function cleanVelocities(velocities, pattern) {
  const clean = {};
  if (!isObject(velocities)) return clean;
  for (const [rowKey, byStep] of Object.entries(velocities)) {
    if (!isObject(byStep) || !pattern[rowKey]) continue;
    const kept = {};
    for (const [stepKey, value] of Object.entries(byStep)) {
      if (!pattern[rowKey].includes(Number(stepKey)) || !Number.isFinite(value)) continue;
      const velocity = Math.min(FULL_VELOCITY, Math.max(MIN_VELOCITY, Math.round(value)));
      if (velocity !== FULL_VELOCITY) kept[stepKey] = velocity;
    }
    if (Object.keys(kept).length) clean[rowKey] = kept;
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
export function parseSong(stored, { rows, steps, maxBars = 1, sequenceCount = 1 }) {
  const raw = upgradeSong(stored);
  if (!raw) return null;
  if (!Number.isFinite(raw.bpm) || !Number.isFinite(raw.volume) || !Array.isArray(raw.sequences)) return null;
  if (!raw.sequences.every((sequence) => isObject(sequence) && isObject(sequence.pattern))) return null;

  // Always `sequenceCount` of them: ones the song does not have are empty, and extra ones are dropped.
  const sequences = Array.from({ length: sequenceCount }, (_, i) => {
    const saved = raw.sequences[i];
    if (!saved) return { bars: 1, pattern: {}, velocities: {} };
    const pattern = cleanPattern(saved.pattern, { rows, steps: steps * maxBars });
    return {
      // Not every saved sequence says how long it is (a version 1 song did not): one bar, as it was.
      bars: Number.isInteger(saved.bars) ? Math.min(maxBars, Math.max(1, saved.bars)) : 1,
      pattern,
      velocities: cleanVelocities(saved.velocities, pattern),
    };
  });

  return {
    bpm: clampBpm(raw.bpm),
    volume: Math.round(Math.min(VOLUME_MAX, Math.max(0, raw.volume))),
    current: isIndex(raw.current, sequenceCount) ? raw.current : 0,
    sequences,
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
