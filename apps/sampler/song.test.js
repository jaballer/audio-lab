import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STARTER_BEAT } from "./starter-beat.js";
import { SONG_VERSION, createSongSaver, parseSong, serializeSong, upgradeSong } from "./song.js";

const SHAPE = { rows: 16, steps: 16, maxBars: 8, sequenceCount: 4 };
const empty = { bars: 1, pattern: {}, velocities: {} };
const song = {
  bpm: 96.5,
  volume: 60,
  current: 1,
  sequences: [
    { bars: 2, pattern: { 0: [0, 4, 8, 12], 3: [2] }, velocities: { 0: { 4: 90, 12: 20 } } },
    { bars: 4, pattern: { 5: [1] }, velocities: {} },
    empty,
    empty,
  ],
};

// What storage does to a value: it goes out as JSON text and comes back as a copy.
const stored = (value) => JSON.parse(JSON.stringify(value));
const parse = (raw) => parseSong(stored(raw), SHAPE);
// The song with the first sequence's pattern (or bars) replaced.
const withPattern = (pattern) => withFirst({ pattern });
const withFirst = (change) => ({
  ...serializeSong(song),
  sequences: [{ ...song.sequences[0], ...change }, ...song.sequences.slice(1)],
});

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
    expect(parse(withPattern(STARTER_BEAT)).sequences[0].pattern).toEqual(STARTER_BEAT);
  });

  it("reads a sequence that does not say how long it is as one bar", () => {
    const raw = withFirst({});
    delete raw.sequences[0].bars;
    expect(parse(raw).sequences[0].bars).toBe(1);
  });

  it.each([
    [0, 1],
    [99, 8],
    [2.5, 1],
    ["4", 1],
  ])("brings bars %s into range as %s", (bars, expected) => {
    expect(parse(withFirst({ bars })).sequences[0].bars).toBe(expected);
  });

  it("keeps steps in later bars, and drops ones past the longest sequence", () => {
    const { sequences } = parse(withPattern({ 0: [3, 16, 127, 128] }));
    expect(sequences[0].pattern).toEqual({ 0: [3, 16, 127] });
  });

  it("fills in the sequences a song does not have, and drops extra ones", () => {
    const short = { ...serializeSong(song), sequences: [song.sequences[0]] };
    expect(parse(short).sequences).toEqual([song.sequences[0], empty, empty, empty]);
    const long = { ...serializeSong(song), sequences: Array.from({ length: 9 }, () => song.sequences[0]) };
    expect(parse(long).sequences).toHaveLength(4);
  });

  it.each([
    [2, 2],
    [4, 0],
    [-1, 0],
    [1.5, 0],
    ["1", 0],
    [undefined, 0],
  ])("brings the current sequence %s into range as %s", (current, expected) => {
    expect(parse({ ...serializeSong(song), current }).current).toBe(expected);
  });

  it("accepts an empty pattern: clearing everything is a valid song", () => {
    expect(parse(withPattern({})).sequences[0].pattern).toEqual({});
  });

  it.each([
    ["nothing stored", null],
    ["undefined", undefined],
    ["a string", "hello"],
    ["a number", 42],
    ["an array", []],
    ["no version", { bpm: 100, volume: 80, sequences: [] }],
    ["another version", { ...serializeSong(song), version: SONG_VERSION + 1 }],
    ["a version of the wrong type", { ...serializeSong(song), version: String(SONG_VERSION) }],
    ["no bpm", { ...serializeSong(song), bpm: undefined }],
    ["a bpm that is not a number", { ...serializeSong(song), bpm: "fast" }],
    ["a bpm that is not finite", { ...serializeSong(song), bpm: Infinity }],
    ["a volume that is not a number", { ...serializeSong(song), volume: "loud" }],
    ["no sequences", { ...serializeSong(song), sequences: undefined }],
    ["sequences that are not a list", { ...serializeSong(song), sequences: { 0: song.sequences[0] } }],
    ["a sequence that is not an object", { ...serializeSong(song), sequences: [null] }],
    ["a sequence with no pattern", withFirst({ pattern: undefined })],
    ["a null pattern", withFirst({ pattern: null })],
    ["an array for a pattern", withFirst({ pattern: [[0, 4]] })],
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
    expect(parse(raw).sequences[0].pattern).toEqual({ 0: [1] });
  });

  it("drops steps that don't exist, and anything that is not a step", () => {
    const raw = withPattern({ 0: [0, 15, 16, -1, 2.5, "3", null, 7] });
    expect(parse(raw).sequences[0].pattern).toEqual({ 0: [0, 7, 15, 16] }); // 16 is bar 2 of 8
  });

  it("lists each step once, in order", () => {
    expect(parse(withPattern({ 0: [8, 2, 8, 2, 0] })).sequences[0].pattern).toEqual({ 0: [0, 2, 8] });
  });

  it("drops a pad whose steps are not a list, or end up empty", () => {
    const raw = withPattern({ 0: "1,2", 1: 5, 2: { 0: true }, 3: [999], 4: [] });
    expect(parse(raw).sequences[0].pattern).toEqual({});
  });

  it("checks pads and steps against the size it is given", () => {
    const small = parseSong(stored(withPattern({ 0: [0, 3, 4], 2: [1], 3: [1] })), { rows: 3, steps: 4 });
    expect(small.sequences[0].pattern).toEqual({ 0: [0, 3], 2: [1] });
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
      read: () => ({ bpm, volume: 80, current: 0, sequences: [empty] }),
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
    expect(upgradeSong({ ...current, version: SONG_VERSION - 1 }, {})).toBeNull();
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

describe("velocities", () => {
  const withVelocities = (velocities) => withFirst({ velocities });
  const velocitiesOf = (raw) => parse(raw).sequences[0].velocities;

  it("come back as they were saved", () => {
    expect(velocitiesOf(serializeSong(song))).toEqual({ 0: { 4: 90, 12: 20 } });
  });

  it("are brought into 1-127 and rounded, and full ones are not kept", () => {
    expect(velocitiesOf(withVelocities({ 0: { 0: 0, 4: 500, 8: 63.6, 12: 127 } }))).toEqual({ 0: { 0: 1, 8: 64 } });
  });

  it("are dropped for steps that are off, pads that are not there and values that are not numbers", () => {
    const raw = withVelocities({ 0: { 1: 50, 4: "loud", 8: null }, 7: { 0: 50 }, x: { 0: 50 }, 3: 50, 4: [60] });
    expect(velocitiesOf(raw)).toEqual({});
  });

  it("are empty when a sequence has none, or has them in the wrong shape", () => {
    expect(velocitiesOf(withFirst({ velocities: undefined }))).toEqual({});
    expect(velocitiesOf(withVelocities([1, 2]))).toEqual({});
    expect(velocitiesOf(withVelocities("loud"))).toEqual({});
  });
});

describe("songs saved by version 2", () => {
  it("load with every step at full velocity", () => {
    const v2 = {
      version: 2,
      bpm: 100,
      volume: 50,
      current: 0,
      sequences: [{ bars: 2, pattern: { 0: [0, 4] } }],
    };
    expect(parse(v2).sequences[0]).toEqual({ bars: 2, pattern: { 0: [0, 4] }, velocities: {} });
  });
});

describe("songs saved by version 1", () => {
  const v1 = { version: 1, bpm: 120, volume: 70, pattern: { 0: [0, 8], 2: [4] } };

  it("become a song with that pattern as the first sequence, selected", () => {
    expect(parse(v1)).toEqual({
      bpm: 120,
      volume: 70,
      current: 0,
      sequences: [{ bars: 1, pattern: { 0: [0, 8], 2: [4] }, velocities: {} }, empty, empty, empty],
    });
  });

  it("keep a length the page had saved for it", () => {
    expect(parse({ ...v1, bars: 2 }).sequences[0].bars).toBe(2);
  });

  it("are still refused when the pattern is not one", () => {
    expect(parse({ ...v1, pattern: null })).toBeNull();
    expect(parse({ version: 1, bpm: 120, volume: 70 })).toBeNull();
  });
});
