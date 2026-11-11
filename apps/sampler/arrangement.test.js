import { describe, expect, it } from "vitest";
import {
  MAX_ENTRIES,
  MAX_REPEATS,
  afterSequenceAdded,
  afterSequenceRemoved,
  cleanArrangement,
  passOrder,
  resolveArrangement,
} from "./arrangement.js";

const entry = (sequence, repeats = 1) => ({ sequence, repeats });

describe("cleanArrangement", () => {
  it("keeps entries that name a sequence the song has, with their repeats", () => {
    expect(cleanArrangement([entry(2, 3), entry(0), entry(2, 16)], 3)).toEqual([entry(2, 3), entry(0), entry(2, 16)]);
  });

  it("is no arrangement (null) when it is not a list: that is what a song that was never edited has", () => {
    for (const raw of [undefined, null, {}, "0", 3, { 0: entry(0) }]) expect(cleanArrangement(raw, 3)).toBeNull();
  });

  it("is no arrangement when nothing in it can be used, an empty list included", () => {
    expect(cleanArrangement([], 3)).toBeNull();
    expect(cleanArrangement([entry(3), entry(-1), null], 3)).toBeNull();
  });

  it("drops an entry that names a sequence the song does not have, or does not name one in whole numbers", () => {
    const raw = [entry(0), entry(3), entry(-1), entry(1.5), { sequence: "1", repeats: 1 }, { repeats: 2 }, entry(2)];
    expect(cleanArrangement(raw, 3)).toEqual([entry(0), entry(2)]);
  });

  it("drops what is not an entry at all", () => {
    expect(cleanArrangement([entry(0), null, 4, "x", [1, 2], entry(1)], 3)).toEqual([entry(0), entry(1)]);
  });

  it("brings repeats into 1 to 16, and reads one that is not a whole number as 1", () => {
    const raw = [
      entry(0, 0),
      entry(0, -4),
      entry(0, 17),
      entry(0, 1000),
      entry(0, 2.5),
      entry(0, "3"),
      { sequence: 0 },
    ];
    expect(cleanArrangement(raw, 1).map(({ repeats }) => repeats)).toEqual([1, 1, MAX_REPEATS, MAX_REPEATS, 1, 1, 1]);
  });

  it("keeps nothing but the sequence and the repeats of an entry", () => {
    expect(cleanArrangement([{ sequence: 1, repeats: 2, label: "verse" }], 2)).toEqual([entry(1, 2)]);
  });

  it("keeps the first 32 entries", () => {
    expect(MAX_ENTRIES).toBe(32);
    const many = Array.from({ length: 50 }, (_, i) => entry(i % 3));
    expect(cleanArrangement(many, 3)).toEqual(many.slice(0, MAX_ENTRIES));
  });

  it("counts only the entries it keeps towards the 32: ones it drops make room", () => {
    const junk = entry(99);
    const mixed = Array.from({ length: 100 }, (_, i) => (i < 10 ? junk : entry(0)));
    expect(cleanArrangement(mixed, 3)).toHaveLength(MAX_ENTRIES);
  });

  it("gives back new entries and leaves what it was given alone", () => {
    const raw = [entry(0, 99)];
    const clean = cleanArrangement(raw, 1);
    expect(clean[0]).not.toBe(raw[0]);
    expect(raw).toEqual([entry(0, 99)]);
  });

  it("has nothing to keep when the song has no sequences to name", () => {
    expect(cleanArrangement([entry(0)], 0)).toBeNull();
  });
});

describe("resolveArrangement", () => {
  it("is every sequence once, in order, when there is no arrangement", () => {
    expect(resolveArrangement(null, 3)).toEqual([entry(0), entry(1), entry(2)]);
    expect(resolveArrangement(null, 1)).toEqual([entry(0)]);
  });

  it("follows the number of sequences while there is none: one added or removed is in it, or gone from it", () => {
    expect(resolveArrangement(null, 4)).toHaveLength(4);
    expect(resolveArrangement(null, 2)).toHaveLength(2);
  });

  it("is the arrangement itself once there is one, whatever the number of sequences", () => {
    const arrangement = [entry(2, 2), entry(0)];
    expect(resolveArrangement(arrangement, 5)).toEqual(arrangement);
  });
});

describe("passOrder", () => {
  it("is the sequences in order, once each, with no arrangement", () => {
    expect(passOrder(null, 4)).toEqual([0, 1, 2, 3]);
  });

  it("plays each entry as many times as it repeats, in the order of the entries", () => {
    expect(passOrder([entry(2, 2), entry(0), entry(2, 3)], 3)).toEqual([2, 2, 0, 2, 2, 2]);
  });

  it("is as long as the repeats add up to, at most 32 entries of 16", () => {
    const longest = Array.from({ length: MAX_ENTRIES }, () => entry(0, MAX_REPEATS));
    expect(passOrder(longest, 1)).toHaveLength(MAX_ENTRIES * MAX_REPEATS);
  });
});

describe("afterSequenceAdded", () => {
  it("leaves no arrangement as none: while there is none, every sequence is in the song, the new one too", () => {
    expect(afterSequenceAdded(null, 3)).toBeNull();
  });

  it("puts an entry for the new sequence, once, at the end of an arrangement that has been edited", () => {
    expect(afterSequenceAdded([entry(1, 4), entry(0)], 2)).toEqual([entry(1, 4), entry(0), entry(2)]);
  });

  it("leaves the arrangement as it is when it already has as many entries as there can be", () => {
    const full = Array.from({ length: MAX_ENTRIES }, () => entry(0));
    expect(afterSequenceAdded(full, 1)).toEqual(full);
  });

  it("gives back a new list and leaves the old one alone", () => {
    const before = [entry(0)];
    const after = afterSequenceAdded(before, 1);
    expect(after).not.toBe(before);
    expect(before).toEqual([entry(0)]);
  });
});

describe("afterSequenceRemoved", () => {
  it("leaves no arrangement as none: the sequences that are left are the song", () => {
    expect(afterSequenceRemoved(null, 1)).toBeNull();
  });

  it("drops every entry that named the sequence, and keeps the repeats of the others", () => {
    const arrangement = [entry(0, 2), entry(1, 3), entry(0), entry(2, 4)];
    expect(afterSequenceRemoved(arrangement, 1)).toEqual([entry(0, 2), entry(0), entry(1, 4)]);
  });

  it("moves down the entries that named a sequence after the one removed, and none of the ones before it", () => {
    expect(afterSequenceRemoved([entry(0), entry(2), entry(3), entry(1)], 0)).toEqual([entry(1), entry(2), entry(0)]);
    expect(afterSequenceRemoved([entry(0), entry(1), entry(2), entry(3)], 3)).toEqual([entry(0), entry(1), entry(2)]);
  });

  it("is no arrangement when no entry is left: the sequences that are left play once each", () => {
    expect(afterSequenceRemoved([entry(1, 4), entry(1)], 1)).toBeNull();
  });

  it("keeps the order of what is left, as the person made it", () => {
    expect(afterSequenceRemoved([entry(3), entry(1), entry(2), entry(0)], 1)).toEqual([entry(2), entry(1), entry(0)]);
  });

  it("gives back a new list and leaves the old one alone", () => {
    const before = [entry(0), entry(1)];
    const after = afterSequenceRemoved(before, 0);
    expect(after).not.toBe(before);
    expect(before).toEqual([entry(0), entry(1)]);
  });
});
