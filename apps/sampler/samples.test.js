import { describe, expect, it, vi } from "vitest";
import { createKit } from "./kit.js";
import { MAX_TOTAL_BYTES, MEMORY_FULL, SAMPLES_VERSION, createSamples, parseSamples } from "./samples.js";
import { REASONS } from "./sample-voice.js";

const sound = (id) => ({ id, name: id, play: vi.fn() });
const defaults = [sound("kick"), sound("snare"), sound("hat")];
const file = (name, size = 100) => ({ name, size, arrayBuffer: vi.fn(async () => new ArrayBuffer(size)) });
const decoded = (id = "buffer") => ({ ok: true, buffer: { id } });

// A store that keeps what it is given; `failWrites` makes writes fail, as a full disk does.
function fakeStore({ failWrites = false, initial = {} } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: vi.fn(async (key) => data.get(key) ?? null),
    set: vi.fn(async (key, bytes) => {
      if (failWrites) return false;
      data.set(key, bytes);
      return true;
    }),
    delete: vi.fn(async (key) => data.delete(key) || true),
  };
}

function setup({ stored = null, store = fakeStore(), decode = vi.fn(async () => decoded()), ...options } = {}) {
  const kit = createKit(defaults);
  const audio = { ensure: vi.fn(() => ({ name: "ctx" })) };
  const writes = [];
  const messages = [];
  const samples = createSamples({
    kit,
    audio,
    store,
    decode,
    readMap: () => stored,
    writeMap: (map) => writes.push(structuredClone(map)),
    onMessage: (text) => messages.push(text),
    ...options,
  });
  return { kit, audio, store, decode, samples, writes, messages };
}

describe("parseSamples", () => {
  it("keeps the pads that exist, with a name and a size", () => {
    const stored = {
      version: SAMPLES_VERSION,
      pads: {
        0: { name: "a", bytes: 5 },
        2: { name: "b", bytes: 0 },
        3: { name: "c", bytes: 5 },
        x: { name: "d", bytes: 5 },
      },
    };
    expect(parseSamples(stored, 3)).toEqual({ 0: { name: "a", bytes: 5 }, 2: { name: "b", bytes: 0 } });
  });

  it("drops entries that are the wrong shape", () => {
    const stored = {
      version: SAMPLES_VERSION,
      pads: { 0: { name: 5, bytes: 5 }, 1: { name: "a" }, 2: "a", "-1": { name: "a", bytes: 1 } },
    };
    expect(parseSamples(stored, 3)).toEqual({});
  });

  it("gives nothing for what is not a samples map, or from another version", () => {
    for (const stored of [
      null,
      "x",
      [],
      {},
      { version: 99, pads: { 0: { name: "a", bytes: 1 } } },
      { version: 1, pads: [] },
    ]) {
      expect(parseSamples(stored, 3)).toEqual({});
    }
  });
});

describe("load", () => {
  it("puts the sample on the pad and keeps it", async () => {
    const { kit, samples, store, writes, messages } = setup();
    expect(await samples.load(1, file("My Snare.wav", 50))).toBe(true);
    expect(kit.get(1)).toMatchObject({ id: "sample-1", name: "My Snare" });
    expect(kit.get(0)).toBe(defaults[0]);
    expect(store.data.get("sample-1")).toHaveProperty("byteLength", 50);
    expect(writes.at(-1)).toEqual({ version: SAMPLES_VERSION, pads: { 1: { name: "My Snare", bytes: 50 } } });
    expect(messages.at(-1)).toBe("PAD 02 SAMPLE LOADED");
  });

  it("decodes in the audio context, which it makes if there is none yet", async () => {
    const { samples, audio, decode } = setup();
    await samples.load(0, file("a.wav"));
    expect(audio.ensure).toHaveBeenCalled();
    expect(decode).toHaveBeenCalledWith({ name: "ctx" }, expect.any(ArrayBuffer));
  });

  it("says why a file cannot be used, and leaves the pad alone", async () => {
    const decode = vi.fn(async () => ({ ok: false, reason: REASONS.notAudio }));
    const { kit, samples, store, writes, messages } = setup({ decode });
    expect(await samples.load(2, file("notes.txt"))).toBe(false);
    expect(kit.isDefault(2)).toBe(true);
    expect(messages.at(-1)).toBe("PAD 03 NOT AUDIO");
    expect(store.set).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("refuses a file over the size cap without reading it", async () => {
    const { samples, messages } = setup();
    const big = file("big.wav", 6 * 1024 * 1024);
    expect(await samples.load(0, big)).toBe(false);
    expect(big.arrayBuffer).not.toHaveBeenCalled();
    expect(messages.at(-1)).toBe("PAD 01 FILE OVER 5 MB");
  });

  it("refuses a file that would take the samples over the total, counting the pad's own as free", async () => {
    const { samples, messages, kit } = setup({ maxTotalBytes: 100 });
    expect(await samples.load(0, file("a.wav", 60))).toBe(true);
    expect(await samples.load(1, file("b.wav", 60))).toBe(false);
    expect(messages.at(-1)).toBe(MEMORY_FULL);
    expect(kit.isDefault(1)).toBe(true);
    expect(await samples.load(0, file("c.wav", 90))).toBe(true); // replaces pad 0's 60
    expect(MAX_TOTAL_BYTES).toBeGreaterThan(5 * 1024 * 1024);
  });

  it("still plays the sample when it cannot be kept, and forgets what was kept for the pad", async () => {
    const store = fakeStore();
    const { kit, samples, writes, messages } = setup({ store });
    await samples.load(0, file("a.wav"));
    store.set.mockImplementation(async () => false);
    expect(await samples.load(0, file("b.wav"))).toBe(true);
    expect(kit.get(0).name).toBe("b");
    expect(messages.at(-1)).toBe("PAD 01 LOADED, NOT SAVED");
    expect(writes.at(-1).pads).toEqual({});
    expect(store.delete).toHaveBeenCalledWith("sample-0");
  });

  it("lets the later of two loads onto a pad win", async () => {
    let finishFirst;
    const decode = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockImplementationOnce(async () => decoded("second"));
    const { kit, samples } = setup({ decode });
    const first = samples.load(0, file("first.wav"));
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"));
    await samples.load(0, file("second.wav"));
    finishFirst(decoded("first"));
    expect(await first).toBe(false);
    expect(kit.get(0).name).toBe("second");
  });
});

describe("reset", () => {
  it("puts the built-in sound back, and forgets the sample", async () => {
    const { kit, samples, store, writes, messages } = setup();
    await samples.load(0, file("a.wav"));
    await samples.reset(0);
    expect(kit.get(0)).toBe(defaults[0]);
    expect(store.delete).toHaveBeenCalledWith("sample-0");
    expect(writes.at(-1).pads).toEqual({});
    expect(messages.at(-1)).toBe("PAD 01 DEFAULT SOUND");
  });
});

describe("restore", () => {
  const stored = {
    version: SAMPLES_VERSION,
    pads: { 0: { name: "Kick 808", bytes: 10 }, 2: { name: "Clap", bytes: 10 } },
  };
  const kept = () => ({ "sample-0": new ArrayBuffer(10), "sample-2": new ArrayBuffer(10) });

  it("puts the kept samples back on their pads, with their names", async () => {
    const { kit, samples } = setup({ stored, store: fakeStore({ initial: kept() }) });
    await samples.restore();
    expect(kit.get(0)).toMatchObject({ id: "sample-0", name: "Kick 808" });
    expect(kit.isDefault(1)).toBe(true);
    expect(kit.get(2).name).toBe("Clap");
  });

  it("does nothing until it is called, and only decodes once the context is there", async () => {
    const { kit, audio, decode } = setup({ stored, store: fakeStore({ initial: kept() }) });
    expect(kit.isDefault(0)).toBe(true);
    expect(audio.ensure).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
  });

  it("runs once", async () => {
    const { samples, decode } = setup({ stored, store: fakeStore({ initial: kept() }) });
    await samples.restore();
    await samples.restore();
    expect(decode).toHaveBeenCalledTimes(2); // two pads, once each
  });

  it("does not overwrite a pad the user has changed in the meantime", async () => {
    let release;
    const store = fakeStore({ initial: kept() });
    store.get.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(new ArrayBuffer(10)))));
    const { kit, samples } = setup({ stored, store });
    const restoring = samples.restore();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await samples.load(0, file("new.wav"));
    release();
    await restoring;
    expect(kit.get(0).name).toBe("new");
    expect(kit.get(2).name).toBe("Clap");
  });

  it("skips a pad whose file is gone or will not decode, and keeps the rest", async () => {
    const decode = vi.fn(async (_ctx, bytes) =>
      bytes === "bad" ? { ok: false, reason: REASONS.notAudio } : decoded(),
    );
    const store = fakeStore({ initial: { "sample-2": "bad" } }); // pad 0's file is missing
    const { kit, samples, writes } = setup({ stored, store, decode });
    await samples.restore();
    expect(kit.isDefault(0)).toBe(true);
    expect(kit.isDefault(2)).toBe(true);
    expect(writes).toHaveLength(0); // the map is left alone: storage may only be unavailable for this visit
  });

  it("ignores a stored map that is not usable", async () => {
    const { kit, samples, store } = setup({ stored: "garbage" });
    await samples.restore();
    expect(store.get).not.toHaveBeenCalled();
    expect(kit.isDefault(0)).toBe(true);
  });
});
