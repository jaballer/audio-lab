import { describe, expect, it } from "vitest";
import {
  CLOCKS_PER_BEAT,
  DEFAULT_BPM,
  LOOKAHEAD_MS,
  MAX_BPM,
  MIN_BPM,
  clampBpm,
  createClockMaster,
} from "./clock-master.js";

const START = [0xfa];

function setup() {
  const sent = [];
  const master = createClockMaster({ send: (bytes, time) => sent.push({ bytes, time }), startMessage: START });
  const ticks = () => sent.filter((m) => m.bytes[0] === 0xf8);
  return { master, sent, ticks };
}

describe("createClockMaster", () => {
  it("sends Start first, then the first tick a moment later", () => {
    const { master, sent } = setup();
    master.start(120, 1000);
    expect(sent[0]).toEqual({ bytes: START, time: 1000 });
    expect(sent[1].bytes).toEqual([0xf8]);
    expect(sent[1].time).toBeGreaterThan(1000);
  });

  it("spaces ticks 24 to a beat at the tempo", () => {
    const { master, ticks } = setup();
    master.start(120, 0); // a beat is 500 ms, so a tick every 500/24 ms
    master.tick(0);
    const times = ticks().map((m) => m.time);
    expect(times.length).toBeGreaterThan(2);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(500 / CLOCKS_PER_BEAT, 6);
  });

  it("queues ticks only up to the lookahead", () => {
    const { master, ticks } = setup();
    master.start(120, 0);
    expect(Math.max(...ticks().map((m) => m.time))).toBeLessThanOrEqual(LOOKAHEAD_MS);
  });

  it("queues each tick once however often tick() runs", () => {
    const { master, ticks } = setup();
    master.start(120, 0);
    for (let now = 0; now <= 1000; now += 25) master.tick(now);
    const times = ticks().map((m) => m.time);
    expect(new Set(times).size).toBe(times.length);
    // a full second at 120 BPM is two beats; ticks run up to the lookahead past the last call
    expect(times.length).toBeGreaterThanOrEqual(2 * CLOCKS_PER_BEAT);
    expect(times.length).toBeLessThanOrEqual(2 * CLOCKS_PER_BEAT + 6);
  });

  // Past-due timestamps are delivered at once by Web MIDI, which the device would read as a burst.
  it("skips ticks that are already overdue after a stall, staying on the beat grid", () => {
    const { master, ticks } = setup();
    master.start(120, 0);
    const before = ticks().length;
    master.tick(400); // the timer stalled for 400 ms
    const late = ticks()
      .slice(before)
      .map((m) => m.time);
    expect(late.length).toBeGreaterThan(0);
    expect(Math.min(...late)).toBeGreaterThanOrEqual(400);
    // the same grid as before the stall: a multiple of the gap after the first tick
    const gap = 500 / CLOCKS_PER_BEAT;
    const first = ticks()[0].time;
    for (const t of late) expect((t - first) / gap).toBeCloseTo(Math.round((t - first) / gap), 6);
    // a long freeze does not queue thousands of ticks either
    master.tick(10 * 60 * 1000);
    expect(ticks().length - before - late.length).toBeLessThan(10);
  });

  it("sends no more ticks once halted", () => {
    const { master, sent } = setup();
    master.start(120, 0);
    master.halt();
    const count = sent.length;
    master.tick(5000);
    expect(sent.length).toBe(count);
    expect(master.running).toBe(false);
  });

  it("can start again after a halt, from the new time", () => {
    const { master, sent } = setup();
    master.start(120, 0);
    master.halt();
    sent.length = 0;
    master.start(120, 9000);
    expect(sent[0]).toEqual({ bytes: START, time: 9000 });
    expect(sent[1].time).toBeGreaterThan(9000);
    expect(master.running).toBe(true);
  });

  it("clears the ticks already queued when halted, where the output can", () => {
    let cleared = 0;
    const master = createClockMaster({ send() {}, clear: () => cleared++, startMessage: START });
    master.start(120, 0);
    cleared = 0; // the start clears too; this is about the halt
    master.halt();
    expect(cleared).toBe(1);
  });

  it("halts without a clear function (not every browser has MIDIOutput.clear)", () => {
    const { master } = setup();
    master.start(120, 0);
    expect(() => master.halt()).not.toThrow();
  });

  it("clears anything still queued when it starts a new stream", () => {
    let cleared = 0;
    const master = createClockMaster({ send() {}, clear: () => cleared++, startMessage: START });
    master.start(120, 0);
    expect(cleared).toBe(1);
  });

  it("does nothing on tick() before it has started", () => {
    const { master, sent } = setup();
    master.tick(1000);
    expect(sent).toEqual([]);
  });
});

describe("clampBpm", () => {
  it("keeps a tempo inside the range and falls back to the default for a non-number", () => {
    expect(clampBpm(95.5)).toBe(95.5);
    expect(clampBpm(5)).toBe(MIN_BPM);
    expect(clampBpm(9999)).toBe(MAX_BPM);
    expect(clampBpm(null)).toBe(DEFAULT_BPM);
    expect(clampBpm(NaN)).toBe(DEFAULT_BPM);
  });
});
