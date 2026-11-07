import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the build works from any subpath,
  // such as https://<user>.github.io/pad-sampler/.
  base: "./",
});
