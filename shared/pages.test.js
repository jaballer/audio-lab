import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../vite.config.js";
import { PAGES, fileFor } from "./pages.js";

const root = resolve(import.meta.dirname, "..");

describe("PAGES", () => {
  it("gives every page its own id and label", () => {
    expect(new Set(PAGES.map((p) => p.id)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((p) => p.label)).size).toBe(PAGES.length);
  });

  it("links each page by a relative address, so the site works from any subpath", () => {
    for (const page of PAGES) expect(page.href).toMatch(/^(\.\/|[\w-]+\.html)$/);
  });

  it("points at html files that exist", () => {
    for (const page of PAGES) expect(existsSync(resolve(root, fileFor(page)))).toBe(true);
  });

  it("lists exactly the pages vite builds, so none is missing from the site header or the build", () => {
    const built = Object.values(config.build.rollupOptions.input).map((path) => basename(path));
    expect(PAGES.map(fileFor).sort()).toEqual(built.sort());
  });
});
