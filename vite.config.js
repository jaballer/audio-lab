import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { defineConfig } from "vite";
import { precacheUrls, renderWorker } from "./shared/precache.js";

// The license asks anyone who gets a copy of any part of the software to get its terms too, and
// the site and the Docker image only carry `dist/`. Emitting the root LICENSE there keeps one
// source for the text.
const emitLicense = {
  name: "emit-license",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "LICENSE",
      source: readFileSync(resolve(import.meta.dirname, "LICENSE"), "utf8"),
    });
  },
};

// Every file under public/ (the manifest and icons), as dist/-relative names. Vite copies them to dist/ after the
// bundle is made, so they are not in the bundle the plugin below sees and are read from disk instead.
function publicFiles(dir = resolve(import.meta.dirname, "public")) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return publicFiles(path);
    return [{ fileName: relative(resolve(import.meta.dirname, "public"), path), source: readFileSync(path) }];
  });
}

// Writes dist/sw.js: the worker in shared/sw-template.js with the list of files to keep offline and a fingerprint of
// them. The fingerprint covers the contents (not only the names), because the pages' own HTML keeps its name when it
// changes; without it a markup-only change would produce an identical sw.js and the browser would never install it.
const emitServiceWorker = {
  name: "emit-service-worker",
  enforce: "post",
  generateBundle(_options, bundle) {
    const files = [
      ...Object.values(bundle).map((output) => ({
        fileName: output.fileName,
        source: output.type === "chunk" ? output.code : output.source,
      })),
      ...publicFiles(),
    ].sort((a, b) => a.fileName.localeCompare(b.fileName));
    const hash = createHash("sha256");
    for (const { fileName, source } of files) hash.update(fileName).update("\0").update(source).update("\0");
    const template = readFileSync(resolve(import.meta.dirname, "shared/sw-template.js"), "utf8");
    const urls = precacheUrls(files.map((file) => file.fileName));
    this.emitFile({
      type: "asset",
      fileName: "sw.js",
      source: renderWorker(template, urls, hash.digest("hex").slice(0, 12)),
    });
  },
};

export default defineConfig({
  plugins: [emitLicense, emitServiceWorker],
  // Relative asset paths so the build works from any subpath,
  // such as https://<user>.github.io/audio-lab/.
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        keyboard: resolve(import.meta.dirname, "keyboard.html"),
        monitor: resolve(import.meta.dirname, "monitor.html"),
        mpcSample: resolve(import.meta.dirname, "mpc-sample.html"),
        toneDemo: resolve(import.meta.dirname, "tone-demo.html"),
      },
    },
  },
  // Only read by `npm run coverage`. The entry points (main.js) and view code are
  // DOM wiring that the tests do not cover, so they show as gaps on purpose.
  test: {
    coverage: {
      provider: "v8",
      include: ["apps/**/*.js", "shared/**/*.js"],
      exclude: ["**/*.test.js"],
      reporter: ["text"],
    },
  },
});
