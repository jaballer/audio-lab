import { describe, expect, it, vi } from "vitest";
import { createTabSync } from "./tab-sync.js";

// What the browser sends to the other tabs of a site when one of them changes localStorage.
const storageEvent = (key) => Object.assign(new Event("storage"), { key });

function setup(options = {}) {
  const target = new EventTarget();
  const onStale = vi.fn();
  const sync = createTabSync({ target, keys: ["song", "samples"], onStale, ...options });
  return { target, onStale, sync };
}

describe("createTabSync", () => {
  it("is not stale until another tab changes one of the keys", () => {
    const { sync, onStale } = setup();
    expect(sync.isStale).toBe(false);
    expect(onStale).not.toHaveBeenCalled();
  });

  it("goes stale, and says so once, when another tab changes the song or the samples", () => {
    const { target, sync, onStale } = setup();
    target.dispatchEvent(storageEvent("song"));
    expect(sync.isStale).toBe(true);
    expect(onStale).toHaveBeenCalledExactlyOnceWith("song");
    target.dispatchEvent(storageEvent("samples")); // already stale: the strip is not shown again
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it("goes stale for the samples map alone", () => {
    const { target, sync } = setup();
    target.dispatchEvent(storageEvent("samples"));
    expect(sync.isStale).toBe(true);
  });

  it("ignores other keys, such as a panel left open or shut", () => {
    const { target, sync, onStale } = setup();
    target.dispatchEvent(storageEvent("pad-sampler:drawer"));
    expect(sync.isStale).toBe(false);
    expect(onStale).not.toHaveBeenCalled();
  });

  it("ignores the whole of storage being cleared: this tab still has the beat, and saving it again puts it back", () => {
    const { target, sync } = setup();
    target.dispatchEvent(storageEvent(null));
    expect(sync.isStale).toBe(false);
  });
});
