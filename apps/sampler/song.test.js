import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STARTER_BEAT } from "./pattern.js";
import { SONG_VERSION, createSongSaver, parseSong, serializeSong, upgradeSong } from "./song.js";

const SHAPE = { rows: 16, steps: 16 };
const song = { bpm: 96.5, volume: 60, pattern: { 0: [0, 4, 8, 12], 3: [2] } };

// What storage does to a value: it goes out as JSON text and comes back as a copy.
const stored = (value) => JSON.parse(JSON.stringify(value));
const parse = (raw) => parseSong(stored(raw), SHAPE);
const withPattern = (pattern) => ({ ...serializeSong(song), pattern });

describe("serializeSong", () => {
  it("tags the song with a format version", () => {
    expect(serializeSong(song)).toEqual({ version: SONG_VERSION, ...song });
  });
});

describe("parseSong", () => {
  it("gives back what serializeSong was given", () => {
    expect(parse(serializeSong(song))).toEqual(song);
  });

  it("reads the starter beat's shape", () => {
    expect(parse(serializeSong({ bpm: 100, volume: 80, pattern: STARTER_BEAT })).pattern).toEqual(STARTER_BEAT);
  });

  it("accepts an empty pattern: clearing everything is a valid song", () => {
    expect(parse(serializeSong({ ...song, pattern: {} }))).toEqual({ ...song, pattern: {} });
  });

  it.each([
    ["nothing stored", null],
    ["undefined", undefined],
    ["a string", "hello"],
    ["a number", 42],
    ["an array", []],
    ["no version", { bpm: 100, volume: 80, pattern: {} }],
    ["another version", { ...serializeSong(song), version: SONG_VERSION + 1 }],
    ["a version of the wrong type", { ...serializeSong(song), version: String(SONG_VERSION) }],
    ["no bpm", { ...serializeSong(song), bpm: undefined }],
    ["a bpm that is not a number", { ...serializeSong(song), bpm: "fast" }],
    ["a bpm that is not finite", { ...serializeSong(song), bpm: Infinity }],
    ["a volume that is not a number", { ...serializeSong(song), volume: "loud" }],
    ["no pattern", { ...serializeSong(song), pattern: undefined }],
    ["a null pattern", { ...serializeSong(song), pattern: null }],
    ["an array for a pattern", { ...serializeSong(song), pattern: [[0, 4]] }],
  ])("gives up on %s", (_what, raw) => {
    // Not passed through `stored`: Infinity and undefined don't survive JSON, and parseSong must cope with them.
    expect(parseSong(raw, SHAPE)).toBeNull();
  });

  it("keeps the tempo in range, to one decimal place", () => {
    expect(parse({ ...serializeSong(song), bpm: 500 }).bpm).toBe(240);
    expect(parse({ ...serializeSong(song), bpm: 10 }).bpm).toBe(40);
    expect(parse({ ...serializeSong(song), bpm: 99.94 }).bpm).toBe(99.9);
  });

  it("keeps the volume a whole number from 0 to 100", () => {
    expect(parse({ ...serializeSong(song), volume: -5 }).volume).toBe(0);
    expect(parse({ ...serializeSong(song), volume: 150 }).volume).toBe(100);
    expect(parse({ ...serializeSong(song), volume: 55.6 }).volume).toBe(56);
  });

  it("drops pads that don't exist", () => {
    const raw = withPattern({ 0: [1], 16: [1], "-1": [1], 1.5: [1], x: [1] });
    expect(parse(raw).pattern).toEqual({ 0: [1] });
  });

  it("drops steps that don't exist, and anything that is not a step", () => {
    const raw = withPattern({ 0: [0, 15, 16, -1, 2.5, "3", null, 7] });
    expect(parse(raw).pattern).toEqual({ 0: [0, 7, 15] });
  });

  it("lists each step once, in order", () => {
    expect(parse(withPattern({ 0: [8, 2, 8, 2, 0] })).pattern).toEqual({ 0: [0, 2, 8] });
  });

  it("drops a pad whose steps are not a list, or end up empty", () => {
    const raw = withPattern({ 0: "1,2", 1: 5, 2: { 0: true }, 3: [99], 4: [] });
    expect(parse(raw).pattern).toEqual({});
  });

  it("checks pads and steps against the size it is given", () => {
    const small = parseSong(stored(withPattern({ 0: [0, 3, 4], 2: [1], 3: [1] })), { rows: 3, steps: 4 });
    expect(small.pattern).toEqual({ 0: [0, 3], 2: [1] });
  });
});

describe("createSongSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (delayMs = 300) => {
    // The tempo stands in for "the song": saved lists the tempo of each song written.
    let bpm = 1;
    const saved = [];
    const saver = createSongSaver({
      read: () => ({ bpm, volume: 80, pattern: {} }),
      save: (written) => saved.push(written.bpm),
      delayMs,
    });
    return { saver, saved, change: (value) => (bpm = value) };
  };

  it("writes once the delay has passed, not before", () => {
    const { saver, saved } = setup();
    saver.schedule();
    vi.advanceTimersByTime(299);
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(saved).toEqual([1]);
  });

  it("waits for changes to stop: each one restarts the delay", () => {
    const { saver, saved } = setup();
    saver.schedule();
    vi.advanceTimersByTime(200);
    saver.schedule();
    vi.advanceTimersByTime(200);
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(saved).toEqual([1]);
  });

  it("saves what the song is when it writes, not when it was asked to", () => {
    const { saver, saved, change } = setup();
    saver.schedule();
    change(2);
    vi.advanceTimersByTime(300);
    expect(saved).toEqual([2]);
  });

  it("writes nothing when nothing changed", () => {
    const { saved } = setup();
    vi.advanceTimersByTime(10_000);
    expect(saved).toEqual([]);
  });

  it("writes again for a later change", () => {
    const { saver, saved, change } = setup();
    saver.schedule();
    vi.advanceTimersByTime(300);
    change(2);
    saver.schedule();
    vi.advanceTimersByTime(300);
    expect(saved).toEqual([1, 2]);
  });

  it("flush writes a waiting change straight away, once", () => {
    const { saver, saved } = setup();
    saver.schedule();
    saver.flush();
    expect(saved).toEqual([1]);
    vi.advanceTimersByTime(1000);
    expect(saved).toEqual([1]);
  });

  it("flush does nothing when no change is waiting", () => {
    const { saver, saved } = setup();
    saver.flush();
    expect(saved).toEqual([]);
  });
});

describe("upgradeSong", () => {
  const current = serializeSong(song);

  it("leaves a song that is already current as it is", () => {
    expect(upgradeSong(current)).toEqual(current);
  });

  it("gives up on a song from a newer page", () => {
    expect(upgradeSong({ ...current, version: SONG_VERSION + 1 })).toBeNull();
  });

  it("gives up on an older song when no migration covers it", () => {
    expect(upgradeSong({ ...current, version: SONG_VERSION - 1 })).toBeNull();
  });

  it("gives up on anything without a whole-number version", () => {
    for (const bad of [null, "song", [], {}, { ...current, version: "1" }, { ...current, version: 1.5 }]) {
      expect(upgradeSong(bad)).toBeNull();
    }
  });

  it("applies each migration in turn, stamping the version after it", () => {
    const old = { version: SONG_VERSION - 1, bpm: 90, volume: 50, pattern: { 0: [1] } };
    const migrations = { [SONG_VERSION - 1]: (s) => ({ ...s, bpm: s.bpm + 1 }) };
    expect(upgradeSong(old, migrations)).toEqual({ version: SONG_VERSION, bpm: 91, volume: 50, pattern: { 0: [1] } });
  });

  it("stops at a gap in the chain", () => {
    const old = { version: SONG_VERSION - 2, bpm: 90, volume: 50, pattern: {} };
    const migrations = { [SONG_VERSION - 2]: (s) => s }; // nothing for the next step
    expect(upgradeSong(old, migrations)).toBeNull();
  });
});
