import { describe, expect, it, vi } from "vitest";
import { createPadDrawer, moveKeepingFocus } from "./pad-drawer.js";

// The few parts of an element the drawer touches. A click or a key is a call to the listener that was added.
function fakeElement(extra = {}) {
  const listeners = {};
  const attributes = {};
  return {
    hidden: false,
    textContent: "",
    tabIndex: 0,
    focus: vi.fn(),
    setAttribute: (name, value) => (attributes[name] = value),
    getAttribute: (name) => attributes[name],
    addEventListener: (type, fn) => (listeners[type] = fn),
    fire: (type, event = {}) => listeners[type]?.({ defaultPrevented: false, preventDefault: vi.fn(), ...event }),
    ...extra,
  };
}

function setup() {
  const element = fakeElement({ id: "pad-drawer" });
  const toggle = fakeElement();
  const close = fakeElement();
  const title = fakeElement();
  const info = fakeElement();
  const message = fakeElement();
  const onToggle = vi.fn();
  const drawer = createPadDrawer({ element, toggle, close, title, info, message, onToggle });
  return { drawer, element, toggle, close, title, info, message, onToggle };
}

describe("createPadDrawer", () => {
  it("starts closed: hidden, and its button says so and says what it controls", () => {
    const { drawer, element, toggle } = setup();
    expect(drawer.isOpen).toBe(false);
    expect(element.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("pad-drawer");
  });

  it("opens and closes with its button, keeping aria-expanded in step and telling the page", () => {
    const { drawer, element, toggle, onToggle } = setup();
    toggle.fire("click");
    expect(drawer.isOpen).toBe(true);
    expect(element.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(onToggle).toHaveBeenLastCalledWith(true);
    toggle.fire("click");
    expect(drawer.isOpen).toBe(false);
    expect(element.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it("moves focus to its heading when the button opens it, and not when the button closes it", () => {
    const { title, toggle } = setup();
    toggle.fire("click");
    expect(title.focus).toHaveBeenCalledTimes(1);
    toggle.fire("click");
    expect(title.focus).toHaveBeenCalledTimes(1);
  });

  it("makes the heading something focus can be sent to, but not a tab stop", () => {
    const { title } = setup();
    expect(title.tabIndex).toBe(-1);
  });

  it("opens by code without moving focus, as when it is restored at startup", () => {
    const { drawer, title, onToggle } = setup();
    drawer.open();
    expect(drawer.isOpen).toBe(true);
    expect(title.focus).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("closes with its close button and gives focus back to the button that opened it", () => {
    const { drawer, close, toggle } = setup();
    drawer.open();
    close.fire("click");
    expect(drawer.isOpen).toBe(false);
    expect(toggle.focus).toHaveBeenCalled();
  });

  it("closes with Escape from inside it, once, and gives focus back", () => {
    const { drawer, element, toggle } = setup();
    drawer.open();
    const preventDefault = vi.fn();
    element.fire("keydown", { key: "Escape", preventDefault });
    expect(drawer.isOpen).toBe(false);
    expect(preventDefault).toHaveBeenCalled();
    expect(toggle.focus).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys, and an Escape something else has already used", () => {
    const { drawer, element } = setup();
    drawer.open();
    element.fire("keydown", { key: "a" });
    element.fire("keydown", { key: "Escape", defaultPrevented: true });
    expect(drawer.isOpen).toBe(true);
  });

  it("does not report a change that changes nothing", () => {
    const { drawer, onToggle } = setup();
    drawer.close(); // already closed
    drawer.open();
    drawer.open(); // already open
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("writes its heading and sound line only when they changed, since it is redrawn every step", () => {
    const { drawer, title, info } = setup();
    let titleWrites = 0;
    let text = "";
    Object.defineProperty(title, "textContent", {
      get: () => text,
      set: (value) => {
        titleWrites++;
        text = value;
      },
    });
    drawer.refresh({ title: "PAD 01 · Kick", info: "Built-in sound" });
    drawer.refresh({ title: "PAD 01 · Kick", info: "Built-in sound" });
    drawer.refresh({ title: "PAD 02 · Snare", info: "Built-in sound" });
    expect(titleWrites).toBe(2);
    expect(title.textContent).toBe("PAD 02 · Snare");
    expect(info.textContent).toBe("Built-in sound");
  });
});

describe("moveKeepingFocus", () => {
  // The element, its parent and the document, as far as moving needs them. Moving drops the focus, as a browser does.
  function scene({ focusInside }) {
    const inside = { focus: vi.fn() };
    const outside = { focus: vi.fn() };
    const doc = { activeElement: focusInside ? inside : outside };
    const element = { contains: (node) => node === inside };
    const parent = {
      append: vi.fn(() => {
        doc.activeElement = { id: "body" }; // the focus is gone after the move
      }),
    };
    return { inside, outside, doc, element, parent };
  }

  it("moves the element to the end of the new parent", () => {
    const { element, parent, doc } = scene({ focusInside: false });
    moveKeepingFocus(element, parent, doc);
    expect(parent.append).toHaveBeenCalledWith(element);
  });

  it("gives focus back to the control that had it, after the move", () => {
    const { inside, element, parent, doc } = scene({ focusInside: true });
    moveKeepingFocus(element, parent, doc);
    expect(inside.focus).toHaveBeenCalledTimes(1);
    expect(parent.append.mock.invocationCallOrder[0]).toBeLessThan(inside.focus.mock.invocationCallOrder[0]);
  });

  it("leaves focus alone when it was somewhere else", () => {
    const { inside, outside, element, parent, doc } = scene({ focusInside: false });
    moveKeepingFocus(element, parent, doc);
    expect(inside.focus).not.toHaveBeenCalled();
    expect(outside.focus).not.toHaveBeenCalled();
  });
});

describe("the message line", () => {
  it("shows the LCD's message for a moment, and clears it", () => {
    vi.useFakeTimers();
    const { drawer, message } = setup();
    drawer.showMessage("PAD 03 LOADED");
    expect(message.textContent).toBe("PAD 03 LOADED");
    vi.advanceTimersByTime(1599);
    expect(message.textContent).toBe("PAD 03 LOADED");
    vi.advanceTimersByTime(1);
    expect(message.textContent).toBe("");
    vi.useRealTimers();
  });

  it("restarts the time when another message comes, and does nothing without a line to show it in", () => {
    vi.useFakeTimers();
    const { drawer, message } = setup();
    drawer.showMessage("ONE");
    vi.advanceTimersByTime(1000);
    drawer.showMessage("TWO");
    vi.advanceTimersByTime(1000);
    expect(message.textContent).toBe("TWO");
    vi.useRealTimers();
    const bare = createPadDrawer({
      element: fakeElement({ id: "d" }),
      toggle: fakeElement(),
      close: fakeElement(),
      title: fakeElement(),
      info: fakeElement(),
    });
    expect(() => bare.showMessage("X")).not.toThrow();
  });
});
