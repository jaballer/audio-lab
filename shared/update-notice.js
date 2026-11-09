// The "a new version is ready" strip, the same on every page. A new build waits in the background (see register-sw.js)
// until the person says to switch, because reloading in the middle of playing would lose their place. It draws into the
// element it is handed and decides nothing: the page passes what Reload does.
//
//   const notice = createUpdateNotice(element);
//   notice.show(apply);   // from registerServiceWorker's onUpdate; Reload calls apply, Later hides the strip
//
// Writes go through dom-updates.js, and the strip hands keyboard focus on before it hides, so Escape and the like keep
// working where the person was.

import { setDisabled, setHidden, setText } from "./dom-updates.js";

export const UPDATE_TEXT = "A new version is ready.";
export const UPDATING_TEXT = "Updating…";

export function createUpdateNotice(element) {
  const doc = element.ownerDocument;
  const text = doc.createElement("span");
  const reload = doc.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  const later = doc.createElement("button");
  later.type = "button";
  later.textContent = "Later";
  element.replaceChildren(text, reload, later);

  let apply = null;

  reload.addEventListener("click", () => {
    setText(text, UPDATING_TEXT);
    setDisabled(reload, true, later);
    setDisabled(later, true);
    apply?.();
  });
  later.addEventListener("click", () => setHidden(element, true, doc.body));

  return {
    show(applyUpdate) {
      apply = applyUpdate;
      setText(text, UPDATE_TEXT);
      setDisabled(reload, false);
      setDisabled(later, false);
      setHidden(element, false);
    },
  };
}
