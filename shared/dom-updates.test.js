import { describe, expect, it, vi } from "vitest";
import { setAttr, setDisabled, setDisabledMany, setHidden, setText } from "./dom-updates.js";

// The parts of an element these helpers touch, with a count of every write so that "only what changed" can be seen.
function fakeElement(initial = {}) {
  const writes = { text: 0, attr: 0, disabled: 0, hidden: 0 };
  const attrs = { ...initial.attrs };
  let text = initial.text ?? "";
  let disabled = initial.disabled ?? false;
  let hidden = initial.hidden ?? false;
  return {
    writes,
    focus: vi.fn(),
    contains: (node) => (initial.children ?? []).includes(node),
    get textContent() {
      return text;
    },
    set textContent(value) {
      writes.text++;
      text = value;
    },
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute: (name, value) => {
      writes.attr++;
      attrs[name] = value;
    },
    get disabled() {
      return disabled;
    },
    set disabled(value) {
      writes.disabled++;
      disabled = value;
    },
    get hidden() {
      return hidden;
    },
    set hidden(value) {
      writes.hidden++;
      hidden = value;
    },
  };
}

describe("setText", () => {
  it("writes the text when it is different, and not when it is the same", () => {
    const el = fakeElement({ text: "Bar 1 of 2" });
    setText(el, "Bar 1 of 2");
    expect(el.writes.text).toBe(0);
    setText(el, "Bar 2 of 2");
    expect(el.writes.text).toBe(1);
    expect(el.textContent).toBe("Bar 2 of 2");
  });
});

describe("setAttr", () => {
  it("sets an attribute that is different or missing, and leaves one that is already right", () => {
    const el = fakeElement({ attrs: { "aria-pressed": "true" } });
    setAttr(el, "aria-pressed", "true");
    expect(el.writes.attr).toBe(0);
    setAttr(el, "aria-pressed", "false");
    setAttr(el, "aria-label", "Kick step 1");
    expect(el.writes.attr).toBe(2);
    expect(el.getAttribute("aria-label")).toBe("Kick step 1");
  });
});

describe("setDisabled", () => {
  it("hands focus to the fallback before it disables the control that has it", () => {
    const button = fakeElement();
    const fallback = fakeElement();
    setDisabled(button, true, fallback, { activeElement: button });
    expect(fallback.focus).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
  });

  it("leaves focus alone when it was somewhere else, or the control is being enabled", () => {
    const button = fakeElement();
    const other = fakeElement();
    const fallback = fakeElement();
    setDisabled(button, true, fallback, { activeElement: other });
    setDisabled(button, false, fallback, { activeElement: button });
    expect(fallback.focus).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });

  it("does not hand focus to a fallback that is disabled itself, which could not take it", () => {
    const button = fakeElement();
    const fallback = fakeElement({ disabled: true });
    setDisabled(button, true, fallback, { activeElement: button });
    expect(fallback.focus).not.toHaveBeenCalled();
  });

  it("copes with no fallback", () => {
    const button = fakeElement();
    expect(() => setDisabled(button, true, null, { activeElement: button })).not.toThrow();
    expect(button.disabled).toBe(true);
  });

  it("writes only when the state changes", () => {
    const button = fakeElement({ disabled: true });
    setDisabled(button, true, null, { activeElement: null });
    expect(button.writes.disabled).toBe(0);
  });
});

describe("setHidden", () => {
  it("hands focus to the fallback when focus is on something inside the group it hides", () => {
    const inner = fakeElement();
    const group = fakeElement({ children: [inner] });
    const fallback = fakeElement();
    setHidden(group, true, fallback, { activeElement: inner });
    expect(fallback.focus).toHaveBeenCalledTimes(1);
    expect(group.hidden).toBe(true);
  });

  it("leaves focus alone when it is outside the group, or the group is being shown", () => {
    const inner = fakeElement();
    const group = fakeElement({ children: [inner] });
    const fallback = fakeElement();
    setHidden(group, true, fallback, { activeElement: fakeElement() });
    setHidden(group, false, fallback, { activeElement: inner });
    expect(fallback.focus).not.toHaveBeenCalled();
    expect(group.hidden).toBe(false);
  });

  it("writes only when the state changes", () => {
    const group = fakeElement({ hidden: true });
    setHidden(group, true, null, { activeElement: null });
    expect(group.writes.hidden).toBe(0);
  });
});

describe("a list of fallbacks", () => {
  it("hands focus to the first one that is not disabled", () => {
    const button = fakeElement();
    const off = fakeElement({ disabled: true });
    const first = fakeElement();
    const second = fakeElement();
    setDisabled(button, true, [null, off, first, second], { activeElement: button });
    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(second.focus).not.toHaveBeenCalled();
  });

  it("does not hand focus back to the control itself", () => {
    const button = fakeElement();
    const other = fakeElement();
    setDisabled(button, true, [button, other], { activeElement: button });
    expect(other.focus).toHaveBeenCalledTimes(1);
    expect(button.focus).not.toHaveBeenCalled();
  });
});

describe("setDisabledMany", () => {
  it("lets a control that is being disabled hand its focus to one that is being enabled in the same update", () => {
    const undo = fakeElement({ disabled: false });
    const redo = fakeElement({ disabled: true });
    setDisabledMany(
      [
        [undo, true, redo],
        [redo, false, undo],
      ],
      { activeElement: undo },
    );
    expect(redo.focus).toHaveBeenCalledTimes(1);
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(false);
  });

  it("disables with no fallback available when every control goes", () => {
    const a = fakeElement();
    const b = fakeElement();
    expect(() =>
      setDisabledMany(
        [
          [a, true, b],
          [b, true, a],
        ],
        { activeElement: a },
      ),
    ).not.toThrow();
    expect(a.disabled && b.disabled).toBe(true);
  });
});
