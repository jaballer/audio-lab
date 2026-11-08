// Takes the loading overlay (see loading.css) away once the page has settled. Loaded as a
// script on every page, like a page's main.js: it wires the overlay element to whenPageReady and
// decides nothing itself. Without scripts the overlay is hidden by a <noscript> rule instead, and
// if this script cannot load at all, a CSS animation in loading.css lifts the overlay after six
// seconds, so nothing here can leave the page covered for good.
//
// It is the first script on each page, not the last: module scripts run in document order, so a
// page script that is slow to arrive would otherwise hold back the timeout that is meant to
// cover exactly that.

import { whenPageReady } from "./page-ready.js";

const FADE_MS = 250; // the same as the transition in loading.css
const overlay = document.getElementById("loading");

if (overlay) {
  // The overlay only hides the page. Keyboard focus and screen readers would still reach the
  // controls behind it, so they are inert until it goes. Whatever the page's scripts add later
  // is not in this list, but is hidden or built after the overlay has gone.
  const covered = [...document.body.children].filter((el) => el !== overlay && el.tagName !== "SCRIPT");
  covered.forEach((el) => (el.inert = true));

  whenPageReady(window).then(() => {
    covered.forEach((el) => (el.inert = false));
    overlay.classList.add("is-done");
    // transitionend never fires when the transition is switched off (reduced motion), so a timer
    // removes it either way.
    setTimeout(() => overlay.remove(), FADE_MS);
  });
}
