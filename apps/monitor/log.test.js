import { describe, expect, it } from "vitest";
import { createLog } from "./log.js";

const note = (n, velocity = 100, channel = 1, source = "MPC") => ({
  kind: "note",
  source,
  channel,
  hit: { note: n, velocity },
});

describe("createLog", () => {
  it("keeps messages in the order they arrived", () => {
    const log = createLog();
    log.add({ name: "a" });
    log.add({ name: "b" });
    expect(log.entries().map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("drops the oldest messages past the limit", () => {
    const log = createLog({ limit: 3 });
    for (const name of ["a", "b", "c", "d", "e"]) log.add({ name });
    expect(log.entries().map((e) => e.name)).toEqual(["c", "d", "e"]);
  });

  it("tallies note hits per channel and note, sorted, with the hardest velocity", () => {
    const log = createLog();
    log.add(note(37, 50));
    log.add(note(36, 90));
    log.add(note(36, 127));
    log.add(note(36, 10, 10));
    expect(log.notesHit()).toEqual([
      { source: "MPC", channel: 1, note: 36, count: 2, maxVelocity: 127 },
      { source: "MPC", channel: 1, note: 37, count: 1, maxVelocity: 50 },
      { source: "MPC", channel: 10, note: 36, count: 1, maxVelocity: 10 },
    ]);
  });

  it("keeps two inputs apart when they send the same channel and note", () => {
    const log = createLog();
    log.add(note(36, 90, 1, "MPC"));
    log.add(note(36, 40, 1, "Launchpad"));
    log.add(note(36, 100, 1, "MPC"));
    expect(log.notesHit()).toEqual([
      { source: "Launchpad", channel: 1, note: 36, count: 1, maxVelocity: 40 },
      { source: "MPC", channel: 1, note: 36, count: 2, maxVelocity: 100 },
    ]);
  });

  it("does not tally messages that are not note hits", () => {
    const log = createLog();
    log.add({ kind: "cc", channel: 1 });
    expect(log.notesHit()).toEqual([]);
  });

  it("keeps counting hits after older messages have been dropped", () => {
    const log = createLog({ limit: 2 });
    for (let i = 0; i < 5; i++) log.add(note(36));
    expect(log.entries()).toHaveLength(2);
    expect(log.notesHit()[0].count).toBe(5);
  });

  it("clears both the messages and the tally", () => {
    const log = createLog();
    log.add(note(36));
    log.clear();
    expect(log.entries()).toEqual([]);
    expect(log.notesHit()).toEqual([]);
  });
});
