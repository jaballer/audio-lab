// A button that shows and hides some regions of a page, drawn on elements it is handed. It shows and reports; the page
// decides what to remember (`onToggle`). No work at import time.
//
//   const panel = createDisclosure({ toggle, regions: [controls, body], open: true, onToggle, doc });
//   panel.toggle(); panel.open(); panel.close();
//   panel.isOpen;
//
// The button says whether it is open (`aria-expanded`) and what it controls (`aria-controls`, the regions' ids), and the
// regions are hidden when it is closed, so they are out of the tab order and away from a screen reader too. If focus is
// inside a region that is being hidden it goes to the button, so the keyboard is not left on the page behind. `open` at
// the start moves no focus and does not call `onToggle`. `doc` is the document that holds focus, so a test can hand in
// a stand-in.

import { setAttr, setHidden } from "./dom-updates.js";

export function createDisclosure({ toggle, regions, open = true, onToggle, doc = document }) {
  let isOpen = open;

  function apply() {
    setAttr(toggle, "aria-expanded", String(isOpen));
    for (const region of regions) setHidden(region, !isOpen, toggle, doc);
  }

  function set(next) {
    if (next === isOpen) return;
    isOpen = next;
    apply();
    onToggle?.(isOpen);
  }

  toggle.setAttribute(
    "aria-controls",
    regions
      .map((region) => region.id)
      .filter(Boolean)
      .join(" "),
  );
  apply();
  toggle.addEventListener("click", () => set(!isOpen));

  return {
    open: () => set(true),
    close: () => set(false),
    toggle: () => set(!isOpen),
    get isOpen() {
      return isOpen;
    },
  };
}
