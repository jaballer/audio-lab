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

// The links in the footer, below every page: where the code and its documentation live. Pure data: no DOM.
// They are absolute because they leave the site. Most point at `main` on GitHub, which is where the pages are
// published from, so what they show is what is live; site-footer.test.js checks they all belong to the repository
// named in package.json (or to its owner's profile).
export const REPO_URL = "https://github.com/jaballer/audio-lab";
// The account that owns the repository: the one link here that is not inside it.
export const PROFILE_URL = "https://github.com/jaballer";

export const FOOTER_LINKS = [
  { id: "source", href: REPO_URL, label: "Source code", title: "The code on GitHub" },
  {
    id: "docs",
    href: `${REPO_URL}#readme`,
    label: "Documentation",
    title: "The README: what each page does, and how to run it",
  },
  {
    id: "design",
    href: `${REPO_URL}/tree/main/docs`,
    label: "Design notes",
    title: "How the code fits together, and why the sampler, export and the MPC Sample page work as they do",
  },
  {
    id: "changelog",
    href: `${REPO_URL}/blob/main/CHANGELOG.md`,
    label: "Changelog",
    title: "What has changed on the site, by day",
  },
  {
    id: "issues",
    href: `${REPO_URL}/issues`,
    label: "Report an issue",
    title: "Report a bug or ask for something on GitHub",
  },
  { id: "profile", href: PROFILE_URL, label: "GitHub profile", title: "jaballer on GitHub: the author of Audio Lab" },
  { id: "license", href: `${REPO_URL}/blob/main/LICENSE`, label: "License", title: "PolyForm Noncommercial 1.0.0" },
];
