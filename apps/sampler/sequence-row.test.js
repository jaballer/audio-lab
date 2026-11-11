import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSequenceRow, latchFromStored, pressIsNow, sequenceKey, sequenceKeys } from "./sequence-row.js";

describe("pressIsNow", () => {
  it("is a press that waits for the end of the pass when the latch is on, and Shift switches at once", () => {
    expect(pressIsNow({ latched: true, shift: false })).toBe(false);
    expect(pressIsNow({ latched: true, shift: true })).toBe(true);
  });

  it("is a press that switches at once when the latch is off, and Shift waits for the end of the pass", () => {
    expect(pressIsNow({ latched: false, shift: false })).toBe(true);
    expect(pressIsNow({ latched: false, shift: true })).toBe(false);
  });
});

describe("latchFromStored", () => {
  it("is on for a first visit, and for storage that is blocked, so a person who has not chosen has the way #163 works", () => {
    expect(latchFromStored(undefined)).toBe(true);
    expect(latchFromStored(null)).toBe(true);
  });

  it("is off only for a stored false, and keeps what was stored on", () => {
    expect(latchFromStored(false)).toBe(false);
    expect(latchFromStored(true)).toBe(true);
  });

  it("is on for anything else that was stored, which a person did not put there", () => {
    for (const odd of ["false", "yes", 0, 1, "", {}, [], "garbage{"]) expect(latchFromStored(odd)).toBe(true);
  });
});

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
    expect(sequenceKeys(1, 0)).toEqual([
      { index: 0, label: "1", name: "Sequence 1", pressed: true, queued: false, title: "" },
    ]);
  });

  it("marks the sequence that plays next, and says so in its name", () => {
    const keys = sequenceKeys(3, 0, { queued: 2 });
    expect(keys.map((key) => key.queued)).toEqual([false, false, true]);
    expect(keys.map((key) => key.name)).toEqual(["Sequence 1", "Sequence 2", "Sequence 3, plays next"]);
  });

  it("marks none when nothing is queued, or the one queued is not one of them", () => {
    expect(sequenceKeys(3, 0).some((key) => key.queued)).toBe(false);
    expect(sequenceKeys(3, 0, { queued: -1 }).some((key) => key.queued)).toBe(false);
    expect(sequenceKeys(3, 0, { queued: 7 }).some((key) => key.queued)).toBe(false);
  });

  it("says what a press does with the latch off: it switches at once, and Shift is what waits", () => {
    const keys = sequenceKeys(3, 0, { playing: true, queued: 2, latched: false });
    expect(keys[1].title).toBe("Press to switch now. Hold Shift to play next, after this pass");
    expect(keys[2].title).toBe("Press to switch to it now. Hold Shift, or press the sequence showing, to take it back");
    expect(keys[0].title).toBe("Press to take back the sequence that plays next"); // the same as with the latch on: a press on it cancels
  });

  it("says nothing while stopped, whichever way the latch is", () => {
    expect(sequenceKeys(3, 0, { latched: false }).map((key) => key.title)).toEqual(["", "", ""]);
  });

  it("explains what a press does only while the beat plays, when it queues instead of switching", () => {
    expect(sequenceKeys(3, 0).map((key) => key.title)).toEqual(["", "", ""]);
    const [showing, other] = sequenceKeys(3, 0, { playing: true });
    expect(showing.title).toBe("");
    // An instruction: read after "Sequence 2, not pressed" as a description, "plays next" would say it is already queued.
    expect(other.title).toBe("Press to play next, after this pass. Hold Shift to switch now");
  });

  it("says the queued key's press takes it back, and so does the one showing while one is queued", () => {
    const keys = sequenceKeys(3, 0, { playing: true, queued: 2 });
    // The key's name already says "plays next": the title does not say it a second time, only what a press does.
    expect(keys[2].title).toBe("Press again to take it back");
    expect(keys[0].title).toBe("Press to take back the sequence that plays next");
    expect(keys[1].title).toMatch(/shift/i); // another key still queues instead, and can still be switched to
  });

  it("takes back through the key showing when the one queued is the first, which is not the one showing", () => {
    const keys = sequenceKeys(3, 1, { playing: true, queued: 0 });
    expect(keys[0].queued).toBe(true);
    expect(keys[1].title).toBe("Press to take back the sequence that plays next");
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
    this.writes = 0; // setAttribute calls, since a page that redraws every step must not rewrite what has not changed
    this.textContent = "";
    this.className = "";
    this.parent = null;
  }

  setAttribute(name, value) {
    this.writes++;
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }

  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }

  click(event = {}) {
    if (!this.disabled) for (const handler of this.listeners.click ?? []) handler(event);
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
  const [LATCH, ADD, COPY, REMOVE] = [0, 1, 2, 3];
  const actions = () => element.children[2].children;
  const pressed = () => keys().map((key) => key.getAttribute("aria-pressed") === "true");
  const refresh = (change = {}) => row.refresh({ count: 3, current: 1, canAdd: true, canRemove: true, ...change });

  beforeEach(() => {
    document = { activeElement: null };
    document.createElement = () => new FakeElement(document);
    vi.stubGlobal("document", document);
    calls = { onSelect: vi.fn(), onAdd: vi.fn(), onCopy: vi.fn(), onRemove: vi.fn(), onLatch: vi.fn() };
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
    expect(calls.onSelect).toHaveBeenCalledWith(2, { now: false });
    actions()[ADD].click();
    actions()[COPY].click();
    actions()[REMOVE].click();
    expect([calls.onAdd, calls.onCopy, calls.onRemove].map((call) => call.mock.calls.length)).toEqual([1, 1, 1]);
    expect(calls.onLatch).not.toHaveBeenCalled();
  });

  it("reports a key made after the first draw as well, and by its own number", () => {
    refresh({ count: 2 });
    refresh({ count: 5 });
    keys()[4].click();
    expect(calls.onSelect).toHaveBeenCalledWith(4, { now: false });
  });

  it("makes a key for the latch, on by default and named, pressed in while a press waits for the end of the pass", () => {
    refresh();
    const latch = actions()[LATCH];
    expect(latch.textContent).toBe("Next");
    expect(latch.getAttribute("aria-label")).toBe("Next: queue sequence presses"); // starts with the "Next" it shows
    expect(latch.className).toContain("seq-latch"); // the style hook for its pressed look, in sampler.css
    expect(latch.getAttribute("aria-pressed")).toBe("true");
    refresh({ latched: false });
    expect(latch.getAttribute("aria-pressed")).toBe("false");
  });

  it("describes the latch by what it is doing now, in both states, and does not say it differently in between", () => {
    refresh({ latched: true });
    expect(actions()[LATCH].getAttribute("title")).toBe(
      "On: while the beat plays, a press on a sequence waits for the end of the pass (Shift: at once)",
    );
    refresh({ latched: false });
    expect(actions()[LATCH].getAttribute("title")).toBe(
      "Off: while the beat plays, a press on a sequence switches at once (Shift: waits for the end of the pass)",
    );
  });

  it("reports the latch as the other way round from how it is", () => {
    refresh({ latched: true });
    actions()[LATCH].click();
    expect(calls.onLatch).toHaveBeenLastCalledWith(false);
    refresh({ latched: false });
    actions()[LATCH].click();
    expect(calls.onLatch).toHaveBeenLastCalledWith(true);
  });

  it("reports a press as switching now when the latch is off, and as waiting when Shift is held with it off", () => {
    refresh({ count: 3, latched: false });
    keys()[1].click();
    expect(calls.onSelect).toHaveBeenLastCalledWith(1, { now: true });
    keys()[1].click({ shiftKey: true });
    expect(calls.onSelect).toHaveBeenLastCalledWith(1, { now: false });
  });

  it("reads a press on a key made after the latch was turned off by the latch it has now, as the keys already there do", () => {
    refresh({ count: 2, latched: false });
    refresh({ count: 4, latched: false });
    keys()[3].click();
    expect(calls.onSelect).toHaveBeenLastCalledWith(3, { now: true });
    keys()[0].click();
    expect(calls.onSelect).toHaveBeenLastCalledWith(0, { now: true });
  });

  it("gives the keys their titles for the latch it has", () => {
    refresh({ count: 3, current: 0, playing: true, latched: false });
    expect(keys()[1].getAttribute("title")).toBe("Press to switch now. Hold Shift to play next, after this pass");
    refresh({ count: 3, current: 0, playing: true, latched: true });
    expect(keys()[1].getAttribute("title")).toBe("Press to play next, after this pass. Hold Shift to switch now");
  });

  it("says the press is to switch now when Shift is held", () => {
    refresh({ count: 3 });
    keys()[1].click({ shiftKey: true });
    expect(calls.onSelect).toHaveBeenCalledWith(1, { now: true });
  });

  it("marks the key that plays next, names it so, and takes the mark off when the queue goes", () => {
    refresh({ count: 3, current: 0, queued: 2 });
    expect(keys().map((key) => key.getAttribute("data-queued"))).toEqual(["false", "false", "true"]);
    expect(keys()[2].getAttribute("aria-label")).toBe("Sequence 3, plays next");
    refresh({ count: 3, current: 0, queued: -1 });
    expect(keys().map((key) => key.getAttribute("data-queued"))).toEqual(["false", "false", "false"]);
    expect(keys()[2].getAttribute("aria-label")).toBe("Sequence 3");
  });

  it("moves the mark when another sequence is queued", () => {
    refresh({ count: 3, queued: 1 });
    refresh({ count: 3, queued: 2 });
    expect(keys().map((key) => key.getAttribute("data-queued"))).toEqual(["false", "false", "true"]);
  });

  it("gives each key a title while playing, and none when stopped", () => {
    refresh({ count: 3, current: 0, playing: true });
    expect(keys()[1].getAttribute("title")).toMatch(/shift/i);
    expect(keys()[0].getAttribute("title")).toBe("");
    refresh({ count: 3, current: 0, playing: false });
    expect(keys().map((key) => key.getAttribute("title"))).toEqual(["", "", ""]);
  });

  it("is not out of step with a key made after the first draw: it has its mark and title as well", () => {
    refresh({ count: 2, queued: -1 });
    refresh({ count: 4, current: 0, queued: 3, playing: true });
    expect(keys()[3].getAttribute("data-queued")).toBe("true");
    expect(keys()[3].getAttribute("title")).toMatch(/again/i);
  });

  it("has no title for a refresh that says nothing about playing, which is the beat being stopped", () => {
    row.refresh({ count: 3, current: 0, canAdd: true, canRemove: true });
    expect(keys().map((key) => key.getAttribute("title"))).toEqual(["", "", ""]);
  });

  it("writes nothing to a key when a refresh changes nothing: the page redraws every step, and a screen reader hears a rewrite", () => {
    refresh({ count: 4, current: 1, queued: 3, playing: true });
    const writes = () =>
      [...element.children[1].children, ...element.children[2].children].reduce((sum, key) => sum + key.writes, 0);
    const before = writes();
    refresh({ count: 4, current: 1, queued: 3, playing: true });
    refresh({ count: 4, current: 1, queued: 3, playing: true });
    expect(writes()).toBe(before);
    refresh({ count: 4, current: 1, queued: 2, playing: true });
    expect(writes()).toBeGreaterThan(before); // and it does write when something has
  });

  it("turns Add and Copy off when there is no room, Remove off when there is one sequence, and says why", () => {
    refresh({ canAdd: false, canRemove: false });
    expect(actions().map((button) => button.disabled)).toEqual([false, true, true, true]); // the latch is always there to press
    expect(actions()[ADD].getAttribute("title")).toMatch(/no room/i);
    expect(actions()[REMOVE].getAttribute("title")).toMatch(/at least one/i);
    refresh({ canAdd: true, canRemove: true });
    expect(actions().map((button) => button.disabled)).toEqual([false, false, false, false]);
  });

  it("gives an enabled button no title, which would only repeat the name that is read out", () => {
    refresh();
    expect(
      actions()
        .slice(1)
        .map((button) => button.getAttribute("title")),
    ).toEqual(["", "", ""]);
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
    expect(element.children[2].getAttribute("aria-label")).toBe("Sequence tools");
  });
});
