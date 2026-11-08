// Takes the loading overlay (see loading.css) away once the page has settled. Loaded as a
// script on every page, like a page's main.js: it wires the overlay element to whenPageReady and
// decides nothing itself. Without scripts the overlay is hidden by a <noscript> rule instead.

import { whenPageReady } from "./page-ready.js";

const FADE_MS = 250; // the same as the transition in loading.css
const overlay = document.getElementById("loading");

if (overlay) {
  whenPageReady(window).then(() => {
    overlay.classList.add("is-done");
    // transitionend never fires when the transition is switched off (reduced motion), so a timer
    // removes it either way.
    setTimeout(() => overlay.remove(), FADE_MS);
  });
}
