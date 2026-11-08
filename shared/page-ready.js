// Resolves when the page has settled: every script, style and image has loaded, fonts are in,
// and a couple of frames have been drawn since, so the layout the scripts built (and the
// measurements they took, like the site bar's height) is what the visitor sees. No DOM of its
// own and nothing at import time; it is handed the window.
//
//   await whenPageReady(window, { timeoutMs: 4000 });
//
// It always resolves, never rejects: after `timeoutMs` it gives up waiting and resolves anyway,
// so a stalled image or a script that threw cannot leave the page hidden for good.

export const DEFAULT_TIMEOUT_MS = 4000;
const SETTLE_FRAMES = 2; // one for the scripts' last changes to be laid out, one to be sure

const loaded = (win) =>
  new Promise((resolve) => {
    if (win.document.readyState === "complete") return resolve();
    win.addEventListener("load", resolve, { once: true });
  });

const fontsReady = (win) => win.document.fonts?.ready ?? Promise.resolve();

const frames = (win, count) =>
  new Promise((resolve) => {
    const step = (left) => (left === 0 ? resolve() : win.requestAnimationFrame(() => step(left - 1)));
    step(count);
  });

export function whenPageReady(win, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const settled = Promise.all([loaded(win), fontsReady(win)])
    .then(() => frames(win, SETTLE_FRAMES))
    .catch(() => {}); // a font that failed to load is no reason to keep the page hidden
  const timeout = new Promise((resolve) => win.setTimeout(resolve, timeoutMs));
  return Promise.race([settled, timeout]);
}
