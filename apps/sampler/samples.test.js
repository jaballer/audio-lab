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
    readMap: () => stored,
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

  it("counts nothing for a pad when the newer file fails after the older one was overtaken", async () => {
    const { decode, pending } = controlledDecode();
    const { samples, messages } = setup({ decode, maxTotalBytes: 100 });
    const older = samples.load(0, file("a.wav", 80));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const newer = samples.load(0, file("b.txt", 10));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[0].resolve(ok()); // the older finishes first, and has been overtaken
    expect(await older).toBe(false);
    pending[1].resolve(bad()); // the newer then fails
    expect(await newer).toBe(false);
    await flush();
    // nothing is on pad 0, so a 95 byte file fits on pad 1 (a leftover count for pad 0 would push it over 100)
    pending.length = 0;
    const third = samples.load(1, file("c.wav", 95));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0].resolve(ok());
    expect(await third).toBe(true);
    expect(messages).not.toContain(MEMORY_FULL);
  });

  it("falls back to what the pad already held when the newer file fails", async () => {
    const { decode, pending } = controlledDecode();
    const { samples, messages } = setup({ decode, maxTotalBytes: 100 });
    const first = samples.load(0, file("x.wav", 60)); // the pad holds 60 bytes
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0].resolve(ok());
    await first;
    pending.length = 0;

    const older = samples.load(0, file("a.wav", 80));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const newer = samples.load(0, file("b.txt", 10));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[0].resolve(ok());
    await older;
    pending[1].resolve(bad());
    await newer;
    await flush();

    pending.length = 0;
    expect(await Promise.race([samples.load(1, file("c.wav", 50)), flush().then(() => "pending")])).toBe(false); // 60 + 50 > 100
    expect(messages.at(-1)).toBe(MEMORY_FULL);
    const fits = samples.load(1, file("d.wav", 30)); // 60 + 30 fits
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0].resolve(ok());
    expect(await fits).toBe(true);
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

describe("a sample's pitch", () => {
  it("starts at the sample's own pitch when a sample is loaded, and the pad's gain stays", async () => {
    const { kit, samples } = setup();
    kit.setSetting(0, "pitch", 7);
    kit.setSetting(0, "gain", -6);
    await samples.load(0, file("a.wav"));
    expect(kit.settings(0)).toEqual({ gain: -6, pitch: 0 });
  });

  it("goes with the sample: Default Sound leaves no pitch to come back with the next one", async () => {
    const { kit, samples } = setup();
    await samples.load(0, file("a.wav"));
    kit.setSetting(0, "pitch", 5);
    kit.setSetting(0, "gain", 3);
    await samples.reset(0);
    expect(kit.settings(0)).toEqual({ gain: 3, pitch: 0 });
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
