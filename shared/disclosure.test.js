import { describe, expect, it, vi } from "vitest";
import { createDisclosure } from "./disclosure.js";

// The few parts of an element it touches. A click is a call to the listener that was added.
function fakeElement(extra = {}) {
  const listeners = {};
  const attributes = {};
  return {
    hidden: false,
    focus: vi.fn(),
    contains: (node) => (extra.children ?? []).includes(node),
    setAttribute: (name, value) => (attributes[name] = value),
    getAttribute: (name) => attributes[name] ?? null,
    addEventListener: (type, fn) => (listeners[type] = fn),
    click: () => listeners.click?.(),
    ...extra,
  };
}

function setup({ open, doc = { activeElement: null }, children } = {}) {
  const toggle = fakeElement();
  const controls = fakeElement({ id: "step-controls", children });
  const body = fakeElement({ id: "step-body" });
  const onToggle = vi.fn();
  const panel = createDisclosure({ toggle, regions: [controls, body], open, onToggle, doc });
  return { panel, toggle, controls, body, onToggle };
}

describe("createDisclosure", () => {
  it("starts open by default: the button says so and what it controls, and nothing is hidden", () => {
    const { panel, toggle, controls, body } = setup();
    expect(panel.isOpen).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe("step-controls step-body");
    expect(controls.hidden).toBe(false);
    expect(body.hidden).toBe(false);
  });

  it("can start closed, with the regions hidden, without telling the page", () => {
    const { panel, toggle, controls, body, onToggle } = setup({ open: false });
    expect(panel.isOpen).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(controls.hidden).toBe(true);
    expect(body.hidden).toBe(true);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("closes and opens with its button, keeping aria-expanded and the regions in step, and tells the page", () => {
    const { panel, toggle, controls, body, onToggle } = setup();
    toggle.click();
    expect(panel.isOpen).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(controls.hidden).toBe(true);
    expect(body.hidden).toBe(true);
    expect(onToggle).toHaveBeenLastCalledWith(false);
    toggle.click();
    expect(panel.isOpen).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body.hidden).toBe(false);
    expect(onToggle).toHaveBeenLastCalledWith(true);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("opens, closes and toggles by code, and says nothing when it is already so", () => {
    const { panel, onToggle } = setup();
    panel.open();
    expect(onToggle).not.toHaveBeenCalled();
    panel.close();
    panel.close();
    expect(onToggle).toHaveBeenCalledTimes(1);
    panel.toggle();
    expect(panel.isOpen).toBe(true);
  });

  it("hands focus to the button when it hides the region that has it", () => {
    const inside = fakeElement();
    const { panel, toggle } = setup({ doc: { activeElement: inside }, children: [inside] });
    panel.close();
    expect(toggle.focus).toHaveBeenCalledTimes(1);
  });

  it("leaves focus alone when it is somewhere else", () => {
    const { panel, toggle } = setup({ doc: { activeElement: fakeElement() } });
    panel.close();
    expect(toggle.focus).not.toHaveBeenCalled();
  });

  it("leaves out an id a region does not have", () => {
    const toggle = fakeElement();
    createDisclosure({ toggle, regions: [fakeElement({ id: "a" }), fakeElement()], doc: { activeElement: null } });
    expect(toggle.getAttribute("aria-controls")).toBe("a");
  });
});
