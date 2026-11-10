// The bar fixed to the top of the window, above the machine and the same on every page: the site's name and a link to each
// page. It also builds the MIDI tools (its status, then the MIDI switch), which are not drawn in the bar: they are
// handed to the machine's own header (app-header.js `tools`), beside Export and POWER. It draws into the <header> it is
// handed and decides nothing.
//
//   const site = createSiteHeader(element, {
//     current: "mpc-sample",   // the id of this page in pages.js; its link is marked
//     midi: false,             // optional: a page with no MIDI has no MIDI switch or status
//   });
//   site.midiTools            // the element holding the MIDI tools: pass to createAppHeader as `tools` (null without MIDI)
//   site.midiButton            // pass to wireMidiButton() (null without MIDI)
//   site.setMidiStatus(text)   // pass as createMidiAccess's onStatus
//   site.log(text, level)      // pass as createMidiAccess's onLog; level "info" | "warn" | "error"
//
// The status is one short line; whatever is long or only useful when something is wrong goes to the log.

import { createConsoleLog } from "./console-log.js";
import { PAGES, SITE_NAME } from "./pages.js";

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function buildNav(current) {
  const nav = element("nav", "site-nav");
  nav.setAttribute("aria-label", "Pages");
  for (const page of PAGES) {
    const link = element("a", "site-link", page.label);
    link.href = page.href;
    if (page.id === current) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  return nav;
}

// The bar is fixed to the top, so the page leaves room for it. Its height changes when its
// controls wrap on a narrow window, so it is measured rather than assumed.
function reserveSpace(root) {
  if (typeof ResizeObserver === "undefined") return;
  const set = () => root.ownerDocument.documentElement.style.setProperty("--site-bar-height", `${root.offsetHeight}px`);
  new ResizeObserver(set).observe(root);
  set();
}

export function createSiteHeader(root, { current, midi = true }) {
  root.classList.add("site-bar");

  const name = element("a", "site-name", SITE_NAME.name);
  name.href = PAGES[0].href;
  name.append(element("b", "", SITE_NAME.accent));
  root.append(name, buildNav(current));

  if (!midi) {
    reserveSpace(root);
    return { midiTools: null, midiButton: null, setMidiStatus() {}, log() {} };
  }

  const midiButton = element("button", "btn btn-small btn-midi", "MIDI");
  midiButton.id = "midi-btn";
  midiButton.type = "button";
  midiButton.setAttribute("aria-pressed", "false");
  midiButton.title = "Listen for MIDI controllers: on when lit";
  const midiStatus = element("span", "small-label", "");
  midiStatus.id = "midi-status";
  midiStatus.setAttribute("role", "status");

  // The Console button and its drawer (console-drawer.js) are left out until there is a better place for them. The log
  // still collects what is sent, so the drawer can be wired back in without losing messages.
  const log = createConsoleLog();

  const midiTools = element("div", "midi-tools");
  midiTools.append(midiStatus, midiButton); // status first: the cluster is right-aligned, so its length changes never move the buttons
  reserveSpace(root);

  return {
    midiTools,
    midiButton,
    setMidiStatus(text) {
      midiStatus.textContent = text;
      midiStatus.title = text; // the whole text, for when the slot cuts it short
    },
    log: (text, level) => log.add(text, level),
  };
}
