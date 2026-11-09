// Makes a page work offline and offers it a newer build when there is one. Each page's main.js calls it once, after the
// site header. It wires the service worker (register-sw.js) to the notice (update-notice.js) and nothing else.
//
//   enableOffline(document.getElementById("update-notice"));
//
// Only in a production build: in `npm run dev` a worker would serve cached files over the dev server's changes.

import { registerServiceWorker } from "./register-sw.js";
import { createUpdateNotice } from "./update-notice.js";

export function enableOffline(noticeElement) {
  if (!import.meta.env.PROD || !noticeElement) return;
  const notice = createUpdateNotice(noticeElement);
  registerServiceWorker({ navigator, location, onUpdate: (apply) => notice.show(apply) });
}
