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
    expect(onChange).toHaveBeenCalledWith(2, "sound");
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

describe("pad settings", () => {
  // A context whose gains record their level and where they are connected.
  function fakeContext() {
    const gains = [];
    return {
      gains,
      ctx: {
        createGain: () => {
          const gain = { gain: { value: 1 }, connect: vi.fn() };
          gains.push(gain);
          return gain;
        },
      },
    };
  }

  it("starts every pad at the defaults, or at the settings it is given", () => {
    const kit = createKit(defaults, { settings: { 1: { gain: -6, pitch: 2 } } });
    expect(kit.settings(0)).toEqual({ gain: 0, pitch: 0, choke: 0, color: 0 });
    expect(kit.settings(1)).toEqual({ gain: -6, pitch: 2, choke: 0, color: 0 });
  });

  it("changes one setting, clamped, and tells the views only when it changed", () => {
    const onChange = vi.fn();
    const kit = createKit(defaults, { onChange });
    kit.setSetting(0, "gain", -3.4);
    expect(kit.settings(0).gain).toBe(-3);
    expect(onChange).toHaveBeenCalledWith(0, "setting");
    kit.setSetting(0, "gain", -3);
    kit.setSetting(0, "pitch", 0);
    expect(onChange).toHaveBeenCalledTimes(1);
    kit.setSetting(0, "pitch", 40);
    expect(kit.settings(0).pitch).toBe(12);
  });

  it("hands out a copy of the settings, not its own", () => {
    const kit = createKit(defaults);
    kit.settings(0).gain = -20;
    expect(kit.settings(0).gain).toBe(0);
  });

  it("lists only the pads that are not at the defaults, in the shape it starts from", () => {
    const kit = createKit(defaults);
    expect(kit.settingsSnapshot()).toEqual({});
    kit.setSetting(2, "pitch", -5);
    kit.setSetting(1, "gain", 3);
    expect(kit.settingsSnapshot()).toEqual({
      1: { gain: 3, pitch: 0, choke: 0, color: 0 },
      2: { gain: 0, pitch: -5, choke: 0, color: 0 },
    });
    kit.setSetting(2, "pitch", 0);
    expect(kit.settingsSnapshot()).toEqual({ 1: { gain: 3, pitch: 0, choke: 0, color: 0 } });
    const copy = createKit(defaults, { settings: kit.settingsSnapshot() });
    expect(copy.settings(1)).toEqual({ gain: 3, pitch: 0, choke: 0, color: 0 });
  });

  describe("the voice a pad plays with", () => {
    it("plays the sound exactly as it always was at the defaults: no extra node, no extra argument", () => {
      const { ctx, gains } = fakeContext();
      const kit = createKit(defaults);
      const out = { name: "out" };
      kit.voice(0).play(ctx, out, 1.5);
      expect(defaults[0].play.mock.calls[0]).toEqual([ctx, out, 1.5]);
      expect(gains).toHaveLength(0);
    });

    it("puts a gain stage in front of the output for the pad's gain", () => {
      const { ctx, gains } = fakeContext();
      const kit = createKit(defaults);
      kit.setSetting(1, "gain", -6);
      const out = { name: "out" };
      kit.voice(1).play(ctx, out, 2);
      expect(gains).toHaveLength(1);
      expect(gains[0].gain.value).toBeCloseTo(0.501, 3);
      expect(gains[0].connect).toHaveBeenCalledWith(out);
      expect(defaults[1].play.mock.calls[0][1]).toBe(gains[0]);
    });

    it("passes the playback rate to the sound for the pad's pitch, and only then", () => {
      const { ctx } = fakeContext();
      const kit = createKit(defaults);
      kit.setSetting(2, "pitch", 12);
      kit.voice(2).play(ctx, {}, 0);
      expect(defaults[2].play.mock.calls[0][3]).toEqual({ rate: 2 });
      kit.setSetting(2, "pitch", 0);
      kit.voice(2).play(ctx, {}, 0);
      expect(defaults[2].play.mock.calls[1]).toHaveLength(3);
    });

    it("applies gain and pitch together: the gain stage in front of the output and the rate to the sound", () => {
      const { ctx, gains } = fakeContext();
      const kit = createKit(defaults);
      kit.setSetting(1, "gain", -6);
      kit.setSetting(1, "pitch", 12);
      const out = { name: "out" };
      kit.voice(1).play(ctx, out, 3);
      expect(gains).toHaveLength(1);
      expect(gains[0].gain.value).toBeCloseTo(0.501, 3);
      expect(gains[0].connect).toHaveBeenCalledWith(out);
      const call = defaults[1].play.mock.calls[0];
      expect(call[1]).toBe(gains[0]);
      expect(call[2]).toBe(3);
      expect(call[3]).toEqual({ rate: 2 });
    });

    it("follows the kit: a swapped sound and a changed setting are heard at the next hit", () => {
      const { ctx } = fakeContext();
      const kit = createKit(defaults);
      const voice = kit.voice(0); // taken before the changes
      const loaded = sound("loaded");
      kit.set(0, loaded);
      kit.setSetting(0, "pitch", -12);
      voice.play(ctx, {}, 0);
      expect(loaded.play.mock.calls[0][3]).toEqual({ rate: 0.5 });
      expect(voice.name).toBe("loaded");
      expect(defaults[0].play).not.toHaveBeenCalled();
    });

    it("keeps a pad's settings when its sound is swapped or put back", () => {
      const kit = createKit(defaults);
      kit.setSetting(0, "gain", -9);
      kit.set(0, sound("loaded"));
      kit.reset(0);
      expect(kit.settings(0).gain).toBe(-9);
    });
  });
});

describe("a pad's choke group", () => {
  it("is set like the other settings, clamped, and reported once when it changes", () => {
    const onChange = vi.fn();
    const kit = createKit(defaults, { onChange });
    kit.setSetting(1, "choke", 3);
    kit.setSetting(1, "choke", 3);
    expect(kit.settings(1).choke).toBe(3);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(1, "setting");
    kit.setSetting(1, "choke", 99);
    expect(kit.settings(1).choke).toBe(8);
  });

  it("is listed for a pad that has nothing else set, and left out when it goes back to none", () => {
    const kit = createKit(defaults);
    kit.setSetting(2, "choke", 1);
    expect(kit.settingsSnapshot()).toEqual({ 2: { gain: 0, pitch: 0, choke: 1, color: 0 } });
    kit.setSetting(2, "choke", 0);
    expect(kit.settingsSnapshot()).toEqual({});
  });
});

describe("a pad's colour", () => {
  it("is set like the other settings, clamped, and reported once when it changes", () => {
    const onChange = vi.fn();
    const kit = createKit(defaults, { onChange });
    kit.setSetting(0, "color", 4);
    kit.setSetting(0, "color", 4);
    expect(kit.settings(0).color).toBe(4);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(0, "setting");
    kit.setSetting(0, "color", 99);
    expect(kit.settings(0).color).toBe(8);
  });

  it("is listed for a pad that has nothing else set, and left out when it goes back to none", () => {
    const kit = createKit(defaults);
    kit.setSetting(1, "color", 2);
    expect(kit.settingsSnapshot()).toEqual({ 1: { gain: 0, pitch: 0, choke: 0, color: 2 } });
    kit.setSetting(1, "color", 0);
    expect(kit.settingsSnapshot()).toEqual({});
  });
});
