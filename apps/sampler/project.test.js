import { describe, expect, it, vi } from "vitest";
import {
  MAX_PROJECT_BYTES,
  PROJECT_FILE,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  REASONS,
  buildProject,
  collectSamples,
  installProject,
  parseProject,
  projectFileName,
  projectBlob,
} from "./project.js";
import { SAMPLES_VERSION, sampleKey } from "./samples.js";
import { SONG_VERSION, parseSong } from "./song.js";
import { readZip, zipParts } from "./zip.js";

const LAYOUT = { rows: 16, steps: 16, maxBars: 8, sequenceCount: 8 };
const song = {
  bpm: 96,
  volume: 70,
  current: 1,
  sequences: [
    { bars: 2, pattern: { 0: [0, 4, 20] }, velocities: { 0: { 4: 60 } } },
    { bars: 1, pattern: { 3: [2] }, velocities: {} },
  ],
  padSettings: { 2: { gain: -3 } },
};
const audio = (length, fill) => new Uint8Array(length).fill(fill);
const samples = [
  { pad: 0, name: "Kick", trim: { start: 0.1, end: 0.9 }, bytes: audio(40, 1) },
  { pad: 5, name: "Hat", trim: { start: 0, end: 1 }, bytes: audio(10, 2) },
];

const join = (parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
};
const archive = (files) => join(zipParts(files));
const json = (value) => new TextEncoder().encode(JSON.stringify(value));
// A project's files with the manifest changed by `edit`, for the files that are damaged in one place only.
function edited(edit, project = { song, samples }) {
  const files = buildProject(project);
  const manifest = JSON.parse(new TextDecoder().decode(files[0].data));
  edit(manifest, files);
  files[0] = { name: PROJECT_FILE, data: json(manifest) };
  return archive(files);
}

describe("buildProject", () => {
  it("writes a manifest and one file for each sample", () => {
    const files = buildProject({ song, samples, savedAt: new Date(Date.UTC(2026, 10, 9)) });
    expect(files.map((file) => file.name)).toEqual([PROJECT_FILE, "samples/pad-01.bin", "samples/pad-06.bin"]);
    const manifest = JSON.parse(new TextDecoder().decode(files[0].data));
    expect(manifest).toMatchObject({
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      savedAt: "2026-11-09T00:00:00.000Z",
    });
    expect(manifest.song.version).toBe(SONG_VERSION);
    // The trim is only there for a sample that is trimmed, as in the page's own map.
    expect(manifest.samples).toEqual({
      0: { name: "Kick", bytes: 40, trim: { start: 0.1, end: 0.9 } },
      5: { name: "Hat", bytes: 10 },
    });
  });

  it("makes a project with no samples", () => {
    expect(buildProject({ song, samples: [] })).toHaveLength(1);
  });
});

describe("parseProject", () => {
  it("gives back what was built: the song, and each sample's name, trim and bytes", () => {
    const result = parseProject(archive(buildProject({ song, samples })), LAYOUT);
    expect(result.ok).toBe(true);
    expect(parseSong(result.song, LAYOUT)).toEqual(parseSong({ ...song, version: SONG_VERSION }, LAYOUT));
    expect(result.song.version).toBe(SONG_VERSION);
    expect(result.samples.map(({ pad, name, trim }) => ({ pad, name, trim }))).toEqual([
      { pad: 0, name: "Kick", trim: { start: 0.1, end: 0.9 } },
      { pad: 5, name: "Hat", trim: undefined },
    ]);
    expect(result.samples[0].bytes).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(result.samples[0].bytes)]).toEqual([...audio(40, 1)]);
  });

  it("reads the Blob projectBlob makes, as bytes", async () => {
    const blob = projectBlob({ song, samples });
    expect(blob.type).toBe("application/octet-stream");
    expect(parseProject(new Uint8Array(await blob.arrayBuffer()), LAYOUT).ok).toBe(true);
  });

  it("writes the song again, so what the page does not know is not kept", () => {
    const bytes = edited((manifest) => {
      manifest.song.surprise = "x";
      manifest.song.bpm = 9999; // out of range is brought back into it, as a saved song is
    });
    const result = parseProject(bytes, LAYOUT);
    expect(result.song.surprise).toBeUndefined();
    expect(result.song.bpm).toBeLessThan(9999);
  });

  it("refuses what is not a zip, or a zip that is not a project", () => {
    expect(parseProject(new TextEncoder().encode("hello, this is not a project"), LAYOUT)).toMatchObject({
      ok: false,
      reason: REASONS.notProject,
    });
    expect(parseProject(archive([{ name: "a.txt", data: json({}) }]), LAYOUT)).toMatchObject({
      ok: false,
      reason: REASONS.notProject,
    });
    expect(
      parseProject(
        edited((manifest) => (manifest.format = "something else")),
        LAYOUT,
      ).reason,
    ).toBe(REASONS.notProject);
  });

  it("refuses a project from a newer page, and one with no usable version", () => {
    expect(
      parseProject(
        edited((m) => (m.version = PROJECT_VERSION + 1)),
        LAYOUT,
      ).reason,
    ).toBe(REASONS.newer);
    expect(
      parseProject(
        edited((m) => (m.version = "1")),
        LAYOUT,
      ).reason,
    ).toBe(REASONS.damaged);
    expect(
      parseProject(
        edited((m) => (m.version = 0)),
        LAYOUT,
      ).reason,
    ).toBe(REASONS.damaged);
  });

  it("refuses a manifest that is not JSON", () => {
    const files = buildProject({ song, samples });
    files[0] = { name: PROJECT_FILE, data: new TextEncoder().encode("{not json") };
    expect(parseProject(archive(files), LAYOUT).reason).toBe(REASONS.damaged);
  });

  it("refuses a song the page cannot read, such as one from a newer page", () => {
    expect(
      parseProject(
        edited((m) => (m.song.version = SONG_VERSION + 1)),
        LAYOUT,
      ).reason,
    ).toBe(REASONS.damaged);
    expect(
      parseProject(
        edited((m) => delete m.song),
        LAYOUT,
      ).reason,
    ).toBe(REASONS.damaged);
  });

  it("refuses the whole project when a sample's file is missing or the wrong size", () => {
    expect(
      parseProject(
        edited((_m, files) => files.splice(1, 1)),
        LAYOUT,
      ).reason,
    ).toBe(REASONS.damaged);
    expect(
      parseProject(
        edited((m) => (m.samples[0].bytes = 41)),
        LAYOUT,
      ).reason,
    ).toBe(REASONS.damaged);
  });

  it("refuses a sample entry the page could not use instead of dropping it", () => {
    expect(
      parseProject(
        edited((m) => (m.samples[99] = { name: "x", bytes: 1 })),
        LAYOUT,
      ).reason,
    ).toBe(REASONS.damaged);
    expect(
      parseProject(
        edited((m) => (m.samples[0].name = 7)),
        LAYOUT,
      ).reason,
    ).toBe(REASONS.damaged);
    expect(
      parseProject(
        edited((m) => (m.samples = [])),
        LAYOUT,
      ).reason,
    ).toBe(REASONS.damaged);
  });

  it("does not read a file named by the manifest: a sample is found by its pad", () => {
    const files = buildProject({ song, samples });
    files[1] = { name: "../../evil", data: files[1].data };
    expect(parseProject(archive(files), LAYOUT).reason).toBe(REASONS.damaged);
  });

  it("refuses a project that holds more audio than the page keeps, and a file that is too large to read", () => {
    const big = Array.from({ length: 8 }, (_, pad) => ({
      pad,
      name: `S${pad}`,
      trim: null,
      bytes: audio(5 * 1024 * 1024, 1),
    }));
    expect(parseProject(archive(buildProject({ song, samples: big })), LAYOUT).reason).toBe(REASONS.tooBig);
    expect(parseProject({ byteLength: MAX_PROJECT_BYTES + 1 }, LAYOUT).reason).toBe(REASONS.tooBig);
  });

  it("opens a project with no samples", () => {
    const result = parseProject(archive(buildProject({ song, samples: [] })), LAYOUT);
    expect(result).toMatchObject({ ok: true, samples: [] });
  });

  it("keeps a zip's own files out of the way: a damaged archive is not a project", () => {
    const whole = archive(buildProject({ song, samples }));
    whole[60] ^= 0xff;
    expect(parseProject(whole, LAYOUT).ok).toBe(false);
    expect(readZip(archive(buildProject({ song, samples }))).length).toBe(3);
  });
});

describe("installProject", () => {
  function fakeStore({ failSet = null } = {}) {
    const data = new Map([
      [sampleKey(0), new ArrayBuffer(1)],
      [sampleKey(3), new ArrayBuffer(1)], // an old sample on a pad the project has none for
    ]);
    return {
      data,
      set: vi.fn(async (key, bytes) => {
        if (key === failSet) return false;
        data.set(key, bytes);
        return true;
      }),
      delete: vi.fn(async (key) => data.delete(key) || true),
    };
  }
  const project = () => parseProject(archive(buildProject({ song, samples })), LAYOUT);

  it("keeps each pad's bytes, replaces the map and the song, and takes off what the project does not have", async () => {
    const store = fakeStore();
    const writeMap = vi.fn(() => true);
    const writeSong = vi.fn(() => true);
    const parsed = project();
    expect(await installProject(parsed, { store, writeMap, writeSong, padCount: 16 })).toBe(true);
    expect([...store.data.keys()].sort()).toEqual([sampleKey(0), sampleKey(5)].sort());
    expect(store.data.get(sampleKey(0)).byteLength).toBe(40);
    expect(writeMap).toHaveBeenCalledWith({
      version: SAMPLES_VERSION,
      pads: { 0: { name: "Kick", bytes: 40, trim: { start: 0.1, end: 0.9 } }, 5: { name: "Hat", bytes: 10 } },
    });
    expect(writeSong).toHaveBeenCalledWith(parsed.song);
  });

  it("leaves the song alone when the bytes cannot be kept, and says so", async () => {
    const writeMap = vi.fn(() => true);
    const writeSong = vi.fn(() => true);
    const store = fakeStore({ failSet: sampleKey(5) });
    expect(await installProject(project(), { store, writeMap, writeSong, padCount: 16 })).toBe(false);
    expect(writeMap).not.toHaveBeenCalled();
    expect(writeSong).not.toHaveBeenCalled();
  });

  it("says so when the map or the song cannot be written", async () => {
    const ok = () => true;
    const fail = () => false;
    expect(await installProject(project(), { store: fakeStore(), writeMap: fail, writeSong: ok, padCount: 16 })).toBe(
      false,
    );
    expect(await installProject(project(), { store: fakeStore(), writeMap: ok, writeSong: fail, padCount: 16 })).toBe(
      false,
    );
  });
});

describe("collectSamples", () => {
  const map = {
    version: SAMPLES_VERSION,
    pads: { 0: { name: "Kick", bytes: 4 }, 2: { name: "Snare", bytes: 3, trim: { start: 0.2, end: 0.8 } } },
  };
  const store = (files) => ({ get: vi.fn(async (key) => files[key] ?? null) });

  it("reads each pad in the map from the store", async () => {
    const result = await collectSamples({
      map,
      store: store({ [sampleKey(0)]: new ArrayBuffer(4), [sampleKey(2)]: new ArrayBuffer(3) }),
      padCount: 16,
    });
    expect(result.missing).toEqual([]);
    expect(result.samples.map(({ pad, name, trim }) => ({ pad, name, trim }))).toEqual([
      { pad: 0, name: "Kick", trim: undefined },
      { pad: 2, name: "Snare", trim: { start: 0.2, end: 0.8 } },
    ]);
  });

  it("lists a pad whose bytes are gone, or are not the size the map says, as missing", async () => {
    const result = await collectSamples({ map, store: store({ [sampleKey(2)]: new ArrayBuffer(99) }), padCount: 16 });
    expect(result.samples).toEqual([]);
    expect(result.missing).toEqual([0, 2]);
  });

  it("finds nothing in a map that was never saved or cannot be read", async () => {
    for (const bad of [null, "x", { version: 99, pads: {} }]) {
      expect(await collectSamples({ map: bad, store: store({}), padCount: 16 })).toEqual({ samples: [], missing: [] });
    }
  });
});

describe("projectFileName", () => {
  it("is the local date, padded, with the project extension", () => {
    expect(projectFileName(new Date(2026, 0, 5))).toBe("pad16-beat-2026-01-05.audiolab");
    expect(projectFileName(new Date(2026, 10, 19))).toBe("pad16-beat-2026-11-19.audiolab");
  });
});
