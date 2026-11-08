// The bar above the machine, the same on every page: the site's name, a link to each page,
// and the things that belong to the page rather than to the device (Connect MIDI, its status,
// the Console). It draws into the <header> it is handed and decides nothing.
//
//   const site = createSiteHeader(element, {
//     current: "mpc-sample",   // the id of this page in pages.js; its link is marked
//     midi: false,             // optional: a page with no MIDI has no Connect MIDI, status or Console
//   });
//   site.midiButton            // pass to wireMidiButton() (null without MIDI)
//   site.setMidiStatus(text)   // pass as createMidiAccess's onStatus
//   site.log(text, level)      // pass as createMidiAccess's onLog; level "info" | "warn" | "error"
//
// The status is one short line; whatever is long or only useful when something is wrong goes to
// the console drawer, opened from the Console button.

import { createConsoleDrawer } from "./console-drawer.js";
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

export function createSiteHeader(root, { current, midi = true }) {
  root.classList.add("site-bar");

  const name = element("a", "site-name", SITE_NAME.name);
  name.href = PAGES[0].href;
  name.append(element("b", "", SITE_NAME.accent));
  root.append(name, buildNav(current));

  if (!midi) {
    return { midiButton: null, setMidiStatus() {}, log() {} };
  }

  const midiButton = element("button", "btn btn-small", "Connect MIDI");
  midiButton.id = "midi-btn";
  midiButton.type = "button";
  const midiStatus = element("span", "small-label", "MIDI: off");
  midiStatus.id = "midi-status";
  midiStatus.setAttribute("role", "status");

  const consoleButton = element("button", "btn btn-small", "Console");
  consoleButton.type = "button";
  consoleButton.setAttribute("aria-expanded", "false");
  const drawerEl = element("section");
  drawerEl.id = "console-drawer";
  consoleButton.setAttribute("aria-controls", drawerEl.id);

  // Messages sent before the drawer is open are kept, so it shows them when it is.
  let drawer = null;
  const log = createConsoleLog({ onChange: () => drawer?.render() });
  drawer = createConsoleDrawer(drawerEl, {
    log,
    onToggle: (open) => consoleButton.setAttribute("aria-expanded", String(open)),
  });
  consoleButton.addEventListener("click", () => drawer.toggle());
  root.ownerDocument.body.append(drawerEl);

  const tools = element("div", "site-tools");
  tools.append(midiButton, midiStatus, consoleButton);
  root.append(tools);

  return {
    midiButton,
    setMidiStatus(text) {
      midiStatus.textContent = text;
      midiStatus.title = text; // the whole text, for when the slot cuts it short
    },
    log: (text, level) => log.add(text, level),
  };
}
