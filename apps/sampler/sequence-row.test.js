import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSequenceRow, sequenceKey, sequenceKeys } from "./sequence-row.js";

describe("sequenceKeys", () => {
  it("gives a key for each sequence, numbered from 1", () => {
    expect(sequenceKeys(3, 0).map((key) => key.label)).toEqual(["1", "2", "3"]);
    expect(sequenceKeys(3, 0).map((key) => key.index)).toEqual([0, 1, 2]);
  });

  it("names each for a screen reader, since a number alone says little out of its row", () => {
    expect(sequenceKeys(2, 0).map((key) => key.name)).toEqual(["Sequence 1", "Sequence 2"]);
  });

  it("presses in the one that is showing, and only that one", () => {
    expect(sequenceKeys(4, 2).map((key) => key.pressed)).toEqual([false, false, true, false]);
    expect(sequenceKeys(4, 0).map((key) => key.pressed)).toEqual([true, false, false, false]);
  });

  it("presses none in when the sequence showing is not one of them", () => {
    expect(sequenceKeys(3, 5).some((key) => key.pressed)).toBe(false);
    expect(sequenceKeys(3, -1).some((key) => key.pressed)).toBe(false);
  });

  it("is empty for no sequences", () => {
    expect(sequenceKeys(0, 0)).toEqual([]);
  });

  it("has one key for a beat of one sequence, pressed in", () => {
    expect(sequenceKeys(1, 0)).toEqual([{ index: 0, label: "1", name: "Sequence 1", pressed: true }]);
  });

  it("is made of the same keys the view puts on the page", () => {
    expect(sequenceKeys(3, 1)[2]).toMatchObject(sequenceKey(2));
  });
});

// Just enough of a page for the view: elements that remember their attributes and children, and a document that knows which
// one has focus (the helpers that hand focus on look at it).
class FakeElement {
  constructor(document) {
    this.document = document;
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.disabled = false;
    this.textContent = "";
    this.className = "";
    this.parent = null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }

  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }

  click() {
    if (!this.disabled) for (const handler of this.listeners.click ?? []) handler();
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  focus() {
    this.document.activeElement = this;
  }

  contains(other) {
    return other === this || this.children.some((child) => child.contains(other));
  }
}

describe("createSequenceRow", () => {
  let document;
  let calls;
  let row;
  let element;

  const keys = () => element.children[1].children;
  const [ADD, COPY, REMOVE] = [0, 1, 2];
  const actions = () => element.children[2].children;
  const pressed = () => keys().map((key) => key.getAttribute("aria-pressed") === "true");
  const refresh = (change = {}) => row.refresh({ count: 3, current: 1, canAdd: true, canRemove: true, ...change });

  beforeEach(() => {
    document = { activeElement: null };
    document.createElement = () => new FakeElement(document);
    vi.stubGlobal("document", document);
    calls = { onSelect: vi.fn(), onAdd: vi.fn(), onCopy: vi.fn(), onRemove: vi.fn() };
    element = new FakeElement(document);
    row = createSequenceRow(element, calls);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("makes a key for each sequence, numbered and named, and presses in the one showing", () => {
    refresh({ count: 3, current: 1 });
    expect(keys().map((key) => key.textContent)).toEqual(["1", "2", "3"]);
    expect(keys().map((key) => key.getAttribute("aria-label"))).toEqual(["Sequence 1", "Sequence 2", "Sequence 3"]);
    expect(pressed()).toEqual([false, true, false]);
  });

  it("makes more keys as there are more sequences and lets go of them as there are fewer", () => {
    refresh({ count: 3 });
    const first = keys()[0];
    refresh({ count: 6, current: 5 });
    expect(keys()).toHaveLength(6);
    expect(keys()[0]).toBe(first); // the keys that were there stay
    expect(pressed()).toEqual([false, false, false, false, false, true]);
    refresh({ count: 2, current: 0 });
    expect(keys()).toHaveLength(2);
    expect(pressed()).toEqual([true, false]);
  });

  it("moves the pressed key when the sequence showing changes", () => {
    refresh({ current: 0 });
    refresh({ current: 2 });
    expect(pressed()).toEqual([false, false, true]);
  });

  it("reports the key that was pressed, counting from 0, and each of the buttons", () => {
    refresh({ count: 4 });
    keys()[2].click();
    expect(calls.onSelect).toHaveBeenCalledWith(2);
    actions()[ADD].click();
    actions()[COPY].click();
    actions()[REMOVE].click();
    expect([calls.onAdd, calls.onCopy, calls.onRemove].map((call) => call.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("reports a key made after the first draw as well, and by its own number", () => {
    refresh({ count: 2 });
    refresh({ count: 5 });
    keys()[4].click();
    expect(calls.onSelect).toHaveBeenCalledWith(4);
  });

  it("turns Add and Copy off when there is no room, Remove off when there is one sequence, and says why", () => {
    refresh({ canAdd: false, canRemove: false });
    expect(actions().map((button) => button.disabled)).toEqual([true, true, true]);
    expect(actions()[ADD].getAttribute("title")).toMatch(/no room/i);
    expect(actions()[REMOVE].getAttribute("title")).toMatch(/at least one/i);
    refresh({ canAdd: true, canRemove: true });
    expect(actions().map((button) => button.disabled)).toEqual([false, false, false]);
  });

  it("gives an enabled button no title, which would only repeat the name that is read out", () => {
    refresh();
    expect(actions().map((button) => button.getAttribute("title"))).toEqual(["", "", ""]);
  });

  it("hands focus to the key showing when Add goes off while it has focus", () => {
    refresh({ count: 7, current: 6 });
    actions()[ADD].focus();
    refresh({ count: 8, current: 7, canAdd: false });
    expect(document.activeElement).toBe(keys()[7]);
  });

  it("hands focus to the key showing when Copy goes off while it has focus", () => {
    refresh({ count: 7, current: 6 });
    actions()[COPY].focus();
    refresh({ count: 8, current: 7, canAdd: false });
    expect(document.activeElement).toBe(keys()[7]);
  });

  it("hands focus to the key showing, and not to Add, when Remove goes off while it has focus", () => {
    refresh({ count: 2, current: 0 });
    actions()[REMOVE].focus();
    refresh({ count: 1, current: 0, canRemove: false });
    expect(document.activeElement).toBe(keys()[0]); // a key held down on Remove must not turn into one held down on Add
  });

  it("leaves focus where it is when a button it is not on goes off", () => {
    refresh({ count: 2, current: 0 });
    const onKey = keys()[0];
    onKey.focus();
    refresh({ count: 2, current: 0, canRemove: false });
    expect(document.activeElement).toBe(onKey);
  });

  it("is a group of its own, with groups inside it for the keys and for the buttons", () => {
    expect(element.getAttribute("role")).toBe("group");
    expect(element.getAttribute("aria-label")).toBe("Sequences");
    expect(element.children[1].getAttribute("aria-label")).toBe("Choose a sequence");
    expect(element.children[2].getAttribute("aria-label")).toBe("Add, copy or remove a sequence");
  });
});
