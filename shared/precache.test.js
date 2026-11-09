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

describe("the worker's install step", () => {
  // Runs the real template against stand-ins for the worker's globals.
  function load() {
    const handlers = {};
    const added = [];
    const cache = { addAll: (requests) => (added.push(...requests), Promise.resolve()) };
    const self = { addEventListener: (type, fn) => (handlers[type] = fn), location: { origin: "https://x.test" } };
    const caches = { open: () => Promise.resolve(cache) };
    // A worker's Request resolves "./" against the worker's own address; Node's has no base, so a stand-in records the call.
    class Request {
      constructor(url, init) {
        Object.assign(this, { url, ...init });
      }
    }
    new Function("self", "caches", "Request", renderWorker(template, ["./", "assets/a.js"], "v1"))(
      self,
      caches,
      Request,
    );
    return { handlers, added };
  }

  it("fetches every file from the server, not the browser's HTTP cache, so a stale page is never kept as the new version", async () => {
    const { handlers, added } = load();
    let done;
    handlers.install({ waitUntil: (promise) => (done = promise) });
    await done;
    expect(added).toHaveLength(2);
    for (const request of added) expect(request.cache).toBe("reload");
  });
});

describe("the worker's fetch step", () => {
  function load(match) {
    const handlers = {};
    const cache = { match };
    const self = { addEventListener: (type, fn) => (handlers[type] = fn), location: { origin: "https://x.test" } };
    const caches = { open: () => Promise.resolve(cache) };
    const fetch = (request) => Promise.resolve(`network:${request.url}`);
    new Function("self", "caches", "fetch", renderWorker(template, [], "v1"))(self, caches, fetch);
    return handlers.fetch;
  }
  const get = (url) => ({ method: "GET", url });
  const answer = (handler, request) => {
    let promise = null;
    handler({ request, respondWith: (p) => (promise = p) });
    return promise;
  };

  it("matches ignoring the query and Vary, so a script requested with an Origin header still finds its cached copy offline", async () => {
    const match = (request, options) =>
      Promise.resolve(options.ignoreSearch && options.ignoreVary ? "cached" : undefined);
    expect(await answer(load(match), get("https://x.test/assets/a.js"))).toBe("cached");
  });

  it("goes to the network for a file that was not kept", async () => {
    expect(
      await answer(
        load(() => Promise.resolve(undefined)),
        get("https://x.test/other.json"),
      ),
    ).toBe("network:https://x.test/other.json");
  });

  it("leaves other origins and other methods alone", () => {
    const handler = load(() => Promise.resolve("cached"));
    expect(answer(handler, get("https://elsewhere.test/a.js"))).toBeNull();
    expect(answer(handler, { method: "POST", url: "https://x.test/a" })).toBeNull();
  });
});
