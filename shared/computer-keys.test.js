import { describe, expect, it, vi } from "vitest";
import { createComputerKeys } from "./computer-keys.js";

function setup({ base = 48, ignore } = {}) {
  const target = new EventTarget();
  const onNoteOn = vi.fn();
  const onNoteOff = vi.fn();
  let currentBase = base;
  const keys = createComputerKeys({ target, getBase: () => currentBase, onNoteOn, onNoteOff, ignore });
  const send = (type, key, extra = {}) => {
    const event = Object.assign(new Event(type), { key, code: `Key${key.toUpperCase()}`, repeat: false, ...extra });
    target.dispatchEvent(event);
  };
  return { keys, send, onNoteOn, onNoteOff, setBase: (value) => (currentBase = value) };
}

describe("createComputerKeys", () => {
  it("plays the octave above the piano's lowest note, C to C", () => {
    const { send, onNoteOn } = setup({ base: 48 });
    send("keydown", "a");
    send("keydown", "k");
    expect(onNoteOn.mock.calls).toEqual([[60], [72]]);
  });

  it("ignores keys that are not piano keys, held modifiers and auto-repeat", () => {
    const { send, onNoteOn } = setup();
    send("keydown", "q");
    send("keydown", "a", { ctrlKey: true });
    send("keydown", "a", { metaKey: true });
    send("keydown", "a", { altKey: true });
    send("keydown", "a", { repeat: true });
    expect(onNoteOn).not.toHaveBeenCalled();
  });

  it("plays a held key once", () => {
    const { send, onNoteOn } = setup();
    send("keydown", "a");
    send("keydown", "a");
    expect(onNoteOn).toHaveBeenCalledTimes(1);
  });

  it("ends the note it started, even if the piano scrolled meanwhile", () => {
    const { send, onNoteOff, setBase } = setup({ base: 48 });
    send("keydown", "a");
    setBase(24);
    send("keyup", "a");
    expect(onNoteOff).toHaveBeenCalledWith(60);
  });

  it("ignores the release of a key it never saw go down", () => {
    const { send, onNoteOff } = setup();
    send("keyup", "a");
    expect(onNoteOff).not.toHaveBeenCalled();
  });

  it("can press a key again after reset, without having seen its keyup", () => {
    const { keys, send, onNoteOn } = setup();
    send("keydown", "a");
    keys.reset();
    send("keydown", "a");
    expect(onNoteOn).toHaveBeenCalledTimes(2);
  });

  it("skips a key the page says is not for the piano, such as one typed into a menu", () => {
    const { send, onNoteOn } = setup({ ignore: (e) => e.inMenu });
    send("keydown", "a", { inMenu: true });
    expect(onNoteOn).not.toHaveBeenCalled();
    send("keydown", "a");
    expect(onNoteOn).toHaveBeenCalledWith(60);
  });
});
