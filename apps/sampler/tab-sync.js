// Knowing when another tab of the sampler has saved. Every tab keeps its own copy of the beat in memory and writes all of it
// on a change, so a tab that has been left open writes its old beat over a newer one (a project opened in another tab, an
// edit made there). The browser tells the other tabs of a site when one changes localStorage (a `storage` event), and that
// is the cue to stop saving here. No DOM, and nothing at import time: the page passes in what to listen on.
//
//   const sync = createTabSync({ target: window, keys: [SONG_KEY, SAMPLES_KEY], onStale: (key) => {} });
//   sync.isStale;   // true once another tab has changed one of the keys: this tab's copy is behind and must not save
//
// Stale stays stale until the page is loaded again, which reads what is kept. The whole of storage being cleared (a `storage`
// event with no key) does not count: this tab still has the beat, and saving it again is how it comes back.

export function createTabSync({ target, keys, onStale = () => {} }) {
  let stale = false;
  target.addEventListener("storage", (event) => {
    if (stale || !keys.includes(event.key)) return;
    stale = true;
    onStale(event.key);
  });
  return {
    get isStale() {
      return stale;
    },
  };
}
