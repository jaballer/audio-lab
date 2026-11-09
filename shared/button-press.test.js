import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A pressed button drops 2px and its bottom edge gets thinner, so the face sinks and the foot stays put.
// The thinner edge is a thinner box, and a box that changes height moves whatever is sized around it (the
// transport grid, the pad panel, a centred dialog): the page jumped on a press. This pins the rule that
// keeps the press a paint-only change: whatever the edge gives up, the margin takes up. Layout cannot be run
// here, so this checks the stylesheet's numbers.

// Comments out, so a note above a rule does not hide it from the selector match.
const read = (path) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const baseCss = read("shared/base.css");
// Every stylesheet the pages use.
const stylesheets = ["shared", "apps/sampler", "apps/keys", "apps/mpc-sample", "apps/monitor", "apps/tone-demo"]
  .filter((folder) => existsSync(resolve(import.meta.dirname, "..", folder)))
  .flatMap((folder) =>
    readdirSync(resolve(import.meta.dirname, "..", folder))
      .filter((file) => file.endsWith(".css"))
      .map((file) => read(`${folder}/${file}`)),
  );

// The declarations of the rule with exactly this selector.
function declarations(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) return null;
  return Object.fromEntries(
    match[1]
      .split(";")
      .map((line) => line.split(/:(.*)/s).map((part) => part.trim()))
      .filter(([name, value]) => name && value),
  );
}

const px = (value) => Number.parseFloat(value);

describe("the pressed button", () => {
  const rest = declarations(baseCss, ".btn");
  const pressed = declarations(baseCss, ".btn:active:not(:disabled)");

  it("has a rule that leaves disabled buttons where they are", () => {
    expect(pressed).not.toBeNull();
  });

  it("keeps its outer height: the thinner bottom edge is given back as margin", () => {
    const edgeLost = px(rest["border-bottom-width"]) - px(pressed["border-bottom-width"]);
    expect(edgeLost).toBeGreaterThan(0);
    expect(px(pressed["margin-bottom"])).toBe(edgeLost);
  });

  it("drops as far as the edge gives up, so the foot of the button stays where it was", () => {
    const edgeLost = px(rest["border-bottom-width"]) - px(pressed["border-bottom-width"]);
    expect(pressed.transform).toBe(`translateY(${edgeLost}px)`);
  });

  it("rests at one bottom edge for every size, so the press always gives back what it takes", () => {
    // `.btn-small` used to set its own 3px, which `.btn` (later in the file) overrode: reorder the two and a
    // small button would rest at 3px, lose only 1px when pressed and get 2px of margin back.
    expect(declarations(baseCss, ".btn-small")["border-bottom-width"]).toBeUndefined();
  });

  it("is not undone for a disabled button by a second rule in any stylesheet", () => {
    for (const css of stylesheets) expect(css).not.toMatch(/:disabled:active|:active:disabled/);
  });
});
