// Registers the service worker (`sw.js`, built from sw-template.js) and tells the page when a newer build is waiting.
// No DOM and no work at import: the page's `navigator` and `location` are handed in, so a test can pass stand-ins.
//
//   registerServiceWorker({
//     navigator, location,
//     onUpdate: (apply) => ...,   // a newer build is installed and waiting; call apply() to switch to it
//   });
//
// A new build never takes over by itself. A reload in the middle of playing would lose the person's place, so the page
// asks first, and `apply()` is the answer. The first install is not an update (there is no older build to replace), and
// the worker claiming the page then must not reload it either, so a reload follows only an `apply()` (or, when another
// tab applied the update, the person's own Reload).
//
// Resolves true once registered, and false when there is nothing to register with (an old browser, a page that is not
// served over https or from localhost) or registering failed. It never throws: the page works the same without it.

const SCRIPT_URL = "./sw.js"; // relative to the page, so the site works from any subpath

export async function registerServiceWorker({ navigator, location, onUpdate, scriptUrl = SCRIPT_URL }) {
  const container = navigator.serviceWorker;
  if (!container) return false;

  let applying = false;
  // A page that had a controller when it loaded is running that build's scripts. If the controller changes without this
  // page asking (another tab pressed Reload), the page is stale the same way: offer a plain reload, which also resets a
  // strip that is still showing "Updating…" for a worker that has already taken over.
  const hadController = Boolean(container.controller);
  container.addEventListener("controllerchange", () => {
    if (applying) location.reload();
    else if (hadController) onUpdate(() => location.reload());
  });

  const announce = (worker) =>
    onUpdate(() => {
      // Only a worker still waiting can be told to take over. One that has since taken over (another tab applied it) or
      // been replaced needs the page reloaded, not a message.
      if (worker.state !== "installed") return location.reload();
      applying = true;
      worker.postMessage({ type: "SKIP_WAITING" });
    });

  try {
    // `updateViaCache: "none"` so the browser asks the server for sw.js each time rather than trusting the HTTP cache
    // (GitHub Pages sends a ten-minute max-age), which would delay every update.
    const registration = await container.register(scriptUrl, { updateViaCache: "none" });

    // A build that finished installing while the page was closed or before this script ran.
    if (registration.waiting && container.controller) announce(registration.waiting);

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && container.controller) announce(worker);
      });
    });
    return true;
  } catch {
    return false;
  }
}
