import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the build works from any subpath,
  // such as https://<user>.github.io/pad-sampler/.
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        keyboard: resolve(import.meta.dirname, "keyboard.html"),
        monitor: resolve(import.meta.dirname, "monitor.html"),
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
