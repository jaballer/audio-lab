// Every page of the site, in the order the site header lists them. Pure data: no DOM.
// `id` is what a page passes to createSiteHeader as `current`; `href` is relative, so it works
// from any subpath (the site is served from /audio-lab/ on GitHub Pages).
//
// A new page needs an entry here as well as in vite.config.js; pages.test.js checks they agree.

export const PAGES = [
  { id: "sampler", href: "./", label: "Sampler" },
  { id: "keys", href: "keyboard.html", label: "Keys" },
  { id: "mpc-sample", href: "mpc-sample.html", label: "MPC Sample" },
  { id: "monitor", href: "monitor.html", label: "Monitor" },
  { id: "tone-demo", href: "tone-demo.html", label: "Tone demo" },
];

export const SITE_NAME = { name: "Audio ", accent: "Lab" };

// The sampler is the front page, served as index.html.
export const fileFor = (page) => (page.href === "./" ? "index.html" : page.href);
