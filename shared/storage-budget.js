// How much room the browser gives this page, and asking it to keep what the page saves. No DOM, and it
// never throws or rejects: the storage API can be missing (older browsers, some embedded views) or refuse,
// and a page has to work without it. `storage` is where it comes from (`navigator.storage`), so a test can
// hand in a stand-in.
//
//   const budget = createStorageBudget();
//   await budget.estimate();        // { usage, quota } in bytes for this site, or null when unknown
//   await budget.limit(32 * MB);    // `maxBytes`, or less when the quota is small: a share of it (QUOTA_SHARE)
//   await budget.persist();         // true when the browser will not clear this site's data under pressure
//
// Browsers treat IndexedDB as best-effort storage: under disk pressure Chrome and Firefox can drop it, and
// Safari can clear a site's data after about a week without a visit. `persist()` asks them not to. Chrome
// decides by itself (often no), Firefox asks the visitor, so call it after something the visitor did.

// What the saved samples may use of the site's quota, so a small quota (a private window) is not filled.
export const QUOTA_SHARE = 0.25;

const MB = 1024 * 1024;

// `maxBytes`, or the share of the quota when that is smaller. An unknown quota changes nothing.
export function capFor(maxBytes, quota) {
  return Number.isFinite(quota) && quota > 0 ? Math.min(maxBytes, Math.floor(quota * QUOTA_SHARE)) : maxBytes;
}

// Megabytes for a small display: "<0.1", "0.5", "4.2", "32". One decimal below 10, whole numbers above.
function megabytes(bytes) {
  const mb = bytes / MB;
  if (mb === 0) return "0";
  if (mb < 0.1) return "<0.1";
  return mb < 10 ? String(Number(mb.toFixed(1))) : String(Math.round(mb));
}

// "4.2/32 MB": what is used of what is allowed.
export const formatSpace = (used, limit) => `${megabytes(used)}/${megabytes(limit)} MB`;

const LOOKUP_TIMEOUT_MS = 1500; // an estimate that never answers must not hold up a load

// The promise's value, or `fallback` if it has not settled in `ms`.
function within(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => (timer = setTimeout(() => resolve(fallback), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createStorageBudget({ storage = globalThis.navigator?.storage, timeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
  async function estimate() {
    try {
      const { usage, quota } = (await within(storage.estimate(), timeoutMs, null)) ?? {};
      return Number.isFinite(usage) && Number.isFinite(quota) ? { usage, quota } : null;
    } catch {
      return null;
    }
  }

  async function limit(maxBytes) {
    const known = await estimate();
    return known ? capFor(maxBytes, known.quota) : maxBytes;
  }

  async function persist() {
    try {
      if (await storage.persisted?.()) return true;
      return (await storage.persist?.()) === true;
    } catch {
      return false;
    }
  }

  return { estimate, limit, persist };
}
