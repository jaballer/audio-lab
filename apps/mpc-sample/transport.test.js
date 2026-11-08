import { describe, expect, it } from "vitest";
import { BEATS_PER_BAR, CLOCKS_PER_BEAT, STALE_MS, createTransport, toggleAction } from "./transport.js";

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
    expect(createTransport().snapshot()).toEqual({ state: "unknown", bpm: null, position: null });
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

  // Captured: the device sends clock only while playing, so clock from a device the page has
  // not heard Start from (it was already playing when the page connected) means it is playing.
  it("takes clock from a device it knows nothing about as playing", () => {
    const transport = createTransport();
    tick(transport, 120, 60);
    expect(transport.snapshot()).toMatchObject({ state: "playing", bpm: 120, position: null });
  });

  it("does not take stray clock after a Stop as playing again", () => {
    const transport = createTransport();
    transport.apply(start);
    transport.apply(stop);
    tick(transport, 120, 30);
    expect(transport.snapshot().state).toBe("stopped");
  });
});

// The clock ends when the device stops, so a clock that goes quiet while playing means it
// stopped without saying so (switched off, or a Stop that was lost).
describe("a clock that goes quiet", () => {
  it("stops after a second without a tick", () => {
    const transport = createTransport();
    transport.apply(start);
    const last = tick(transport, 120, 60);
    expect(transport.expire(last + STALE_MS / 2)).toBe(false);
    expect(transport.snapshot().state).toBe("playing");
    expect(transport.expire(last + STALE_MS + 1)).toBe(true);
    expect(transport.snapshot()).toMatchObject({ state: "stopped", bpm: 120 });
  });

  it("says so once, not on every check", () => {
    const transport = createTransport();
    transport.apply(start);
    const last = tick(transport, 120, 60);
    expect(transport.expire(last + 5000)).toBe(true);
    expect(transport.expire(last + 6000)).toBe(false);
  });

  it("does not stop a device that plays without sending clock", () => {
    const transport = createTransport();
    transport.apply(start);
    expect(transport.expire(60_000)).toBe(false);
    expect(transport.snapshot().state).toBe("playing");
  });

  it("does nothing while stopped or unknown", () => {
    const transport = createTransport();
    expect(transport.expire(60_000)).toBe(false);
    transport.apply(stop);
    expect(transport.expire(60_000)).toBe(false);
  });
});

describe("bar and beat", () => {
  it("starts at bar 1 beat 1 on Start", () => {
    const transport = createTransport();
    transport.apply(start);
    expect(transport.snapshot().position).toEqual({ bar: 1, beat: 1 });
  });

  // The first tick follows Start at once and marks the start, so it does not move the position.
  it("counts a beat every 24 ticks, starting from the first tick", () => {
    const transport = createTransport();
    transport.apply(start);
    tick(transport, 120, 1);
    expect(transport.snapshot().position).toEqual({ bar: 1, beat: 1 });
    tick(transport, 120, CLOCKS_PER_BEAT - 1, 20);
    expect(transport.snapshot().position).toEqual({ bar: 1, beat: 1 }); // 24 ticks: 23 elapsed
    tick(transport, 120, 1, 500);
    expect(transport.snapshot().position).toEqual({ bar: 1, beat: 2 }); // 25 ticks: 24 elapsed
  });

  it("counts a bar every four beats, assuming 4/4", () => {
    const transport = createTransport();
    transport.apply(start);
    tick(transport, 120, 1 + BEATS_PER_BAR * CLOCKS_PER_BEAT);
    expect(transport.snapshot().position).toEqual({ bar: 2, beat: 1 });
    tick(transport, 120, 2 * CLOCKS_PER_BEAT, 10_000);
    expect(transport.snapshot().position).toEqual({ bar: 2, beat: 3 });
  });

  it("keeps the place through a Stop and carries on after a Continue", () => {
    const transport = createTransport();
    transport.apply(start);
    tick(transport, 120, 1 + 2 * CLOCKS_PER_BEAT);
    transport.apply(stop);
    expect(transport.snapshot().position).toEqual({ bar: 1, beat: 3 });
    transport.apply(cont);
    // As after a Start, the first tick marks where it resumes and does not move the song.
    tick(transport, 120, 1, 10_000);
    expect(transport.snapshot().position).toEqual({ bar: 1, beat: 3 });
    tick(transport, 120, CLOCKS_PER_BEAT, 10_100);
    expect(transport.snapshot().position).toEqual({ bar: 1, beat: 4 });
  });

  it("goes back to the start on the next Start", () => {
    const transport = createTransport();
    transport.apply(start);
    tick(transport, 120, 200);
    transport.apply(stop);
    transport.apply(start);
    expect(transport.snapshot().position).toEqual({ bar: 1, beat: 1 });
  });

  it("is not known when the page joined a device that was already playing", () => {
    const transport = createTransport();
    tick(transport, 120, 200);
    expect(transport.snapshot().position).toBeNull();
  });
});

// Captured: Play sends Start and position 0; Shift + Play sends Continue and the position it
// resumes from (10 sixteenths). The device's position beats counting ticks from a guess.
describe("song position", () => {
  const SIXTEENTHS_PER_BEAT = 4;
  const at = (position) => ({ type: "songPosition", position });

  it("puts a Continue where the device says it resumes", () => {
    const transport = createTransport();
    transport.apply(cont);
    transport.apply(at(10)); // 2.5 beats in
    tick(transport, 120, 1);
    expect(transport.snapshot().position).toEqual({ bar: 1, beat: 3 });
    transport.apply(at(4 * SIXTEENTHS_PER_BEAT)); // one bar in
    tick(transport, 120, 1, 1000);
    expect(transport.snapshot().position).toEqual({ bar: 2, beat: 1 });
  });

  it("counts on from that place", () => {
    const transport = createTransport();
    transport.apply(cont);
    transport.apply(at(4 * SIXTEENTHS_PER_BEAT));
    tick(transport, 120, 1 + 2 * CLOCKS_PER_BEAT);
    expect(transport.snapshot().position).toEqual({ bar: 2, beat: 3 });
  });

  it("moves a Continue that was not at the place the page counted", () => {
    const transport = createTransport();
    transport.apply(start);
    tick(transport, 120, 1 + 3 * CLOCKS_PER_BEAT);
    transport.apply(stop);
    transport.apply(cont);
    transport.apply(at(0)); // the device went back to the top before resuming
    tick(transport, 120, 1, 20_000);
    expect(transport.snapshot().position).toEqual({ bar: 1, beat: 1 });
  });

  it("agrees with the 0 that follows a Start", () => {
    const transport = createTransport();
    transport.apply(start);
    transport.apply(at(0));
    tick(transport, 120, 1 + CLOCKS_PER_BEAT);
    expect(transport.snapshot().position).toEqual({ bar: 1, beat: 2 });
  });

  it("makes the place known even for a device the page joined mid-play", () => {
    const transport = createTransport();
    expect(transport.snapshot().position).toBeNull();
    transport.apply(at(8));
    expect(transport.snapshot().position).toEqual({ bar: 1, beat: 3 });
  });
});

describe("toggleAction", () => {
  it("stops a device that is playing and plays one that is not", () => {
    expect(toggleAction("playing")).toBe("stop");
    expect(toggleAction("stopped")).toBe("play");
    expect(toggleAction("unknown")).toBe("play");
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
    expect(transport.snapshot()).toMatchObject({ state: "stopped", bpm: 93 });
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

// Seen on the device: at 98 then 120 BPM the tenths digit jumped around. Ticks reach the page on a
// clock only about a millisecond precise, so each tick's time is a little off and the estimate
// wobbles with it. This feeds ticks that are up to a millisecond early or late, in a fixed pattern.
describe("a steady tempo", () => {
  const JITTER_MS = 1;

  // A seeded generator, so the "random" jitter is the same on every run.
  function jitterSource(seed) {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 2 ** 32;
      return (state / 2 ** 32) * 2 * JITTER_MS - JITTER_MS; // -1 to +1 ms
    };
  }
  const jitter = jitterSource(42);

  // Feeds `count` jittery ticks and returns the tempo shown after each one.
  function readings(transport, bpm, count, from = 0) {
    const interval = 60000 / bpm / CLOCKS_PER_BEAT;
    const shown = [];
    for (let i = 0; i < count; i++) {
      transport.apply({ type: "clock", time: from + i * interval + jitter() });
      shown.push(transport.snapshot().bpm);
    }
    return shown;
  }

  it("does not flicker between values once it has settled", () => {
    const transport = createTransport();
    transport.apply(start);
    const settled = readings(transport, 98, 600)
      .slice(150)
      .filter((bpm) => bpm !== null);
    expect(new Set(settled).size).toBeLessThanOrEqual(2);
    for (const bpm of settled) expect(Math.abs(bpm - 98)).toBeLessThan(0.3);
  });

  it("follows a real change of tempo within about a beat", () => {
    const transport = createTransport();
    transport.apply(start);
    const end = 600 * (60000 / 98 / CLOCKS_PER_BEAT);
    readings(transport, 98, 600);
    readings(transport, 120, CLOCKS_PER_BEAT + 6, end);
    expect(Math.abs(transport.snapshot().bpm - 120)).toBeLessThan(1);
  });
});

describe("reset", () => {
  it("forgets everything, as when the device is unplugged mid-play", () => {
    const transport = createTransport();
    transport.apply(start);
    tick(transport, 120, 60);
    transport.reset();
    expect(transport.snapshot()).toEqual({ state: "unknown", bpm: null, position: null });
  });
});
