import { describe, expect, it, vi } from "vitest";
import {
  CC_MAX,
  DETENT,
  TARGETS,
  assignCc,
  clearCc,
  createMidiMapping,
  formatAssignment,
  isAssignableCc,
  parseMidiMap,
  targetForCc,
} from "./midi-map.js";
import { EFFECTS } from "./effects.js";

const toSetting = TARGETS.masterFilter.toSetting;

describe("the Master Filter's knob", () => {
  it("reaches both ends of the filter", () => {
    expect(toSetting(0)).toBe(-100);
    expect(toSetting(CC_MAX)).toBe(100);
  });

  it("is off over the middle of the travel, on both sides of its two middle positions", () => {
    expect(toSetting(63)).toBe(0);
    expect(toSetting(64)).toBe(0);
    for (let value = 60; value <= 67; value++) expect(toSetting(value)).toBe(0);
  });

  it("starts to filter just past the detent, from 1 and not from a jump", () => {
    expect(toSetting(59)).toBe(-1);
    expect(toSetting(68)).toBe(1);
  });

  it("never moves more than a step or two between neighbouring positions, so it is smooth and has no jump at the detent", () => {
    for (let value = 1; value <= CC_MAX; value++)
      expect(Math.abs(toSetting(value) - toSetting(value - 1))).toBeLessThanOrEqual(2);
  });

  it("rises with the knob, never going back", () => {
    for (let value = 1; value <= CC_MAX; value++) expect(toSetting(value)).toBeGreaterThanOrEqual(toSetting(value - 1));
  });

  it("is symmetrical about the middle, and never a negative zero", () => {
    for (let value = 0; value <= 63; value++) expect(toSetting(value) + toSetting(CC_MAX - value)).toBe(0);
    for (let value = 0; value <= CC_MAX; value++) expect(Object.is(toSetting(value), -0)).toBe(false);
  });

  it("stays inside the filter's range for any value a controller can send", () => {
    for (let value = 0; value <= CC_MAX; value++) {
      expect(toSetting(value)).toBeGreaterThanOrEqual(EFFECTS.masterFilter.min);
      expect(toSetting(value)).toBeLessThanOrEqual(EFFECTS.masterFilter.max);
    }
  });

  it("has a detent that is a small part of the travel", () => {
    expect(DETENT).toBeGreaterThan(0);
    expect(DETENT).toBeLessThan(20);
  });
});

describe("isAssignableCc", () => {
  it("takes an ordinary knob on any channel", () => {
    expect(isAssignableCc(0, 21)).toBe(true);
    expect(isAssignableCc(15, 1)).toBe(true);
    expect(isAssignableCc(9, 127 - 8)).toBe(true);
  });

  it("leaves out the sustain pedal, bank select and the channel mode messages", () => {
    for (const controller of [0, 32, 64, 120, 121, 123, 127]) expect(isAssignableCc(0, controller)).toBe(false);
  });

  it("leaves out what is not a channel and a controller number", () => {
    expect(isAssignableCc(-1, 21)).toBe(false);
    expect(isAssignableCc(16, 21)).toBe(false);
    expect(isAssignableCc(0, 128)).toBe(false);
    expect(isAssignableCc(0, 2.5)).toBe(false);
    expect(isAssignableCc("0", 21)).toBe(false);
    expect(isAssignableCc(undefined, undefined)).toBe(false);
  });
});

describe("formatAssignment", () => {
  it("counts channels from 1, as a controller does", () => {
    expect(formatAssignment({ channel: 0, controller: 21 })).toBe("CH 1 CC 21");
    expect(formatAssignment({ channel: 9, controller: 7 })).toBe("CH 10 CC 7");
  });
});

describe("parseMidiMap", () => {
  it("reads a map as it was saved", () => {
    const stored = { masterFilter: { channel: 0, controller: 21 } };
    expect(parseMidiMap(stored)).toEqual(stored);
  });

  it("is empty for anything that is not a map, and never throws", () => {
    for (const stored of [null, undefined, 3, "x", [], [1, 2], true]) expect(parseMidiMap(stored)).toEqual({});
  });

  it("leaves out an entry that is not an assignable controller, and targets it does not know", () => {
    expect(parseMidiMap({ masterFilter: { channel: 0, controller: 64 } })).toEqual({});
    expect(parseMidiMap({ masterFilter: { channel: 16, controller: 21 } })).toEqual({});
    expect(parseMidiMap({ masterFilter: { channel: "0", controller: 21 } })).toEqual({});
    expect(parseMidiMap({ masterFilter: null })).toEqual({});
    expect(parseMidiMap({ cutoff: { channel: 0, controller: 21 } })).toEqual({});
  });

  it("does not keep what it was not given, nor a copy that shares the stored object", () => {
    const stored = { masterFilter: { channel: 2, controller: 30, extra: "x" } };
    const map = parseMidiMap(stored);
    expect(map).toEqual({ masterFilter: { channel: 2, controller: 30 } });
    expect(map.masterFilter).not.toBe(stored.masterFilter);
  });
});

describe("assigning and clearing", () => {
  const map = { masterFilter: { channel: 0, controller: 21 } };

  it("finds the target a controller on a channel is assigned to", () => {
    expect(targetForCc(map, 0, 21)).toBe("masterFilter");
  });

  it("does not find it on another channel, or for another controller, or in an empty map", () => {
    expect(targetForCc(map, 1, 21)).toBeNull();
    expect(targetForCc(map, 0, 22)).toBeNull();
    expect(targetForCc({}, 0, 21)).toBeNull();
  });

  it("assigns a new map and leaves the old one as it was", () => {
    const next = assignCc({}, "masterFilter", 3, 74);
    expect(next).toEqual({ masterFilter: { channel: 3, controller: 74 } });
    expect(map).toEqual({ masterFilter: { channel: 0, controller: 21 } });
  });

  it("replaces a target's earlier controller", () => {
    expect(assignCc(map, "masterFilter", 0, 22)).toEqual({ masterFilter: { channel: 0, controller: 22 } });
  });

  it("clears a target into a new map, and clearing one that is not assigned changes nothing", () => {
    expect(clearCc(map, "masterFilter")).toEqual({});
    expect(map.masterFilter).toBeDefined();
    expect(clearCc({}, "masterFilter")).toEqual({});
  });
});

// The page's view of a mapping, with what it needs from the page faked.
function setup({ stored = null, effect = 0, saveResult = true } = {}) {
  let current = effect;
  const calls = {
    save: vi.fn(() => saveResult),
    setEffect: vi.fn((name, value) => {
      current = value;
    }),
    onChange: vi.fn(),
    onMessage: vi.fn(),
  };
  const mapping = createMidiMapping({
    load: () => stored,
    save: calls.save,
    setEffect: calls.setEffect,
    getEffect: () => current,
    onChange: calls.onChange,
    onMessage: calls.onMessage,
  });
  return { mapping, ...calls };
}

const cc = (controller, value, channel = 0) => ({ channel, controller, value });

describe("a mapping that nothing is assigned in", () => {
  it("has nothing assigned and is not learning", () => {
    expect(setup().mapping.getState()).toEqual({ learning: null, assigned: { masterFilter: null } });
  });

  it("ignores a controller that is not assigned", () => {
    const { mapping, setEffect, save } = setup();
    mapping.handleCc(cc(21, 100));
    expect(setEffect).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("learning", () => {
  it("waits for a knob after Learn, and says so", () => {
    const { mapping, onMessage, onChange } = setup();
    mapping.startLearn("masterFilter");
    expect(mapping.getState().learning).toBe("masterFilter");
    expect(onMessage).toHaveBeenCalledWith("MOVE A KNOB FOR MASTER FILTER");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("takes the first knob turned, keeps it and says which", () => {
    const { mapping, save, onMessage } = setup();
    mapping.startLearn("masterFilter");
    mapping.handleCc(cc(21, 90, 2));
    expect(mapping.getState()).toEqual({ learning: null, assigned: { masterFilter: "CH 3 CC 21" } });
    expect(save).toHaveBeenCalledWith({ masterFilter: { channel: 2, controller: 21 } });
    expect(onMessage).toHaveBeenLastCalledWith("MASTER FILTER CH 3 CC 21");
  });

  it("does not move the filter with the turn that taught it", () => {
    const { mapping, setEffect } = setup();
    mapping.startLearn("masterFilter");
    mapping.handleCc(cc(21, 127));
    expect(setEffect).not.toHaveBeenCalled();
  });

  it("goes on waiting past a pedal or a channel message, which are not knobs, and says so", () => {
    const { mapping, save, onMessage } = setup();
    mapping.startLearn("masterFilter");
    mapping.handleCc(cc(64, 127));
    mapping.handleCc(cc(123, 0));
    expect(mapping.getState().learning).toBe("masterFilter");
    expect(save).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenLastCalledWith("CC 123 IS NOT A KNOB");
    mapping.handleCc(cc(74, 10));
    expect(mapping.getState().assigned.masterFilter).toBe("CH 1 CC 74");
  });

  it("can be cancelled, and then takes nothing", () => {
    const { mapping, save, onMessage } = setup();
    mapping.startLearn("masterFilter");
    mapping.cancelLearn();
    expect(mapping.getState().learning).toBeNull();
    expect(onMessage).toHaveBeenLastCalledWith("LEARN CANCELLED");
    mapping.handleCc(cc(21, 50));
    expect(save).not.toHaveBeenCalled();
  });

  it("says nothing when there was nothing to cancel", () => {
    const { mapping, onMessage, onChange } = setup();
    mapping.cancelLearn();
    expect(onMessage).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not learn a target it does not know", () => {
    const { mapping, onChange } = setup();
    mapping.startLearn("cutoff");
    expect(mapping.getState().learning).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("replaces a knob already assigned to the target", () => {
    const { mapping, save } = setup({ stored: { masterFilter: { channel: 0, controller: 21 } } });
    mapping.startLearn("masterFilter");
    mapping.handleCc(cc(22, 0));
    expect(save).toHaveBeenLastCalledWith({ masterFilter: { channel: 0, controller: 22 } });
    mapping.handleCc(cc(21, 127));
    expect(mapping.getState().assigned.masterFilter).toBe("CH 1 CC 22");
  });
});

describe("the Learn key", () => {
  it("waits for a knob when pressed, and stops waiting when pressed again", () => {
    const { mapping, onMessage } = setup();
    mapping.toggleLearn("masterFilter");
    expect(mapping.getState().learning).toBe("masterFilter");
    mapping.toggleLearn("masterFilter");
    expect(mapping.getState().learning).toBeNull();
    expect(onMessage).toHaveBeenLastCalledWith("LEARN CANCELLED");
  });

  it("is pressed again after a knob was taken: it waits for another", () => {
    const { mapping } = setup();
    mapping.toggleLearn("masterFilter");
    mapping.handleCc(cc(21, 1));
    mapping.toggleLearn("masterFilter");
    expect(mapping.getState().learning).toBe("masterFilter");
  });
});

describe("a Learn that has to stop", () => {
  it("is ended by Clear, which also takes the assigned knob", () => {
    const { mapping, save, setEffect } = setup({ stored: { masterFilter: { channel: 0, controller: 21 } } });
    mapping.toggleLearn("masterFilter");
    mapping.clear("masterFilter");
    expect(mapping.getState()).toEqual({ learning: null, assigned: { masterFilter: null } });
    expect(save).toHaveBeenLastCalledWith({});
    // A knob turned now is not taken by a Learn that was left running.
    mapping.handleCc(cc(30, 50));
    expect(mapping.getState().assigned.masterFilter).toBeNull();
    expect(setEffect).not.toHaveBeenCalled();
  });

  it("is ended by cancelLearn, which the page calls when MIDI is switched off or the panel is hidden", () => {
    const { mapping, save } = setup();
    mapping.toggleLearn("masterFilter");
    mapping.cancelLearn();
    mapping.handleCc(cc(21, 90));
    expect(save).not.toHaveBeenCalled();
    expect(mapping.getState().assigned.masterFilter).toBeNull();
  });
});

describe("storage that does not keep the map", () => {
  it("says so on the display when a taught knob could not be saved, and the knob works for now", () => {
    const { mapping, onMessage, setEffect } = setup({ saveResult: false });
    mapping.toggleLearn("masterFilter");
    mapping.handleCc(cc(21, 100));
    expect(onMessage).toHaveBeenLastCalledWith("MASTER FILTER CH 1 CC 21 (NOT SAVED)");
    mapping.handleCc(cc(21, 127));
    expect(setEffect).toHaveBeenCalledWith("masterFilter", 100);
  });

  it("says so when a clear could not be saved", () => {
    const { mapping, onMessage } = setup({
      stored: { masterFilter: { channel: 0, controller: 21 } },
      saveResult: false,
    });
    mapping.clear("masterFilter");
    expect(onMessage).toHaveBeenLastCalledWith("MASTER FILTER KNOB CLEARED (NOT SAVED)");
  });

  it("does not mention it when the map was kept", () => {
    const { mapping, onMessage } = setup();
    mapping.toggleLearn("masterFilter");
    mapping.handleCc(cc(21, 100));
    expect(onMessage).toHaveBeenLastCalledWith("MASTER FILTER CH 1 CC 21");
  });

  it("takes a save that returns nothing as kept", () => {
    const { mapping, onMessage } = setup({ saveResult: undefined });
    mapping.toggleLearn("masterFilter");
    mapping.handleCc(cc(21, 100));
    expect(onMessage).toHaveBeenLastCalledWith("MASTER FILTER CH 1 CC 21");
  });
});

describe("an assigned knob", () => {
  const stored = { masterFilter: { channel: 0, controller: 21 } };

  it("is read from what was stored", () => {
    expect(setup({ stored }).mapping.getState().assigned.masterFilter).toBe("CH 1 CC 21");
  });

  it("starts from nothing assigned when what was stored is not a map", () => {
    expect(setup({ stored: "junk" }).mapping.getState().assigned.masterFilter).toBeNull();
  });

  it("sets the Master Filter from the knob's position", () => {
    const { mapping, setEffect } = setup({ stored });
    mapping.handleCc(cc(21, 0));
    mapping.handleCc(cc(21, 127));
    expect(setEffect).toHaveBeenNthCalledWith(1, "masterFilter", -100);
    expect(setEffect).toHaveBeenNthCalledWith(2, "masterFilter", 100);
  });

  it("turns the filter off in the knob's middle", () => {
    const { mapping, setEffect } = setup({ stored, effect: -40 });
    mapping.handleCc(cc(21, 64));
    expect(setEffect).toHaveBeenCalledWith("masterFilter", 0);
  });

  it("does not set the filter again for a position that is the setting it already has", () => {
    const { mapping, setEffect } = setup({ stored });
    for (const value of [62, 63, 64, 65, 66]) mapping.handleCc(cc(21, value));
    expect(setEffect).not.toHaveBeenCalled();
  });

  it("follows the slider: a knob at the same position as before sets it again once the slider has moved", () => {
    const { mapping, setEffect } = setup({ stored, effect: 55 });
    mapping.handleCc(cc(21, 127));
    expect(setEffect).toHaveBeenCalledWith("masterFilter", 100);
  });

  it("ignores the same controller on another channel and other controllers", () => {
    const { mapping, setEffect } = setup({ stored });
    mapping.handleCc(cc(21, 127, 1));
    mapping.handleCc(cc(22, 127));
    expect(setEffect).not.toHaveBeenCalled();
  });

  it("can be cleared, kept as cleared, and then does nothing", () => {
    const { mapping, setEffect, save, onMessage } = setup({ stored });
    mapping.clear("masterFilter");
    expect(save).toHaveBeenCalledWith({});
    expect(onMessage).toHaveBeenLastCalledWith("MASTER FILTER KNOB CLEARED");
    expect(mapping.getState().assigned.masterFilter).toBeNull();
    mapping.handleCc(cc(21, 127));
    expect(setEffect).not.toHaveBeenCalled();
  });

  it("says and saves nothing when what is cleared was not assigned", () => {
    const { mapping, save, onMessage } = setup();
    mapping.clear("masterFilter");
    expect(save).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("tells the view whenever the assignment or Learn changes", () => {
    const { mapping, onChange } = setup();
    mapping.startLearn("masterFilter");
    mapping.handleCc(cc(21, 1));
    mapping.clear("masterFilter");
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});
