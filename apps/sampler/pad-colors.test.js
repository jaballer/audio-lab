import { describe, expect, it } from "vitest";
import { COLOR_COUNT, PAD_COLORS, padColorCss, padColorName } from "./pad-colors.js";

// WCAG relative luminance and contrast ratio of two "#rrggbb" colours.
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const distance = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

const PAD_FACE = "#45454a"; // the lightest part of a pad's face (sampler.css), so the worst case for a colour on it
const SELECTION_RING = "#ff8c3c"; // the orange ring that marks the selected pad
const HIT_LIGHT = "#ff3b2f"; // the red a hit lights a pad with

describe("PAD_COLORS", () => {
  it("starts with none, then the colours, each with a name for a screen reader", () => {
    expect(PAD_COLORS[0]).toMatchObject({ id: "none", css: null });
    expect(COLOR_COUNT).toBe(PAD_COLORS.length - 1);
    for (const colour of PAD_COLORS.slice(1)) {
      expect(colour.name).toMatch(/^[A-Z][a-z]+$/);
      expect(colour.css).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(new Set(PAD_COLORS.map((c) => c.id)).size).toBe(PAD_COLORS.length);
    expect(new Set(PAD_COLORS.map((c) => c.name)).size).toBe(PAD_COLORS.length);
  });

  it("has colours that can be seen against a pad's face: at least 3:1", () => {
    for (const { name, css } of PAD_COLORS.slice(1)) expect(contrast(css, PAD_FACE), name).toBeGreaterThanOrEqual(3);
  });

  it("has colours that cannot be mistaken for the selection ring or the hit light", () => {
    for (const { name, css } of PAD_COLORS.slice(1)) {
      expect(distance(css, SELECTION_RING), `${name} against the selection ring`).toBeGreaterThan(80);
      expect(distance(css, HIT_LIGHT), `${name} against the hit light`).toBeGreaterThan(120);
    }
  });

  it("has colours that are different from each other", () => {
    const colours = PAD_COLORS.slice(1);
    for (let i = 0; i < colours.length; i++)
      for (let j = i + 1; j < colours.length; j++)
        expect(distance(colours[i].css, colours[j].css), `${colours[i].name} and ${colours[j].name}`).toBeGreaterThan(
          40,
        );
  });
});

describe("padColorName and padColorCss", () => {
  it("name and give the colour of a swatch, and are none for anything else", () => {
    expect(padColorName(0)).toBe("None");
    expect(padColorName(5)).toBe(PAD_COLORS[5].name);
    expect(padColorCss(5)).toBe(PAD_COLORS[5].css);
    expect(padColorCss(0)).toBeNull();
    expect(padColorName(99)).toBe("None");
    expect(padColorCss(-1)).toBeNull();
    expect(padColorCss(undefined)).toBeNull();
  });
});
