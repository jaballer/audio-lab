import { describe, expect, it, vi } from "vitest";
import { createKit } from "./kit.js";

const sound = (id) => ({ id, name: id, play: vi.fn() });
const defaults = [sound("kick"), sound("snare"), sound("hat")];

describe("createKit", () => {
  it("starts with the built-in sounds, one per pad", () => {
    const kit = createKit(defaults);
    expect(kit.length).toBe(3);
    expect(kit.get(1)).toBe(defaults[1]);
    expect(kit.isDefault(1)).toBe(true);
  });

  it("plays another sound on a pad once it is set, and tells the views", () => {
    const onChange = vi.fn();
    const kit = createKit(defaults, { onChange });
    const loaded = sound("loaded");
    kit.set(2, loaded);
    expect(kit.get(2)).toBe(loaded);
    expect(kit.get(0)).toBe(defaults[0]);
    expect(kit.isDefault(2)).toBe(false);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("puts the built-in sound back", () => {
    const kit = createKit(defaults);
    kit.set(0, sound("loaded"));
    kit.reset(0);
    expect(kit.get(0)).toBe(defaults[0]);
    expect(kit.isDefault(0)).toBe(true);
  });

  it("does not report a change that changes nothing", () => {
    const onChange = vi.fn();
    const kit = createKit(defaults, { onChange });
    kit.reset(0); // already the built-in one
    kit.set(1, defaults[1]); // the same sound
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not change the list it was made from", () => {
    const kit = createKit(defaults);
    kit.set(0, sound("loaded"));
    expect(defaults[0].id).toBe("kick");
  });
});
