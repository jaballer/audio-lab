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
      },
    },
  },
});
