import { describe, expect, it } from "vitest";
import { MAX_BARS, MAX_SEQUENCES, PAD_COUNT, STEPS } from "./layout.js";
import { BEAT_VERSION, parseBeat, serializeBeat } from "./beat.js";
import { SOFT_VELOCITY, STARTERS, sequenceBars, starterBeat } from "./starters.js";
import { SWING_DEFAULT, SWING_MAX, SWING_MIN, clampBpm } from "../../shared/tempo.js";

const limits = { rows: PAD_COUNT, steps: STEPS, maxBars: MAX_BARS, maxSequences: MAX_SEQUENCES };
const beat = (starter, volume = 80) => starterBeat(starter, { ...limits, volume });

describe("sequenceBars", () => {
  it("counts bars of 16 steps, ignoring the spaces that group them", () => {
    expect(sequenceBars({ 0: "X...X...X...X..." })).toBe(1);
    expect(sequenceBars({ 0: "X...X...X...X... X...X...X...X..." })).toBe(2);
  });

  it("is 0 when the rows differ in length or are not whole bars", () => {
    expect(sequenceBars({ 0: "X...X...X...X...", 1: "X..." })).toBe(0);
    expect(sequenceBars({ 0: "X...X..." })).toBe(0);
    expect(sequenceBars({})).toBe(0);
  });
});

describe("STARTERS", () => {
  it("have distinct ids and names, and a description each", () => {
    expect(new Set(STARTERS.map((s) => s.id)).size).toBe(STARTERS.length);
    expect(new Set(STARTERS.map((s) => s.name)).size).toBe(STARTERS.length);
    for (const starter of STARTERS) expect(starter.description.length).toBeGreaterThan(10);
  });

  it.each(STARTERS.map((s) => [s.name, s]))("%s fits the sampler and reads back as written", (_name, starter) => {
    const result = beat(starter);
    expect(result).not.toBeNull();
    expect(result.version).toBe(BEAT_VERSION);
    expect(result.bpm).toBe(starter.bpm);
    // Already inside the tempo range: nothing was clamped.
    expect(clampBpm(starter.bpm)).toBe(starter.bpm);
    expect(result.sequences).toHaveLength(starter.sequences.length); // a starter has the sequences it wrote, no more
    expect(result.current).toBe(0);
    // Saving it and reading it again changes nothing, so the page that loads it sees exactly this.
    expect(serializeBeat(parseBeat(result, limits))).toEqual(result);
  });

  it.each(STARTERS.map((s) => [s.name, s]))("%s keeps every step it wrote", (_name, starter) => {
    const result = beat(starter);
    starter.sequences.forEach(({ pads }, index) => {
      const written = Object.entries(pads).flatMap(([row, grid]) =>
        [...grid.replaceAll(" ", "")].flatMap((cell, step) => (cell === "." ? [] : [`${row}:${step}`])),
      );
      const kept = Object.entries(result.sequences[index].pattern).flatMap(([row, steps]) =>
        steps.map((step) => `${row}:${step}`),
      );
      expect(kept.sort()).toEqual(written.sort());
      expect(result.sequences[index].bars).toBe(sequenceBars(pads));
    });
  });

  it.each(STARTERS.map((s) => [s.name, s]))("%s only names pads that exist", (_name, starter) => {
    for (const { pads } of starter.sequences)
      for (const row of Object.keys(pads)) expect(Number(row)).toBeLessThan(PAD_COUNT);
    for (const pad of Object.keys(starter.padSettings)) expect(Number(pad)).toBeLessThan(PAD_COUNT);
  });

  it.each(STARTERS.map((s) => [s.name, s]))("%s writes only X, o, . and spaces in its grids", (_name, starter) => {
    for (const { pads } of starter.sequences) for (const grid of Object.values(pads)) expect(grid).toMatch(/^[Xo. ]+$/);
  });

  // Pads in one choke group that start on the same step cut each other, and only the higher pad is heard (voices.js):
  // a hit written there would be silent.
  it.each(STARTERS.map((s) => [s.name, s]))(
    "%s has no hit that a pad of its choke group would cut off",
    (_name, starter) => {
      for (const { pads } of starter.sequences) {
        const seen = new Map(); // "group:step" -> pad
        for (const [row, grid] of Object.entries(pads)) {
          const group = starter.padSettings[row]?.choke ?? 0;
          if (!group) continue;
          [...grid.replaceAll(" ", "")].forEach((cell, step) => {
            if (cell === ".") return;
            const key = `${group}:${step}`;
            expect(seen.has(key), `pads ${seen.get(key)} and ${row} both hit step ${step}`).toBe(false);
            seen.set(key, row);
          });
        }
      }
    },
  );

  it("keep the pad settings they name", () => {
    const hipHop = beat(STARTERS.find((s) => s.id === "hip-hop"));
    // Open and closed hat are in one choke group, so the next closed hat cuts an open one.
    expect(hipHop.padSettings[2].choke).toBe(1);
    expect(hipHop.padSettings[3].choke).toBe(1);
  });

  it("writes a soft hit as a velocity, and a full hit as none", () => {
    const hipHop = beat(STARTERS.find((s) => s.id === "hip-hop"));
    // Closed hat, second step: the "o" after the first "X".
    expect(hipHop.sequences[0].velocities[2][1]).toBe(SOFT_VELOCITY);
    expect(hipHop.sequences[0].velocities[2][0]).toBeUndefined();
  });

  it("keeps the settings of a pad that holds a sample, with the starter's choke and colour over them", () => {
    const hipHop = STARTERS.find((s) => s.id === "hip-hop");
    const keep = { 0: { gain: -12, pitch: 3, color: 5 }, 9: { gain: 4, pitch: -2 } };
    const kept = starterBeat(hipHop, { ...limits, volume: 80, keep });
    // Pad 0 (kick): the person's gain and pitch stay; the starter's colour is put over theirs.
    expect(kept.padSettings[0]).toMatchObject({ gain: -12, pitch: 3, color: 1 });
    // Pad 9: the starter has nothing for it, so it is exactly what the person had.
    expect(kept.padSettings[9]).toMatchObject({ gain: 4, pitch: -2 });
    // And without `keep` a pad is as the starter says, or at its defaults.
    expect(beat(hipHop).padSettings[9]).toBeUndefined();
  });

  it("carry a swing inside the range, and a starter without one is straight", () => {
    for (const starter of STARTERS) {
      const swing = beat(starter).swing;
      expect(swing).toBeGreaterThanOrEqual(SWING_MIN);
      expect(swing).toBeLessThanOrEqual(SWING_MAX);
      expect(swing).toBe(starter.swing ?? SWING_DEFAULT);
    }
    // Each style's own: hip hop lazy, house light, techno and trap on the straight grid.
    const swingOf = (id) => beat(STARTERS.find((s) => s.id === id)).swing;
    expect(swingOf("hip-hop")).toBe(58);
    expect(swingOf("house")).toBe(54);
    expect(swingOf("techno")).toBe(SWING_DEFAULT);
    expect(swingOf("trap")).toBe(SWING_DEFAULT);
  });

  it("brings an out-of-range swing inside it, and ignores one that is not a number", () => {
    const base = { id: "x", name: "X", description: "a test starter", bpm: 100, padSettings: {}, sequences: [] };
    expect(beat({ ...base, swing: 99 }).swing).toBe(SWING_MAX);
    expect(beat({ ...base, swing: "58" }).swing).toBe(SWING_DEFAULT);
  });

  it("leaves the master volume as the person has it", () => {
    expect(beat(STARTERS[0], 35).volume).toBe(35);
    expect(beat(STARTERS[0], 90).volume).toBe(90);
  });
});

describe("starterBeat", () => {
  const starter = { id: "x", name: "X", description: "a test starter", bpm: 100, sequences: [], padSettings: {} };

  it("is null when a sequence is longer than the sampler allows", () => {
    const long = { pads: { 0: "X...X...X...X...".repeat(MAX_BARS + 1) } };
    expect(beat({ ...starter, sequences: [long] })).toBeNull();
  });

  it("is null when a sequence is not a whole number of bars", () => {
    expect(beat({ ...starter, sequences: [{ pads: { 0: "X...X..." } }] })).toBeNull();
  });

  it("has just the sequences it wrote: a starter of one sequence is a beat of one", () => {
    const result = beat({ ...starter, sequences: [{ pads: { 0: "X...X...X...X..." } }] });
    expect(result.sequences).toHaveLength(1);
    expect(result.current).toBe(0);
  });
});
