import { describe, expect, it } from "vitest";
import { MAX_BARS, PAD_COUNT, SEQUENCE_COUNT, STEPS } from "./layout.js";
import { SONG_VERSION, parseSong, serializeSong } from "./song.js";
import { SOFT_VELOCITY, STARTERS, sequenceBars, starterSong } from "./starters.js";
import { clampBpm } from "../../shared/tempo.js";

const limits = { rows: PAD_COUNT, steps: STEPS, maxBars: MAX_BARS, sequenceCount: SEQUENCE_COUNT };
const song = (starter, volume = 80) => starterSong(starter, { ...limits, volume });

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
    const result = song(starter);
    expect(result).not.toBeNull();
    expect(result.version).toBe(SONG_VERSION);
    expect(result.bpm).toBe(starter.bpm);
    // Already inside the tempo range: nothing was clamped.
    expect(clampBpm(starter.bpm)).toBe(starter.bpm);
    expect(result.sequences).toHaveLength(SEQUENCE_COUNT);
    expect(result.current).toBe(0);
    // Saving it and reading it again changes nothing, so the page that loads it sees exactly this.
    expect(serializeSong(parseSong(result, limits))).toEqual(result);
  });

  it.each(STARTERS.map((s) => [s.name, s]))("%s keeps every step it wrote", (_name, starter) => {
    const result = song(starter);
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
    const hipHop = song(STARTERS.find((s) => s.id === "hip-hop"));
    // Open and closed hat are in one choke group, so the next closed hat cuts an open one.
    expect(hipHop.padSettings[2].choke).toBe(1);
    expect(hipHop.padSettings[3].choke).toBe(1);
  });

  it("writes a soft hit as a velocity, and a full hit as none", () => {
    const hipHop = song(STARTERS.find((s) => s.id === "hip-hop"));
    // Closed hat, second step: the "o" after the first "X".
    expect(hipHop.sequences[0].velocities[2][1]).toBe(SOFT_VELOCITY);
    expect(hipHop.sequences[0].velocities[2][0]).toBeUndefined();
  });

  it("keeps the settings of a pad that holds a sample, with the starter's choke and colour over them", () => {
    const hipHop = STARTERS.find((s) => s.id === "hip-hop");
    const keep = { 0: { gain: -12, pitch: 3, color: 5 }, 9: { gain: 4, pitch: -2 } };
    const kept = starterSong(hipHop, { ...limits, volume: 80, keep });
    // Pad 0 (kick): the person's gain and pitch stay; the starter's colour is put over theirs.
    expect(kept.padSettings[0]).toMatchObject({ gain: -12, pitch: 3, color: 1 });
    // Pad 9: the starter has nothing for it, so it is exactly what the person had.
    expect(kept.padSettings[9]).toMatchObject({ gain: 4, pitch: -2 });
    // And without `keep` a pad is as the starter says, or at its defaults.
    expect(song(hipHop).padSettings[9]).toBeUndefined();
  });

  it("leaves the master volume as the person has it", () => {
    expect(song(STARTERS[0], 35).volume).toBe(35);
    expect(song(STARTERS[0], 90).volume).toBe(90);
  });
});

describe("starterSong", () => {
  const starter = { id: "x", name: "X", description: "a test starter", bpm: 100, sequences: [], padSettings: {} };

  it("is null when a sequence is longer than the sampler allows", () => {
    const long = { pads: { 0: "X...X...X...X...".repeat(MAX_BARS + 1) } };
    expect(song({ ...starter, sequences: [long] })).toBeNull();
  });

  it("is null when a sequence is not a whole number of bars", () => {
    expect(song({ ...starter, sequences: [{ pads: { 0: "X...X..." } }] })).toBeNull();
  });

  it("leaves the sequences it does not have empty, one bar each", () => {
    const result = song({ ...starter, sequences: [{ pads: { 0: "X...X...X...X..." } }] });
    expect(result.sequences[1]).toEqual({ bars: 1, pattern: {}, velocities: {} });
  });
});
