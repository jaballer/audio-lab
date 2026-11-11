import { describe, expect, it } from "vitest";
import {
  MAX_ENTRIES,
  MAX_REPEATS,
  afterSequenceAdded,
  afterSequenceRemoved,
  cleanArrangement,
  insertEntry,
  moveEntry,
  nextPass,
  passOrder,
  positionOf,
  removeEntry,
  resolveArrangement,
  setRepeats,
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

describe("positionOf", () => {
  it("is the first entry that names the sequence, at its first repeat", () => {
    expect(positionOf([entry(2, 3), entry(0), entry(2)], 3, 2)).toEqual({ entry: 0, rep: 0 });
    expect(positionOf([entry(2, 3), entry(0), entry(2)], 3, 0)).toEqual({ entry: 1, rep: 0 });
  });

  it("is null for a sequence that no entry names: it is not in the song", () => {
    expect(positionOf([entry(2), entry(0)], 3, 1)).toBeNull();
  });

  it("is the sequence's own place when there is no arrangement: every sequence is in it, once, in order", () => {
    expect(positionOf(null, 4, 3)).toEqual({ entry: 3, rep: 0 });
    expect(positionOf(null, 4, 0)).toEqual({ entry: 0, rep: 0 });
  });
});

describe("nextPass", () => {
  // The passes a song gives, one after the other, from the first of them, the way the controller asks for them: it hands back
  // where the last one was and the sequence that played.
  const walk = (
    arrangement,
    count,
    passes,
    start = { played: null, sequence: resolveArrangement(arrangement, count)[0].sequence },
  ) => {
    const out = [];
    let { played, sequence } = start;
    for (let i = 0; i < passes; i++) {
      const pass = nextPass(arrangement, count, played, sequence);
      out.push(pass.sequence);
      played = { entry: pass.entry, rep: pass.rep };
      sequence = pass.sequence;
    }
    return out;
  };

  it("goes on to the next sequence, and from the last to the first, with no arrangement", () => {
    expect(nextPass(null, 3, null, 0)).toEqual({ entry: 1, rep: 0, sequence: 1 });
    expect(nextPass(null, 3, { entry: 1, rep: 0 }, 1)).toEqual({ entry: 2, rep: 0, sequence: 2 });
    expect(nextPass(null, 3, { entry: 2, rep: 0 }, 2)).toEqual({ entry: 0, rep: 0, sequence: 0 });
    expect(nextPass(null, 1, null, 0)).toEqual({ entry: 0, rep: 0, sequence: 0 });
  });

  it("repeats an entry before it goes on, and counts the repeat", () => {
    const arrangement = [entry(1, 3), entry(0)];
    expect(nextPass(arrangement, 2, { entry: 0, rep: 0 }, 1)).toEqual({ entry: 0, rep: 1, sequence: 1 });
    expect(nextPass(arrangement, 2, { entry: 0, rep: 1 }, 1)).toEqual({ entry: 0, rep: 2, sequence: 1 });
    expect(nextPass(arrangement, 2, { entry: 0, rep: 2 }, 1)).toEqual({ entry: 1, rep: 0, sequence: 0 });
  });

  it("goes round from the last entry to the first", () => {
    expect(nextPass([entry(0), entry(2, 2)], 3, { entry: 1, rep: 1 }, 2)).toEqual({ entry: 0, rep: 0, sequence: 0 });
  });

  it("gives the passes of passOrder, from the first, round and round", () => {
    const arrangement = [entry(2, 2), entry(0), entry(1, 3), entry(2)];
    const order = passOrder(arrangement, 3);
    const walked = walk(arrangement, 3, order.length * 3);
    // from the first pass, so the next is the second
    expect(walked).toEqual([...order.slice(1), ...order, ...order, order[0]]);
  });

  it("gives every sequence once, in order, round and round, with no arrangement", () => {
    expect(walk(null, 4, 9)).toEqual([1, 2, 3, 0, 1, 2, 3, 0, 1]);
  });

  it("counts the times round a single entry and begins it again when they are over", () => {
    const only = [entry(1, 3)];
    expect(nextPass(only, 2, { entry: 0, rep: 0 }, 1)).toEqual({ entry: 0, rep: 1, sequence: 1 });
    expect(nextPass(only, 2, { entry: 0, rep: 1 }, 1)).toEqual({ entry: 0, rep: 2, sequence: 1 });
    expect(nextPass(only, 2, { entry: 0, rep: 2 }, 1)).toEqual({ entry: 0, rep: 0, sequence: 1 });
  });

  it("takes the place of the sequence that played from the first entry that names it, when it does not know where it was", () => {
    const arrangement = [entry(0), entry(1, 2), entry(2), entry(1)];
    expect(nextPass(arrangement, 3, null, 1)).toEqual({ entry: 1, rep: 1, sequence: 1 });
    expect(nextPass(arrangement, 3, null, 2)).toEqual({ entry: 3, rep: 0, sequence: 1 });
  });

  it("believes where it was while that entry still names the sequence that played, and tells two entries for one sequence apart", () => {
    const arrangement = [entry(1), entry(0), entry(1, 2)];
    expect(nextPass(arrangement, 2, { entry: 2, rep: 0 }, 1)).toEqual({ entry: 2, rep: 1, sequence: 1 });
    expect(nextPass(arrangement, 2, { entry: 0, rep: 0 }, 1)).toEqual({ entry: 1, rep: 0, sequence: 0 });
  });

  it("does not believe where it was when that entry names another sequence, is not there, or has no such repeat", () => {
    const arrangement = [entry(0), entry(1, 2), entry(2)];
    // entry 0 names sequence 0, but sequence 2 played: it was somewhere else
    expect(nextPass(arrangement, 3, { entry: 0, rep: 0 }, 2)).toEqual({ entry: 0, rep: 0, sequence: 0 });
    // an entry that is not there
    expect(nextPass(arrangement, 3, { entry: 7, rep: 0 }, 2)).toEqual({ entry: 0, rep: 0, sequence: 0 });
    // a repeat the entry does not have (it was made shorter): the first entry that names the sequence
    expect(nextPass(arrangement, 3, { entry: 1, rep: 5 }, 1)).toEqual({ entry: 1, rep: 1, sequence: 1 });
    expect(nextPass(arrangement, 3, { entry: 1, rep: 2 }, 1)).toEqual({ entry: 1, rep: 1, sequence: 1 }); // the entry repeats twice: 0 and 1
  });

  it("begins the song at its first entry after a sequence that is not in it", () => {
    expect(nextPass([entry(0), entry(1)], 3, null, 2)).toEqual({ entry: 0, rep: 0, sequence: 0 });
    expect(nextPass([entry(1, 2), entry(0)], 3, { entry: 0, rep: 0 }, 2)).toEqual({ entry: 0, rep: 0, sequence: 1 });
  });

  it("never gives a pass that is not an entry of the song", () => {
    for (let trial = 0; trial < 300; trial++) {
      const count = 1 + (trial % 5);
      const arrangement =
        trial % 4 === 0
          ? null
          : Array.from({ length: 1 + (trial % 7) }, (_, i) => entry((i * 3 + trial) % count, 1 + ((i + trial) % 4)));
      const entries = resolveArrangement(arrangement, count);
      let played = trial % 3 ? null : { entry: trial % 9, rep: trial % 5 };
      let sequence = trial % count;
      for (let i = 0; i < 40; i++) {
        const pass = nextPass(arrangement, count, played, sequence);
        expect(entries[pass.entry]).toBeDefined();
        expect(entries[pass.entry].sequence).toBe(pass.sequence);
        expect(pass.rep).toBeGreaterThanOrEqual(0);
        expect(pass.rep).toBeLessThan(entries[pass.entry].repeats);
        played = { entry: pass.entry, rep: pass.rep };
        sequence = pass.sequence;
      }
    }
  });
});

describe("editing the arrangement", () => {
  // Each edit gives back the list after it and where each entry went, or null when it cannot be done.
  const moved = (edit) => (index) => edit.entryAfter(index);

  describe("insertEntry", () => {
    it("puts an entry for the sequence at the place, once, and makes a song that had no arrangement explicit", () => {
      expect(insertEntry(null, 3, 1, 2).arrangement).toEqual([entry(0), entry(2), entry(1), entry(2)]);
      expect(insertEntry([entry(2, 4)], 3, 1, 0).arrangement).toEqual([entry(2, 4), entry(0)]);
      expect(insertEntry([entry(2, 4)], 3, 0, 0).arrangement).toEqual([entry(0), entry(2, 4)]);
    });

    it("brings the place into the list: before the first, or after the last", () => {
      expect(insertEntry([entry(0), entry(1)], 2, -5, 1).arrangement).toEqual([entry(1), entry(0), entry(1)]);
      expect(insertEntry([entry(0), entry(1)], 2, 99, 1).arrangement).toEqual([entry(0), entry(1), entry(1)]);
    });

    it("says where each entry went: the ones from the place on move up one", () => {
      const edit = insertEntry([entry(0), entry(1), entry(0)], 2, 1, 1);
      expect([0, 1, 2].map(moved(edit))).toEqual([0, 2, 3]);
    });

    it("cannot when there are as many entries as there can be", () => {
      const full = Array.from({ length: MAX_ENTRIES }, () => entry(0));
      expect(insertEntry(full, 2, 3, 1)).toBeNull();
      expect(insertEntry(full.slice(1), 2, 3, 1)).not.toBeNull();
    });

    it("brings a place before the first into the list from the start, not from the end", () => {
      expect(insertEntry([entry(0), entry(1), entry(2)], 3, -1, 2).arrangement).toEqual([
        entry(2),
        entry(0),
        entry(1),
        entry(2),
      ]);
      const edit = insertEntry([entry(0), entry(1), entry(2)], 3, -1, 2);
      expect([0, 1, 2].map(moved(edit))).toEqual([1, 2, 3]);
    });

    it("says where each entry went when the place is past the end: none of them moved", () => {
      const edit = insertEntry([entry(0), entry(1)], 2, 99, 0);
      expect([0, 1].map(moved(edit))).toEqual([0, 1]);
    });

    it("cannot for a place that is not a whole number", () => {
      for (const at of [1.5, NaN, undefined, "1"]) expect(insertEntry([entry(0), entry(1)], 2, at, 0)).toBeNull();
    });

    it("cannot for a sequence the song does not have, or that is not a whole number", () => {
      for (const sequence of [-1, 3, 1.5, "1", NaN, undefined]) expect(insertEntry(null, 3, 0, sequence)).toBeNull();
    });

    it("gives a new list, and leaves the one it was given alone", () => {
      const before = [entry(0)];
      const edit = insertEntry(before, 2, 1, 1);
      expect(edit.arrangement).not.toBe(before);
      expect(before).toEqual([entry(0)]);
      expect(edit.arrangement[0]).not.toBe(before[0]);
    });
  });

  describe("removeEntry", () => {
    it("takes the entry out and keeps the others as they are, with their repeats", () => {
      expect(removeEntry([entry(0, 2), entry(1, 3), entry(2)], 3, 1).arrangement).toEqual([entry(0, 2), entry(2)]);
    });

    it("works on the entries a song with no arrangement has, and makes them explicit", () => {
      expect(removeEntry(null, 3, 0).arrangement).toEqual([entry(1), entry(2)]);
    });

    it("says where each entry went: the one removed is gone, the ones after it move down", () => {
      const edit = removeEntry([entry(0), entry(1), entry(2), entry(0)], 3, 1);
      expect([0, 1, 2, 3].map(moved(edit))).toEqual([0, -1, 1, 2]);
    });

    it("cannot take the last entry: a song is never left playing nothing", () => {
      expect(removeEntry([entry(1, 5)], 3, 0)).toBeNull();
      expect(removeEntry(null, 1, 0)).toBeNull();
    });

    it("cannot for an entry that is not there", () => {
      for (const index of [-1, 2, 1.5, "0", NaN]) expect(removeEntry([entry(0), entry(1)], 2, index)).toBeNull();
    });

    it("gives a new list, and leaves the one it was given alone", () => {
      const before = [entry(0), entry(1)];
      const edit = removeEntry(before, 2, 0);
      expect(edit.arrangement).not.toBe(before);
      expect(before).toEqual([entry(0), entry(1)]);
    });
  });

  describe("moveEntry", () => {
    const list = [entry(0), entry(1, 2), entry(2), entry(0, 3)];

    it("moves an entry to the place, later or earlier, with its repeats", () => {
      expect(moveEntry(list, 3, 1, 3).arrangement).toEqual([entry(0), entry(2), entry(0, 3), entry(1, 2)]);
      expect(moveEntry(list, 3, 3, 0).arrangement).toEqual([entry(0, 3), entry(0), entry(1, 2), entry(2)]);
      expect(moveEntry(list, 3, 1, 2).arrangement).toEqual([entry(0), entry(2), entry(1, 2), entry(0, 3)]);
    });

    it("says where each entry went", () => {
      const later = moveEntry(list, 3, 0, 2);
      expect([0, 1, 2, 3].map(moved(later))).toEqual([2, 0, 1, 3]);
      const earlier = moveEntry(list, 3, 3, 1);
      expect([0, 1, 2, 3].map(moved(earlier))).toEqual([0, 2, 3, 1]);
    });

    it("cannot when it would not change anything, or for an entry or a place that is not there", () => {
      expect(moveEntry(list, 3, 2, 2)).toBeNull();
      for (const [from, to] of [
        [-1, 0],
        [0, -1],
        [4, 0],
        [0, 4],
        [0.5, 1],
        [0, "1"],
        [NaN, 0],
      ]) {
        expect(moveEntry(list, 3, from, to)).toBeNull();
      }
    });

    it("works on the entries a song with no arrangement has", () => {
      expect(moveEntry(null, 3, 0, 2).arrangement).toEqual([entry(1), entry(2), entry(0)]);
    });

    it("gives a new list, and leaves the one it was given alone", () => {
      const before = [entry(0), entry(1)];
      moveEntry(before, 2, 0, 1);
      expect(before).toEqual([entry(0), entry(1)]);
    });
  });

  describe("setRepeats", () => {
    it("sets how many times an entry goes round, from 1 to 16", () => {
      expect(setRepeats([entry(0), entry(1)], 2, 1, 5).arrangement).toEqual([entry(0), entry(1, 5)]);
      expect(setRepeats([entry(0, 4)], 2, 0, 1).arrangement).toEqual([entry(0)]);
    });

    it("brings the number into range, and is nothing when that is what it was", () => {
      expect(setRepeats([entry(0)], 1, 0, 99).arrangement).toEqual([entry(0, MAX_REPEATS)]);
      expect(setRepeats([entry(0, 3)], 1, 0, 0).arrangement).toEqual([entry(0)]);
      expect(setRepeats([entry(0, 3)], 1, 0, 3)).toBeNull();
      expect(setRepeats([entry(0, MAX_REPEATS)], 1, 0, 99)).toBeNull();
      expect(setRepeats([entry(0)], 1, 0, -4)).toBeNull();
    });

    it("cannot for repeats that are not a whole number, or an entry that is not there", () => {
      for (const repeats of [1.5, "2", NaN, undefined]) expect(setRepeats([entry(0)], 1, 0, repeats)).toBeNull();
      for (const index of [-1, 1, 0.5]) expect(setRepeats([entry(0)], 1, index, 2)).toBeNull();
    });

    it("leaves every entry where it was", () => {
      const edit = setRepeats([entry(0), entry(1)], 2, 1, 4);
      expect([0, 1].map(moved(edit))).toEqual([0, 1]);
    });

    it("works on the entries a song with no arrangement has", () => {
      expect(setRepeats(null, 3, 1, 2).arrangement).toEqual([entry(0), entry(1, 2), entry(2)]);
    });

    it("gives a new list, and leaves the one it was given alone", () => {
      const before = [entry(0)];
      setRepeats(before, 1, 0, 4);
      expect(before).toEqual([entry(0)]);
    });
  });
});
