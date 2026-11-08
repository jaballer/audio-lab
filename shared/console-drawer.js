// The console drawer: a panel along the bottom of the window that lists the console log.
// It draws into the element it is handed and decides nothing; the log itself is
// console-log.js.
//
//   const drawer = createConsoleDrawer(element, {
//     log,                    // a createConsoleLog()
//     onToggle: (open) => {}, // after it opens or closes, e.g. to set the button's state
//   });
//   drawer.render();          // call when the log changed
//   drawer.toggle();
//   drawer.open                // whether it is showing
//
// It is fixed to the window rather than part of the page's layout, so opening it never pushes
// the pads around.

import { formatTime } from "./console-log.js";

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function actionButton(label, onClick) {
  const button = element("button", "console-action", label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

const COPIED_MS = 1200;

export function createConsoleDrawer(root, { log, onToggle }) {
  root.classList.add("console-drawer");
  root.hidden = true;
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Console");

  const lines = element("ol", "console-lines");
  lines.setAttribute("role", "log");
  const empty = element("p", "console-empty", "Nothing logged yet.");

  const copy = actionButton("Copy", async () => {
    try {
      await navigator.clipboard.writeText(log.toText());
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Copy failed"; // no clipboard permission, or an insecure page
    }
    setTimeout(() => (copy.textContent = "Copy"), COPIED_MS);
  });
  const bar = element("div", "console-bar");
  bar.append(
    element("span", "console-title", "Console"),
    copy,
    actionButton("Clear", () => log.clear()),
  );

  root.append(bar, empty, lines);

  let open = false;

  function render() {
    const entries = log.entries();
    empty.hidden = entries.length > 0;
    lines.replaceChildren(
      ...entries.map((entry) => {
        const line = element("li", `console-line ${entry.level}`);
        line.append(element("time", "console-time", formatTime(entry.time)), element("span", "", entry.text));
        return line;
      }),
    );
    // Keep the newest line in view, as a terminal does.
    lines.scrollTop = lines.scrollHeight;
    root.scrollTop = root.scrollHeight;
  }

  return {
    render,
    toggle() {
      open = !open;
      root.hidden = !open;
      if (open) render();
      onToggle?.(open);
    },
    get open() {
      return open;
    },
  };
}
