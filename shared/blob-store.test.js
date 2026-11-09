import { describe, expect, it } from "vitest";
import { createBlobStore } from "./blob-store.js";

// A stand-in for the part of IndexedDB the store uses. Requests and transactions finish in a later
// microtask, as the real ones finish later than the call. `failures` make a step go wrong.
function fakeIndexedDB({ failures = {} } = {}) {
  const data = new Map();
  const db = {
    onclose: null,
    transaction() {
      const tx = { oncomplete: null, onerror: null, onabort: null };
      const finish = (request, work) => {
        queueMicrotask(() => {
          if (failures.transaction === "abort") return tx.onabort?.();
          if (failures.transaction === "error") return tx.onerror?.();
          work();
          tx.oncomplete?.();
        });
        return request;
      };
      tx.objectStore = () => ({
        get: (key) => {
          const request = { result: undefined };
          return finish(request, () => (request.result = data.get(key)));
        },
        put: (value, key) => finish({}, () => data.set(key, value)),
        delete: (key) => finish({}, () => data.delete(key)),
      });
      return tx;
    },
  };
  let opens = 0;
  return {
    data,
    db,
    get opens() {
      return opens;
    },
    factory: () => ({
      open() {
        opens++;
        const request = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
        queueMicrotask(() => {
          if (failures.open === "error") return request.onerror?.();
          if (failures.open === "blocked") return request.onblocked?.();
          request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      },
    }),
  };
}

// The first open creates the object store, as the real one does.
const withStore = (idb) => {
  idb.db.createObjectStore = () => {};
  return createBlobStore({ factory: idb.factory });
};

describe("createBlobStore", () => {
  it("creates its object store, by its own name, when the database is new", async () => {
    const idb = fakeIndexedDB();
    const created = [];
    idb.db.createObjectStore = (name) => created.push(name);
    const store = createBlobStore({ factory: idb.factory, storeName: "samples" });
    await store.get("a");
    expect(created).toEqual(["samples"]);
  });

  it("keeps bytes and gives them back", async () => {
    const store = withStore(fakeIndexedDB());
    const bytes = new ArrayBuffer(4);
    expect(await store.set("a", bytes)).toBe(true);
    expect(await store.get("a")).toBe(bytes);
  });

  it("gives null for a key that is not there, and deletes", async () => {
    const store = withStore(fakeIndexedDB());
    expect(await store.get("missing")).toBeNull();
    await store.set("a", new ArrayBuffer(1));
    expect(await store.delete("a")).toBe(true);
    expect(await store.get("a")).toBeNull();
  });

  it("opens the database once", async () => {
    const idb = fakeIndexedDB();
    const store = withStore(idb);
    await store.set("a", new ArrayBuffer(1));
    await store.get("a");
    expect(idb.opens).toBe(1);
  });

  it("shares one open between calls made at the same time", async () => {
    const idb = fakeIndexedDB();
    const store = withStore(idb);
    await Promise.all(Array.from({ length: 16 }, (_, i) => store.get(`k${i}`)));
    expect(idb.opens).toBe(1);
  });

  it("tries again after a failed open, instead of keeping the failure", async () => {
    const idb = fakeIndexedDB({ failures: { open: "error" } });
    const store = withStore(idb);
    expect(await store.get("a")).toBeNull();
    expect(await store.get("a")).toBeNull();
    expect(idb.opens).toBe(2);
  });

  it("opens again after the browser closes the connection", async () => {
    const idb = fakeIndexedDB();
    const store = withStore(idb);
    await store.get("a");
    idb.db.onclose();
    await store.get("a");
    expect(idb.opens).toBe(2);
  });

  it("does not throw or reject when storage cannot be opened", async () => {
    for (const open of ["error", "blocked"]) {
      const store = withStore(fakeIndexedDB({ failures: { open } }));
      expect(await store.get("a")).toBeNull();
      expect(await store.set("a", new ArrayBuffer(1))).toBe(false);
      expect(await store.delete("a")).toBe(false);
    }
  });

  it("does not throw when there is no IndexedDB at all, or it throws", async () => {
    const missing = createBlobStore({ factory: () => undefined });
    expect(await missing.get("a")).toBeNull();
    expect(await missing.set("a", new ArrayBuffer(1))).toBe(false);
    const throwing = createBlobStore({
      factory: () => {
        throw new Error("denied");
      },
    });
    expect(await throwing.get("a")).toBeNull();
  });

  it("says a write was not kept when the transaction aborts, as a full disk does", async () => {
    for (const transaction of ["abort", "error"]) {
      const store = withStore(fakeIndexedDB({ failures: { transaction } }));
      expect(await store.set("a", new ArrayBuffer(1))).toBe(false);
      expect(await store.get("a")).toBeNull();
    }
  });
});
