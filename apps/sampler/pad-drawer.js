// The pad editor: a drawer that holds the options of the selected pad (its sound, and later more), the way a
// hardware sampler keeps them on a screen of their own and not around the pads. This file is only the drawer:
// opening and closing it, and its heading and sound line. What goes inside it (the Load Sample buttons, the
// sliders) is drawn by other views into the elements the markup gives them.
//
//   const drawer = createPadDrawer({ element, toggle, close, title, info, onToggle });
//   drawer.toggle(); drawer.open(); drawer.close();
//   drawer.isOpen;
//   drawer.refresh({ title: "PAD 03 · Snare", info: "0.40 s, mono, 22 KB" });   // for the selected pad
//
// It is not a dialog: playing goes on while it is open, so focus is not trapped and the pads stay usable. It
// is a labelled region opened by a button that says whether it is open (aria-expanded). Opening it with the
// button moves focus to its heading, so a keyboard user is in it whether it sits beside the machine (far from the
// button in the tab order) or under the pads; the heading is not a tab stop of its own. Escape, pressed while
// focus is inside it, closes it and puts focus back on the button. `onToggle(open)` is called when it opens
// or closes, so the page can remember it and place it. Opening it by code (restoring it at startup) moves no focus.

// Moves `element` to the end of `parent`. Moving an element in the document takes keyboard focus off anything
// inside it, so if focus was in it, it is given back to the same control afterwards.
export function moveKeepingFocus(element, parent, doc = document) {
  const focused = element.contains(doc.activeElement) ? doc.activeElement : null;
  parent.append(element);
  focused?.focus();
}

export function createPadDrawer({ element, toggle, close, title, info, onToggle }) {
  let open = false;

  function set(next) {
    if (next === open) return;
    open = next;
    element.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    onToggle?.(open);
  }

  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", element.id);
  title.tabIndex = -1; // focusable by code, not by Tab
  toggle.addEventListener("click", () => {
    set(!open);
    if (open) title.focus();
  });
  close.addEventListener("click", () => {
    set(false);
    toggle.focus();
  });
  element.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    set(false);
    toggle.focus();
  });
  element.hidden = true;

  return {
    open: () => set(true),
    close: () => set(false),
    toggle: () => set(!open),
    get isOpen() {
      return open;
    },
    // Called on every redraw, which is every step while playing: only what changed is written.
    refresh(next) {
      if (title.textContent !== next.title) title.textContent = next.title;
      if (info.textContent !== next.info) info.textContent = next.info;
    },
  };
}
