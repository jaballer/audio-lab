// The strip below every page, after the help: links to the code, the documentation and the places to report a problem
// (the list is FOOTER_LINKS in pages.js). It draws into the <footer> it is handed and decides nothing.
//
//   createSiteFooter(element);
//
// The links leave the site, and the sampler may be playing or holding work that is not saved yet, so they open in a new
// tab rather than replacing the page.

import { FOOTER_LINKS, SITE_NAME } from "./pages.js";

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function buildLink({ href, label, title }) {
  const link = element("a", "site-footer-link", label);
  link.href = href;
  link.title = title;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

export function createSiteFooter(root) {
  root.classList.add("site-footer");

  const nav = element("nav", "site-footer-nav");
  nav.setAttribute("aria-label", "Project links");
  for (const entry of FOOTER_LINKS) nav.append(buildLink(entry));

  const note = element(
    "p",
    "site-footer-note",
    `${SITE_NAME.name}${SITE_NAME.accent} runs in your browser: no accounts, nothing uploaded.`,
  );
  root.append(nav, note);
}
