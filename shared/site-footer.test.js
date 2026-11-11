import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOOTER_LINKS, PAGES, PROFILE_URL, REPO_URL } from "./pages.js";
import { createSiteFooter } from "./site-footer.js";

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "package.json"), "utf8"));
const repoFromPackage = pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");

describe("FOOTER_LINKS", () => {
  it("names the repository in package.json", () => {
    expect(REPO_URL).toBe(repoFromPackage);
  });

  it("gives every link its own id and label", () => {
    expect(new Set(FOOTER_LINKS.map((l) => l.id)).size).toBe(FOOTER_LINKS.length);
    expect(new Set(FOOTER_LINKS.map((l) => l.label)).size).toBe(FOOTER_LINKS.length);
  });

  it("names the owner of the repository as the profile", () => {
    expect(REPO_URL.startsWith(`${PROFILE_URL}/`)).toBe(true);
    expect(FOOTER_LINKS.find((l) => l.id === "profile").href).toBe(PROFILE_URL);
  });

  it("links only to the repository (and its owner's profile), over https, with a title for each", () => {
    for (const link of FOOTER_LINKS.filter((l) => l.id !== "profile")) {
      expect(
        link.href === REPO_URL || link.href.startsWith(`${REPO_URL}/`) || link.href.startsWith(`${REPO_URL}#`),
      ).toBe(true);
      expect(link.href.startsWith("https://")).toBe(true);
      expect(link.title.length).toBeGreaterThan(0);
    }
  });

  it("links the documentation, the source and the issue tracker", () => {
    const ids = FOOTER_LINKS.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["source", "docs", "issues"]));
  });
});

describe("every page has the footer", () => {
  for (const page of PAGES) {
    const file = page.href === "./" ? "index.html" : page.href;
    it(`${file} has an element for it, and apps/${page.id}/main.js draws into it`, () => {
      const root = resolve(import.meta.dirname, "..");
      expect(readFileSync(resolve(root, file), "utf8")).toContain('<footer id="site-footer"></footer>');
      expect(readFileSync(resolve(root, "apps", page.id, "main.js"), "utf8")).toContain(
        'createSiteFooter($("site-footer"))',
      );
    });
  }
});

// A stand-in for the few parts of the DOM the footer touches, recording what it is given.
function fakeElement(tag) {
  return {
    tag,
    className: "",
    textContent: "",
    attributes: {},
    children: [],
    classList: {
      add(name) {
        this.owner.className = `${this.owner.className} ${name}`.trim();
      },
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
  };
}
function fakeDocument() {
  return {
    createElement(tag) {
      const el = fakeElement(tag);
      el.classList.owner = el;
      return el;
    },
  };
}

describe("createSiteFooter", () => {
  afterEach(() => vi.unstubAllGlobals());

  function build() {
    vi.stubGlobal("document", fakeDocument());
    const root = document.createElement("footer");
    createSiteFooter(root);
    const [nav, note] = root.children;
    return { root, nav, note };
  }

  it("marks the footer for its styles and labels the links as a navigation", () => {
    const { root, nav } = build();
    expect(root.className).toBe("site-footer");
    expect(nav.tag).toBe("nav");
    expect(nav.attributes["aria-label"]).toBe("Project links");
  });

  it("draws one link for each entry, in order, with its address, label and title", () => {
    const { nav } = build();
    expect(nav.children.map((a) => [a.href, a.textContent, a.title])).toEqual(
      FOOTER_LINKS.map((l) => [l.href, l.label, l.title]),
    );
  });

  it("opens each link in a new tab without handing the page to it", () => {
    const { nav } = build();
    for (const link of nav.children) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
    }
  });

  it("says that nothing is uploaded", () => {
    expect(build().note.textContent).toContain("nothing uploaded");
  });
});
