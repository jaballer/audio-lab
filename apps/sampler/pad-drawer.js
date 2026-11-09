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
// is a labelled region opened by a button that says whether it is open (aria-expanded). Escape, pressed while
// focus is inside it, closes it and puts focus back on that button. `onToggle(open)` is called when it opens
// or closes, so the page can remember it and place it.

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
  toggle.addEventListener("click", () => set(!open));
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
    refresh(next) {
      title.textContent = next.title;
      info.textContent = next.info;
    },
  };
}
