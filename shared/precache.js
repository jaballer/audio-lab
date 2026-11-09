// What the service worker keeps for offline use, decided from the names of the files the build emits. The build plugin in
// `vite.config.js` calls these and writes `sw.js`; nothing here touches the DOM or the file system.
//
//   precacheUrls(["index.html", "assets/main-abc.js", "sw.js"])   // ["./", "assets/main-abc.js", "index.html"]
//   renderWorker(templateSource, urls, version)                    // the worker's source with both filled in

// A source map is only for DevTools, and the worker does not list itself (the browser fetches it on its own).
const NOT_PRECACHED = /\.map$|^sw\.js$/;

// Addresses are relative to the worker, so the site works from any subpath (the site is served from /audio-lab/ on
// GitHub Pages). The front page is asked for as the folder (`./`) as well as `index.html`, so both are kept.
export function precacheUrls(fileNames) {
  const urls = new Set();
  for (const name of fileNames) {
    if (NOT_PRECACHED.test(name)) continue;
    urls.add(name);
    if (name === "index.html") urls.add("./");
  }
  return [...urls].sort();
}

// The two lines `shared/sw-template.js` carries for the build to replace. Matching them exactly (and failing when
// they are gone) means a template edited by hand cannot quietly ship a worker that caches nothing.
const URLS_LINE = "const PRECACHE = [];";
const VERSION_LINE = 'const VERSION = "dev";';

export function renderWorker(template, urls, version) {
  if (!template.includes(URLS_LINE) || !template.includes(VERSION_LINE)) {
    throw new Error("sw-template.js no longer has the PRECACHE and VERSION lines the build fills in");
  }
  return template
    .replace(URLS_LINE, `const PRECACHE = ${JSON.stringify(urls)};`)
    .replace(VERSION_LINE, `const VERSION = ${JSON.stringify(version)};`);
}
