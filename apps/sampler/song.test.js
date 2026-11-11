import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STARTER_BEAT } from "./starter-beat.js";
import {
  SONG_BACKUP_KEY,
  SONG_KEY,
  SONG_VERSION,
  backUpUnusable,
  createSongSaver,
  needsBackup,
  parseSong,
  serializeSong,
  upgradeSong,
} from "./song.js";

const SHAPE = { rows: 16, steps: 16, maxBars: 8, maxSequences: 4 };
const empty = { bars: 1, pattern: {}, velocities: {} };
const song = {
  bpm: 96.5,
  swing: 58,
  volume: 60,
  current: 1,
  padSettings: { 1: { gain: -6, pitch: 3, choke: 2, color: 0, attack: 0, decay: 0, sustain: 100, release: 0 } },
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

  it("keeps as many sequences as the song has, and drops the ones past the most there can be", () => {
    const some = (count) => ({
      ...serializeSong(song),
      sequences: Array.from({ length: count }, () => song.sequences[0]),
    });
    expect(parse(some(1)).sequences).toEqual([song.sequences[0]]);
    expect(parse(some(3)).sequences).toHaveLength(3);
    expect(parse(some(4)).sequences).toHaveLength(4);
    expect(parse(some(9)).sequences).toHaveLength(4);
  });

  it("gives a song with no sequences one empty one: there is always something to play and edit", () => {
    expect(parse({ ...serializeSong(song), sequences: [] }).sequences).toEqual([empty]);
  });

  it("brings the current sequence into the ones the song has", () => {
    const two = { ...serializeSong(song), sequences: [song.sequences[0], song.sequences[1]] };
    expect(parse({ ...two, current: 1 }).current).toBe(1);
    expect(parse({ ...two, current: 2 }).current).toBe(0);
    expect(parse({ ...two, current: 3 }).current).toBe(0);
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

  it("drops a pad key that is not written the way a number is, even when it reads as one", () => {
    const raw = withPattern({ 0: [1], "01": [2], "1e0": [3], " 2": [4], "+3": [5] });
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

  it("cancel drops a waiting change, for the timer and for a flush after it", () => {
    const { saver, saved } = setup();
    saver.schedule();
    saver.cancel();
    saver.flush();
    vi.advanceTimersByTime(1000);
    expect(saved).toEqual([]);
    saver.schedule(); // and it still works afterwards
    vi.advanceTimersByTime(300);
    expect(saved).toEqual([1]);
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

  it("ignore a row named like an inherited property instead of throwing", () => {
    // JSON.parse makes `__proto__` an own key, as stored data would have it.
    const named = JSON.parse('{"__proto__": {"0": 50}, "constructor": {"0": 50}, "toString": {"0": 50}}');
    expect(velocitiesOf(withVelocities(named))).toEqual({});
  });

  it("are empty when a sequence has none, or has them in the wrong shape", () => {
    expect(velocitiesOf(withFirst({ velocities: undefined }))).toEqual({});
    expect(velocitiesOf(withVelocities([1, 2]))).toEqual({});
    expect(velocitiesOf(withVelocities("loud"))).toEqual({});
  });
});

describe("pad settings", () => {
  it("come back as they were saved", () => {
    expect(parse(serializeSong(song)).padSettings).toEqual({
      1: { gain: -6, pitch: 3, choke: 2, color: 0, attack: 0, decay: 0, sustain: 100, release: 0 },
    });
  });

  it("are brought into range, and pads that are not there or are at the defaults are dropped", () => {
    const raw = {
      ...serializeSong(song),
      padSettings: { 0: { gain: 40, pitch: -40 }, 2: { gain: 0, pitch: 0 }, 99: { gain: 1, pitch: 1 } },
    };
    expect(parse(raw).padSettings).toEqual({
      0: { gain: 6, pitch: -12, choke: 0, color: 0, attack: 0, decay: 0, sustain: 100, release: 0 },
    });
  });

  it("are empty when there are none, or they are the wrong shape", () => {
    expect(parse({ ...serializeSong(song), padSettings: undefined }).padSettings).toEqual({});
    expect(parse({ ...serializeSong(song), padSettings: [1, 2] }).padSettings).toEqual({});
    expect(parse({ ...serializeSong(song), padSettings: "loud" }).padSettings).toEqual({});
  });
});

describe("songs saved by version 8", () => {
  // What a page of version 8 kept: always eight sequences, the ones nobody used empty.
  const blank = { bars: 1, pattern: {}, velocities: {} };
  const used = { bars: 1, pattern: { 0: [0, 4] }, velocities: { 0: { 4: 90 } } };
  const v8 = (sequences, current = 0) => ({
    version: 8,
    bpm: 100,
    swing: 58,
    volume: 50,
    current,
    padSettings: {},
    sequences,
  });
  const eight = { ...SHAPE, maxSequences: 8 };
  const load = (raw) => parseSong(stored(raw), eight);

  it("lose the empty sequences at the end, and keep the ones that were used", () => {
    const loaded = load(v8([used, { ...used, bars: 2 }, blank, blank, blank, blank, blank, blank]));
    expect(loaded.sequences).toHaveLength(2);
    expect(loaded.sequences[0]).toEqual(used);
    expect(loaded.sequences[1].bars).toBe(2);
  });

  it("keep an empty sequence that has a used one after it: the numbers after it matter", () => {
    const loaded = load(v8([used, blank, blank, used, blank, blank, blank, blank]));
    expect(loaded.sequences).toHaveLength(4);
    expect(loaded.sequences[1]).toEqual(blank);
    expect(loaded.sequences[3]).toEqual(used);
  });

  it("keep a sequence with no steps showing but some in a bar it no longer shows", () => {
    const hidden = { bars: 1, pattern: { 2: [20, 21] }, velocities: {} }; // bar 2 of a one-bar sequence
    const loaded = load(v8([used, hidden, blank, blank]));
    expect(loaded.sequences).toHaveLength(2);
    expect(loaded.sequences[1].pattern).toEqual({ 2: [20, 21] });
  });

  it("keep an empty sequence that was given a length", () => {
    const loaded = load(v8([used, { bars: 4, pattern: {}, velocities: {} }, blank, blank]));
    expect(loaded.sequences).toHaveLength(2);
    expect(loaded.sequences[1].bars).toBe(4);
  });

  it("count a pad with an empty list of steps as no steps", () => {
    const loaded = load(v8([used, { bars: 1, pattern: { 3: [] }, velocities: {} }, blank]));
    expect(loaded.sequences).toHaveLength(1);
  });

  it("become one empty sequence when every one was empty", () => {
    expect(load(v8([blank, blank, blank, blank])).sequences).toEqual([blank]);
  });

  it("keep the sequence that was showing, or the last one left when it was one of those that went", () => {
    const sequences = [used, used, blank, blank, blank, blank, blank, blank];
    expect(load(v8(sequences, 1)).current).toBe(1);
    expect(load(v8(sequences, 2)).current).toBe(1); // the first one that went
    expect(load(v8(sequences, 5)).current).toBe(1);
  });

  it("keep the tempo, swing, volume and pad settings", () => {
    const loaded = load({ ...v8([used, blank]), padSettings: { 1: { gain: -6 } } });
    expect(loaded).toMatchObject({ bpm: 100, swing: 58, volume: 50 });
    expect(loaded.padSettings[1].gain).toBe(-6);
  });

  it("are left for the loader to refuse when the sequences are not a list", () => {
    expect(load(v8("none"))).toBeNull();
    expect(load({ ...v8([]), sequences: undefined })).toBeNull();
  });

  it("are not made usable by trimming: a sequence that is not shaped like one is kept, and the song refused", () => {
    expect(load(v8([used, { bars: 1 }, blank]))).toBeNull();
    expect(load(v8([used, null]))).toBeNull();
    expect(load(v8([used, blank, "x"]))).toBeNull();
  });

  it("are stamped as the current version", () => {
    expect(upgradeSong(stored(v8([used, blank]))).version).toBe(SONG_VERSION);
    expect(SONG_VERSION).toBe(9);
  });
});

describe("songs saved by version 6", () => {
  it("load with every pad's envelope at its defaults, keeping the other settings", () => {
    const v6 = {
      version: 6,
      bpm: 100,
      volume: 50,
      current: 0,
      padSettings: { 1: { gain: -6, pitch: 3, choke: 2, color: 4 } },
      sequences: [{ bars: 1, pattern: { 0: [0] }, velocities: {} }],
    };
    expect(parse(v6).padSettings).toEqual({
      1: { gain: -6, pitch: 3, choke: 2, color: 4, attack: 0, decay: 0, sustain: 100, release: 0 },
    });
  });

  it("keep a pad's envelope through saving and loading", () => {
    const saved = serializeSong({
      ...song,
      padSettings: { 2: { gain: 0, pitch: 0, choke: 0, color: 0, attack: 30, decay: 20, sustain: 40, release: 60 } },
    });
    expect(saved.version).toBe(SONG_VERSION);
    expect(parse(saved).padSettings).toEqual(saved.padSettings);
  });
});

describe("songs saved by version 5", () => {
  it("load with every pad in no colour, keeping the gain, pitch and choke group that were saved", () => {
    const v5 = {
      version: 5,
      bpm: 100,
      volume: 50,
      current: 0,
      padSettings: { 1: { gain: -6, pitch: 3, choke: 2 } },
      sequences: [{ bars: 1, pattern: { 0: [0] }, velocities: {} }],
    };
    expect(parse(v5).padSettings).toEqual({
      1: { gain: -6, pitch: 3, choke: 2, color: 0, attack: 0, decay: 0, sustain: 100, release: 0 },
    });
  });

  it("keep a pad's colour through saving and loading, even when it is the only thing set", () => {
    const saved = serializeSong({
      ...song,
      padSettings: { 6: { gain: 0, pitch: 0, choke: 0, color: 5, attack: 0, decay: 0, sustain: 100, release: 0 } },
    });
    expect(parse(saved).padSettings).toEqual({
      6: { gain: 0, pitch: 0, choke: 0, color: 5, attack: 0, decay: 0, sustain: 100, release: 0 },
    });
  });
});

describe("songs saved by version 4", () => {
  it("load with every pad in no choke group, keeping the gain and pitch that were saved", () => {
    const v4 = {
      version: 4,
      bpm: 100,
      volume: 50,
      current: 0,
      padSettings: { 1: { gain: -6, pitch: 3 } },
      sequences: [{ bars: 1, pattern: { 0: [0] }, velocities: {} }],
    };
    expect(parse(v4).padSettings).toEqual({
      1: { gain: -6, pitch: 3, choke: 0, color: 0, attack: 0, decay: 0, sustain: 100, release: 0 },
    });
  });

  it("keep a choke group through saving and loading", () => {
    const saved = serializeSong({
      ...song,
      padSettings: { 4: { gain: 0, pitch: 0, choke: 5, color: 0, attack: 0, decay: 0, sustain: 100, release: 0 } },
    });
    expect(saved.version).toBe(SONG_VERSION);
    expect(parse(saved).padSettings).toEqual({
      4: { gain: 0, pitch: 0, choke: 5, color: 0, attack: 0, decay: 0, sustain: 100, release: 0 },
    });
  });
});

describe("songs saved by version 3", () => {
  it("load with every pad at its defaults", () => {
    const v3 = {
      version: 3,
      bpm: 100,
      volume: 50,
      current: 0,
      sequences: [{ bars: 1, pattern: { 0: [0] }, velocities: {} }],
    };
    expect(parse(v3)).toMatchObject({ padSettings: {}, sequences: [{ pattern: { 0: [0] } }] });
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
      swing: 50,
      volume: 70,
      current: 0,
      sequences: [{ bars: 1, pattern: { 0: [0, 8], 2: [4] }, velocities: {} }],
      padSettings: {},
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

describe("needsBackup", () => {
  it("is for what is in storage and could not be used", () => {
    expect(needsBackup({ version: 99 }, false)).toBe(true);
    expect(needsBackup("garbage", false)).toBe(true);
    expect(needsBackup([], false)).toBe(true);
  });

  it("is not for nothing in storage (a first visit), or for what was used", () => {
    expect(needsBackup(null, false)).toBe(false);
    expect(needsBackup(undefined, false)).toBe(false);
    expect(needsBackup({ version: SONG_VERSION }, true)).toBe(false);
  });

  it("matches what parseSong does with a song from a newer page or a damaged one", () => {
    const newer = { ...serializeSong(song), version: SONG_VERSION + 1 };
    expect(needsBackup(newer, parse(newer) !== null)).toBe(true);
    expect(needsBackup(serializeSong(song), parse(serializeSong(song)) !== null)).toBe(false);
  });

  it("has a key of its own, beside the song's", () => {
    expect(SONG_BACKUP_KEY).toBe(`${SONG_KEY}:backup`);
  });
});

describe("backUpUnusable", () => {
  it("saves what could not be used, under the key it is given", () => {
    const save = vi.fn();
    expect(backUpUnusable({ version: 99 }, false, "k:backup", save)).toBe(true);
    expect(save).toHaveBeenCalledExactlyOnceWith("k:backup", { version: 99 });
  });

  it("saves nothing for a first visit or for what was used", () => {
    const save = vi.fn();
    expect(backUpUnusable(null, false, "k:backup", save)).toBe(false);
    expect(backUpUnusable({ version: SONG_VERSION }, true, "k:backup", save)).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("swing", () => {
  it("is kept through saving and loading", () => {
    expect(parse(serializeSong(song)).swing).toBe(58);
  });

  it("is straight in a song that does not say, as one saved by version 7 does not", () => {
    const v7 = {
      version: 7,
      bpm: 100,
      volume: 50,
      current: 0,
      padSettings: {},
      sequences: [{ bars: 1, pattern: { 0: [0] }, velocities: {} }],
    };
    expect(parse(v7).swing).toBe(50);
    expect(serializeSong({ ...song, swing: undefined }).swing).toBe(50);
  });

  it("is brought into range, and a value that is not a number is straight", () => {
    expect(parse({ ...serializeSong(song), swing: 99 }).swing).toBe(75);
    expect(parse({ ...serializeSong(song), swing: 10 }).swing).toBe(50);
    expect(parse({ ...serializeSong(song), swing: "58" }).swing).toBe(50);
    expect(parse({ ...serializeSong(song), swing: 58.4 }).swing).toBe(58);
  });
});
