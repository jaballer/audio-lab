import { describe, expect, it, vi } from "vitest";
import { QUOTA_SHARE, capFor, createStorageBudget, formatSpace } from "./storage-budget.js";

const MB = 1024 * 1024;

describe("capFor", () => {
  it("is the cap itself while the quota is roomy", () => {
    expect(capFor(32 * MB, 10_000 * MB)).toBe(32 * MB);
  });

  it("is a share of a small quota", () => {
    expect(capFor(32 * MB, 40 * MB)).toBe(Math.floor(40 * MB * QUOTA_SHARE));
  });

  it("leaves the cap alone when the quota is not known", () => {
    for (const quota of [undefined, null, NaN, 0, -5, Infinity]) expect(capFor(32 * MB, quota)).toBe(32 * MB);
  });
});

describe("formatSpace", () => {
  it("says used of allowed, in megabytes", () => {
    expect(formatSpace(4.2 * MB, 32 * MB)).toBe("4.2/32 MB");
    expect(formatSpace(0, 32 * MB)).toBe("0/32 MB");
  });

  it("keeps small amounts readable and big ones whole", () => {
    expect(formatSpace(10, 32 * MB)).toBe("<0.1/32 MB");
    expect(formatSpace(0.5 * MB, 10 * MB)).toBe("0.5/10 MB");
    expect(formatSpace(31.6 * MB, 32 * MB)).toBe("32/32 MB");
    expect(formatSpace(1 * MB, 0.5 * MB)).toBe("1/0.5 MB");
  });
});

describe("createStorageBudget", () => {
  const storage = (over = {}) => ({
    estimate: vi.fn(async () => ({ usage: 5 * MB, quota: 100 * MB })),
    persisted: vi.fn(async () => false),
    persist: vi.fn(async () => true),
    ...over,
  });

  it("reports usage and quota", async () => {
    expect(await createStorageBudget({ storage: storage() }).estimate()).toEqual({ usage: 5 * MB, quota: 100 * MB });
  });

  it("gives null when the estimate is missing, fails or is not numbers", async () => {
    expect(await createStorageBudget({ storage: undefined }).estimate()).toBeNull();
    expect(await createStorageBudget({ storage: {} }).estimate()).toBeNull();
    expect(
      await createStorageBudget({
        storage: storage({ estimate: async () => Promise.reject(new Error("no")) }),
      }).estimate(),
    ).toBeNull();
    expect(await createStorageBudget({ storage: storage({ estimate: async () => ({}) }) }).estimate()).toBeNull();
  });

  it("limits the cap by the quota, and leaves it when the quota is unknown", async () => {
    expect(await createStorageBudget({ storage: storage() }).limit(32 * MB)).toBe(25 * MB);
    expect(
      await createStorageBudget({ storage: storage({ estimate: async () => ({ usage: 0, quota: 1000 * MB }) }) }).limit(
        32 * MB,
      ),
    ).toBe(32 * MB);
    expect(await createStorageBudget({ storage: undefined }).limit(32 * MB)).toBe(32 * MB);
  });

  it("asks for persistent storage, and says whether it was granted", async () => {
    const granting = storage();
    expect(await createStorageBudget({ storage: granting }).persist()).toBe(true);
    expect(granting.persist).toHaveBeenCalled();
    expect(await createStorageBudget({ storage: storage({ persist: async () => false }) }).persist()).toBe(false);
  });

  it("does not ask again when the site is persistent already", async () => {
    const already = storage({ persisted: async () => true });
    expect(await createStorageBudget({ storage: already }).persist()).toBe(true);
    expect(already.persist).not.toHaveBeenCalled();
  });

  it("is false, not an error, where persistence is unsupported or fails", async () => {
    expect(await createStorageBudget({ storage: undefined }).persist()).toBe(false);
    expect(await createStorageBudget({ storage: { estimate: async () => ({}) } }).persist()).toBe(false);
    expect(
      await createStorageBudget({
        storage: storage({ persist: async () => Promise.reject(new Error("no")) }),
      }).persist(),
    ).toBe(false);
  });
});
