import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const publicDir = resolve(import.meta.dirname, "..", "public");
const manifest = JSON.parse(readFileSync(resolve(publicDir, "manifest.webmanifest"), "utf8"));

describe("manifest.webmanifest", () => {
  it("is installable as a standalone app", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
  });

  it("starts and scopes by relative address, so it works from any subpath", () => {
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
  });

  it("has icons that exist, including a maskable one and the 192 and 512 sizes Chrome asks for", () => {
    for (const icon of manifest.icons) expect(existsSync(resolve(publicDir, icon.src))).toBe(true);
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("is linked, with the touch icon, from every page", () => {
    for (const page of ["index", "keyboard", "monitor", "mpc-sample", "tone-demo"]) {
      const html = readFileSync(resolve(publicDir, "..", `${page}.html`), "utf8");
      expect(html).toContain('rel="manifest"');
      expect(html).toContain('rel="apple-touch-icon"');
      expect(html).toContain('id="update-notice"');
    }
  });
});
