import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

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

export default defineConfig({
  plugins: [emitLicense],
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
