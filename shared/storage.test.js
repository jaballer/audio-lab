import { afterEach, describe, expect, it, vi } from "vitest";
import { loadJson, saveJson } from "./storage.js";

// A localStorage stand-in backed by a Map.
function fakeStorage(overrides = {}) {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("storage", () => {
  it("round-trips JSON", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(saveJson("k", { pads: [1, 2] })).toBe(true);
    expect(loadJson("k")).toEqual({ pads: [1, 2] });
  });

  it("returns the fallback for a missing key", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(loadJson("nope")).toBeNull();
    expect(loadJson("nope", [])).toEqual([]);
  });

  it("returns the fallback for corrupt data", () => {
    const storage = fakeStorage();
    storage.setItem("k", "{not json");
    vi.stubGlobal("localStorage", storage);
    expect(loadJson("k", "fallback")).toBe("fallback");
  });

  it("does not throw when storage is blocked", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", fakeStorage({ getItem: blocked, setItem: blocked }));
    expect(loadJson("k", "fallback")).toBe("fallback");
    expect(saveJson("k", 1)).toBe(false);
  });

  it("does not throw when storage does not exist at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadJson("k", "fallback")).toBe("fallback");
    expect(saveJson("k", 1)).toBe(false);
  });
});
