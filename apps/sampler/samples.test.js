import { describe, expect, it, vi } from "vitest";
import { createKit } from "./kit.js";
import { MAX_TOTAL_BYTES, MEMORY_FULL, SAMPLES_VERSION, createSamples, isSamplesMap, parseSamples } from "./samples.js";
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

function setup({
  stored = null,
  store = fakeStore(),
  decode = vi.fn(async () => decoded()),
  probe = vi.fn(async () => null), // a length that cannot be told from the header, unless a test says
  failMap = false,
  ...options
} = {}) {
  const kit = createKit(defaults);
  const audio = { ensure: vi.fn(() => ({ name: "ctx" })) };
  const writes = [];
  const messages = [];
  const samples = createSamples({
    kit,
    audio,
    store,
    decode,
    probe,
    readMap: () => writes.at(-1) ?? stored,
    writeMap: (map) => {
      writes.push(structuredClone(map));
      return !failMap;
    },
    onMessage: (text) => messages.push(text),
    ...options,
  });
  return { kit, audio, store, decode, probe, samples, writes, messages };
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
    expect(messages.at(-1)).toBe("PAD 02 LOADED <0.1/32 MB");
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

  it("lets an earlier load carry on when the newer file is refused", async () => {
    let finishFirst;
    const decode = vi.fn().mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)));
    const { kit, samples, messages } = setup({ decode, maxTotalBytes: 100 });
    const first = samples.load(0, file("first.wav", 60));
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"));
    expect(await samples.load(0, file("big.wav", 6 * 1024 * 1024))).toBe(false); // refused: too big
    expect(messages.at(-1)).toBe("PAD 01 FILE OVER 5 MB");
    finishFirst(decoded());
    expect(await first).toBe(true);
    expect(kit.get(0).name).toBe("first");
    expect(samples.isKept(0)).toBe(true); // and it was kept
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

describe("load, when storage fails in part or the cap is close", () => {
  it("is not saved when the bytes were kept but the map could not be written", async () => {
    const { kit, samples, store, messages } = setup({ failMap: true });
    expect(await samples.load(0, file("a.wav"))).toBe(true);
    expect(kit.get(0).name).toBe("a"); // it plays this visit
    expect(messages.at(-1)).toBe("PAD 01 LOADED, NOT SAVED");
    expect(store.delete).toHaveBeenCalledWith("sample-0"); // no orphaned bytes
    expect(samples.isKept(0)).toBe(false);
  });

  it("still counts a sample that plays but was not saved toward the total", async () => {
    const { samples, messages } = setup({ maxTotalBytes: 100, store: fakeStore({ failWrites: true }) });
    expect(await samples.load(0, file("a.wav", 60))).toBe(true);
    expect(await samples.load(1, file("b.wav", 60))).toBe(false);
    expect(messages.at(-1)).toBe(MEMORY_FULL);
  });

  it("counts loads that overlap together, so they cannot go over the total", async () => {
    let finish;
    const decode = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const { samples, messages } = setup({ maxTotalBytes: 100, decode });
    const first = samples.load(0, file("a.wav", 60));
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(await samples.load(1, file("b.wav", 60))).toBe(false);
    expect(messages.at(-1)).toBe(MEMORY_FULL);
    finish(decoded());
    expect(await first).toBe(true);
  });

  it("stops counting a file that could not be decoded", async () => {
    const decode = vi.fn().mockResolvedValueOnce({ ok: false, reason: REASONS.notAudio }).mockResolvedValue(decoded());
    const { samples } = setup({ maxTotalBytes: 100, decode });
    expect(await samples.load(0, file("bad.txt", 80))).toBe(false);
    expect(await samples.load(1, file("b.wav", 80))).toBe(true);
  });
});

describe("the browser's storage budget", () => {
  const MB = 1024 * 1024;
  const budget = (limit = 32 * MB) => ({
    limit: vi.fn(async (maxBytes) => Math.min(limit, maxBytes)),
    persist: vi.fn(async () => true),
  });

  it("takes the cap from the budget, so a small quota allows less than the fixed cap", async () => {
    const { samples, messages, kit } = setup({ budget: budget(100), maxTotalBytes: MB });
    expect(await samples.load(0, file("a.wav", 60))).toBe(true);
    expect(await samples.load(1, file("b.wav", 60))).toBe(false); // 120 bytes against a limit of 100
    expect(messages.at(-1)).toBe(MEMORY_FULL);
    expect(kit.isDefault(1)).toBe(true);
  });

  it("asks the budget for room each time, and gives it the fixed cap", async () => {
    const b = budget();
    const { samples } = setup({ budget: b, maxTotalBytes: 5 * MB });
    await samples.load(0, file("a.wav"));
    await samples.load(1, file("b.wav"));
    expect(b.limit).toHaveBeenCalledTimes(2);
    expect(b.limit).toHaveBeenCalledWith(5 * MB);
  });

  it("says how much of the room the samples use when one is loaded", async () => {
    const { samples, messages } = setup({ budget: budget(32 * MB) });
    await samples.load(0, file("a.wav", 2 * MB));
    expect(messages.at(-1)).toBe("PAD 01 LOADED 2/32 MB");
    await samples.load(1, file("b.wav", 1.5 * MB));
    expect(messages.at(-1)).toBe("PAD 02 LOADED 3.5/32 MB");
  });

  it("works with no budget given", async () => {
    const { samples } = setup();
    expect(await samples.load(0, file("a.wav"))).toBe(true);
  });
});

describe("what counts toward the total when requests overlap", () => {
  // decode calls that finish when the test says, in the order they were made
  function controlledDecode() {
    const pending = [];
    const decode = vi.fn((_ctx, bytes) => new Promise((resolve) => pending.push({ size: bytes.byteLength, resolve })));
    return { decode, pending };
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const ok = () => ({ ok: true, buffer: {} });
  const bad = () => ({ ok: false, reason: REASONS.notAudio });

  it("keeps the older sample, and counts it, when the newer file fails after the older one has finished", async () => {
    const { decode, pending } = controlledDecode();
    const { samples, kit, messages, writes } = setup({ decode, maxTotalBytes: 100 });
    const older = samples.load(0, file("a.wav", 80));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const newer = samples.load(0, file("b.txt", 10));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[0].resolve(ok()); // the older finishes first: nothing newer has installed, so it stands
    expect(await older).toBe(true);
    pending[1].resolve(bad()); // the newer then fails, and leaves the pad as it is
    expect(await newer).toBe(false);
    await flush();
    expect(kit.get(0).name).toBe("a"); // the pad plays the older file
    expect(writes.at(-1).pads[0]).toEqual({ name: "a", bytes: 80 }); // and it is kept, so it is there next visit
    // and it counts: 80 of 100 is taken, so 30 more does not fit and 20 does
    pending.length = 0;
    expect(await samples.load(1, file("c.wav", 30))).toBe(false);
    expect(messages.at(-1)).toBe(MEMORY_FULL);
    const fits = samples.load(1, file("d.wav", 20));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0].resolve(ok());
    expect(await fits).toBe(true);
  });

  it("falls back to what the pad already held when both new files fail", async () => {
    const { decode, pending } = controlledDecode();
    const { samples, kit, messages } = setup({ decode, maxTotalBytes: 100 });
    const first = samples.load(0, file("x.wav", 60)); // the pad holds 60 bytes
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0].resolve(ok());
    await first;
    pending.length = 0;

    const a = samples.load(0, file("a.txt", 80));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const b = samples.load(0, file("b.txt", 10));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[0].resolve(bad());
    pending[1].resolve(bad());
    await Promise.all([a, b]);
    expect(kit.get(0).name).toBe("x");

    pending.length = 0;
    expect(await samples.load(1, file("c.wav", 50))).toBe(false); // 60 + 50 > 100
    expect(messages.at(-1)).toBe(MEMORY_FULL);
    const fits = samples.load(1, file("d.wav", 30)); // 60 + 30 fits
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0].resolve(ok());
    expect(await fits).toBe(true);
  });

  it("lets the newer file win when it installs first, and drops the older one that finishes after it", async () => {
    const { decode, pending } = controlledDecode();
    const { samples, kit, writes } = setup({ decode });
    const older = samples.load(0, file("old.wav", 50));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const newer = samples.load(0, file("new.wav", 70));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1].resolve(ok()); // the newer finishes first and installs
    expect(await newer).toBe(true);
    pending[0].resolve(ok()); // the older arrives after it, and gives way
    expect(await older).toBe(false);
    expect(kit.get(0).name).toBe("new");
    expect(writes.at(-1).pads[0]).toEqual({ name: "new", bytes: 70 });
  });

  it("counts the biggest of the loads in flight on a pad, never less, and lets go of each one as it ends", async () => {
    const { decode, pending } = controlledDecode();
    const { samples } = setup({ decode, maxTotalBytes: 100 });
    const a = samples.load(0, file("a.wav", 30));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const b = samples.load(0, file("b.wav", 60));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    // pad 0 may end up holding 60: 50 more on pad 1 does not fit, 40 does
    expect(await samples.load(1, file("c.wav", 50))).toBe(false);
    pending[0].resolve(bad());
    pending[1].resolve(bad());
    await Promise.all([a, b]);
    pending.length = 0;
    const d = samples.load(1, file("d.wav", 100)); // everything is let go: the whole cap is free again
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0].resolve(ok());
    expect(await d).toBe(true);
  });
});

describe("the order of requests on a pad", () => {
  // A budget whose answers are given when the test says, so loads can be made to reach acceptance out of order.
  function slowBudget() {
    const waiting = [];
    return {
      waiting,
      limit: vi.fn((maxBytes) => new Promise((resolve) => waiting.push(() => resolve(maxBytes)))),
      persist: vi.fn(async () => true),
    };
  }
  const settled = (n, b) => vi.waitFor(() => expect(b.waiting.length).toBe(n));

  it("keeps the newer file when the older one's quota lookup finishes last", async () => {
    const b = slowBudget();
    const { samples, kit } = setup({ budget: b });
    const older = samples.load(0, file("older.wav"));
    const newer = samples.load(0, file("newer.wav"));
    await settled(2, b);
    b.waiting[1](); // the newer one is accepted first
    await newer;
    b.waiting[0](); // the older arrives after it
    expect(await older).toBe(false);
    expect(kit.get(0).name).toBe("newer");
  });

  it("keeps the newer file when the older one is accepted first and overtaken", async () => {
    const b = slowBudget();
    const { samples, kit } = setup({ budget: b });
    const older = samples.load(0, file("older.wav"));
    const newer = samples.load(0, file("newer.wav"));
    await settled(2, b);
    b.waiting[0]();
    await older;
    b.waiting[1]();
    await newer;
    expect(kit.get(0).name).toBe("newer");
  });

  it("does not let a load that was waiting on the quota undo a reset made meanwhile", async () => {
    const b = slowBudget();
    const { samples, kit } = setup({ budget: b });
    const load = samples.load(0, file("late.wav"));
    await settled(1, b);
    await samples.reset(0);
    b.waiting[0]();
    expect(await load).toBe(false);
    expect(kit.isDefault(0)).toBe(true);
    expect(samples.isKept(0)).toBe(false);
  });

  it("lets an older load stand when the newer file turns out not to decode", async () => {
    const decode = vi
      .fn()
      .mockImplementation(async (_ctx, bytes) =>
        bytes.byteLength === 7 ? { ok: false, reason: REASONS.notAudio } : decoded(),
      );
    const b = slowBudget();
    const { samples, kit } = setup({ budget: b, decode });
    const older = samples.load(0, file("older.wav", 50));
    const newer = samples.load(0, file("bad.txt", 7));
    await settled(2, b);
    b.waiting[1](); // the newer is accepted, and fails to decode
    expect(await newer).toBe(false);
    b.waiting[0](); // so the older, arriving after, still stands
    expect(await older).toBe(true);
    expect(kit.get(0).name).toBe("older");
  });
});

describe("asking the browser to keep the samples", () => {
  it("asks synchronously from the load, before anything is awaited, because Firefox wants a fresh gesture", () => {
    const b = { limit: vi.fn(async (m) => m), persist: vi.fn(async () => true) };
    const { samples } = setup({ budget: b });
    samples.load(0, file("a.wav")); // not awaited
    expect(b.persist).toHaveBeenCalledTimes(1);
  });

  it("asks once per visit, not for a file refused for its size, and not again", async () => {
    const b = { limit: vi.fn(async (m) => m), persist: vi.fn(async () => true) };
    const { samples } = setup({ budget: b });
    await samples.load(0, file("big.wav", 6 * 1024 * 1024));
    expect(b.persist).not.toHaveBeenCalled();
    await samples.load(0, file("a.wav"));
    await samples.load(1, file("b.wav"));
    expect(b.persist).toHaveBeenCalledTimes(1);
  });
});

describe("the length check before decoding", () => {
  it("refuses a file whose header says it is far too long, without reading or decoding it", async () => {
    const { samples, decode, messages, kit } = setup({ probe: vi.fn(async () => 25) });
    const long = file("loop.mp3", 3000);
    expect(await samples.load(0, long)).toBe(false);
    expect(messages.at(-1)).toBe("PAD 01 OVER 10 SECONDS");
    expect(long.arrayBuffer).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
    expect(kit.isDefault(0)).toBe(true);
  });

  it("treats the header as a hint: a file a little over the limit goes on to be decoded, and decoding decides", async () => {
    const decode = vi.fn(async () => ({ ok: false, reason: REASONS.seconds }));
    const { samples, messages } = setup({ probe: vi.fn(async () => 14), decode });
    expect(await samples.load(0, file("maybe.mp3"))).toBe(false);
    expect(decode).toHaveBeenCalled();
    expect(messages.at(-1)).toBe("PAD 01 OVER 10 SECONDS");
    expect(await setup({ probe: vi.fn(async () => 14) }).samples.load(0, file("fine.mp3"))).toBe(true);
  });

  it("lets a short file through, and one whose length cannot be told (decoding checks that)", async () => {
    expect(await setup({ probe: vi.fn(async () => 2.5) }).samples.load(0, file("a.wav"))).toBe(true);
    expect(await setup({ probe: vi.fn(async () => 10) }).samples.load(0, file("a.wav"))).toBe(true);
    const { samples, decode } = setup({ probe: vi.fn(async () => null) });
    expect(await samples.load(0, file("a.wav"))).toBe(true);
    expect(decode).toHaveBeenCalled();
  });

  it("does not probe a file that is too big already", async () => {
    const { samples, probe } = setup();
    await samples.load(0, file("big.wav", 6 * 1024 * 1024));
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("what a loaded sample says about itself", () => {
  const buffered = (extra) => ({
    ok: true,
    buffer: { duration: 1.5, numberOfChannels: 2, sampleRate: 44100, ...extra },
  });

  it("is its length, channels and the file's size, when it is loaded", async () => {
    const { kit, samples } = setup({ decode: vi.fn(async () => buffered()) });
    await samples.load(0, file("a.wav", 4321));
    expect(kit.get(0).info).toEqual({ seconds: 1.5, channels: 2, bytes: 4321 });
    expect(kit.get(1).info).toBeUndefined(); // a built-in sound has none
  });

  it("is the same after a restore, with the size of the bytes that were read, not what the map says", async () => {
    const stored = { version: SAMPLES_VERSION, pads: { 0: { name: "Kept", bytes: 777 } } };
    const { kit, samples } = setup({
      stored,
      store: fakeStore({ initial: { "sample-0": new ArrayBuffer(1234) } }), // the map is out of date
      decode: vi.fn(async () => buffered({ numberOfChannels: 1 })),
    });
    await samples.restore();
    expect(kit.get(0).info).toEqual({ seconds: 1.5, channels: 1, bytes: 1234 });
  });
});

describe("trimming a sample", () => {
  // A decode that gives a buffer with a real length, so a trim can be kept possible.
  const longBuffer = () => ({
    ok: true,
    buffer: { duration: 2, numberOfChannels: 1, sampleRate: 44100, length: 88200 },
  });
  const withSample = async (options = {}) => {
    const context = setup({ decode: vi.fn(async () => longBuffer()), ...options });
    await context.samples.load(0, file("a.wav", 500));
    return context;
  };

  it("sets the part that plays and keeps it with the sample", async () => {
    const { samples, kit, writes } = await withSample();
    expect(samples.setTrim(0, { start: 0.25, end: 0.75 }, "end")).toEqual({ start: 0.25, end: 0.75 });
    expect(kit.get(0).trim).toEqual({ start: 0.25, end: 0.75 });
    expect(writes.at(-1).pads[0]).toEqual({ name: "a", bytes: 500, trim: { start: 0.25, end: 0.75 } });
  });

  it("gives back what the trim became, kept possible, and keeps that", async () => {
    const { samples, writes } = await withSample();
    expect(samples.setTrim(0, { start: -1, end: 9 })).toEqual({ start: 0, end: 1 });
    expect(writes.at(-1).pads[0]).toEqual({ name: "a", bytes: 500 });
  });

  it("leaves nothing in the map for all of the sample, once it has been put back", async () => {
    const { samples, writes } = await withSample();
    samples.setTrim(0, { start: 0.1, end: 0.9 });
    samples.setTrim(0, { start: 0, end: 1 });
    expect(writes.at(-1).pads[0]).toEqual({ name: "a", bytes: 500 });
  });

  it("is null for a pad that plays a built-in sound, and changes nothing", async () => {
    const { samples, writes } = await withSample();
    writes.length = 0;
    expect(samples.setTrim(2, { start: 0.1, end: 0.9 })).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it("comes back after a restore, applied to the sample", async () => {
    const stored = {
      version: SAMPLES_VERSION,
      pads: { 0: { name: "Kept", bytes: 500, trim: { start: 0.2, end: 0.6 } } },
    };
    const { kit, samples } = setup({
      stored,
      store: fakeStore({ initial: { "sample-0": new ArrayBuffer(500) } }),
      decode: vi.fn(async () => longBuffer()),
    });
    await samples.restore();
    expect(kit.get(0).trim).toEqual({ start: 0.2, end: 0.6 });
  });

  it("starts at all of a sample when a new one is loaded over a trimmed one", async () => {
    const { samples, kit, writes } = await withSample();
    samples.setTrim(0, { start: 0.3, end: 0.4 });
    await samples.load(0, file("b.wav", 600));
    expect(kit.get(0).trim).toEqual({ start: 0, end: 1 });
    expect(writes.at(-1).pads[0]).toEqual({ name: "b", bytes: 600 });
  });

  it("is dropped, with the sample, by Default Sound", async () => {
    const { samples, writes } = await withSample();
    samples.setTrim(0, { start: 0.3, end: 0.4 });
    await samples.reset(0);
    expect(writes.at(-1).pads).toEqual({});
  });
});

describe("trimming a sample that is not kept, or is still being saved", () => {
  const longBuffer = () => ({
    ok: true,
    buffer: { duration: 2, numberOfChannels: 1, sampleRate: 44100, length: 88200 },
  });

  it("plays the trim for a sample that could not be saved, without writing anything or throwing", async () => {
    const { samples, kit, writes } = setup({
      decode: vi.fn(async () => longBuffer()),
      store: fakeStore({ failWrites: true }),
    });
    await samples.load(0, file("a.wav", 500));
    expect(samples.isKept(0)).toBe(false);
    writes.length = 0;
    expect(() => samples.setTrim(0, { start: 0.2, end: 0.6 })).not.toThrow();
    expect(kit.get(0).trim).toEqual({ start: 0.2, end: 0.6 }); // it plays this visit
    expect(writes).toHaveLength(0); // and nothing is written for it
  });

  // A store that holds a write until the test lets it finish.
  function gatedStore() {
    const store = fakeStore();
    const gates = [];
    store.set.mockImplementation(
      (key, bytes) =>
        new Promise((resolve) => {
          gates.push(() => {
            store.data.set(key, bytes);
            resolve(true);
          });
        }),
    );
    return { store, gates };
  }

  it("does not write a trim made while a new sample is saving onto the old sample's entry, and keeps it with the new one", async () => {
    const { store, gates } = gatedStore();
    const { samples, kit, writes } = setup({ decode: vi.fn(async () => longBuffer()), store });
    const first = samples.load(0, file("old.wav", 500));
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    gates[0]();
    await first;
    samples.setTrim(0, { start: 0.1, end: 0.9 });
    expect(writes.at(-1).pads[0]).toEqual({ name: "old", bytes: 500, trim: { start: 0.1, end: 0.9 } });

    const second = samples.load(0, file("new.wav", 600)); // the pad plays it now; its bytes are still being saved
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    expect(kit.get(0).name).toBe("new");
    writes.length = 0;
    samples.setTrim(0, { start: 0.3, end: 0.4 });
    expect(writes).toHaveLength(0); // the entry in the map is still "old": it is not touched
    gates[1]();
    await second;
    expect(writes.at(-1).pads[0]).toEqual({ name: "new", bytes: 600, trim: { start: 0.3, end: 0.4 } });
  });

  it("keeps the trim of the sound that wins when a load is overtaken by a newer one", async () => {
    const { store, gates } = gatedStore();
    const { samples, kit, writes } = setup({ decode: vi.fn(async () => longBuffer()), store });
    const b = samples.load(0, file("b.wav", 500));
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    const c = samples.load(0, file("c.wav", 700)); // overtakes b while b is being saved
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    samples.setTrim(0, { start: 0.2, end: 0.5 }); // c is what plays
    gates[0]();
    gates[1]();
    await Promise.all([b, c]);
    expect(kit.get(0).name).toBe("c");
    expect(writes.at(-1).pads[0]).toEqual({ name: "c", bytes: 700, trim: { start: 0.2, end: 0.5 } });
  });
});

describe("two tabs sharing the saved map", () => {
  // One storage that both tabs read and write, as localStorage is. A tab's map is read when it starts and again
  // whenever it writes.
  function sharedStorage(initial = null) {
    const box = { map: initial };
    return { box, readMap: () => box.map, writeMap: (map) => ((box.map = structuredClone(map)), true) };
  }
  const entry = (name, bytes = 100) => ({ name, bytes });

  it("keeps a sample another tab saved since this one started, when this one saves its own", async () => {
    const storage = sharedStorage({ version: SAMPLES_VERSION, pads: {} });
    const { samples } = setup({ readMap: storage.readMap, writeMap: storage.writeMap });
    // the other tab saves a sample on pad 2
    storage.box.map = { version: SAMPLES_VERSION, pads: { 2: entry("other") } };
    await samples.load(1, file("mine.wav", 200));
    expect(storage.box.map.pads).toEqual({ 1: { name: "mine", bytes: 200 }, 2: entry("other") });
  });

  it("changes only its own pad when it resets one, and leaves the other tab's samples", async () => {
    const storage = sharedStorage({ version: SAMPLES_VERSION, pads: { 0: entry("mine") } });
    const { samples } = setup({ readMap: storage.readMap, writeMap: storage.writeMap });
    storage.box.map = { version: SAMPLES_VERSION, pads: { 0: entry("mine"), 2: entry("other") } };
    await samples.reset(0);
    expect(storage.box.map.pads).toEqual({ 2: entry("other") });
  });

  it("writes a trim into the map without dropping another tab's pad", async () => {
    const storage = sharedStorage({ version: SAMPLES_VERSION, pads: {} });
    const longBuffer = { ok: true, buffer: { duration: 2, numberOfChannels: 1, length: 88200 } };
    const { samples } = setup({
      readMap: storage.readMap,
      writeMap: storage.writeMap,
      decode: vi.fn(async () => longBuffer),
    });
    await samples.load(0, file("a.wav", 300));
    storage.box.map = { version: SAMPLES_VERSION, pads: { ...storage.box.map.pads, 2: entry("other") } };
    samples.setTrim(0, { start: 0.2, end: 0.6 });
    expect(storage.box.map.pads[2]).toEqual(entry("other"));
    expect(storage.box.map.pads[0].trim).toEqual({ start: 0.2, end: 0.6 });
  });
});

describe("what a restored entry counts as", () => {
  const stored = (...bytes) => ({
    version: SAMPLES_VERSION,
    pads: Object.fromEntries(bytes.map((size, pad) => [pad, { name: `s${pad}`, bytes: size }])),
  });

  it("is the size of the bytes that were read, not what the map says", async () => {
    const { samples } = setup({
      stored: stored(10), // the map says 10 bytes
      store: fakeStore({ initial: { "sample-0": new ArrayBuffer(900) } }), // there are 900
      maxTotalBytes: 1000,
    });
    await samples.restore();
    expect(await samples.load(1, file("more.wav", 200))).toBe(false); // 900 + 200 does not fit
    expect(await samples.load(1, file("less.wav", 100))).toBe(true);
  });

  it("is nothing for an entry whose bytes are not there, so it cannot fill the cap on its own", async () => {
    const { samples, kit } = setup({ stored: stored(300, 300), maxTotalBytes: 1000 }); // the store is empty
    await samples.restore();
    expect(kit.isDefault(0)).toBe(true);
    expect(samples.isKept(0)).toBe(true); // the entry is left, in case storage is only away for this visit
    expect(await samples.load(2, file("big.wav", 900))).toBe(true); // all of the room is free
  });
});

describe("parseSamples and the size an entry claims", () => {
  const withBytes = (bytes) => ({ version: SAMPLES_VERSION, pads: { 0: { name: "a", bytes } } });

  it("keeps a whole number of bytes up to what a file may be", () => {
    expect(parseSamples(withBytes(0), 4)[0]).toEqual({ name: "a", bytes: 0 });
    expect(parseSamples(withBytes(5 * 1024 * 1024), 4)[0].bytes).toBe(5 * 1024 * 1024);
  });

  it("drops an entry that cannot be a stored file: negative, fractional, bigger than a file may be, or not a number", () => {
    for (const bytes of [-1, 1.5, 5 * 1024 * 1024 + 1, 1e300, Infinity, NaN, "10", null, undefined]) {
      expect(parseSamples(withBytes(bytes), 4)).toEqual({});
    }
  });
});

describe("parseSamples and a trim", () => {
  const entry = (trim) => ({ version: SAMPLES_VERSION, pads: { 0: { name: "a", bytes: 5, trim } } });

  it("keeps a trim that is usable, and leaves it off for all of the sample", () => {
    expect(parseSamples(entry({ start: 0.1, end: 0.5 }), 4)[0].trim).toEqual({ start: 0.1, end: 0.5 });
    expect(parseSamples(entry({ start: 0, end: 1 }), 4)[0]).toEqual({ name: "a", bytes: 5 });
  });

  it("drops a trim that is not usable, but keeps the sample", () => {
    for (const trim of ["x", { start: 0.9, end: 0.1 }, { start: -1, end: 2 }, { start: "a" }, null]) {
      expect(parseSamples(entry(trim), 4)[0]).toEqual({ name: "a", bytes: 5 });
    }
  });
});

describe("a sample's pitch", () => {
  it("starts at the sample's own pitch when a sample is loaded, and the pad's gain stays", async () => {
    const { kit, samples } = setup();
    kit.setSetting(0, "pitch", 7);
    kit.setSetting(0, "gain", -6);
    await samples.load(0, file("a.wav"));
    expect(kit.settings(0)).toEqual({
      gain: -6,
      pitch: 0,
      choke: 0,
      color: 0,
      attack: 0,
      decay: 0,
      sustain: 100,
      release: 0,
    });
  });

  it("goes with the sample: Default Sound leaves no pitch to come back with the next one", async () => {
    const { kit, samples } = setup();
    await samples.load(0, file("a.wav"));
    kit.setSetting(0, "pitch", 5);
    kit.setSetting(0, "gain", 3);
    await samples.reset(0);
    expect(kit.settings(0)).toEqual({
      gain: 3,
      pitch: 0,
      choke: 0,
      color: 0,
      attack: 0,
      decay: 0,
      sustain: 100,
      release: 0,
    });
    await samples.load(0, file("b.wav"));
    expect(kit.settings(0).pitch).toBe(0);
  });

  it("is left alone when kept samples are restored at the start of a visit", async () => {
    const stored = { version: SAMPLES_VERSION, pads: { 0: { name: "Kept", bytes: 10 } } };
    const store = fakeStore({ initial: { "sample-0": new ArrayBuffer(10) } });
    const kit = createKit(defaults, { settings: { 0: { gain: 0, pitch: 4 } } });
    const samples = createSamples({
      kit,
      audio: { ensure: () => ({}) },
      store,
      decode: async () => decoded(),
      readMap: () => stored,
      writeMap: () => true,
    });
    await samples.restore();
    expect(kit.get(0).name).toBe("Kept");
    expect(kit.settings(0).pitch).toBe(4);
  });

  it("does not report a change for a pad whose pitch was already 0", async () => {
    const changes = [];
    const kit = createKit(defaults, { onChange: (index, what) => changes.push([index, what]) });
    const samples = createSamples({
      kit,
      audio: { ensure: () => ({}) },
      store: fakeStore(),
      decode: async () => decoded(),
      probe: async () => null,
      readMap: () => null,
      writeMap: () => true,
    });
    await samples.load(0, file("a.wav"));
    expect(changes).toEqual([[0, "sound"]]);
  });
});

describe("reset", () => {
  it("frees the pad's share of the total", async () => {
    const { samples } = setup({ maxTotalBytes: 100 });
    await samples.load(0, file("a.wav", 80));
    await samples.reset(0);
    expect(await samples.load(1, file("b.wav", 80))).toBe(true);
  });

  it("removes a sample that is kept but was not restored, so it does not come back", async () => {
    const stored = { version: SAMPLES_VERSION, pads: { 0: { name: "Kept", bytes: 10 } } };
    const { kit, samples, store, writes } = setup({ stored }); // the store has no file: a failed restore
    await samples.restore();
    expect(kit.isDefault(0)).toBe(true);
    expect(samples.isKept(0)).toBe(true);
    await samples.reset(0);
    expect(samples.isKept(0)).toBe(false);
    expect(writes.at(-1).pads).toEqual({});
    expect(store.delete).toHaveBeenCalledWith("sample-0");
  });

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

  it("decodes with the context it is given, without making the audio context", async () => {
    const offline = { name: "offline" };
    const { samples, audio, decode, kit } = setup({
      stored,
      store: fakeStore({ initial: kept() }),
      restoreContext: () => offline,
    });
    await samples.restore();
    expect(decode).toHaveBeenCalledWith(offline, expect.anything());
    expect(audio.ensure).not.toHaveBeenCalled();
    expect(kit.get(0).name).toBe("Kick 808");
  });

  it("does nothing when there is no context to decode with", async () => {
    const { samples, store, kit } = setup({ stored, restoreContext: () => null });
    await samples.restore();
    expect(store.get).not.toHaveBeenCalled();
    expect(kit.isDefault(0)).toBe(true);
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

describe("isSamplesMap", () => {
  it("is true for a map of this version, even an empty one", () => {
    expect(isSamplesMap({ version: SAMPLES_VERSION, pads: {} })).toBe(true);
  });

  it("is false for what this page cannot read: another version, no pads, or not an object", () => {
    for (const stored of [
      null,
      undefined,
      "x",
      [],
      {},
      { version: 99, pads: {} },
      { version: SAMPLES_VERSION },
      { version: SAMPLES_VERSION, pads: [] },
    ]) {
      expect(isSamplesMap(stored)).toBe(false);
    }
  });
});

describe("restore, when the pad is changed while its file is being read", () => {
  const stored = { version: SAMPLES_VERSION, pads: { 0: { name: "old", bytes: 10 } } };
  // The store's read of pad 0 finishes when the test says, with a file of 900 bytes.
  function slowRead() {
    const store = fakeStore();
    let release;
    store.get.mockImplementation(() => new Promise((resolve) => (release = () => resolve(new ArrayBuffer(900)))));
    return { store, release: () => release() };
  }

  it("does not read the file of a pad that was changed before the restore began", async () => {
    const { store } = slowRead();
    const { samples } = setup({ stored, store });
    await samples.load(0, file("new.wav", 100)); // its entry is kept, and it is this visit's sample
    store.get.mockClear();
    await samples.restore();
    expect(store.get).not.toHaveBeenCalled();
  });

  it("does not count the old file's size again after Default Sound has freed it", async () => {
    const { store, release } = slowRead();
    const { samples } = setup({ stored, store, maxTotalBytes: 1000 });
    const restoring = samples.restore();
    await vi.waitFor(() => expect(store.get).toHaveBeenCalled());
    await samples.reset(0);
    release();
    await restoring;
    expect(await samples.load(1, file("more.wav", 500))).toBe(true); // 900 left over would have refused it
  });

  it("does not count the old file's size instead of the new sample's", async () => {
    const { store, release } = slowRead();
    const { samples } = setup({ stored, store, maxTotalBytes: 1000 });
    const restoring = samples.restore();
    await vi.waitFor(() => expect(store.get).toHaveBeenCalled());
    await samples.load(0, file("new.wav", 100));
    release();
    await restoring;
    expect(await samples.load(1, file("more.wav", 800))).toBe(true); // 100 + 800, not 900 + 800
    expect(await samples.load(2, file("too-much.wav", 200))).toBe(false); // and 100 + 800 + 200 is over
  });
});

describe("a load that is overtaken while its bytes are being saved", () => {
  it("does not write its entry over the newer sample's", async () => {
    const store = fakeStore();
    const gates = [];
    store.set.mockImplementation(
      (key, bytes) =>
        new Promise((resolve) =>
          gates.push(() => {
            store.data.set(key, bytes);
            resolve(true);
          }),
        ),
    );
    const { samples, kit, writes } = setup({ store });
    const older = samples.load(0, file("older.wav", 50));
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    const newer = samples.load(0, file("newer.wav", 70)); // takes the pad while the older is still being saved
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    gates[1]();
    await newer;
    gates[0](); // the older finishes last
    expect(await older).toBe(true); // it did play, for a moment
    expect(kit.get(0).name).toBe("newer");
    expect(writes.at(-1).pads[0]).toEqual({ name: "newer", bytes: 70 });
  });
});

describe("what counts toward the total: the biggest load in flight, not the last", () => {
  it("counts the earlier, bigger load when a smaller one is accepted after it", async () => {
    const pending = [];
    const decode = vi.fn((_ctx, bytes) => new Promise((resolve) => pending.push({ size: bytes.byteLength, resolve })));
    const { samples } = setup({ decode, maxTotalBytes: 100 });
    const a = samples.load(0, file("a.wav", 60));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const b = samples.load(0, file("b.wav", 30)); // a smaller file, accepted after the bigger
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(await samples.load(1, file("c.wav", 50))).toBe(false); // pad 0 may still end up holding 60
    pending[0].resolve({ ok: false, reason: REASONS.notAudio });
    pending[1].resolve({ ok: false, reason: REASONS.notAudio });
    await Promise.all([a, b]);
  });
});

describe("a trim, when another tab has changed the pad's entry", () => {
  function sharedStorage(initial) {
    const box = { map: initial };
    return { box, readMap: () => box.map, writeMap: (map) => ((box.map = structuredClone(map)), true) };
  }
  const longBuffer = { ok: true, buffer: { duration: 2, numberOfChannels: 1, length: 88200 } };
  async function loaded(initial) {
    const storage = sharedStorage(initial);
    const tab = setup({
      readMap: storage.readMap,
      writeMap: storage.writeMap,
      decode: vi.fn(async () => longBuffer),
    });
    await tab.samples.load(0, file("mine.wav", 300));
    return { storage, ...tab };
  }
  const empty = { version: SAMPLES_VERSION, pads: {} };

  it("is not written over a different sample the other tab put on the pad", async () => {
    const { storage, samples, kit } = await loaded(empty);
    storage.box.map = { version: SAMPLES_VERSION, pads: { 0: { name: "theirs", bytes: 40 } } };
    samples.setTrim(0, { start: 0.2, end: 0.6 });
    expect(kit.get(0).trim).toEqual({ start: 0.2, end: 0.6 }); // it still plays here
    expect(storage.box.map.pads[0]).toEqual({ name: "theirs", bytes: 40 }); // and their entry is as it was
  });

  it("does not bring back an entry the other tab removed", async () => {
    const { storage, samples } = await loaded(empty);
    storage.box.map = { version: SAMPLES_VERSION, pads: {} }; // the other tab reset pad 0, and deleted its bytes
    samples.setTrim(0, { start: 0.2, end: 0.6 });
    expect(storage.box.map.pads).toEqual({});
  });

  it("is written onto the same sample's entry, even when the other tab trimmed it differently", async () => {
    const { storage, samples } = await loaded(empty);
    storage.box.map = {
      version: SAMPLES_VERSION,
      pads: { 0: { name: "mine", bytes: 300, trim: { start: 0.5, end: 1 } } },
    };
    samples.setTrim(0, { start: 0.2, end: 0.6 });
    expect(storage.box.map.pads[0].trim).toEqual({ start: 0.2, end: 0.6 });
  });
});

describe("when the saved map cannot be read at the time of a write", () => {
  const longBuffer = { ok: true, buffer: { duration: 2, numberOfChannels: 1, length: 88200 } };

  it("writes this tab's own pads, rather than a map without them", async () => {
    const box = { map: null };
    const { samples } = setup({
      readMap: () => box.map,
      writeMap: (map) => ((box.map = structuredClone(map)), true),
      decode: vi.fn(async () => longBuffer),
    });
    await samples.load(0, file("a.wav", 100));
    await samples.load(1, file("b.wav", 100));
    box.map = "garbage"; // damaged since
    await samples.reset(1);
    expect(box.map.pads).toEqual({ 0: { name: "a", bytes: 100 } });
    box.map = null;
    samples.setTrim(0, { start: 0.1, end: 0.9 });
    expect(box.map.pads[0]).toEqual({ name: "a", bytes: 100, trim: { start: 0.1, end: 0.9 } });
  });
});

describe("a sample's envelope", () => {
  const withEnvelope = (kit) => {
    kit.setSetting(0, "attack", 30);
    kit.setSetting(0, "decay", 20);
    kit.setSetting(0, "sustain", 40);
    kit.setSetting(0, "release", 60);
  };
  const flat = { attack: 0, decay: 0, sustain: 100, release: 0 };
  const envelopeOf = (kit) => {
    const { attack, decay, sustain, release } = kit.settings(0);
    return { attack, decay, sustain, release };
  };

  it("starts flat when a sample is loaded, as the pitch does, and the pad's gain stays", async () => {
    const { samples, kit } = setup();
    kit.setSetting(0, "gain", -6);
    withEnvelope(kit);
    await samples.load(0, file("a.wav"));
    expect(envelopeOf(kit)).toEqual(flat);
    expect(kit.settings(0).gain).toBe(-6);
  });

  it("goes with the sample: Default Sound leaves none to come back with the next one", async () => {
    const { samples, kit } = setup();
    await samples.load(0, file("a.wav"));
    withEnvelope(kit);
    await samples.reset(0);
    expect(envelopeOf(kit)).toEqual(flat);
    await samples.load(0, file("b.wav"));
    expect(envelopeOf(kit)).toEqual(flat);
  });

  it("is left alone when kept samples are restored at the start of a visit", async () => {
    const stored = { version: SAMPLES_VERSION, pads: { 0: { name: "Kick", bytes: 10 } } };
    const { samples, kit } = setup({ stored, store: fakeStore({ initial: { "sample-0": new ArrayBuffer(10) } }) });
    withEnvelope(kit); // as saved with the song
    await samples.restore();
    expect(kit.settings(0)).toMatchObject({ attack: 30, decay: 20, sustain: 40, release: 60 });
  });
});

describe("the settings a sample has, when the sound changes", () => {
  // What the pad's settings are at the moment the kit is told the sound changed: that is when a playing sequence builds
  // its queued steps again, from the sound and the settings as they are then, so they must already be the new ones.
  function watchSoundChanges(kit) {
    const seen = [];
    const set = kit.set;
    const reset = kit.reset;
    kit.set = (pad, sound) => {
      seen.push(kit.settings(pad));
      set(pad, sound);
    };
    kit.reset = (pad) => {
      seen.push(kit.settings(pad));
      reset(pad);
    };
    return seen;
  }
  const flat = { pitch: 0, attack: 0, decay: 0, sustain: 100, release: 0 };
  const dirty = (kit) => {
    kit.setSetting(0, "pitch", 7);
    kit.setSetting(0, "attack", 30);
    kit.setSetting(0, "release", 60);
    kit.setSetting(0, "gain", -6);
  };

  it("are already back to flat when a new sample is installed, so the steps built again for it use none of the old ones", async () => {
    const { samples, kit } = setup();
    dirty(kit);
    const seen = watchSoundChanges(kit);
    await samples.load(0, file("a.wav"));
    expect(seen[0]).toMatchObject(flat);
    expect(seen[0].gain).toBe(-6); // the pad's gain stays
  });

  it("are already back to flat when the built-in sound comes back", async () => {
    const { samples, kit } = setup();
    await samples.load(0, file("a.wav"));
    dirty(kit);
    const seen = watchSoundChanges(kit);
    await samples.reset(0);
    expect(seen[0]).toMatchObject(flat);
  });
});
