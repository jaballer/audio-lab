import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGES, fileFor } from "./pages.js";
import { precacheUrls, renderWorker } from "./precache.js";

const template = readFileSync(resolve(import.meta.dirname, "sw-template.js"), "utf8");

describe("precacheUrls", () => {
  it("keeps every file, sorted, with the front page also asked for as the folder", () => {
    expect(precacheUrls(["keyboard.html", "index.html", "assets/main-abc.js"])).toEqual([
      "./",
      "assets/main-abc.js",
      "index.html",
      "keyboard.html",
    ]);
  });

  it("leaves out the worker itself and source maps", () => {
    expect(precacheUrls(["sw.js", "assets/main-abc.js", "assets/main-abc.js.map"])).toEqual(["assets/main-abc.js"]);
  });

  it("keeps a file that only ends like the worker's name", () => {
    expect(precacheUrls(["assets/sw.js"])).toEqual(["assets/sw.js"]);
  });

  it("keeps every page of the site", () => {
    const urls = precacheUrls(PAGES.map(fileFor));
    for (const page of PAGES) expect(urls).toContain(fileFor(page));
    expect(urls).toContain("./");
  });

  it("uses relative addresses, so the site works from any subpath", () => {
    for (const url of precacheUrls(["index.html", "assets/a.js"])) expect(url).not.toMatch(/^\/|^https?:/);
  });
});

describe("renderWorker", () => {
  it("fills in the files to keep and the version", () => {
    const source = renderWorker(template, ["./", "assets/a.js"], "abc123");
    expect(source).toContain('const PRECACHE = ["./","assets/a.js"];');
    expect(source).toContain('const VERSION = "abc123";');
    expect(source).not.toContain("const PRECACHE = [];");
    expect(source).not.toContain('const VERSION = "dev";');
  });

  it("keeps the rest of the template as it is", () => {
    const source = renderWorker(template, ["./"], "v");
    expect(source).toContain('self.addEventListener("fetch"');
    expect(source).toContain("SKIP_WAITING");
  });

  it("fails when the template has lost a line the build fills in", () => {
    expect(() => renderWorker("const PRECACHE = [];", [], "v")).toThrow(/sw-template/);
    expect(() => renderWorker('const VERSION = "dev";', [], "v")).toThrow(/sw-template/);
  });

  it("makes a worker that parses as a script", () => {
    expect(() => new Function(renderWorker(template, ["./"], "v"))).not.toThrow();
  });
});
