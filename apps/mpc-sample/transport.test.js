import { describe, expect, it } from "vitest";
import { CLOCKS_PER_BEAT, createTransport } from "./transport.js";

const start = { type: "transportStart" };
const stop = { type: "transportStop" };
const cont = { type: "transportContinue" };

// Feeds `count` clock ticks at `bpm`, starting at `from` ms; returns the time after the last one.
function tick(transport, bpm, count, from = 0) {
  const interval = 60000 / bpm / CLOCKS_PER_BEAT;
  for (let i = 0; i < count; i++) transport.apply({ type: "clock", time: from + i * interval });
  return from + count * interval;
}

describe("a fresh transport", () => {
  it("knows nothing yet", () => {
    expect(createTransport().snapshot()).toEqual({ state: "unknown", bpm: null });
  });
});

describe("play state", () => {
  it("follows Start, Stop and Continue as the device reports them", () => {
    const transport = createTransport();
    transport.apply(start);
    expect(transport.snapshot().state).toBe("playing");
    transport.apply(stop);
    expect(transport.snapshot().state).toBe("stopped");
    transport.apply(cont);
    expect(transport.snapshot().state).toBe("playing");
  });

  it("is not moved by clock alone", () => {
    const transport = createTransport();
    tick(transport, 120, 30);
    expect(transport.snapshot().state).toBe("unknown");
  });
});

describe("tempo from clock", () => {
  it("is unknown until a beat of clock has arrived", () => {
    const transport = createTransport();
    transport.apply(start);
    tick(transport, 120, CLOCKS_PER_BEAT); // 24 ticks are 23 gaps: not a full beat yet
    expect(transport.snapshot().bpm).toBeNull();
  });

  it("is read from the gaps between ticks, at 24 ticks per beat", () => {
    for (const bpm of [60, 93, 120, 174]) {
      const transport = createTransport();
      transport.apply(start);
      tick(transport, bpm, 60);
      expect(transport.snapshot().bpm).toBeCloseTo(bpm, 1);
    }
  });

  it("follows a tempo change within a couple of beats", () => {
    const transport = createTransport();
    transport.apply(start);
    const later = tick(transport, 100, 60);
    tick(transport, 140, 120, later);
    expect(transport.snapshot().bpm).toBeCloseTo(140, 0);
  });

  it("rounds to a tenth of a beat per minute", () => {
    const transport = createTransport();
    transport.apply(start);
    tick(transport, 93, 60);
    expect(transport.snapshot().bpm).toBe(93);
  });

  it("starts over on Start, so a new tempo is not blended with the old one", () => {
    const transport = createTransport();
    transport.apply(start);
    tick(transport, 100, 60);
    transport.apply(stop);
    transport.apply(start);
    expect(transport.snapshot().bpm).toBeNull();
    tick(transport, 140, 60, 10_000);
    expect(transport.snapshot().bpm).toBeCloseTo(140, 1);
  });

  it("keeps the last tempo while stopped", () => {
    const transport = createTransport();
    transport.apply(start);
    tick(transport, 93, 60);
    transport.apply(stop);
    expect(transport.snapshot()).toEqual({ state: "stopped", bpm: 93 });
  });

  it("does not blend the gap across a stop and a continue", () => {
    const transport = createTransport();
    transport.apply(start);
    const end = tick(transport, 120, 60);
    transport.apply(stop);
    transport.apply(cont);
    tick(transport, 120, 60, end + 5000); // five seconds later
    expect(transport.snapshot().bpm).toBeCloseTo(120, 1);
  });
});

describe("reset", () => {
  it("forgets everything, as when the device is unplugged mid-play", () => {
    const transport = createTransport();
    transport.apply(start);
    tick(transport, 120, 60);
    transport.reset();
    expect(transport.snapshot()).toEqual({ state: "unknown", bpm: null });
  });
});
