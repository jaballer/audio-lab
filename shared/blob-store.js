// Bytes kept between visits in IndexedDB, because localStorage cannot hold audio. Like storage.js it never
// throws or rejects: IndexedDB can be missing, blocked (private windows), full or broken, and the page has to
// work without it. A failed read gives null, a failed write or delete gives false.
//
//   const store = createBlobStore();
//   await store.set("sample-3", arrayBuffer);   // true when it was kept
//   await store.get("sample-3");                // the bytes, or null (missing, or storage unavailable)
//   await store.delete("sample-3");             // true when it is gone
//
// `factory` is where IndexedDB comes from, so a test can hand in a stand-in.

export function createBlobStore({
  dbName = "audio-lab",
  storeName = "blobs",
  factory = () => globalThis.indexedDB,
} = {}) {
  let opening = null; // the open in progress, or the open database: calls made while it opens share it

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve) => {
      // A failed open is not kept, so the next call tries again.
      const fail = () => {
        opening = null;
        resolve(null);
      };
      try {
        const request = factory().open(dbName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(storeName);
        request.onsuccess = () => {
          const db = request.result;
          // Another tab upgrading or the browser closing the connection: open again next time.
          db.onclose = () => (opening = null);
          resolve(db);
        };
        request.onerror = fail;
        request.onblocked = fail;
      } catch {
        fail();
      }
    });
    return opening;
  }

  // Runs one request in its own transaction and resolves when the transaction has finished, which is
  // when a write is really kept. `result(request)` turns the request into the value to give back.
  async function run(mode, start, result, fallback) {
    const db = await open();
    if (!db) return fallback;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, mode);
        const request = start(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(result(request));
        tx.onerror = () => resolve(fallback);
        tx.onabort = () => resolve(fallback); // a full disk aborts the transaction
      } catch {
        resolve(fallback);
      }
    });
  }

  return {
    get: (key) =>
      run(
        "readonly",
        (store) => store.get(key),
        (request) => request.result ?? null,
        null,
      ),
    set: (key, bytes) =>
      run(
        "readwrite",
        (store) => store.put(bytes, key),
        () => true,
        false,
      ),
    delete: (key) =>
      run(
        "readwrite",
        (store) => store.delete(key),
        () => true,
        false,
      ),
  };
}
