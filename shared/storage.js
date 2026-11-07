// JSON in localStorage that never throws. Storage can be missing, full, blocked
// or hold corrupt data (private windows, blocked site data), and the page has
// to work without it, so a failed read returns the fallback and a failed write
// returns false.

export function loadJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
